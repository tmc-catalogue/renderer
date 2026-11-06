import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Bake generated static models into one mesh per equivalent material, without changing cached prototypes. */
export function bakeStaticModelParts(root: THREE.Object3D): THREE.Mesh[] {
	root.updateWorldMatrix(true, true);
	const inverse = root.matrixWorld.clone().invert();
	const buckets = new Map<string, { geometries: THREE.BufferGeometry[]; mesh: THREE.Mesh }>();
	root.traverse((part) => {
		if (!(part instanceof THREE.Mesh)) return;
		const material = part.material;
		// These callers generate standard materials. Keep custom/array materials separate.
		const key =
			material instanceof THREE.MeshStandardMaterial &&
			!Object.prototype.hasOwnProperty.call(material, "onBeforeCompile")
				? JSON.stringify(
						Object.fromEntries(
							Object.entries(material)
								.filter(([key]) => !["uuid", "name", "version", "_listeners"].includes(key))
								.map(([key, value]) => [key, value instanceof THREE.Texture ? value.uuid : value])
						)
					)
				: part.uuid;
		const layout = Object.keys(part.geometry.attributes)
			.sort()
			.map((name) => {
				const attribute = part.geometry.getAttribute(name);
				return [name, attribute.itemSize, attribute.normalized, attribute.array.constructor.name];
			});
		const stateKey = `${key}:${part.renderOrder}:${part.visible}:${part.castShadow}:${part.receiveShadow}:${!!part.geometry.index}:${JSON.stringify(layout)}`;
		const geometry = part.geometry
			.clone()
			.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, part.matrixWorld));
		const bucket = buckets.get(stateKey);
		if (bucket) bucket.geometries.push(geometry);
		else
			buckets.set(stateKey, {
				geometries: [geometry],
				mesh: part,
			});
	});
	const meshes: THREE.Mesh[] = [];
	for (const { geometries, mesh: source } of buckets.values()) {
		const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
		if (!geometry) {
			// Incompatible vertex layouts must remain separate rather than lose attributes.
			geometries.forEach((geometry) => meshes.push(new THREE.Mesh(geometry, source.material)));
			continue;
		}
		if (geometries.length > 1) geometries.forEach((part) => part.dispose());
		const mesh = new THREE.Mesh(geometry, source.material);
		mesh.name = source.name;
		mesh.visible = source.visible;
		mesh.renderOrder = source.renderOrder;
		mesh.castShadow = source.castShadow;
		mesh.receiveShadow = source.receiveShadow;
		mesh.userData = { ...source.userData };
		meshes.push(mesh);
	}
	return meshes;
}

/** Replace newly built, exclusively owned geometry; materials remain owned by the model. */
export function mergeOwnedStaticModelParts(root: THREE.Group): void {
	const meshes = bakeStaticModelParts(root);
	const keptMaterials = new Set(
		meshes.flatMap((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]))
	);
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	root.traverse((part) => {
		if (!(part instanceof THREE.Mesh)) return;
		geometries.add(part.geometry);
		for (const material of Array.isArray(part.material) ? part.material : [part.material])
			materials.add(material);
	});
	geometries.forEach((geometry) => geometry.dispose());
	materials.forEach((material) => {
		if (!keptMaterials.has(material)) material.dispose();
	});
	root.clear();
	root.add(...meshes);
}
