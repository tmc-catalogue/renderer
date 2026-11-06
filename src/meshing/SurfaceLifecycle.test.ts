import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SchematicObject } from "../managers/SchematicObject";
import { buildFluidMeshes, disposeFluidMeshes, setFluidTextures } from "./WaterMesher";
import { createFluidFrameTexture } from "./WaterTextures";
import { SurfaceIndex } from "./SurfaceIndex";
vi.mock("nucleation", () => ({ default: vi.fn(), SchematicWrapper: class {} }));
vi.mock("../workers/MeshBuilder.worker?worker&inline", () => ({ default: class {} }));
vi.mock("../workers/MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));

function schematic() {
	const object: any = Object.create(SchematicObject.prototype);
	const cells = new Map<string, string>();
	const texture = new THREE.Texture();
	const loader = {
		getMaterial: vi.fn(async () => new THREE.MeshStandardMaterial({ map: texture })),
		getTexture: vi.fn(async () => texture),
	};
	Object.assign(object, {
		eventEmitter: { emit: vi.fn() },
		visible: true,
		opacity: 1,
		group: new THREE.Group(),
		meshes: [],
		animatedSurfaces: [],
		surfaceViewBox: new THREE.Box3(),
		surfaceIndex: new SurfaceIndex(),
		surfaceTemplates: new Map(),
		surfaceMaterials: new Map(),
		surfaceClip: { value: new THREE.Vector2(0, 1e9) },
		hiddenCells: new Set(),
		renderingBounds: {
			enabled: false,
			min: new THREE.Vector3(),
			max: new THREE.Vector3(128, 16, 16),
		},
		editQueue: Promise.resolve(),
		meshesReady: Promise.resolve(),
		gpuBuilt: false,
		schematicWrapper: {
			get_block_string: (x: number, y: number, z: number) =>
				cells.get(`${x},${y},${z}`) || "minecraft:air",
			set_block: (x: number, y: number, z: number, state: string) =>
				cells.set(`${x},${y},${z}`, state),
		},
		schematicRenderer: {
			options: { meshBuildingMode: "gpu-pull", enableAnimatedTextures: true },
			invalidate: vi.fn(),
			cubane: {
				getAssetLoader: () => loader,
				getBlockMesh: vi.fn(async (state: string) => {
					const material = new THREE.MeshBasicMaterial();
					material.userData.texturePath = `block/${state}`;
					return [{ geometry: new THREE.BoxGeometry(), material }];
				}),
			},
		},
		worldMeshBuilder: { extractAllMeshData: (parts: unknown) => parts },
		rebuildMeshNow: vi.fn(async () => {}),
	});
	return { object, loader, cells };
}

function buildableSchematic() {
	const fixture = schematic();
	const { object, cells } = fixture;
	delete object.rebuildMeshNow;
	Object.assign(object, {
		id: "surface-recovery",
		name: "surface-recovery",
		position: new THREE.Vector3(),
		rotation: new THREE.Euler(),
		scale: new THREE.Vector3(1, 1, 1),
		chunkMeshes: new Map(),
		sceneManager: { schematicRenderer: { options: {} } },
	});
	object.schematicRenderer.options.meshBuildingMode = "batched";
	object.worldMeshBuilder.buildSignMeshes = vi.fn(async () => []);
	const states = ["minecraft:end_portal", "minecraft:glass"];
	vi.spyOn(object, "getPalettes").mockReturnValue({ default: states.map((name) => ({ name })) });
	object.schematicWrapper.create_lazy_chunk_iterator = () => {
		let done = false;
		return {
			has_next: () => !done,
			next: () => {
				done = true;
				return {
					blocks: [...cells].map(([key, state]) => [
						...key.split(",").map(Number),
						states.indexOf(state),
					]),
				};
			},
			free: vi.fn(),
		};
	};
	const mainBuild = vi
		.spyOn(object, "buildSchematicMeshesBatched")
		.mockImplementation(async () => ({
			meshes: [new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())],
			chunkMap: new Map(),
		}));
	return { ...fixture, mainBuild };
}
const surfaces = (s: any) => s.meshes.filter((m: THREE.Mesh) => m.userData.surfaceMesh);
const triangles = (meshes: THREE.Mesh[]) =>
	meshes.reduce(
		(n, m) => n + (m.geometry.index?.count ?? m.geometry.getAttribute("position").count),
		0
	);

