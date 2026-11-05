import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as THREE from "three";
import { ModelResolver } from "./ModelResolver";
import { AssetLoader } from "./AssetLoader";
import { BlockMeshBuilder } from "./BlockMeshBuilder";
import { SignRenderer } from "./SignRenderer";
import { TintManager } from "./TintManager";
import { buildChestBlockMesh } from "../meshing/ChestModels";
import { buildCopperGolemStatue } from "../meshing/CopperGolemModels";
import { buildFluidMeshes, disposeFluidMeshes } from "../meshing/WaterMesher";

let pack: JSZip;
beforeAll(async () => {
	pack = await JSZip.loadAsync(readFileSync("test/public/pack.zip"));
});
const json = async (path: string) =>
	JSON.parse(await pack.file(`assets/minecraft/${path}.json`)!.async("string"));
const woods = [
	"oak",
	"spruce",
	"birch",
	"jungle",
	"acacia",
	"dark_oak",
	"mangrove",
	"cherry",
	"bamboo",
	"crimson",
	"warped",
	"pale_oak",
	"poplar",
];
const stages = ["", "exposed_", "weathered_", "oxidized_"];

describe("26.3 resource-pack compatibility", () => {
	it.each(woods)("selects both shelf layers for every %s state", async (wood) => {
		const name = `${wood}_shelf`;
		const definition = await json(`blockstates/${name}`);
		const resolver = new ModelResolver({
			getBlockState: async () => definition,
		} as unknown as AssetLoader);
		for (const [angle, facing] of ["north", "east", "south", "west"].entries())
			for (const powered of ["false", "true"])
				for (const side_chain of ["unconnected", "left", "center", "right"])
					for (const waterlogged of ["false", "true"]) {
						const models = await resolver.resolveBlockModel({
							namespace: "minecraft",
							name,
							properties: { facing, powered, side_chain, waterlogged },
						});
						expect(models.map((m) => m.model)).toEqual([
							`minecraft:block/${name}`,
							`minecraft:block/${name}_${powered === "false" ? "unpowered" : side_chain}`,
						]);
						expect(models.map((m) => m.y ?? 0)).toEqual([angle * 90, angle * 90]);
					}
	});

	it("evaluates nested AND/OR and value alternatives without accepting missing properties", async () => {
		const resolver = new ModelResolver({
			getBlockState: async () => ({
				multipart: [
					{
						when: {
							AND: [
								{ OR: [{ facing: "north|east" }, { powered: "true" }] },
								{ waterlogged: "false" },
							],
						},
						apply: { model: "matched" },
					},
				],
			}),
		} as unknown as AssetLoader);
		for (const [properties, matches] of [
			[{ facing: "east", waterlogged: "false" }, true],
			[{ powered: "true", waterlogged: "false" }, true],
			[{ facing: "south", waterlogged: "false" }, false],
			[{ facing: "east" }, false],
		] as const) {
			expect(
				(
					await resolver.resolveBlockModel({
						namespace: "minecraft",
						name: "test",
						properties: { ...properties },
					})
				).length
			).toBe(matches ? 1 : 0);
		}
	});

	it("loads the right copper chest skin for every oxidation, wax and double half", async () => {
		for (const wax of ["", "waxed_"])
			for (const stage of stages)
				for (const type of ["single", "left", "right"])
					for (const facing of ["north", "east", "south", "west"]) {
						let path = "";
						const mesh = await buildChestBlockMesh(
							`minecraft:${wax}${stage}copper_chest[type=${type},facing=${facing}]`,
							{
								getTexture: (p) => {
									path = p;
									return new THREE.Texture();
								},
							}
						);
						expect(path).toBe(
							`entity/chest/copper${stage ? `_${stage.slice(0, -1)}` : ""}${type === "single" ? "" : `_${type}`}`
						);
						expect(pack.file(`assets/minecraft/textures/${path}.png`)).not.toBeNull();
						expect(mesh!.geometry.index!.count).toBeGreaterThan(0);
						expect(mesh!.geometry.boundingBox!.min.y).toBe(-0.5);
						mesh!.geometry.dispose();
					}
	});

	it("builds four distinct statue poses with finite, outward-facing geometry and all eight skins", async () => {
		const silhouettes = new Set<string>();
		for (const wax of ["", "waxed_"])
			for (const stage of stages)
				for (const pose of ["standing", "sitting", "running", "star"]) {
					let path = "";
					const group = await buildCopperGolemStatue(
						`${wax}${stage}copper_golem_statue`,
						{ copper_golem_pose: pose, facing: "north" },
						{
							getTexture: (p) => {
								path = p;
								return new THREE.Texture();
							},
						}
					);
					expect(pack.file(`assets/minecraft/textures/${path}.png`)).not.toBeNull();
					const bounds = new THREE.Box3().setFromObject(group);
					silhouettes.add(JSON.stringify(bounds));
					expect(bounds.max.y).toBeGreaterThan(0.5);
					for (const child of group.children as THREE.Mesh[]) {
						const p = child.geometry.getAttribute("position"),
							n = child.geometry.getAttribute("normal"),
							index = child.geometry.index!;
						expect([...p.array].every(Number.isFinite)).toBe(true);
						const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(0));
						const b = new THREE.Vector3().fromBufferAttribute(p, index.getX(1));
						const c = new THREE.Vector3().fromBufferAttribute(p, index.getX(2));
						expect(
							b
								.sub(a)
								.cross(c.sub(a))
								.dot(new THREE.Vector3().fromBufferAttribute(n, index.getX(0)))
						).toBeGreaterThan(0);
						child.geometry.dispose();
					}
				}
		expect(silhouettes.size).toBe(4);
	});

	it("uses grass and dry-foliage maps for the newly tinted plants", () => {
		const tint = new TintManager();
		const pixels = (r: number, g: number, b: number) =>
			({ width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, 255]) }) as ImageData;
		tint.setColormaps(pixels(30, 180, 20), pixels(20, 90, 10), pixels(150, 110, 60));
		for (const name of ["bush", "wildflowers"])
			expect(tint.getTint(`minecraft:${name}`, {}).toArray()).toEqual([
				30 / 255,
				180 / 255,
				20 / 255,
			]);
		expect(tint.getTint("minecraft:leaf_litter", {}).toArray()).toEqual([
			150 / 255,
			110 / 255,
			60 / 255,
		]);
		expect(tint.getTint("minecraft:firefly_bush", {}).getHex()).toBe(0xffffff);
	});

	it("retains the face beside new partial blocks, while solid neighbors still occlude fluids", () => {
		const partial = [
			...woods.map((w) => `${w}_shelf`),
			"dried_ghast",
			"sulfur_spike",
			"resin_clump",
			"pale_hanging_moss",
			"bush",
			"firefly_bush",
			"leaf_litter",
			"copper_golem_statue",
		];
		for (const fluid of ["water", "lava"])
			for (const name of [...partial, "stone", "resin_block"]) {
				const result = buildFluidMeshes(
					(x) => (x === 0 ? `minecraft:${fluid}` : `minecraft:${name}[waterlogged=false]`),
					2,
					1,
					1
				);
				expect(result.meshes[0].geometry.index!.count, `${fluid}/${name}`).toBe(
					partial.includes(name) ? 36 : 30
				);
				disposeFluidMeshes(result.meshes);
			}
	});

	it("keeps element emission separate even when two layers share a texture", async () => {
		const assets = new AssetLoader();
		assets.getTexture = async () => new THREE.Texture();
		const builder = new BlockMeshBuilder(assets, { useAtlas: false });
		const template = await json("models/block/cross_emissive");
		template.textures = { cross: "block/test", cross_emissive: "block/test" };
		const mesh = await builder.createBlockMesh(template);
		const materials = (mesh.children as THREE.Mesh[]).map(
			(m) => m.material as THREE.MeshStandardMaterial
		);
		expect(materials.filter((m) => m.emissive.getHex() === 0xffffff)).toHaveLength(4);
		expect(materials.filter((m) => m.emissive.getHex() === 0)).toHaveLength(4);
		for (const m of materials.filter((m) => m.emissive.getHex())) expect(m.emissiveMap).toBe(m.map);
	});
	it("renders modern sign models with independent front/back text instead of falling back to blank boards", async () => {
		const canvases = new WeakMap<HTMLCanvasElement, ImageData>();
		const context = vi
			.spyOn(HTMLCanvasElement.prototype, "getContext")
			.mockImplementation(function (this: HTMLCanvasElement) {
				return {
					putImageData: (data: ImageData) => canvases.set(this, data),
					getImageData: () => canvases.get(this)!,
				} as unknown as CanvasRenderingContext2D;
			} as unknown as HTMLCanvasElement["getContext"]);
		try {
			const assets = new AssetLoader();
			assets.getBlockState = (name) => json(`blockstates/${name}`);
			assets.getModel = async (name) => {
				const model = await json(`models/${name.replace("minecraft:", "")}`);
				if (!model.parent) return model;
				const parent = await assets.getModel(model.parent);
				return {
					...parent,
					...model,
					elements: model.elements ?? parent.elements,
					textures: { ...parent.textures, ...model.textures },
				};
			};
			assets.getTexture = async () => new THREE.Texture();
			assets.getTexturePixels = async (path) => {
				if (path.startsWith("entity/")) return null;
				const size = path === "font/ascii" ? 128 : 32;
				return new ImageData(new Uint8ClampedArray(size * size * 4).fill(255), size, size);
			};
			const signs = new SignRenderer(assets);
			for (const wood of ["pale_oak", "poplar"])
				for (const kind of ["sign", "wall_sign", "hanging_sign", "wall_hanging_sign"]) {
					const mesh = await signs.buildSignMesh(
						`minecraft:${wood}_${kind}`,
						{ rotation: "3", facing: "east", attached: "true" },
						{
							front_text: { messages: ['{"text":"FRONT"}'], color: "black" },
							back_text: { messages: ['{"text":"BACK"}'], color: "blue" },
						}
					);
					expect(mesh).not.toBeNull();
					let pixels: ImageData | undefined;
					mesh!.traverse((o) => {
						if (o instanceof THREE.Mesh)
							pixels = canvases.get(
								(o.material as THREE.MeshStandardMaterial).map!.image as HTMLCanvasElement
							);
					});
					expect(pixels).toBeDefined();
					const colors = new Set<string>();
					for (let i = 0; i < pixels!.data.length; i += 4)
						colors.add([...pixels!.data.slice(i, i + 3)].join(","));
					expect(colors.has("0,0,0")).toBe(true);
					expect(
						[...colors].some((c) => {
							const [r, g, b] = c.split(",").map(Number);
							return b > r && b > g;
						})
					).toBe(true);
				}
		} finally {
			context.mockRestore();
		}
	});
});
