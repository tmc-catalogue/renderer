import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import JSZip from "jszip";
import { AssetLoader } from "./AssetLoader";
import { AtlasBuilder } from "./AtlasBuilder";
import { InstancedBlockRenderer } from "../InstancedBlockRenderer";
import { createFluidMaterial, updateFluidTime } from "../meshing/WaterMesher";
import { fluidAnimationFrame } from "../meshing/FluidAnimation";
import type { ResourcePackManager } from "./ResourcePackManager";

// Pack switches now discard the old atlas. Keep these fluid-focused tests
// independent of canvas packing while allowing a replacement atlas to be built.
function mockAtlasRebuild(loader: AssetLoader): void {
	vi.spyOn(loader as any, "configureAtlasMips").mockImplementation(() => {});
	vi.spyOn(AtlasBuilder.prototype, "buildAtlas").mockResolvedValue({
		atlas: document.createElement("canvas"),
		uvMap: new Map(),
		packingEfficiency: 100,
		fromCache: false,
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("lava rendering", () => {
	it.each([1, 3])(
		"loads colored lava with %i frames even when the atlas is cached",
		async (frames) => {
			const loader = new AssetLoader(false);
			mockAtlasRebuild(loader);
			const atlas = new THREE.Texture();
			// Exercise the atlas cache-hit path without a browser's canvas/PNG decoder.
			(loader as any).textureAtlas = atlas;
			vi.spyOn(loader as any, "loadColormaps").mockResolvedValue(undefined);
			const pixels = new Uint8ClampedArray(
				Array.from({ length: frames }, (_, f) => [255, 80 + f, 0, 255]).flat()
			);
			vi.spyOn(loader, "getResourceBlob").mockImplementation(async (path) =>
				path === "textures/block/lava_still.png" ? new Blob(["lava"]) : undefined
			);
			vi.spyOn(loader, "getResourceString").mockResolvedValue('{"animation":{"frametime":2}}');
			const close = vi.fn();
			vi.stubGlobal(
				"createImageBitmap",
				vi.fn().mockResolvedValue({ width: 1, height: frames, close })
			);
			vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
				drawImage: vi.fn(),
				getImageData: () => ({ data: pixels }),
			} as any);
			expect(await loader.buildTextureAtlas()).toBe(atlas);
			const texture = loader.getFluidTextures().lava!;
			expect(texture.image.depth).toBe(frames);
			expect([...texture.image.data!]).toEqual([...pixels]);
			expect(close).toHaveBeenCalledOnce();
			const material = createFluidMaterial("lava", false, loader.getFluidTextures());
			expect(material.uniforms.uHasTex.value).toBe(1);
			expect(material.uniforms.uTex.value).toBe(texture);
			updateFluidTime(0.125);
			expect(material.uniforms.uStillFrame.value.x).toBe(frames === 1 ? 0 : 1);
			expect(material.transparent).toBe(false);
			expect(material.depthWrite).toBe(true);
			await loader.buildTextureAtlas();
			updateFluidTime(0.5);
			expect(material.uniforms.uTex.value).toBe(loader.getFluidTextures().lava);
			expect(material.uniforms.uTex.value).toBe(texture);
			expect(createImageBitmap).toHaveBeenCalledOnce();
			// A subsequent pack without lava must not retain the previous texture.
			vi.mocked(loader.getResourceBlob).mockResolvedValue(undefined);
			const zip = new JSZip().file("pack.mcmeta", "{}");
			await loader.loadResourcePack(new Blob([await zip.generateAsync({ type: "arraybuffer" })]));
			await loader.buildTextureAtlas();
			expect(loader.getFluidTextures().lava).toBeNull();
			updateFluidTime(0.75);
			expect(material.uniforms.uHasTex.value).toBe(0);
			expect(material.uniforms.uTex.value).toBeNull();
			material.dispose();
			loader.dispose();
		}
	);

	it("shares concurrent fluid decodes, isolates failed assets, and releases owned textures", async () => {
		const loader = new AssetLoader(false);
		const atlas = new THREE.Texture();
		(loader as any).textureAtlas = atlas;
		vi.spyOn(loader as any, "loadColormaps").mockResolvedValue(undefined);
		vi.spyOn(loader, "getResourceBlob").mockResolvedValue(new Blob(["image"]));
		vi.spyOn(loader, "getResourceString").mockImplementation(async (path) =>
			path.includes("lava_flow") ? '{"animation":{"width":3}}' : undefined
		);
		const close = vi.fn();
		vi.stubGlobal(
			"createImageBitmap",
			vi
				.fn()
				.mockRejectedValueOnce(new Error("broken PNG"))
				.mockResolvedValue({ width: 1, height: 1, close })
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
			getImageData: () => ({ data: new Uint8ClampedArray([255, 80, 0, 255]) }),
		} as any);
		expect(await Promise.all([loader.buildTextureAtlas(), loader.buildTextureAtlas()])).toEqual([
			atlas,
			atlas,
		]);
		expect(createImageBitmap).toHaveBeenCalledTimes(5);
		expect(close).toHaveBeenCalledTimes(4);
		expect(loader.getFluidTextures().water).toBeNull();
		expect(loader.getFluidTextures().lavaFlow).toBeNull();
		expect(loader.getFluidTextures().lava).not.toBeNull();
		const dispose = vi.fn();
		loader.getFluidTextures().lava!.addEventListener("dispose", dispose);
		loader.dispose();
		expect(dispose).toHaveBeenCalledOnce();
		expect(loader.getFluidTextures().lava).toBeNull();
	});

	it("discards fluid textures that finish decoding after disposal", async () => {
		const loader = new AssetLoader(false);
		(loader as any).textureAtlas = new THREE.Texture();
		vi.spyOn(loader as any, "loadColormaps").mockResolvedValue(undefined);
		vi.spyOn(loader, "getResourceBlob").mockResolvedValue(new Blob(["image"]));
		vi.spyOn(loader, "getResourceString").mockResolvedValue(undefined);
		let finish!: (value: any) => void;
		const decoded = new Promise((resolve) => {
			finish = resolve;
		});
		let onDecode!: () => void;
		const started = new Promise<void>((resolve) => {
			onDecode = resolve;
		});
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn(() => {
				onDecode();
				return decoded;
			})
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
			getImageData: () => ({ data: new Uint8ClampedArray(4) }),
		} as any);
		const load = loader.buildTextureAtlas();
		await started;
		loader.dispose();
		finish({ width: 1, height: 1, close: vi.fn() });
		await expect(load).rejects.toThrow("AssetLoader disposed");
		expect(Object.values(loader.getFluidTextures()).every((value) => value === null)).toBe(true);
	});

	it("isolates coexisting loaders and their materials even after one is disposed", async () => {
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() })
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
			getImageData: () => ({ data: new Uint8ClampedArray(4) }),
		} as any);
		const loaders = [new AssetLoader(false), new AssetLoader(false)];
		for (const loader of loaders) {
			(loader as any).textureAtlas = new THREE.Texture();
			vi.spyOn(loader as any, "loadColormaps").mockResolvedValue(undefined);
			vi.spyOn(loader, "getResourceBlob").mockImplementation(async (path) =>
				path.includes("lava_still") ? new Blob(["lava"]) : undefined
			);
			vi.spyOn(loader, "getResourceString").mockResolvedValue(undefined);
		}
		await loaders[0].buildTextureAtlas();
		const first = loaders[0].getFluidTextures().lava;
		const firstMaterial = createFluidMaterial("lava", false, loaders[0].getFluidTextures());
		const disposed = vi.fn();
		first!.addEventListener("dispose", disposed);
		await loaders[1].buildTextureAtlas();
		const second = loaders[1].getFluidTextures().lava;
		const secondMaterial = createFluidMaterial("lava", false, loaders[1].getFluidTextures());
		expect(second).not.toBe(first);
		updateFluidTime(1);
		expect(firstMaterial.uniforms.uTex.value).toBe(first);
		expect(secondMaterial.uniforms.uTex.value).toBe(second);
		loaders[1].dispose();
		updateFluidTime(2);
		expect(firstMaterial.uniforms.uTex.value).toBe(first);
		expect(secondMaterial.uniforms.uTex.value).toBeNull();
		expect(loaders[1].getFluidTextures().lava).toBeNull();
		await loaders[0].buildTextureAtlas();
		expect(loaders[0].getFluidTextures().lava).toBe(first);
		expect(disposed).not.toHaveBeenCalled();
		expect(createImageBitmap).toHaveBeenCalledTimes(2);
		loaders[0].dispose();
		expect(disposed).toHaveBeenCalledOnce();
		firstMaterial.dispose();
		secondMaterial.dispose();
	});

	it.each(["direct", "managed"])(
		"reloads animation metadata when a %s pack replaces cached fluid frames",
		async (source) => {
			const loader = new AssetLoader(false);
			mockAtlasRebuild(loader);
			(loader as any).textureAtlas = new THREE.Texture();
			vi.spyOn(loader as any, "loadColormaps").mockResolvedValue(undefined);
			vi.spyOn(loader, "getResourceBlob").mockImplementation(async (path) =>
				path.includes("lava_still") ? new Blob(["lava"]) : undefined
			);
			vi.stubGlobal(
				"createImageBitmap",
				vi.fn().mockResolvedValue({ width: 1, height: 2, close: vi.fn() })
			);
			vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
				drawImage: vi.fn(),
				getImageData: () => ({ data: new Uint8ClampedArray(8) }),
			} as any);
			for (const frametime of [2, 8]) {
				const zip = new JSZip().file(
					"assets/minecraft/textures/block/lava_still.png.mcmeta",
					JSON.stringify({ animation: { frametime } })
				);
				if (source === "managed" && frametime === 8) {
					loader.setPackManager({
						getEnabledPacksInOrder: () => [{ id: "managed", zip }],
						setAtlasRebuildCallback: vi.fn(),
					} as unknown as ResourcePackManager);
				} else {
					await loader.loadResourcePack(
						new Blob([await zip.generateAsync({ type: "arraybuffer" })])
					);
				}
				await loader.buildTextureAtlas();
				expect(fluidAnimationFrame(loader.getFluidTextures().lava!, 0.15).x).toBe(
					frametime === 2 ? 1 : 0
				);
			}
			expect(createImageBitmap).toHaveBeenCalledTimes(2);
			loader.dispose();
		}
	);

	it.each(["initializeInstancedMeshes", "initializeInstancedMeshesMerged"] as const)(
		"keeps lava opaque and preserves water alpha through %s",
		async (method) => {
			const loader = new AssetLoader(false);
			const texture = new THREE.Texture();
			vi.spyOn(loader, "getTexture").mockResolvedValue(texture);
			const lava = await loader.getMaterial("block/lava_still", {
				isLiquid: true,
				isLava: true,
				useAtlas: false,
			});
			const water = await loader.getMaterial("block/water_still", {
				isLiquid: true,
				isWater: true,
				useAtlas: false,
			});
			const waterOpacity = water.opacity;
			const geometry = new THREE.BoxGeometry();
			const group = new THREE.Group();
			const renderer = new InstancedBlockRenderer(group, {
				isReady: true,
				blockData: [lava, water].map((material, i) => ({
					blockName: `minecraft:${i ? "water" : "lava"}`,
					category: "water",
					materialGroups: [{ baseGeometry: geometry, material }],
				})),
			});
			renderer[method]();
			expect(lava.opacity).toBe(1);
			expect(lava.transparent).toBe(false);
			expect(lava.depthWrite).toBe(true);
			expect(water.opacity).toBe(waterOpacity);
			expect(water.transparent).toBe(true);
			expect(water.depthWrite).toBe(false);
			renderer.disposeInstancedMeshes();
			geometry.dispose();
			lava.dispose();
			water.dispose();
			texture.dispose();
		}
	);
});
