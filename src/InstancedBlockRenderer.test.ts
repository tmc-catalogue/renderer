import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { InstancedBlockRenderer } from "./InstancedBlockRenderer";
import { MaterialRegistry } from "./MaterialRegistry";

it("merges only same-material geometry and preserves same-name palette variants", () => {
	const root = new THREE.Group(),
		geometry = new THREE.BoxGeometry();
	const opaque = new THREE.MeshBasicMaterial(),
		cutout = new THREE.MeshBasicMaterial({ alphaTest: 0.5 });
	const data = {
		isReady: true,
		blockData: [
			{
				blockName: "minecraft:custom",
				category: "solid",
				materialGroups: [
					{ baseGeometry: geometry, material: opaque },
					{ baseGeometry: geometry, material: cutout },
				],
			},
			{
				blockName: "minecraft:custom",
				category: "cutout",
				materialGroups: [{ baseGeometry: geometry, material: cutout }],
			},
		],
	};
	const renderer = new InstancedBlockRenderer(root, data);
	try {
		renderer.initializeInstancedMeshesMerged();
		renderer.renderBlocksInstanced([
			{ x: 0, y: 0, z: 0, paletteIndex: 0 },
			{ x: 1, y: 0, z: 0, paletteIndex: 1 },
		]);
		const meshes = renderer.getInstancedMeshes("minecraft:custom");
		expect(meshes).toHaveLength(3);
		expect(meshes.filter((m) => m.material === cutout)).toHaveLength(2);
		expect(meshes.map((m) => m.count)).toEqual([1, 1, 1]);
		expect(cutout.transparent).toBe(false);
		expect(cutout.depthWrite).toBe(true);
	} finally {
		renderer.disposeInstancedMeshes();
		geometry.dispose();
		opaque.dispose();
		cutout.dispose();
	}
});

it.each(["initializeInstancedMeshes", "initializeInstancedMeshesMerged"] as const)(
	"allocates instance matrices on demand and reuses capacity after %s",
	(initialize) => {
		const group = new THREE.Group();
		const geometry = new THREE.BoxGeometry();
		const material = new THREE.MeshBasicMaterial();
		const renderer = new InstancedBlockRenderer(group, {
			isReady: true,
			blockData: ["stone", "dirt"].map((name) => ({
				blockName: `minecraft:${name}`,
				category: "solid",
				materialGroups: [{ baseGeometry: geometry, material }],
			})),
		});
		const stone = () => renderer.getInstancedMeshes("minecraft:stone#0")[0];
		const positions = (count: number) =>
			Array.from({ length: count }, (_, x) => ({ x: x + 5, y: -1, z: 2, paletteIndex: 0 }));
		const matrix = new THREE.Matrix4();
		try {
			renderer[initialize]();
			const unused = renderer.getInstancedMeshes("minecraft:dirt#1")[0];
			expect(stone().instanceMatrix.count).toBe(0);
			expect(unused.instanceMatrix.count).toBe(0);
			expect(unused.visible).toBe(false);

			renderer.renderBlocksInstanced(positions(1));
			const first = stone();
			const disposeFirst = vi.fn();
			const disposeGeometry = vi.fn();
			first.addEventListener("dispose", disposeFirst);
			first.geometry.addEventListener("dispose", disposeGeometry);
			expect(first.instanceMatrix.count).toBe(1);
			first.getMatrixAt(0, matrix);
			expect(matrix.elements.slice(12, 15)).toEqual([5, -1, 2]);

			renderer.renderBlocksInstanced(positions(3));
			const grown = stone();
			const grownMatrix = grown.instanceMatrix;
			expect(grown.count).toBe(3);
			expect(grownMatrix.count).toBe(3);
			expect(grown.geometry).toBe(first.geometry);
			expect(disposeFirst).toHaveBeenCalledOnce();
			expect(disposeGeometry).not.toHaveBeenCalled();
			expect(first.parent).toBeNull();
			grown.getMatrixAt(2, matrix);
			expect(matrix.elements.slice(12, 15)).toEqual([7, -1, 2]);

			renderer.renderBlocksInstanced(positions(2));
			expect(stone()).toBe(grown);
			expect(grown.instanceMatrix).toBe(grownMatrix);
			expect(grown.count).toBe(2);
			expect(renderer.getInstancedMeshes("minecraft:dirt#1")[0]).toBe(unused);
			expect(unused.instanceMatrix.count).toBe(0);
		} finally {
			renderer.disposeInstancedMeshes();
			geometry.dispose();
			material.dispose();
		}
		expect(group.children).toHaveLength(0);
	}
);

it("clears overflow on subsequent renders and initialization", () => {
	const group = new THREE.Group();
	const geometry = new THREE.BoxGeometry();
	const material = new THREE.MeshBasicMaterial();
	const renderer = new InstancedBlockRenderer(group, {
		isReady: true,
		blockData: [
			{
				blockName: "minecraft:stone",
				category: "solid",
				materialGroups: [{ baseGeometry: geometry, material }],
			},
		],
	});
	const positions = Array.from({ length: 50001 }, (_, x) => ({ x, y: 0, z: 0, paletteIndex: 0 }));
	try {
		renderer.initializeInstancedMeshesMerged();
		renderer.renderBlocksInstanced(positions);
		const [mesh] = renderer.getInstancedMeshes("minecraft:stone");
		const overflow = group.children.find((child) => child.name.startsWith("overflow_"));
		expect(mesh.count).toBe(50000);
		expect(mesh.instanceMatrix.count).toBe(50000);
		expect(overflow?.position.x).toBe(50000);
		expect(group.children).toHaveLength(2);
		renderer.renderBlocksInstanced(positions.slice(0, 1));
		expect(group.children).toEqual([mesh]);
		expect(mesh.count).toBe(1);
		renderer.renderBlocksInstanced(positions);
		renderer.initializeInstancedMeshesMerged();
		expect(group.children).toHaveLength(1);
		expect(renderer.getInstancedMeshes("minecraft:stone")[0].instanceMatrix.count).toBe(0);
	} finally {
		renderer.disposeInstancedMeshes();
		geometry.dispose();
		material.dispose();
	}
});

it("does not merge materials with different depth semantics and exposes a shared ownership marker", () => {
	const a = new THREE.MeshBasicMaterial(),
		b = new THREE.MeshBasicMaterial({ depthWrite: false });
	const sa = MaterialRegistry.getMaterial(a),
		sb = MaterialRegistry.getMaterial(b);
	try {
		expect(sa).not.toBe(sb);
		expect(sa.userData.registryShared).toBe(true);
		expect(sb.depthWrite).toBe(false);
	} finally {
		MaterialRegistry.releaseMaterial(sa);
		MaterialRegistry.releaseMaterial(sb);
		a.dispose();
		b.dispose();
	}
});
