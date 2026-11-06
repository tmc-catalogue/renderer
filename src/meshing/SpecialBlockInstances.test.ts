import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Cubane } from "../cubane/Cubane";
import { SchematicObject } from "../managers/SchematicObject";
vi.mock("../workers/MeshBuilder.worker?worker&inline", () => ({ default: class {} }));
vi.mock("../workers/MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));

const state =
	"minecraft:copper_golem_statue[copper_golem_pose=standing,facing=north,waterlogged=false]";
function cachedStatue() {
	const texture = new THREE.Texture();
	const cubane = Object.assign(Object.create(Cubane.prototype), {
		initialized: true,
		blockMeshCache: new Map(),
		assetLoader: { getTexture: async () => texture },
		signRenderer: { isSign: () => false },
	}) as Cubane;
	return { cubane, texture };
}
async function schematic(cubane: Pick<Cubane, "getBlockMesh">) {
	const object: any = Object.assign(Object.create(SchematicObject.prototype), {
		group: new THREE.Group(),
		opacity: 1,
		visible: true,
		schematicWrapper: {},
		schematicRenderer: { invalidate: vi.fn() },
		worldMeshBuilder: { cubane },
		buildFluidSurface: async () => [],
		emitPropertyChanged: vi.fn(),
		disposeSurfaceResources: vi.fn(),
		chunkMeshes: new Map(),
		extractGpuGrid: async () => ({
			builder: { buildRecordMeshes: async () => ({ meshes: [] }) },
			paletteData: [],
			materials: [],
			grid: new Uint32Array(1),
			sx: 1,
			sy: 1,
			sz: 1,
			entityCells: [{ x: 0, y: 0, z: 0, block: state }],
		}),
	});
	const result = await object.buildSchematicMeshesGpuPull(object);
	object.meshes = result.meshes;
	object.group.add(...result.meshes);
	return { object, mesh: result.meshes[0] as THREE.InstancedMesh };
}
function material(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
	if (Array.isArray(mesh.material)) throw new Error("Expected a single statue material");
	return mesh.material as THREE.MeshStandardMaterial;
}

describe("special-block schematic ownership", () => {
	it("fades one schematic without changing another schematic or the cached statue", async () => {
		const { cubane, texture } = cachedStatue();
		const cached = (await cubane.getBlockMesh(state)).children[0] as THREE.Mesh;
		const first = await schematic(cubane),
			second = await schematic(cubane);
		first.object.opacity = 0.25;
		first.object.updateMeshMaterials("opacity");
		expect(material(first.mesh).opacity).toBe(0.25);
		expect(material(first.mesh).transparent).toBe(true);
		expect(material(second.mesh).opacity).toBe(1);
		expect(material(second.mesh).transparent).toBe(false);
		expect(material(cached).opacity).toBe(1);
		expect(material(cached).transparent).toBe(false);
		expect(material(first.mesh).map).toBe(texture);
		expect(material(second.mesh).map).toBe(texture);
		expect(first.object.meshes).toHaveLength(1);
		expect(second.object.meshes).toHaveLength(1);
	});

	it("tears down owned instances without disposing template or other schematic resources", async () => {
		const { cubane, texture } = cachedStatue();
		const cached = (await cubane.getBlockMesh(state)).children[0] as THREE.Mesh;
		const first = await schematic(cubane),
			second = await schematic(cubane);
		const cachedDisposed = vi.fn(),
			otherDisposed = vi.fn(),
			textureDisposed = vi.fn();
		cached.geometry.addEventListener("dispose", cachedDisposed);
		material(cached).addEventListener("dispose", cachedDisposed);
		second.mesh.geometry.addEventListener("dispose", otherDisposed);
		material(second.mesh).addEventListener("dispose", otherDisposed);
		texture.addEventListener("dispose", textureDisposed);
		const ownedDisposed = vi.fn();
		first.mesh.geometry.addEventListener("dispose", ownedDisposed);
		material(first.mesh).addEventListener("dispose", ownedDisposed);
		first.object.visible = false;
		await first.object.updateMeshNow();
		expect(ownedDisposed).toHaveBeenCalledTimes(2);
		expect(cachedDisposed).not.toHaveBeenCalled();
		expect(otherDisposed).not.toHaveBeenCalled();
		expect(textureDisposed).not.toHaveBeenCalled();
		const replacement = await schematic(cubane);
		expect(material(replacement.mesh).opacity).toBe(1);
		expect(material(replacement.mesh)).not.toBe(material(first.mesh));
		expect(replacement.mesh.geometry).not.toBe(cached.geometry);
		expect(material(replacement.mesh).map).toBe(texture);
	});

	it("copies material arrays once per source material while preserving texture sharing", async () => {
		const texture = new THREE.Texture();
		const firstMaterial = new THREE.MeshStandardMaterial({ map: texture });
		const secondMaterial = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff });
		const cloneFirst = vi.spyOn(firstMaterial, "clone");
		const root = new THREE.Group();
		root.add(
			new THREE.Mesh(new THREE.BoxGeometry(), [firstMaterial, secondMaterial, firstMaterial])
		);
		const { mesh } = await schematic({ getBlockMesh: async () => root.clone() });
		expect(Array.isArray(mesh.material)).toBe(true);
		const materials = mesh.material as THREE.MeshStandardMaterial[];
		expect(materials[0]).not.toBe(firstMaterial);
		expect(materials[1]).not.toBe(secondMaterial);
		expect(materials[0]).toBe(materials[2]);
		expect(materials.map((m) => m.map)).toEqual([texture, texture, texture]);
		expect(materials[1].emissive.getHex()).toBe(0xffffff);
		expect(cloneFirst).toHaveBeenCalledOnce();
	});
});
