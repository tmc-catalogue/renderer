import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
	buildGlassMeshes,
	glassConnections,
	isSurfaceBlock,
	makeGlassMaterial,
	surfaceFaces,
} from "./ConnectedGlass";
import { buildEndPortalMesh, makeEndPortalMaterial } from "./EndPortal";
import { GpuMeshBuilder } from "./GpuMeshBuilder";

const colors = [
	"white",
	"orange",
	"magenta",
	"light_blue",
	"yellow",
	"lime",
	"pink",
	"gray",
	"light_gray",
	"cyan",
	"purple",
	"blue",
	"brown",
	"green",
	"red",
	"black",
];
function faces(name: string, pane = false) {
	const material = new THREE.MeshBasicMaterial();
	material.userData.texturePath = `block/${name}`;
	return surfaceFaces([{ geometry: new THREE.BoxGeometry(1, 1, pane ? 0.125 : 1), material }]);
}
function scene(cells: Array<[number, number, number, string]>, pane = false) {
	const blocks = new Map(cells.map(([x, y, z, s]) => [`${x},${y},${z}`, s]));
	const get = (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`);
	const templates = new Map(cells.map(([, , , s]) => [s, faces(s, pane)]));
	const materials = new Map(
		[...templates.values()]
			.flat()
			.map((f) => [f.texture, makeGlassMaterial(new THREE.Texture(), true)])
	);
	const meshes = buildGlassMeshes(
		get,
		cells.map(([x, y, z, state]) => ({ x, y, z, state })),
		templates,
		materials
	);
	return { get, templates, meshes };
}
const vertices = (meshes: THREE.Mesh[]) => meshes.reduce((n, m) => n + m.geometry.index!.count, 0);

describe("connected glass surfaces", () => {
	it("allows a surface-only schematic without allocating empty GPU buffers", async () => {
		const builder = new GpuMeshBuilder();
		const grid = new Uint32Array([1]);
		expect(await builder.buildMeshes(grid, 1, 1, 1, [], () => [])).toEqual([]);
		expect(await builder.buildRecordMeshes(grid, 1, 1, 1, [], () => [])).toEqual({
			meshes: [],
			stream: null,
		});
	});
	it.each(["glass", "tinted_glass", ...colors.map((c) => `${c}_stained_glass`)])(
		"joins %s across a chunk boundary and removes its internal faces",
		(name) => {
			const { meshes } = scene([
				[15, 0, 0, name],
				[16, 0, 0, name],
			]);
			expect(vertices(meshes)).toBe(10 * 6);
			expect(meshes).toHaveLength(2);
			expect(
				meshes.reduce(
					(n, m) => n + Array.from(m.geometry.getAttribute("aEdges").array).filter(Boolean).length,
					0
				)
			).toBe(8 * 4);
		}
	);
	it.each(["glass_pane", ...colors.map((c) => `${c}_stained_glass_pane`)])(
		"joins %s without turning it into a full cube",
		(name) => {
			const { meshes } = scene(
				[
					[0, 0, 0, name],
					[1, 0, 0, name],
				],
				true
			);
			expect(vertices(meshes)).toBe(60);
			const bounds = new THREE.Box3().setFromObject(meshes[0]);
			expect(bounds.max.z - bounds.min.z).toBe(0.125);
			expect(
				meshes.some((m) => Array.from(m.geometry.getAttribute("aEdges").array).some(Boolean))
			).toBe(true);
		}
	);
	it("keeps a boundary between different colors and between blocks and panes", () => {
		for (const other of ["blue_stained_glass", "red_stained_glass_pane", "glass"]) {
			const { meshes } = scene([
				[0, 0, 0, "red_stained_glass"],
				[1, 0, 0, other],
			]);
			expect(vertices(meshes)).toBe(72);
			expect(
				meshes.every((m) =>
					Array.from(m.geometry.getAttribute("aEdges").array).every((v) => v === 0)
				)
			).toBe(true);
		}
	});
	it("distinguishes the missing diagonal in an L-shaped window", () => {
		const { get, templates } = scene([
			[0, 0, 0, "glass"],
			[1, 0, 0, "glass"],
			[0, 1, 0, "glass"],
		]);
		const front = templates.get("glass")!.find((f) => f.normal.z > 0.9)!;
		const mask = glassConnections(front, "glass", 0, 0, 0, get, templates);
		expect(mask.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(2);
		expect(mask[7]).toBe(0);
		const full = (x: number, y: number, z: number) =>
			x === 1 && y === 1 && z === 0 ? "glass" : get(x, y, z);
		expect(glassConnections(front, "glass", 0, 0, 0, full, templates)[7]).toBe(1);
	});
	it("preserves stained alpha below 50% and restores texture UVs from the atlas", () => {
		const material = makeGlassMaterial(new THREE.Texture(), true);
		expect(material.transparent).toBe(true);
		expect(material.alphaTest).toBeLessThan(0.1);
		expect(material.depthWrite).toBe(false);
		const geometry = new THREE.PlaneGeometry();
		const uv = geometry.getAttribute("uv");
		for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.25 + uv.getX(i) / 8, 0.5 + uv.getY(i) / 8);
		material.userData.atlasUV = { u: 0.25, v: 0.375, width: 0.125, height: 0.125 };
		expect(
			surfaceFaces([{ geometry, material }])[0].uvs.every(
				(p) => [0, 1].includes(p.x) && [0, 1].includes(p.y)
			)
		).toBe(true);
	});
	it("writes depth for binary glass borders but blends partially transparent glass", () => {
		const map = new THREE.Texture();
		const cutout = makeGlassMaterial(
			map,
			true,
			undefined,
			new THREE.MeshStandardMaterial({ alphaTest: 0.5 })
		);
		expect(cutout.transparent).toBe(false);
		expect(cutout.depthWrite).toBe(true);
		expect(cutout.alphaTest).toBe(0.5);
		const stained = makeGlassMaterial(
			map,
			true,
			undefined,
			new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.01, depthWrite: false })
		);
		expect(stained.transparent).toBe(true);
		expect(stained.depthWrite).toBe(false);
		cutout.dispose();
		stained.dispose();
		map.dispose();
	});
	it("partitions mixed alpha glass into mutually exclusive depth-writing and blended passes", () => {
		const source = new THREE.MeshStandardMaterial({
			transparent: true,
			alphaTest: 0.01,
			depthWrite: false,
		});
		source.userData.alphaClass = "blend";
		source.userData.hasOpaquePixels = true;
		const texture = new THREE.Texture();
		const material = makeGlassMaterial(texture, true, undefined, source);
		const meshes = buildGlassMeshes(
			() => "red_stained_glass",
			[{ x: 0, y: 0, z: 0, state: "red_stained_glass" }],
			new Map([["red_stained_glass", faces("red_stained_glass")]]),
			new Map([["block/red_stained_glass", material]])
		);
		// Return air for actual neighbours to expose both passes' geometry.
		const isolated = buildGlassMeshes(
			(x, y, z) => (x === 0 && y === 0 && z === 0 ? "red_stained_glass" : undefined),
			[{ x: 0, y: 0, z: 0, state: "red_stained_glass" }],
			new Map([["red_stained_glass", faces("red_stained_glass")]]),
			new Map([["block/red_stained_glass", material]])
		);
		expect(meshes).toHaveLength(0);
		expect(isolated).toHaveLength(2);
		const [opaque, blend] = isolated.map((mesh) => mesh.material as THREE.Material);
		expect(opaque).toMatchObject({ transparent: false, depthWrite: true });
		expect(blend).toMatchObject({ transparent: true, depthWrite: false });
		for (const [pass, operator] of [
			[opaque, "<"],
			[blend, ">="],
		] as const) {
			const shader = {
				uniforms: {},
				vertexShader: "#include <common>\n#include <begin_vertex>",
				fragmentShader:
					"#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>",
			};
			pass.onBeforeCompile(shader as any, null as any);
			expect(shader.fragmentShader).toContain(`if (glassSourceAlpha ${operator} 0.999) discard;`);
		}
		material.dispose();
		texture.dispose();
		isolated.forEach((mesh) => mesh.geometry.dispose());
	});
	it("only takes ownership of glass and actual portal blocks", () => {
		expect(isSurfaceBlock("minecraft:nether_portal[axis=z]")).toBe(true);
		expect(isSurfaceBlock("minecraft:end_portal")).toBe(true);
		expect(isSurfaceBlock("minecraft:end_portal_frame[eye=true]")).toBe(false);
	});
});

describe("End portals", () => {
	it("creates a continuous, opaque, double-sided surface at the portal height", () => {
		const mesh = buildEndPortalMesh(
			[0, 1].map((x) => ({ x, y: 0, z: 0, state: "minecraft:end_portal" })),
			makeEndPortalMaterial(new THREE.Texture(), new THREE.Texture()),
			true
		)!;
		expect(mesh.geometry.getAttribute("position").count).toBe(12);
		const bounds = new THREE.Box3().setFromObject(mesh);
		expect(bounds.min.y).toBe(0.25);
		expect(bounds.max.y).toBe(0.25);
		const material = mesh.material as THREE.ShaderMaterial;
		expect(material.side).toBe(THREE.DoubleSide);
		expect(material.transparent).toBe(false);
		expect(mesh.userData.animatedSurface).toBe(true);
	});
	it("does not substitute a portal surface for a frame block", () => {
		expect(
			buildEndPortalMesh(
				[{ x: 0, y: 0, z: 0, state: "minecraft:end_portal_frame" }],
				makeEndPortalMaterial(new THREE.Texture(), new THREE.Texture()),
				false
			)
		).toBeNull();
	});
});
