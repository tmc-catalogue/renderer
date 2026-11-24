import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Cubane } from "./Cubane";

describe("assembled mesh cache generations", () => {
	it("retries in-flight assemblies after an asset switch instead of caching old atlas UVs", async () => {
		const cubane = new Cubane({ autoRestore: false });
		const assets = cubane.getAssetLoader();
		vi.spyOn(cubane.modelResolver, "resolveBlockModel").mockResolvedValue([
			{ model: "block/test" },
		]);
		vi.spyOn(assets, "getModel").mockResolvedValue({});
		let finish!: (group: THREE.Group) => void;
		const previous = new Promise<THREE.Group>((resolve) => {
			finish = resolve;
		});
		const current = new THREE.Group();
		current.name = "new pack";
		const assembly = vi
			.spyOn(cubane.getBlockMeshBuilder(), "createBlockMesh")
			.mockReturnValueOnce(previous)
			.mockResolvedValue(current);
		const loading = cubane.getBlockMesh("minecraft:stone");
		await vi.waitFor(() => expect(assembly).toHaveBeenCalledOnce());
		const generation = assets.getResourceGeneration();
		vi.spyOn(assets, "getResourceGeneration").mockReturnValue(generation + 1);
		const stale = new THREE.Group();
		stale.name = "old pack";
		finish(stale);
		expect((await loading).children[0].name).toBe("new pack");
		expect((await cubane.getBlockMesh("minecraft:stone")).children[0].name).toBe("new pack");
		expect(assembly).toHaveBeenCalledTimes(2);
		cubane.dispose();
	});
});