describe("surface edit lifecycle", () => {
	it("keeps the main mesh after a surface failure and rebuilds surfaces on retry", async () => {
		const { object, loader, cells } = buildableSchematic();
		cells.set("0,0,0", "minecraft:end_portal");
		cells.set("3,0,0", "minecraft:glass");
		const failure = new Error("surface material preparation failed");
		loader.getMaterial.mockRejectedValueOnce(failure);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const disposeMaterial = vi.spyOn(THREE.ShaderMaterial.prototype, "dispose");
		try {
			object.meshesReady = object.buildMeshes();
			await expect(object.meshesReady).resolves.toBeUndefined();
			expect(await object.getMeshes()).toEqual(object.meshes);
			expect(object.meshes).toHaveLength(1);
			expect(surfaces(object)).toHaveLength(0);
			expect(warn).toHaveBeenCalledWith(
				"[SchematicObject] transparent surface build failed",
				failure
			);
			expect(disposeMaterial).toHaveBeenCalledOnce();
			expect(object.endPortalMaterial).toBeUndefined();
			expect(object.surfaceTemplates.size).toBe(0);
			expect(object.surfaceIndex.sections.size).toBe(0);
			await object.rebuildMesh();
			expect(object.meshes).toHaveLength(3);
			expect(triangles(surfaces(object))).toBe(42);
			expect(object.hasAnimatedSurfaces).toBe(true);
			expect(loader.getMaterial).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
			disposeMaterial.mockRestore();
		}
	});

	it("waits for a failed initial build, then runs queued recovery operations in order", async () => {
		const { object, mainBuild } = buildableSchematic();
		const failure = new Error("initial worker failure");
		let rejectInitial!: (error: Error) => void;
		mainBuild.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectInitial = reject;
				})
		);
		object.meshesReady = object.buildMeshes();
		const initial = expect(object.meshesReady).rejects.toBe(failure);
		const recovered = Promise.all([
			object.rebuildMesh(),
			object.updateMesh(),
			object.setBlock([0, 0, 0], "minecraft:glass"),
			object.hideBlockAndRebuild(0, 0, 0),
			object.unhideAllBlocks(),
		]);
		await Promise.resolve();
		expect(mainBuild).toHaveBeenCalledOnce();
		rejectInitial(failure);
		await initial;
		await recovered;
		expect(mainBuild).toHaveBeenCalledTimes(3);
		expect(object.meshes).toHaveLength(2);
		expect(triangles(surfaces(object))).toBe(36);
		expect(object.hiddenCells.size).toBe(0);
		await expect(object.meshesReady).rejects.toBe(failure);
	});

	it("reports a queued rebuild failure without blocking the next recovery attempt", async () => {
		const { object, mainBuild } = buildableSchematic();
		object.meshesReady = object.buildMeshes();
		await object.meshesReady;
		const failure = new Error("rebuild worker failure");
		mainBuild.mockRejectedValueOnce(failure);
		const failed = expect(object.rebuildMesh()).rejects.toBe(failure);
		const recovered = object.rebuildMesh();
		await failed;
		await recovered;
		expect(mainBuild).toHaveBeenCalledTimes(3);
		expect(await object.getMeshes()).toHaveLength(1);
	});

	it("orders inspector hide after an in-flight edit and treats empty edits as no-ops", async () => {
		const { object } = schematic();
		await object.setBlocks([]);
		expect(object.rebuildMeshNow).not.toHaveBeenCalled();
		let release!: () => void, started!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const building = new Promise<void>((r) => (started = r));
		const build = object.buildSurfaceSections.bind(object);
		vi.spyOn(object, "buildSurfaceSections").mockImplementationOnce(async (keys) => {
			const meshes = await build(keys);
			started();
			await gate;
			return meshes;
		});
		const edit = object.setBlock([0, 0, 0], "minecraft:glass");
		await building;
		const hide = object.hideBlockAndRebuild(0, 0, 0);
		release();
		await Promise.all([edit, hide]);
		expect(surfaces(object)).toHaveLength(0);
		expect(object.surfaceIndex.getBlock(0, 0, 0)).toBe("");
		await object.unhideAllBlocks();
		expect(triangles(surfaces(object))).toBe(36);
	});

	it("updates section seams without replacing unrelated geometry or materials", async () => {
		const { object, loader } = schematic();
		const opaque = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
		object.meshes.push(opaque);
		object.group.add(opaque);
		await object.setBlocks([
			[[15, 0, 0], "minecraft:glass"],
			[[16, 0, 0], "minecraft:glass"],
			[[64, 0, 0], "minecraft:glass"],
		]);
		const distant = surfaces(object).find((m: THREE.Mesh) => m.userData.surfaceSection === "4,0,0");
		expect(triangles(surfaces(object))).toBe(16 * 6);
		await object.setBlock([15, 0, 0], "minecraft:air");
		expect(triangles(surfaces(object))).toBe(12 * 6);
		expect(object.meshes).toContain(distant);
		expect(object.meshes).toContain(opaque);
		expect(loader.getMaterial).toHaveBeenCalledOnce();
		expect(object.rebuildMeshNow).not.toHaveBeenCalled();
	});
	it("serializes concurrent edits and inherits the current layer clip for new colors", async () => {
		const { object } = schematic();
		await object.setBlock([0, 0, 0], "minecraft:glass");
		object.surfaceClip.value.set(1, 2);
		await Promise.all([
			object.setBlock([0, 0, 0], "minecraft:red_stained_glass"),
			object.setBlock([0, 0, 0], "minecraft:blue_stained_glass"),
		]);
		expect(object.surfaceIndex.getBlock(0, 0, 0)).toBe("minecraft:blue_stained_glass");
		expect(surfaces(object)).toHaveLength(1);
		expect(surfaces(object)[0].material.uniforms.uLayerClip.value.toArray()).toEqual([1, 2]);
	});
	it("replaces inspector hidden surfaces and restores the same geometry without duplicates", async () => {
		const { object } = schematic();
		await object.setBlocks([
			[[0, 0, 0], "minecraft:glass"],
			[[1, 0, 0], "minecraft:glass"],
			[[4, 0, 0], "minecraft:end_portal"],
		]);
		const before = triangles(surfaces(object));
		for (let i = 0; i < 3; i++) {
			await object.hideBlockAndRebuild(1, 0, 0);
			expect(triangles(surfaces(object))).toBe(6 * 6 + 6);
			await object.hideBlockAndRebuild(4, 0, 0);
			expect(object.hasAnimatedSurfaces).toBe(false);
			await object.unhideAllBlocks();
			expect(triangles(surfaces(object))).toBe(before);
			expect(object.group.children.length).toBe(surfaces(object).length);
			expect(object.hasAnimatedSurfaces).toBe(true);
		}
		expect(object.rebuildMeshNow).not.toHaveBeenCalled();
	});
	it("restores current opacity on cached materials and shows sections edited while hidden", async () => {
		const { object } = schematic();
		await object.setBlocks([
			[[0, 0, 0], "minecraft:glass"],
			[[3, 0, 0], "minecraft:end_portal"],
		]);
		object.opacity = 0.5;
		object.updateMeshMaterials("opacity");
		await object.hideBlockAndRebuild(0, 0, 0);
		await object.hideBlockAndRebuild(3, 0, 0);
		object.opacity = 1;
		object.updateMeshMaterials("opacity");
		await object.unhideAllBlocks();
		expect(surfaces(object).map((m: THREE.Mesh) => (m.material as THREE.Material).opacity)).toEqual(
			[1, 1]
		);
		object.visible = false;
		object.updateMeshVisibility();
		await object.setBlock([0, 0, 0], "minecraft:red_stained_glass");
		expect(object.group.visible).toBe(false);
		object.visible = true;
		object.updateMeshVisibility();
		expect(surfaces(object).every((m: THREE.Mesh) => m.visible)).toBe(true);
	});

	it("uses a full rebuild when opaque geometry or waterlogged fluid also changes", async () => {
		const { object } = schematic();
		await object.setBlock([0, 0, 0], "minecraft:glass");
		await object.setBlock([0, 0, 0], "minecraft:stone");
		expect(object.rebuildMeshNow).toHaveBeenCalledOnce();
		await object.setBlock([1, 0, 0], "minecraft:glass_pane[waterlogged=true]");
		expect(object.rebuildMeshNow).toHaveBeenCalledTimes(2);
	});
	it("does not animate clipped, offscreen, removed or invisible End portals", async () => {
		const { object } = schematic();
		await object.setBlock([0, 0, 0], "minecraft:end_portal");
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
		camera.position.set(0, 2, 3);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		const frustum = new THREE.Frustum().setFromProjectionMatrix(
			new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
		);
		expect(object.hasSurfacesInView(frustum)).toBe(true);
		object.surfaceClip.value.set(1, -1);
		expect(object.hasSurfacesInView(frustum)).toBe(false);
		object.surfaceClip.value.set(0, 0);
		object.group.position.x = 100;
		expect(object.hasSurfacesInView(frustum)).toBe(false);
		object.group.position.x = 0;
		object.group.visible = false;
		expect(object.hasSurfacesInView(frustum)).toBe(false);
		object.group.visible = true;
		const end = surfaces(object)[0];
		object.opacity = 0;
		object.updateMeshMaterials("opacity");
		end.onBeforeRender();
		expect(end.material.uniforms.uOpacity.value).toBe(0);
		expect(end.material.fragmentShader).toContain("uOpacity <= 0.0");
		expect(object.hasSurfacesInView(frustum)).toBe(false);
		object.group.clear();
		expect(object.hasSurfacesInView(frustum)).toBe(false);
	});
	it("schedules animated fluids only while visible, including meshes without portal clip uniforms", () => {
		const { object } = schematic();
		const texture = createFluidFrameTexture(new Uint8ClampedArray(8), 1, 2, { animation: {} });
		setFluidTextures({ water: texture });
		const { meshes } = buildFluidMeshes(() => "water", 1, 1, 1);
		object.group.add(...meshes);
		object.animatedSurfaces = meshes;
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
		camera.position.set(0, 2, 3);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		const frustum = new THREE.Frustum().setFromProjectionMatrix(
			new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
		);
		expect(meshes[0].userData.animatedSurface).toBe(true);
		expect(object.hasSurfacesInView(frustum)).toBe(true);
		object.group.position.x = 100;
		expect(object.hasSurfacesInView(frustum)).toBe(false);
		object.group.position.x = 0;
		object.group.visible = false;
		expect(object.hasSurfacesInView(frustum)).toBe(false);
		disposeFluidMeshes(meshes);
		texture.dispose();
		setFluidTextures(null);
	});
});
