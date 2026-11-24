import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
	disposeRecordMeshes,
	makeRecordMeshes,
	materializeRecordMeshes,
	splitRecordMaterialRuns,
	type RecordTables,
} from "./RecordRenderer";

const tables: RecordTables = {
	rowCorners: new Uint32Array([0, 1, 2, 0, 0, 2, 3, 0]),
	rows: 2,
	tplPos: new Float32Array(16),
	tplNrm: new Float32Array(16),
	tplUv: new Float32Array(16),
	verts: 4,
};

const cameraAt = (x: number, width = 40) => {
	const camera = new THREE.OrthographicCamera(-width, width, width, -width, 0.1, 100);
	camera.position.set(x, 0, 50);
	camera.lookAt(x, 0, 0);
	camera.updateMatrixWorld();
	return camera;
};

function beforeRender(mesh: THREE.Mesh, camera: THREE.Camera) {
	mesh.onBeforeRender(null!, null!, camera, mesh.geometry, mesh.material as THREE.Material, null!);
}

function submittedItems(mesh: THREE.Mesh, verticesPerItem: number) {
	const material = mesh.material as THREE.ShaderMaterial;
	const pages = (material.uniforms.uPages.value as THREE.DataTexture).image.data as Uint32Array;
	let submitted = 0;
	for (let slot = 0; slot < mesh.geometry.drawRange.count / verticesPerItem; slot++) {
		if (slot % 64 < pages[Math.floor(slot / 64) * 2 + 1]) submitted++;
	}
	return submitted;
}

