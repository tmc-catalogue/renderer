import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { SchematicRenderer } from "./SchematicRenderer";
import type { Cubane } from "./cubane";
import type { ChunkMeshes } from "./types";

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock("nucleation", () => ({ default: vi.fn(), SchematicWrapper: class {} }));
vi.mock("./workers/MeshBuilder.worker?worker&inline", () => ({
	default: class {
		postMessage = postMessage;
		terminate = vi.fn();
	},
}));
vi.mock("./workers/MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));
import { WorldMeshBuilder } from "./WorldMeshBuilder";
import { MaterialRegistry } from "./MaterialRegistry";
import { buildChestBlockMesh } from "./meshing/ChestModels";
import { AssetLoader } from "./cubane/AssetLoader";

interface PaletteDescriptor {
	index: number;
	category: keyof ChunkMeshes;
	occlusionFlags: number;
	fluid?: "water" | "lava";
	geometries: Array<{
		positions: Float32Array;
		indices: Uint16Array | Uint32Array;
		category: keyof ChunkMeshes;
		fluid?: "water" | "lava";
	}>;
}

const builders: WorldMeshBuilder[] = [];
const models: THREE.Object3D[] = [];

// Run the real constructor; mock only asset loading and worker transport.
function createBuilder(getBlockMesh: (state: string) => Promise<THREE.Object3D>) {
	const builder = new WorldMeshBuilder(
		{
			options: {
				gpuComputeOptions: { enabled: false },
				wasmMeshBuilderOptions: { enabled: false, maxWorkers: 1 },
			},
		} as SchematicRenderer,
		{
			getBlockMesh,
			getBlockOptimizationData: async () => null,
		} as unknown as Cubane
	);
	builders.push(builder);
	return builder;
}

function box(materialOptions: THREE.MeshBasicMaterialParameters = {}) {
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(),
		new THREE.MeshBasicMaterial(materialOptions)
	);
	models.push(mesh);
	return mesh;
}

function withFluid(host: THREE.Mesh, fluid: "water" | "lava" = "water") {
	const liquid = box({ transparent: true, opacity: 0.6 });
	liquid.material.userData[fluid === "water" ? "isWater" : "isLava"] = true;
	const root = new THREE.Group();
	root.add(host, liquid);
	return root;
}

// Inspect the payload that actually reaches the mesher, not private builder fields.
function paletteSentToWorker(): PaletteDescriptor[] {
	expect(postMessage).toHaveBeenCalled();
	const message = postMessage.mock.lastCall?.[0];
	expect(message).toMatchObject({ type: "updatePalette", meshContextId: expect.any(String) });
	return message.paletteData;
}

beforeEach(() => {
	postMessage.mockClear();
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	// Palette processing catches exceptions; do not mistake a failed extraction for an empty model.
	const warnings = vi.mocked(console.warn).mock.calls.slice();
	builders.splice(0).forEach((builder) => builder.dispose());
	models.splice(0).forEach((root) => {
		root.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			child.geometry.dispose();
			const materials = Array.isArray(child.material) ? child.material : [child.material];
			materials.forEach((material) => material.dispose());
		});
	});
	MaterialRegistry.clear();
	vi.restoreAllMocks();
	expect(warnings).toEqual([]);
});

