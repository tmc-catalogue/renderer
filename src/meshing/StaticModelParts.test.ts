import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { bakeStaticModelParts, mergeOwnedStaticModelParts } from "./StaticModelParts";

describe("static model consolidation", () => {
	it("bakes nested transforms and retains bounds, UVs and cached source geometry", () => {
		const root = new THREE.Group();
		root.position.set(10, 20, 30);
		const parent = new THREE.Group();
		parent.rotation.y = Math.PI / 2;
		root.add(parent);
		const material = new THREE.MeshStandardMaterial();
		for (const x of [0, 2]) {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material.clone());
			mesh.position.x = x;
			parent.add(mesh);
		}
		const bounds = new THREE.Box3().setFromObject(root);
		const original = (parent.children[0] as THREE.Mesh).geometry;
		const dispose = vi.fn();
		original.addEventListener("dispose", dispose);
		const parts = bakeStaticModelParts(root);
		expect(parts).toHaveLength(1);
		expect(parts[0].geometry.index!.count).toBe(72);
		expect(parts[0].geometry.getAttribute("uv").count).toBe(48);
		const merged = new THREE.Group();
		merged.position.copy(root.position);
		merged.add(...parts);
		expect(new THREE.Box3().setFromObject(merged)).toEqual(bounds);
		expect(dispose).not.toHaveBeenCalled();
		expect(parent.children).toHaveLength(2);
	});

	it("retains distinct emission, textures, depth settings, and attribute layouts", () => {
		const root = new THREE.Group();
		const texture = new THREE.Texture();
		const base = new THREE.MeshStandardMaterial({ map: texture });
		const emissive = base.clone();
		emissive.emissive.set(0xffffff);
		emissive.emissiveMap = texture;
		const depth = base.clone();
		depth.depthWrite = false;
		const otherTexture = base.clone();
		otherTexture.map = new THREE.Texture();
		for (const material of [base, emissive, depth, otherTexture])
			root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
		const extra = new THREE.BoxGeometry();
		extra.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(72), 3));
		root.add(new THREE.Mesh(extra, base));
		expect(bakeStaticModelParts(root)).toHaveLength(5);
	});

	it("disposes owned source geometry and redundant materials without disposing textures", () => {
		const root = new THREE.Group();
		const texture = new THREE.Texture();
		const textureDisposed = vi.fn();
		texture.addEventListener("dispose", textureDisposed);
		const geometriesDisposed = vi.fn(),
			materialsDisposed = vi.fn();
		for (let i = 0; i < 3; i++) {
			const geometry = new THREE.BoxGeometry();
			geometry.addEventListener("dispose", geometriesDisposed);
			const material = new THREE.MeshStandardMaterial({ map: texture });
			material.addEventListener("dispose", materialsDisposed);
			root.add(new THREE.Mesh(geometry, material));
		}
		mergeOwnedStaticModelParts(root);
		expect(root.children).toHaveLength(1);
		expect(geometriesDisposed).toHaveBeenCalledTimes(3);
		expect(materialsDisposed).toHaveBeenCalledTimes(2);
		expect(textureDisposed).not.toHaveBeenCalled();
	});
});