describe("record renderer material and geometry parity", () => {
	it("expands low-binding GPU records into conventional geometry with identical coordinates and material", () => {
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		const recordTables = {
			...tables,
			tplPos: new Float32Array([
				-0.5, 0, -0.5, 0, 0.5, 0, -0.5, 0, 0.5, 0.5, -0.5, 0, -0.5, 0.5, -0.5, 0,
			]),
			tplNrm: new Float32Array([0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0]),
			tplUv: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0]),
		};
		const [mesh] = materializeRecordMeshes({
			tables: recordTables,
			sx: 4,
			sy: 2,
			sz: 3,
			perCategory: [{ category: "solid", records: new Uint32Array([19, 0]), tris: 1, material }],
		});
		expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual([
			2.5, 1, 0.5, 3.5, 1, 0.5, 3.5, 1.5, 0.5,
		]);
		expect(Array.from(mesh.geometry.getAttribute("normal").array)).toEqual([
			0, 0, -1, 0, 0, -1, 0, 0, -1,
		]);
		expect(Array.from(mesh.geometry.getAttribute("uv").array)).toEqual([0, 0, 1, 0, 1, 1]);
		expect(mesh.material).toBe(material);
		mesh.geometry.dispose();
	});
	it("reserves index backing for every section's padded quads regardless of camera order", () => {
		const cells = [
			0,
			...Array.from({ length: 64 }, (_, i) => 16 + (i % 16) + 32 * Math.floor(i / 16)),
		];
		const records = Uint32Array.from(cells.flatMap((cell) => [cell, 0, cell, 1]));
		const [mesh] = makeRecordMeshes(
			{ perCategory: [{ category: "solid", records, tris: 130 }], tables, sx: 32, sy: 4, sz: 4 },
			null,
			(a, b) => ({ quad: a === 0 && b === 1, corners: [0, 1, 2, 3] })
		);
		for (const x of [0, 32]) {
			const camera = cameraAt(x);
			beforeRender(mesh, camera);
			expect(mesh.geometry.index?.count).toBe(128 * 6);
			expect(mesh.geometry.drawRange.count).toBe(128 * 6);
			expect(submittedItems(mesh, 6)).toBe(65);
			const pageTable = (mesh.material as THREE.ShaderMaterial).uniforms.uPages
				.value as THREE.DataTexture;
			const version = pageTable.version;
			beforeRender(mesh, camera);
			expect(pageTable.version).toBe(version);
		}
		disposeRecordMeshes([mesh]);
	});

	it("allocates triangle page tables for many tiny visible sections", () => {
		const n = 1025;
		const records = Uint32Array.from(Array.from({ length: n }, (_, i) => [i * 16, 0]).flat());
		const [mesh] = makeRecordMeshes(
			{ perCategory: [{ category: "solid", records, tris: n }], tables, sx: 16 * n, sy: 1, sz: 1 },
			null
		);
		beforeRender(mesh, cameraAt(8 * n, 16 * n));
		expect(mesh.userData.pagesDrawn).toBe(n);
		expect(submittedItems(mesh, 3)).toBe(n);
		disposeRecordMeshes([mesh]);
	});

	it("uses actual material runs, retaining atlas batching, cutout depth and independent maps", () => {
		const atlas = new THREE.Texture();
		const animatedMap = new THREE.Texture();
		const solid = new THREE.MeshStandardMaterial({ map: atlas, color: 0x334455 });
		solid.userData.useAtlas = true;
		const cutout = new THREE.MeshStandardMaterial({
			map: atlas,
			alphaTest: 0.5,
			side: THREE.DoubleSide,
		});
		cutout.userData.useAtlas = true;
		const translucent = new THREE.MeshStandardMaterial({
			map: animatedMap,
			emissive: 0x112233,
			emissiveIntensity: 2,
			emissiveMap: animatedMap,
			transparent: true,
			depthWrite: false,
			opacity: 0.4,
		});
		const records = new Uint32Array([0, 0, 0, 1, 1, 0, 1, 1]);
		const runs = splitRecordMaterialRuns(
			records,
			[2, 0, 1, 1],
			[solid, solid, cutout, translucent],
			"transparent"
		);
		expect(runs.map((r) => [r.category, r.tris])).toEqual([
			["solid", 2],
			["cutout", 1],
			["transparent", 1],
		]);
		expect(runs.every((r) => r.records.buffer === records.buffer)).toBe(true);
		const meshes = makeRecordMeshes({ perCategory: runs, tables, sx: 2, sy: 1, sz: 1 }, null);
		const [opaque, tested, blended] = meshes.map((mesh) => mesh.material as THREE.ShaderMaterial);
		expect(opaque.transparent).toBe(false);
		expect(opaque.uniforms.uTint.value).toEqual(solid.color);
		expect(opaque.uniforms.uAtlas.value).toBe(atlas);
		expect(opaque.uniforms.uAtlasMipCap.value).toBe(4);
		expect(tested.transparent).toBe(false);
		expect(tested.depthWrite).toBe(true);
		expect(tested.side).toBe(THREE.DoubleSide);
		expect(tested.fragmentShader).toContain("c.a * uBaseOpacity < uAlphaTest");
		expect(blended.fragmentShader).not.toContain("c.a * uBaseOpacity < uAlphaTest");
		expect(blended.transparent).toBe(true);
		expect(blended.depthWrite).toBe(false);
		expect(blended.uniforms.uAtlas.value).toBe(animatedMap);
		expect(blended.uniforms.uAtlasMipCap.value).toBe(-1);
		expect(blended.uniforms.uEmissive.value).toEqual(
			translucent.emissive.clone().multiplyScalar(2)
		);
		expect(blended.uniforms.uHasEmissiveMap.value).toBe(2);
		expect(blended.uniforms.uOpacity.value).toBe(0.4);
		expect(blended.fragmentShader).not.toContain("uWaterFrames");
		animatedMap.offset.set(0, 0.25);
		blended.opacity = 0.2;
		beforeRender(meshes[2], cameraAt(0));
		expect(blended.uniforms.uMapMatrix.value).toEqual(animatedMap.matrix);
		expect(blended.uniforms.uOpacity.value).toBe(0.2);
		tested.opacity = 0.1;
		beforeRender(meshes[1], cameraAt(0));
		expect(tested.uniforms.uOpacity.value).toBe(0.1);
		expect(tested.uniforms.uBaseOpacity.value).toBe(1);
		disposeRecordMeshes(meshes);
	});

	it("releases generated textures once without destroying live sibling tables or asset maps", () => {
		const map = new THREE.Texture();
		const material = new THREE.MeshBasicMaterial({ map });
		const records = new Uint32Array([0, 0]);
		const run = { category: "solid", records, tris: 1, material };
		const meshes = makeRecordMeshes({ perCategory: [run, run], tables, sx: 1, sy: 1, sz: 1 }, null);
		const [a, b] = meshes.map((mesh) => mesh.material as THREE.ShaderMaterial);
		const shared = a.uniforms.uPos.value as THREE.Texture;
		const disposed: string[] = [];
		for (const [key, texture] of [
			["shared", shared],
			["first", a.uniforms.uRecords.value],
			["last", b.uniforms.uRecords.value],
			["source", map],
		] as [string, THREE.Texture][]) {
			texture.addEventListener("dispose", () => disposed.push(key));
		}
		disposeRecordMeshes([meshes[0]]);
		expect(disposed).toEqual(["first"]);
		disposeRecordMeshes([meshes[1], meshes[0]]);
		expect(disposed).toEqual(["first", "last", "shared"]);
	});
});