describe("palette mesh extraction", () => {
	it("routes opaque obsidian to the solid pass even when its atlas contains alpha tiles", async () => {
		const loader = new AssetLoader(false);
		const atlas = document.createElement("canvas");
		atlas.width = 3;
		atlas.height = 1;
		const texture = new THREE.CanvasTexture(atlas);
		const readPixels = vi.fn((x: number) => ({
			data: new Uint8ClampedArray([20, 30, 40, [255, 0, 128][x]]),
		}));
		vi.spyOn(atlas, "getContext").mockReturnValue({ getImageData: readPixels } as any);
		const names = ["obsidian", "custom_cutout", "custom_blend"];
		Object.assign(loader, {
			textureAtlas: texture,
			textureUVMap: new Map(
				names.map((name, i) => [`block/${name}`, { u: i / 3, v: 0, width: 1 / 3, height: 1 }])
			),
		});
		const builder = createBuilder(async (state) => {
			const material = await loader.getMaterial(`block/${state.replace("minecraft:", "")}`);
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
			models.push(mesh);
			return mesh;
		});
		try {
			await builder.precomputePaletteGeometries(
				names.map((name) => ({ name: `minecraft:${name}` })),
				true
			);
			const palette = paletteSentToWorker()
				.slice()
				.sort((a, b) => a.index - b.index);
			expect(palette.map((block) => block.category)).toEqual(["solid", "cutout", "transparent"]);
			expect(await loader.getMaterial("block/obsidian", { faceDirection: "north" })).toMatchObject({
				transparent: false,
				alphaTest: 0,
				depthWrite: true,
			});
			expect(readPixels).toHaveBeenCalledTimes(3);
			expect(readPixels).toHaveBeenCalledWith(0, 0, 1, 1);
		} finally {
			loader.dispose();
		}
	});

	it.each([
		"glass",
		"white_stained_glass",
		"blue_stained_glass_pane",
		"nether_portal",
		"end_portal",
	])(
		"leaves %s to the shared surface pass instead of emitting duplicate templates",
		async (name) => {
			const builder = createBuilder(async () => box({ transparent: true }));
			await builder.precomputePaletteGeometries([{ name: "minecraft:" + name }], true);
			expect(paletteSentToWorker()).toEqual([]);
			expect(builder.getPaletteStats()).toMatchObject({ isReady: true, uniqueMaterials: 0 });
		}
	);

	it.each([
		{ name: "polished_andesite_stairs", material: {}, category: "solid" },
		{ name: "scaffolding", material: { alphaTest: 0.5 }, category: "cutout" },
		{ name: "kelp", material: { alphaTest: 0.5 }, category: "cutout" },
		{ name: "custom_host", material: { transparent: true, opacity: 0.5 }, category: "transparent" },
	])(
		"classifies the retained $name host from its own material",
		async ({ name, material, category }) => {
			const host = box(material);
			const builder = createBuilder(async () => withFluid(host));
			await builder.precomputePaletteGeometries(
				[{ name: "minecraft:" + name, properties: { waterlogged: "true" } }],
				true
			);
			const palette = paletteSentToWorker();
			expect(palette).toHaveLength(1);
			expect(palette[0]).toMatchObject({ category, occlusionFlags: category === "solid" ? 63 : 0 });
			expect(palette[0].geometries).toHaveLength(1);
			expect(palette[0].geometries[0].fluid).toBeUndefined();
			expect(palette[0].geometries[0].positions).toEqual(host.geometry.attributes.position.array);
		}
	);

	it.each(["water", "lava"] as const)(
		"does not let removed %s make an opaque host transparent",
		async (fluid) => {
			const builder = createBuilder(async () => withFluid(box(), fluid));
			await builder.precomputePaletteGeometries([{ name: "minecraft:custom_host" }], true);
			const palette = paletteSentToWorker();
			expect(palette).toHaveLength(1);
			expect(palette[0].category).toBe("solid");
			expect(palette[0].geometries).toHaveLength(1);
			expect(palette[0].geometries[0].fluid).toBeUndefined();
		}
	);

	it.each([
		{ name: "polished_andesite_stairs", properties: { waterlogged: "true" } },
		{ name: "kelp", properties: {} },
	])("keeps $name and its water in their own passes in legacy mode", async (state) => {
		const builder = createBuilder(async () => withFluid(box()));
		await builder.precomputePaletteGeometries([{ ...state, name: "minecraft:" + state.name }]);
		const palette = paletteSentToWorker();
		expect(palette).toHaveLength(1);
		expect(palette[0]).toMatchObject({ category: "solid", occlusionFlags: 63 });
		expect(palette[0].geometries.map((g) => g.category)).toEqual(["solid", "water"]);
		expect(palette[0].geometries.map((geometry) => geometry.fluid)).toEqual([undefined, "water"]);
	});

	it.each(["water", "lava"] as const)(
		"preserves standalone %s material category and fluid identity",
		async (fluid) => {
			const mesh = box({ transparent: fluid === "water" });
			mesh.material.userData[fluid === "water" ? "isWater" : "isLava"] = true;
			const builder = createBuilder(async () => mesh);
			await builder.precomputePaletteGeometries([{ name: "minecraft:" + fluid }]);
			expect(paletteSentToWorker()).toMatchObject([
				{
					category: fluid === "water" ? "water" : "solid",
					fluid,
					occlusionFlags: fluid === "water" ? 0 : 63,
					geometries: [{ fluid }],
				},
			]);
		}
	);

	it("does not force similarly named opaque blocks into translucent or water passes", async () => {
		const names = [
			"packed_ice",
			"blue_ice",
			"water_cauldron",
			"lava_cauldron",
			"custom_glass_solid",
		];
		const builder = createBuilder(async () => box());
		await builder.precomputePaletteGeometries(names.map((name) => ({ name: `minecraft:${name}` })));
		expect(
			paletteSentToWorker().every(
				(block) => block.category === "solid" && block.occlusionFlags === 63
			)
		).toBe(true);
	});

	it("compares every palette entry and snapshots in-place state mutations", async () => {
		const getMesh = vi.fn(async () => box());
		const builder = createBuilder(getMesh);
		const palette = [
			{ name: "minecraft:air" },
			{ name: "minecraft:stone", properties: { variant: "a" } },
			{ name: "minecraft:glass" },
		];
		await builder.precomputePaletteGeometries(palette);
		expect(getMesh).toHaveBeenCalledTimes(3);
		await builder.precomputePaletteGeometries(palette);
		expect(getMesh).toHaveBeenCalledTimes(3);
		palette[1].name = "minecraft:obsidian";
		await builder.precomputePaletteGeometries(palette);
		expect(getMesh).toHaveBeenCalledTimes(6);
		palette[1].properties!.variant = "b";
		await builder.precomputePaletteGeometries(palette);
		expect(getMesh).toHaveBeenCalledTimes(9);
	});

	it("keeps grouped opaque and cutout faces separate and only occludes actual opaque boundary faces", async () => {
		const opaque = new THREE.MeshBasicMaterial();
		const cutout = new THREE.MeshBasicMaterial({ alphaTest: 0.5 });
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [
			opaque,
			cutout,
			opaque,
			opaque,
			opaque,
			opaque,
		]);
		models.push(mesh);
		const builder = createBuilder(async () => mesh);
		await builder.precomputePaletteGeometries([{ name: "minecraft:mixed" }]);
		const [block] = paletteSentToWorker();
		expect(block.geometries).toHaveLength(6);
		expect(block.geometries.filter((g) => g.category === "cutout")).toHaveLength(1);
		expect(block.geometries.every((g) => g.indices.length === 6 && g.positions.length === 12)).toBe(
			true
		);
		// Box group 1 is -X (west); its alpha holes cannot occlude.
		expect(block.occlusionFlags).toBe(62);
	});

	it.each([false, true])(
		"keeps same-name block states independent (transparent state first: %s)",
		async (transparentFirst) => {
			const states = transparentFirst ? [true, false] : [false, true];
			const builder = createBuilder(async (state) =>
				box({ transparent: state.includes("variant=clear") })
			);
			await builder.precomputePaletteGeometries(
				states.map((transparent) => ({
					name: "minecraft:custom_host",
					properties: { variant: transparent ? "clear" : "opaque" },
				}))
			);
			const palette = paletteSentToWorker()
				.slice()
				.sort((a, b) => a.index - b.index);
			expect(palette.map((block) => block.category)).toEqual(
				states.map((transparent) => (transparent ? "transparent" : "solid"))
			);
		}
	);

	it("recomputes classification after a resource pack changes the material", async () => {
		let transparent = true;
		const builder = createBuilder(async () => box({ transparent }));
		const palette = [{ name: "minecraft:custom_host" }];
		await builder.precomputePaletteGeometries(palette);
		expect(paletteSentToWorker()[0].category).toBe("transparent");
		transparent = false;
		builder.invalidateCache();
		await builder.precomputePaletteGeometries(palette);
		expect(paletteSentToWorker()[0].category).toBe("solid");
	});

	it.each(["hidden", "empty"])(
		"ignores %s transparent geometry when classifying an opaque host",
		async (kind) => {
			const root = new THREE.Group();
			const ignored = box({ transparent: true });
			if (kind === "hidden") ignored.visible = false;
			else ignored.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
			root.add(box(), ignored);
			const builder = createBuilder(async () => root);
			await builder.precomputePaletteGeometries([{ name: "minecraft:custom_host" }]);
			const palette = paletteSentToWorker();
			expect(palette).toHaveLength(1);
			expect(palette[0].category).toBe("solid");
			expect(palette[0].geometries).toHaveLength(1);
		}
	);

	it("retains a chest returned as a root mesh", async () => {
		const texture = new THREE.Texture();
		const chest = await buildChestBlockMesh("minecraft:chest[type=left,facing=south]", {
			getTexture: async () => texture,
		});
		expect(chest).not.toBeNull();
		if (!chest) throw new Error("Expected a chest mesh");
		models.push(chest);
		const builder = createBuilder(async () => chest);
		const result = builder.extractAllMeshData(chest);
		expect(result).toHaveLength(1);
		expect(result[0].geometry.getAttribute("position").array).toEqual(
			chest.geometry.getAttribute("position").array
		);
		result.forEach(({ geometry }) => geometry.dispose());
		texture.dispose();
	});

	it("preserves child transforms relative to a rotated root", () => {
		const root = new THREE.Group();
		root.position.set(5, 2, 1);
		root.rotation.y = Math.PI / 2;
		const child = box();
		child.position.set(2, 0, 0);
		root.add(child);
		const builder = createBuilder(async () => root);
		const result = builder.extractAllMeshData(root);
		expect(result).toHaveLength(1);
		result[0].geometry.computeBoundingBox();
		const center = result[0].geometry.boundingBox?.getCenter(new THREE.Vector3());
		expect(center?.x).toBeCloseTo(2);
		expect(center?.y).toBeCloseTo(0);
		expect(center?.z).toBeCloseTo(0);
		result.forEach(({ geometry }) => geometry.dispose());
	});
});
