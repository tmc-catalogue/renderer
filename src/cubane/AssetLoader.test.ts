import { describe, expect, it, vi } from "vitest";
import { AssetLoader } from "./AssetLoader";
import JSZip from "jszip";
import type { ResourcePackManager } from "./ResourcePackManager";
import * as THREE from "three";
import { ModelResolver } from "./ModelResolver";

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

describe("render material classifications", () => {
	it.each([
		[[255, 255], false, 0, true],
		[[255, 0], false, 0.5, true],
		[[255, 128], true, 0.01, false],
	] as const)(
		"classifies RGBA alpha %j before meshing",
		async (alphas, transparent, alphaTest, depthWrite) => {
			const loader = new AssetLoader(false);
			const texture = new THREE.DataTexture(
				new Uint8Array(alphas.flatMap((alpha) => [30, 40, 50, alpha])),
				2,
				1
			);
			vi.spyOn(loader, "getTexture").mockResolvedValue(texture);
			const material = await loader.getMaterial("block/custom_alpha", { useAtlas: false });
			expect(material).toMatchObject({ transparent, alphaTest, depthWrite });
			loader.dispose();
			texture.dispose();
		}
	);
	it("keeps ordinary animated sprites independent of the static atlas", async () => {
		const loader = new AssetLoader(false);
		const atlas = new THREE.Texture();
		(loader as any).textureAtlas = atlas;
		(loader as any).textureUVMap.set("block/magma", { u: 0, v: 0, width: 0.25, height: 0.75 });
		const sprite = new THREE.DataTexture(new Uint8Array([123, 45, 67, 255]), 1, 1);
		const animations = (loader as any).animatedTextureManager;
		vi.spyOn(animations, "isAnimated").mockResolvedValue(true);
		vi.spyOn(animations, "createAnimatedTexture").mockResolvedValue(sprite);
		const material = (await loader.getMaterial("block/magma")) as THREE.MeshStandardMaterial;
		expect(material.map).toBe(sprite);
		expect(material.userData.atlasUV).toBeUndefined();
		expect(material.transparent).toBe(false);
		loader.dispose();
		sprite.dispose();
	});
});

describe("namespaced resource-pack models", () => {
	it("uses the custom namespace without aliasing a same-named vanilla model or texture", async () => {
		const loader = new AssetLoader(false);
		const zip = new JSZip()
			.file(
				"assets/custom/blockstates/obsidian.json",
				JSON.stringify({ variants: { "": { model: "custom:block/obsidian" } } })
			)
			.file(
				"assets/custom/models/block/obsidian.json",
				JSON.stringify({ textures: { all: "custom:block/obsidian" } })
			)
			.file("assets/custom/textures/block/obsidian.png", "custom")
			.file("assets/minecraft/textures/block/obsidian.png", "vanilla");
		await loader.loadResourcePack(new Blob([await zip.generateAsync({ type: "arraybuffer" })]));
		const models = await new ModelResolver(loader).resolveBlockModel({
			namespace: "custom",
			name: "obsidian",
			properties: {},
		});
		expect(models[0].model).toBe("custom:block/obsidian");
		const model = await loader.getModel(models[0].model);
		const path = loader.resolveTexture("#all", model);
		expect(await (await loader.getResourceBlob(`textures/${path}.png`))!.text()).toBe("custom");
		expect(await (await loader.getResourceBlob("textures/block/obsidian.png"))!.text()).toBe(
			"vanilla"
		);
		expect(await loader.listBlockstates()).toEqual(["custom:obsidian"]);
		loader.dispose();
	});
	it("does not synthesize liquid cubes for water/lava named model textures", async () => {
		const loader = new AssetLoader(false);
		vi.spyOn(loader, "getResourceString").mockResolvedValue(
			JSON.stringify({ textures: { all: "block/cauldron" } })
		);
		expect(await loader.getModel("block/water_cauldron")).toEqual({
			textures: { all: "block/cauldron" },
		});
		loader.dispose();
	});
});
