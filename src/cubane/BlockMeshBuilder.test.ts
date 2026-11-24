import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BlockMeshBuilder } from "./BlockMeshBuilder";
import type { AssetLoader } from "./AssetLoader";
import type { BlockModel } from "./types";

function builder() {
	return new BlockMeshBuilder({
		getTextureAtlas: () => ({}),
		resolveTexture: (path: string) => path,
		getTint: () => new THREE.Color(0x3f76e4),
		getMaterial: async () => new THREE.MeshStandardMaterial(),
	} as unknown as AssetLoader);
}

describe("block model surfaces", () => {
	it("projects omitted UVs onto narrow elements without mutating cached models", async () => {
		const expected = {
			down: [2, 3, 4, 11],
			up: [2, 5, 4, 13],
			north: [12, 1, 14, 13],
			south: [2, 1, 4, 13],
			west: [5, 1, 13, 13],
			east: [3, 1, 11, 13],
		};
		for (const [direction, uv] of Object.entries(expected)) {
			const model: BlockModel = {
				elements: [
					{
						from: [2, 3, 5],
						to: [4, 15, 13],
						faces: { [direction]: { texture: "block/scaffolding_side" } },
					},
				],
			};
			const before = JSON.stringify(model);
			const mesh = await builder().createBlockMesh(model);
			const geometry = (mesh.children[0] as THREE.Mesh).geometry;
			expect([...geometry.getAttribute("uv").array]).toEqual([
				uv[0] / 16,
				1 - uv[1] / 16,
				uv[2] / 16,
				1 - uv[1] / 16,
				uv[0] / 16,
				1 - uv[3] / 16,
				uv[2] / 16,
				1 - uv[3] / 16,
			]);
			const optimized = await builder().createOptimizedFaceData(model);
			expect([...optimized.nonCullableFaces[0].geometry.getAttribute("uv").array]).toEqual([
				...geometry.getAttribute("uv").array,
			]);
			expect(JSON.stringify(model)).toBe(before);
		}
	});

	it("preserves explicit mirrored UVs on scaffolding rails", async () => {
		const mesh = await builder().createBlockMesh({
			elements: [
				{
					from: [14, 14, 2],
					to: [16, 16, 14],
					faces: { east: { texture: "block/scaffolding_side", uv: [14, 0, 2, 2] } },
				},
			],
		});
		const uv = (mesh.children[0] as THREE.Mesh).geometry.getAttribute("uv");
		expect([...uv.array]).toEqual([0.875, 1, 0.125, 1, 0.875, 0.875, 0.125, 0.875]);
	});
	it("keeps blockstate-rotated UVs world aligned only when uvlock is true", async () => {
		const model: BlockModel = {
			elements: [
				{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: "block/asymmetric" } } },
			],
		};
		const uv = async (uvlock: boolean) => {
			const mesh = await builder().createBlockMesh(model, { y: 90, uvlock });
			return Array.from((mesh.children[0] as THREE.Mesh).geometry.getAttribute("uv").array);
		};
		expect(await uv(false)).toEqual([0, 1, 1, 1, 0, 0, 1, 0]);
		expect(await uv(true)).toEqual([1, 1, 1, 0, 0, 1, 0, 0]);
		const optimized = await builder().createOptimizedFaceData(model, { y: 90, uvlock: true });
		expect(Array.from(optimized.nonCullableFaces[0].geometry.getAttribute("uv").array)).toEqual(
			await uv(true)
		);
	});

	it("tags every bubble-column face as water so the shared surface replaces it", async () => {
		const mesh = await builder().createBlockMesh(
			{ elements: [] },
			{},
			{
				namespace: "minecraft",
				name: "bubble_column",
				properties: { drag: "false" },
			}
		);
		let triangles = 0;
		mesh.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			expect((child.material as THREE.Material).userData.isWater).toBe(true);
			triangles += child.geometry.index!.count / 3;
		});
		expect(triangles).toBe(12); // One shell, not a host cube plus a waterlogged shell.
	});
});
