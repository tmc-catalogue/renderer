import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildFluidMeshes, disposeFluidMeshes } from "./WaterMesher";
const meshes: THREE.Mesh[] = [];
afterEach(() => disposeFluidMeshes(meshes.splice(0)));
function surface(cells: Record<string, string>, sx = 5, sy = 3, sz = 5) {
	const result = buildFluidMeshes((x, y, z) => cells[`${x},${y},${z}`], sx, sy, sz);
	meshes.push(...result.meshes);
	return result;
}
function faces(mesh: THREE.Mesh, x: number, y: number, z: number, face: number) {
	const { position, uv, aFace, aTexture } = mesh.geometry.attributes;
	const output: { uv: number[]; texture: number; position: number[] }[] = [];
	for (let i = 0; i < position.count; i += 4) {
		let cx = 0,
			cy = 0,
			cz = 0;
		for (let j = 0; j < 4; j++) {
			cx += position.getX(i + j);
			cy += position.getY(i + j);
			cz += position.getZ(i + j);
		}
		if (
			aFace.getX(i) !== face ||
			Math.abs(cx / 4 - x) > 0.501 ||
			Math.abs(cy / 4 - y) > 0.501 ||
			Math.abs(cz / 4 - z) > 0.501
		)
			continue;
		for (let j = 0; j < 4; j++)
			output.push({
				uv: [uv.getX(i + j), uv.getY(i + j)],
				texture: aTexture.getX(i + j),
				position: [position.getX(i + j), position.getY(i + j), position.getZ(i + j)],
			});
	}
	return output;
}

describe("vanilla fluid surfaces", () => {
	it.each(["water", "lava"])(
		"keeps an isolated %s source still and maps the complete top sprite",
		(kind) => {
			const mesh = surface({ "2,1,2": kind, "1,1,2": "stone" }).meshes[0];
			const top = faces(mesh, 2, 1, 2, 0);
			expect(top.map((v) => v.texture)).toEqual([0, 0, 0, 0]);
			expect(top.map((v) => v.uv)).toEqual([
				[0, 0],
				[0, 1],
				[1, 1],
				[1, 0],
			]);
		}
	);
	it("rotates flowing tops around the sprite center, independent of block position", () => {
		const cells: Record<string, string> = {};
		for (const z of [1, 3]) {
			cells[`1,1,${z}`] = "water[level=0]";
			cells[`2,1,${z}`] = "water[level=4]";
		}
		const mesh = surface(cells).meshes[0];
		for (const z of [1, 3]) {
			const top = faces(mesh, 1, 1, z, 0);
			expect(top.map((v) => v.texture)).toEqual([1, 1, 1, 1]);
			// Eastward flow: Minecraft's angle atan2(z,x)-pi/2.
			expect(top.map((v) => v.uv)).toEqual([
				[0.75, 0.25],
				[0.25, 0.25],
				[0.25, 0.75],
				[0.75, 0.75],
			]);
		}
	});
	it("recognizes a downward spill into fluid below the neighboring air cell", () => {
		const mesh = surface({ "2,1,2": "lava", "3,0,2": "lava" }).meshes[0];
		expect(faces(mesh, 2, 1, 2, 0).map((v) => v.texture)).toEqual([1, 1, 1, 1]);
	});
	it("repeats side UVs per block and selects overlays only at transparent water boundaries", () => {
		const mesh = surface({ "1,1,1": "water", "3,1,3": "water", "1,1,0": "glass" }).meshes[0];
		for (const face of [2, 3, 4, 5]) {
			const first = faces(mesh, 1, 1, 1, face),
				second = faces(mesh, 3, 1, 3, face);
			expect(first.map((v) => v.uv)).toEqual(second.map((v) => v.uv));
			expect(first.map((v) => v.texture)).toEqual(Array(4).fill(face === 2 ? 2 : 1));
			expect(first.slice(0, 2).map((v) => v.uv[1])).toEqual([0.5, 0.5]);
		}
	});
	it("treats schematic edges as air and falling fluid as 8/9 high unless covered", () => {
		const edge = surface({ "0,0,0": "water[level=8]" }, 1, 1, 1).meshes[0];
		const interior = surface({ "2,1,2": "water[level=8]" }).meshes[0];
		expect(edge.geometry.boundingBox!.max.y + 1).toBeCloseTo(interior.geometry.boundingBox!.max.y);
		expect(edge.geometry.boundingBox!.max.y).toBeCloseTo((10 * (8 / 9)) / 12 - 0.5 - 1 / 1024);
	});
	it("keeps large volumes to one outer-surface draw with compact vertex attributes", () => {
		const result = buildFluidMeshes(() => "water", 16, 16, 16);
		meshes.push(...result.meshes);
		expect(result.meshes).toHaveLength(1);
		const geometry = result.meshes[0].geometry;
		expect(geometry.index!.count).toBe(6 * 16 * 16 * 6);
		const bytes = Object.values(geometry.attributes).reduce(
			(sum, a) => sum + a.array.byteLength,
			0
		);
		expect(bytes / geometry.attributes.position.count).toBeLessThan(28); // previous position+face+flow layout
	});
});
