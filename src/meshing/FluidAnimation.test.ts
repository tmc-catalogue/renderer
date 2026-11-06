import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as THREE from "three";
import { fluidAnimationFrame, registerFluidAnimation } from "./FluidAnimation";
import { createFluidFrameTexture } from "./WaterTextures";
let pack: JSZip;
beforeAll(async () => {
	pack = await JSZip.loadAsync(readFileSync("test/public/pack.zip"));
});

describe("resource-pack fluid animations", () => {
	it.each([
		[
			"lava_still",
			20,
			0.1,
			[
				[1.9, 19],
				[2, 18],
				[3.8, 0],
			],
		],
		["lava_flow", 16, 0.15, [[0.3, 2]]],
		["water_still", 32, 0.1, [[0.3, 3]]],
		["water_flow", 32, 0.05, [[0.1, 2]]],
	] as const)(
		"honors the bundled %s timing and frame order",
		async (name, layers, step, samples) => {
			const metadata = JSON.parse(
				await pack.file(`assets/minecraft/textures/block/${name}.png.mcmeta`)!.async("string")
			);
			const texture = new THREE.DataArrayTexture(new Uint8Array(layers * 4), 1, 1, layers);
			registerFluidAnimation(texture, metadata);
			expect(fluidAnimationFrame(texture, step - 0.00001).x).toBe(0);
			expect(fluidAnimationFrame(texture, step + 0.00001).x).toBe(1);
			for (const [time, index] of samples) {
				const frame = fluidAnimationFrame(texture, time + 0.00001);
				expect(frame.x).toBe(index);
				expect(frame.z).toBe(0); // None of the vanilla fluid textures requests interpolation.
			}
			texture.dispose();
		}
	);

	it("uses per-frame durations and only interpolates when requested", () => {
		const tex = new THREE.DataArrayTexture(new Uint8Array(12), 1, 1, 3);
		registerFluidAnimation(tex, {
			animation: { frames: [{ index: 2, time: 4 }, 0, 2], frametime: 2, interpolate: true },
		});
		expect(fluidAnimationFrame(tex, 0.1).toArray()).toEqual([2, 0, 0.5]);
		expect(fluidAnimationFrame(tex, 0.25).toArray()).toEqual([0, 2, 0.5]);
		expect(fluidAnimationFrame(tex, 0.35).z).toBe(0); // repeated final/first index
		tex.dispose();
	});

	it("packs horizontal frame grids once, without copying repeated timeline entries", () => {
		const pixels = new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]);
		const tex = createFluidFrameTexture(pixels, 2, 2, {
			animation: { width: 1, height: 1, frames: [0, 1, 0, 3, 0] },
		});
		expect(tex.image.depth).toBe(4);
		expect([...tex.image.data!]).toEqual([...pixels]);
		expect(fluidAnimationFrame(tex, 0.15 + 0.00001).x).toBe(3);
		tex.dispose();
	});

	it("leaves textures without animation metadata static, even when not square", () => {
		const tex = createFluidFrameTexture(new Uint8ClampedArray(32), 2, 4);
		expect([tex.image.width, tex.image.height, tex.image.depth]).toEqual([2, 4, 1]);
		expect(fluidAnimationFrame(tex, 123).toArray()).toEqual([0, 0, 0]);
		tex.dispose();
	});

	it.each([
		[{ width: 16 }, [16, 64, 1]],
		[{ height: 16 }, [16, 16, 4]],
		[{}, [16, 16, 4]],
	] as const)("preserves vanilla frame-size defaults for %j", (animation, dimensions) => {
		const texture = createFluidFrameTexture(new Uint8ClampedArray(16 * 64 * 4), 16, 64, {
			animation,
		});
		expect([texture.image.width, texture.image.height, texture.image.depth]).toEqual(dimensions);
		texture.dispose();
	});
});
