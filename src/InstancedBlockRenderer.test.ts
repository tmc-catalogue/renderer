import * as THREE from "three";
import { expect, it } from "vitest";
import { InstancedBlockRenderer } from "./InstancedBlockRenderer";
import { MaterialRegistry } from "./MaterialRegistry";

it("merges only same-material geometry and preserves same-name palette variants", () => {
	const root = new THREE.Group(),
		geometry = new THREE.BoxGeometry();
	const opaque = new THREE.MeshBasicMaterial(),
		cutout = new THREE.MeshBasicMaterial({ alphaTest: 0.5 });
	const data = {
		isReady: true,
		blockData: [
			{
				blockName: "minecraft:custom",
				category: "solid",
				materialGroups: [
					{ baseGeometry: geometry, material: opaque },
					{ baseGeometry: geometry, material: cutout },
				],
			},
			{
				blockName: "minecraft:custom",
				category: "cutout",
				materialGroups: [{ baseGeometry: geometry, material: cutout }],
			},
		],
	};
	const renderer = new InstancedBlockRenderer(root, data);
	try {
		renderer.initializeInstancedMeshesMerged();
		renderer.renderBlocksInstanced([
			{ x: 0, y: 0, z: 0, paletteIndex: 0 },
			{ x: 1, y: 0, z: 0, paletteIndex: 1 },
		]);
		const meshes = renderer.getInstancedMeshes("minecraft:custom");
		expect(meshes).toHaveLength(3);
		expect(meshes.filter((m) => m.material === cutout)).toHaveLength(2);
		expect(meshes.map((m) => m.count)).toEqual([1, 1, 1]);
		expect(cutout.transparent).toBe(false);
		expect(cutout.depthWrite).toBe(true);
	} finally {
		renderer.disposeInstancedMeshes();
		geometry.dispose();
		opaque.dispose();
		cutout.dispose();
	}
});

it("does not merge materials with different depth semantics and exposes a shared ownership marker", () => {
	const a = new THREE.MeshBasicMaterial(),
		b = new THREE.MeshBasicMaterial({ depthWrite: false });
	const sa = MaterialRegistry.getMaterial(a),
		sb = MaterialRegistry.getMaterial(b);
	try {
		expect(sa).not.toBe(sb);
		expect(sa.userData.registryShared).toBe(true);
		expect(sb.depthWrite).toBe(false);
	} finally {
		MaterialRegistry.releaseMaterial(sa);
		MaterialRegistry.releaseMaterial(sb);
		a.dispose();
		b.dispose();
	}
});
