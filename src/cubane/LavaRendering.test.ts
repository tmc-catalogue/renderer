import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { InstancedBlockRenderer } from "../InstancedBlockRenderer";
import { liquidFrameTextures } from "../meshing/RecordRenderer";
import { createFluidMaterial, setFluidTextures, updateFluidTime } from "../meshing/WaterMesher";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	for (const key of ["water", "waterFlow", "lava"] as const) {
		liquidFrameTextures[key]?.dispose();
		liquidFrameTextures[key] = null;
	}
	setFluidTextures(null);
});

describe("lava rendering", () => {
	it.each([1, 3])(
		"loads colored lava with %i frames even when the atlas is cached",
		async (frames) => {
			const loader = new AssetLoader(false);
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
			const texture = liquidFrameTextures.lava!;
			expect(texture.image.depth).toBe(frames);
			expect([...texture.image.data!]).toEqual([...pixels]);
			expect(close).toHaveBeenCalledOnce();
			setFluidTextures(liquidFrameTextures);
			const material = createFluidMaterial("lava");
			expect(material.uniforms.uHasTex.value).toBe(1);
			expect(material.uniforms.uTex.value).toBe(texture);
			updateFluidTime(0.375);
			expect(material.uniforms.uFrame0.value).toBe(frames === 1 ? 0 : 1);
			expect(material.transparent).toBe(false);
			expect(material.depthWrite).toBe(true);
			await loader.buildTextureAtlas();
			updateFluidTime(0.5);
			expect(material.uniforms.uTex.value).toBe(liquidFrameTextures.lava);
			expect(material.uniforms.uTex.value).not.toBe(texture);
			// A subsequent pack without lava must not retain the previous texture.
			vi.mocked(loader.getResourceBlob).mockResolvedValue(undefined);
			await loader.buildTextureAtlas();
			expect(liquidFrameTextures.lava).toBeNull();
			updateFluidTime(0.75);
			expect(material.uniforms.uHasTex.value).toBe(0);
			expect(material.uniforms.uTex.value).toBeNull();
			material.dispose();
			atlas.dispose();
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
