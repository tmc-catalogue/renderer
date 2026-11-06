import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import JSZip from "jszip";
import { AssetLoader } from "./AssetLoader";
import { AtlasBuilder } from "./AtlasBuilder";
import type { ResourcePackManager } from "./ResourcePackManager";

async function pack(version: string): Promise<Blob> {
	const zip = new JSZip()
		.file(
			"assets/minecraft/blockstates/stone.json",
			JSON.stringify({ variants: { "": { model: `block/${version}` } } })
		)
		.file(
			"assets/minecraft/models/block/stone.json",
			JSON.stringify({ textures: { all: `block/${version}` } })
		)
		.file(`assets/minecraft/textures/block/${version}.png`, version)
		.file("assets/minecraft/textures/block/stone.png", version);
	return new Blob([await zip.generateAsync({ type: "arraybuffer" })]);
}

function mockAtlas(loader: AssetLoader) {
	vi.spyOn(loader, "loadColormaps").mockResolvedValue(undefined);
	vi.spyOn(loader as any, "configureAtlasMips").mockImplementation(() => {});
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async (blob: Blob) => ({
			width: 1,
			height: 1,
			version: await blob.text(),
			close: vi.fn(),
		}))
	);
	return vi.spyOn(AtlasBuilder.prototype, "buildAtlas").mockImplementation(async (textures) => ({
		atlas: document.createElement("canvas"),
		uvMap: new Map(textures.map(({ path }) => [path, { u: 0, v: 0, width: 1, height: 1 }])),
		packingEfficiency: 100,
		fromCache: false,
	}));
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("pack-dependent asset invalidation", () => {
	it.each(["direct", "managed"])(
		"replaces warmed definitions, GPU resources and atlas UVs after a %s load",
		async (source) => {
			const loader = new AssetLoader(false);
			const build = mockAtlas(loader);
			const blobs = new Map<string, Blob>();
			vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
				const url = `blob:test-${blobs.size}`;
				blobs.set(url, blob as Blob);
				return url;
			});
			vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation((url, onLoad) => {
				const texture = new THREE.Texture<HTMLImageElement>();
				void blobs
					.get(url)!
					.text()
					.then((version) => {
						texture.userData.version = version;
						onLoad!(texture);
					});
				return texture;
			});
			let managedLoad;
			if (source === "managed") {
				let rebuild!: () => Promise<void>;
				const packs: { id: string; zip: JSZip; hash: string }[] = [];
				managedLoad = vi.fn(async (blob: Blob) => {
					packs.push({
						id: `${packs.length}`,
						zip: await JSZip.loadAsync(await blob.arrayBuffer()),
						hash: `${packs.length}`,
					});
					await rebuild();
				});
				loader.setPackManager({
					setAtlasRebuildCallback: (callback: () => Promise<void>) => {
						rebuild = callback;
					},
					getEnabledPacks: () => packs,
					getEnabledPacksInOrder: () => packs,
					loadPackFromBlob: managedLoad,
				} as unknown as ResourcePackManager);
			}
			await loader.loadResourcePack(await pack("old"));
			expect((await loader.getBlockState("stone")).variants).toEqual({
				"": { model: "block/old" },
			});
			expect((await loader.getModel("block/stone")).textures).toEqual({ all: "block/old" });
			const oldTexture = await loader.getTexture("block/stone");
			const oldMaterial = await loader.getMaterial("block/stone", { useAtlas: false });
			const oldAtlas = await loader.buildTextureAtlas();
			const disposed = [oldTexture, oldMaterial, oldAtlas].map((resource) => {
				const listener = vi.fn();
				resource.addEventListener("dispose", listener);
				return listener;
			});
			expect(loader.getTextureUV("block/old")).not.toBeNull();
			(loader as any).textureUVMap.set("block/stale", { u: 0, v: 0, width: 1, height: 1 });
			await loader.loadResourcePack(await pack("new"));
			expect((await loader.getBlockState("stone")).variants).toEqual({
				"": { model: "block/new" },
			});
			expect((await loader.getModel("block/stone")).textures).toEqual({ all: "block/new" });
			const newTexture = await loader.getTexture("block/stone");
			const newMaterial = await loader.getMaterial("block/stone", { useAtlas: false });
			const newAtlas = await loader.buildTextureAtlas();
			expect(newTexture).not.toBe(oldTexture);
			expect(oldTexture.userData.version).toBe("old");
			expect(newTexture.userData.version).toBe("new");
			expect(newMaterial).not.toBe(oldMaterial);
			expect((newMaterial as THREE.MeshStandardMaterial).map).toBe(newTexture);
			expect(newAtlas).not.toBe(oldAtlas);
			for (const listener of disposed) expect(listener).toHaveBeenCalledOnce();
			expect(loader.getTextureUV("block/stale")).toBeNull();
			expect(loader.getTextureUV("block/new")).not.toBeNull();
			expect((build.mock.calls[build.mock.calls.length - 1][0][0].image as any).version).toBe(
				"new"
			);
			expect(await loader.buildTextureAtlas()).toBe(newAtlas);
			expect(build.mock.calls.filter(([inputs]) => inputs.length > 0)).toHaveLength(2);
			// A disabled atlas cache must not accidentally use the shared "undefined:fmt3" key.
			for (const [inputs, cacheKey] of build.mock.calls)
				if (inputs.length) expect(cacheKey).toBeUndefined();
			if (managedLoad) expect(managedLoad).toHaveBeenCalledTimes(2);
		}
	);

	it("removes registered animations and disposes a shared texture only once", async () => {
		vi.stubGlobal(
			"Image",
			class {
				width = 16;
				height = 32;
				onload: (() => void) | null = null;
				set src(_url: string) {
					queueMicrotask(() => this.onload?.());
				}
			}
		);
		const zip = new JSZip()
			.file("assets/minecraft/textures/block/kelp.png", "pixels")
			.file("assets/minecraft/textures/block/kelp.png.mcmeta", '{"animation":{"frametime":2}}');
		const blob = new Blob([await zip.generateAsync({ type: "arraybuffer" })]);
		const loader = new AssetLoader(false);
		await loader.loadResourcePack(blob);
		const previous = await loader.getTexture("block/kelp");
		const disposed = vi.fn();
		previous.addEventListener("dispose", disposed);
		expect(loader.hasAnimatedTextures()).toBe(true);
		await loader.loadResourcePack(blob);
		expect(disposed).toHaveBeenCalledOnce();
		expect(loader.hasAnimatedTextures()).toBe(false);
		expect(loader.updateAnimations()).toBe(false);
		expect(await loader.getTexture("block/kelp")).not.toBe(previous);
	});

	it("preserves warmed assets if a replacement ZIP is invalid", async () => {
		const loader = new AssetLoader(false);
		mockAtlas(loader);
		await loader.loadResourcePack(await pack("old"));
		const model = await loader.getModel("block/stone");
		const atlas = await loader.buildTextureAtlas();
		const disposed = vi.fn();
		atlas.addEventListener("dispose", disposed);
		await expect(loader.loadResourcePack(new Blob(["not a zip"]))).rejects.toThrow("Invalid ZIP");
		expect(await loader.getModel("block/stone")).toBe(model);
		expect(await loader.buildTextureAtlas()).toBe(atlas);
		expect(disposed).not.toHaveBeenCalled();
	});

	it("does not publish an atlas that finishes after a pack switch", async () => {
		const loader = new AssetLoader(false);
		const build = mockAtlas(loader);
		await loader.loadResourcePack(await pack("old"));
		let finish!: (result: Awaited<ReturnType<AtlasBuilder["buildAtlas"]>>) => void;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		build.mockImplementationOnce(() => {
			started();
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const previous = loader.buildTextureAtlas();
		await ready;
		await loader.loadResourcePack(await pack("new"));
		const current = await loader.buildTextureAtlas();
		finish({
			atlas: document.createElement("canvas"),
			uvMap: new Map(),
			packingEfficiency: 100,
			fromCache: false,
		});
		expect(await previous).toBe(current);
		expect(loader.getTextureAtlas()).toBe(current);
		expect(loader.getTextureUV("block/new")).not.toBeNull();
	});

	it("does not let an old model read repopulate the cache after a switch", async () => {
		const loader = new AssetLoader(false);
		await loader.loadResourcePack(await pack("old"));
		let finish!: (json: string) => void;
		const pending = new Promise<string>((resolve) => {
			finish = resolve;
		});
		const read = vi.spyOn(loader, "getResourceString").mockReturnValueOnce(pending);
		const oldRead = loader.getModel("block/stone");
		await loader.loadResourcePack(await pack("new"));
		const current = await loader.getModel("block/stone");
		finish(JSON.stringify({ textures: { all: "block/old" } }));
		expect(await oldRead).toBe(current);
		expect(await loader.getModel("block/stone")).toBe(current);
		expect(current.textures).toEqual({ all: "block/new" });
		read.mockRestore();
	});
});
