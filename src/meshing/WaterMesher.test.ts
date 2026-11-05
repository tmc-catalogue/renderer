import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
	buildFluidMeshes,
	createFluidMaterial,
	disposeFluidMeshes,
	hasFluid,
	setFluidTextures,
	updateFluidTime,
} from "./WaterMesher";
import { createFluidFrameTexture, tintWaterPixels } from "./WaterTextures";
import { withoutFluidGeometry } from "./FluidGeometry";

const meshes: THREE.Mesh[] = [];
const materials: THREE.ShaderMaterial[] = [];
function build(blocks: string[], sx = blocks.length, sy = 1, sz = 1) {
	const result = buildFluidMeshes((x, y, z) => blocks[(y * sz + z) * sx + x], sx, sy, sz);
	meshes.push(...result.meshes);
	return result;
}
function material(kind: "water" | "lava", logged = false) {
	const result = createFluidMaterial(kind, logged);
	materials.push(result);
	return result;
}
afterEach(() => {
	disposeFluidMeshes(meshes.splice(0));
	materials.splice(0).forEach((m) => m.dispose());
	setFluidTextures(null);
});

describe("water surfaces", () => {
	it("skips dry palettes while recognizing explicit and implicit water", () => {
		expect(hasFluid("minecraft:oak_slab[waterlogged=false]")).toBe(false);
		expect(hasFluid("minecraft:stone")).toBe(false);
		expect(hasFluid("minecraft:oak_slab[waterlogged=true]")).toBe(true);
		expect(hasFluid("minecraft:bubble_column[drag=true]")).toBe(true);
	});
	it("merges waterlogged and ordinary water and culls their shared face", () => {
		const result = build(["minecraft:water", "minecraft:oak_slab[type=bottom,waterlogged=true]"]);
		expect(result.cells).toBe(2);
		expect(result.meshes).toHaveLength(1);
		expect(result.meshes[0].geometry.index!.count).toBe(10 * 6);
	});

	it.each(["bubble_column", "kelp", "kelp_plant", "seagrass", "tall_seagrass"])(
		"connects implicitly waterlogged %s to water",
		(name) => {
			const result = build(["minecraft:water", `minecraft:${name}`]);
			expect(result.cells).toBe(2);
			expect(result.meshes).toHaveLength(1);
			expect(result.meshes[0].geometry.index!.count).toBe(60);
		}
	);

	it("emits only the outer shell of a water volume", () => {
		const result = build(Array(8).fill("water"), 2, 2, 2);
		expect(result.meshes).toHaveLength(1);
		expect(result.meshes[0].geometry.index!.count).toBe(24 * 6);
	});

	it("keeps source and falling-water heights and solid-neighbor culling", () => {
		const source = build(["water[level=0]"]).meshes[0].geometry;
		expect(source.boundingBox!.max.y).toBeCloseTo(8 / 9 - 0.5);
		const falling = build(["water[level=8]"]).meshes[0].geometry;
		expect(falling.boundingBox!.max.y).toBe(0.5);
		const solid = build(["water", "stone"]).meshes[0].geometry;
		expect(solid.index!.count).toBe(5 * 6);
	});

	it("uses one transparent draw for either water kind while lava stays opaque", () => {
		for (const logged of [false, true]) {
			const water = material("water", logged);
			expect(water.transparent).toBe(true);
			expect(water.depthWrite).toBe(false);
			expect(water.depthTest).toBe(true);
			expect(water.side).toBe(THREE.DoubleSide);
			expect(water.forceSinglePass).toBe(true);
			expect(water.polygonOffset).toBe(true);
		}
		const lava = material("lava");
		expect(lava.transparent).toBe(false);
		expect(lava.depthWrite).toBe(true);
	});

	it("animates still/flow textures at their native rates and removes disposed materials", () => {
		const still = new THREE.DataArrayTexture(new Uint8Array(16), 1, 1, 4);
		const flow = new THREE.DataArrayTexture(new Uint8Array(32), 1, 1, 8);
		setFluidTextures({ water: still, waterFlow: flow });
		const water = material("water");
		updateFluidTime(0.125);
		expect(water.uniforms.uTex.value).toBe(still);
		expect(water.uniforms.uFlowTex.value).toBe(flow);
		expect(water.uniforms.uStillFrame.value.toArray()).toEqual([1, 2, 0.25]);
		expect(water.uniforms.uFlowFrame.value.toArray()).toEqual([2, 3, 0.5]);
		water.dispose();
		updateFluidTime(1);
		expect(water.uniforms.uTime.value).toBe(0.125);
	});

	it("supports a missing flow texture and resets removed resource packs", () => {
		const water = material("water");
		const still = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
		setFluidTextures({ water: still });
		expect(water.uniforms.uFlowTex.value).toBe(still);
		setFluidTextures({});
		expect(water.uniforms.uHasTex.value).toBe(0);
		expect(water.uniforms.uTex.value).toBeNull();
	});

	it("binds a flow texture that arrives after the still texture", () => {
		const still = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
		const source = { water: still, waterFlow: null as THREE.DataArrayTexture | null };
		setFluidTextures(source);
		const water = material("water");
		const flow = new THREE.DataArrayTexture(new Uint8Array(8), 1, 1, 2);
		source.waterFlow = flow;
		updateFluidTime(0.05);
		expect(water.uniforms.uFlowTex.value).toBe(flow);
		expect(water.uniforms.uFlowFrame.value.x).toBe(1);
	});
});

describe("water textures", () => {
	it("preserves per-pixel alpha and brightness when tinting grayscale water", () => {
		const pixels = new Uint8ClampedArray([255, 255, 255, 160, 128, 128, 128, 90]);
		tintWaterPixels(pixels);
		expect([...pixels]).toEqual([63, 118, 228, 160, 32, 59, 114, 90]);
	});

	it("keeps colored resource-pack water intact", () => {
		const pixels = new Uint8ClampedArray([10, 120, 220, 80, 100, 100, 100, 160]);
		const original = pixels.slice();
		tintWaterPixels(pixels);
		expect(pixels).toEqual(original);
	});

	it("supports static packs and independent repeatable animation frames", () => {
		for (const frames of [1, 3]) {
			const pixels = new Uint8ClampedArray(2 * 2 * 4 * frames).fill(127);
			const texture = createFluidFrameTexture(pixels, 2, 2 * frames);
			expect(texture.image.depth).toBe(frames);
			expect(texture.image.data).toEqual(new Uint8Array(pixels));
			expect(texture.wrapS).toBe(THREE.RepeatWrapping);
			expect(texture.magFilter).toBe(THREE.NearestFilter);
			texture.dispose();
		}
	});
});

it("removes duplicate fluid templates without mutating CPU templates or culling host blocks", () => {
	const block = { positions: [1, 2, 3], fluid: undefined };
	const palette = [
		{ geometries: [block, { fluid: "water" as const }], occlusionFlags: 63, isCubic: true },
		{ geometries: [block], occlusionFlags: 63, isCubic: true },
	];
	const result = withoutFluidGeometry(palette);
	expect(result[0].geometries).toEqual([block]);
	expect(result[0].occlusionFlags).toBe(0);
	expect(result[0].isCubic).toBe(false);
	expect(palette[0].geometries).toHaveLength(2);
	expect(result[1]).toBe(palette[1]);
});
