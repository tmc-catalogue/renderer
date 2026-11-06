import { describe, expect, it, vi } from "vitest";
import { AssetLoader } from "./AssetLoader";
import JSZip from "jszip";
import type { ResourcePackManager } from "./ResourcePackManager";

function colormap(red: number): ImageData {
	return { width: 1, height: 1, data: new Uint8ClampedArray([red, 0, 0, 255]) } as ImageData;
}

describe("resource-pack colormaps", () => {
	it.each(["direct", "managed"])(
		"reloads all plant maps after a %s pack switch",
		async (source) => {
			const loader = new AssetLoader(false);
			let red = 50;
			const read = vi
				.spyOn(loader, "getTexturePixels")
				.mockImplementation(async () => colormap(red));
			await Promise.all([loader.loadColormaps(), loader.loadColormaps()]);
			expect(read).toHaveBeenCalledTimes(3);
			red = 200;
			const zip = new JSZip().file("pack.mcmeta", "{}");
			if (source === "direct") {
				await loader.loadResourcePack(new Blob([await zip.generateAsync({ type: "arraybuffer" })]));
			} else {
				loader.setPackManager({
					setAtlasRebuildCallback: vi.fn(),
				} as unknown as ResourcePackManager);
			}
			await Promise.all([loader.loadColormaps(), loader.loadColormaps()]);
			for (const block of ["short_grass", "oak_leaves", "leaf_litter"])
				expect(loader.getTint(`minecraft:${block}`, {}).r).toBe(200 / 255);
			expect(read).toHaveBeenCalledTimes(6);
		}
	);

	it("does not let an old decode overwrite the replacement pack's maps", async () => {
		const loader = new AssetLoader(false);
		let finish!: (pixels: ImageData) => void;
		const oldPixels = new Promise<ImageData>((resolve) => {
			finish = resolve;
		});
		vi.spyOn(loader, "getTexturePixels")
			.mockReturnValueOnce(oldPixels)
			.mockResolvedValue(colormap(200));
		const previous = loader.loadColormaps();
		loader.setPackManager({ setAtlasRebuildCallback: vi.fn() } as unknown as ResourcePackManager);
		await loader.loadColormaps();
		finish(colormap(50));
		await previous;
		expect(loader.getTint("minecraft:short_grass", {}).r).toBe(200 / 255);
	});

	it("retries failed decodes instead of keeping a rejected cache entry", async () => {
		const loader = new AssetLoader(false);
		vi.spyOn(loader, "getTexturePixels")
			.mockRejectedValueOnce(new Error("decode failed"))
			.mockResolvedValue(colormap(200));
		await expect(loader.loadColormaps()).rejects.toThrow("decode failed");
		await loader.loadColormaps();
		expect(loader.getTint("minecraft:leaf_litter", {}).r).toBe(200 / 255);
	});
});

describe("renamed chain blockstates", () => {
	it.each([
		["iron_chain", "chain"],
		["chain", "iron_chain"],
	])("loads %s from an older/newer pack and caches it", async (name, alias) => {
		const loader = new AssetLoader(false);
		const definition = { variants: { "axis=y": { model: `minecraft:block/${alias}` } } };
		const read = vi
			.spyOn(loader, "getResourceString")
			.mockImplementation(async (path) =>
				path === `blockstates/${alias}.json` ? JSON.stringify(definition) : undefined
			);
		expect(await loader.getBlockState(`minecraft:${name}`)).toEqual(definition);
		expect(await loader.getBlockState(name)).toEqual(definition);
		expect(read).toHaveBeenCalledTimes(2);
	});
	it("prefers the exact pack definition", async () => {
		const loader = new AssetLoader(false);
		const read = vi.spyOn(loader, "getResourceString").mockResolvedValue('{"variants":{}}');
		await loader.getBlockState("iron_chain");
		expect(read).toHaveBeenCalledExactlyOnceWith("blockstates/iron_chain.json");
	});
});
