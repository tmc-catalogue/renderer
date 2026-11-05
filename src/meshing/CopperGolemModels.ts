import * as THREE from "three";
import poses from "./CopperGolemPoses.json";
import type { ChestAssetLoaderLike } from "./ChestModels";
import { mergeOwnedStaticModelParts } from "./StaticModelParts";

/** Static entity-model poses, in Minecraft's pixel units (Y down).
 * CopperGolemPoses contains the vanilla 26.3 model dimensions and part transforms.
 * Reference: https://mc-packet-reference.netlify.app/26.x/source/net/minecraft/client/model/animal/golem/coppergolemmodel/
 * Keep the model's floor/origin: normalizing its bounding box changes running poses.
 */
export async function buildCopperGolemStatue(
	name: string,
	properties: Record<string, string>,
	assets: ChestAssetLoaderLike
): Promise<THREE.Group> {
	const oxidation = ["oxidized", "weathered", "exposed"].find((stage) => name.includes(stage));
	const path = `entity/copper_golem/copper_golem${oxidation ? `_${oxidation}` : ""}`;
	const texture = await assets.getTexture(path);
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1 });
	const pose = properties.copper_golem_pose as keyof typeof poses;
	const parts = poses[pose] ?? poses.standing;
	const matrices: THREE.Matrix4[] = [];
	const group = new THREE.Group();
	const facing = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 };
	const world = new THREE.Matrix4()
		.makeRotationY(facing[properties.facing as keyof typeof facing] ?? 0)
		.multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0))
		.multiply(new THREE.Matrix4().makeScale(1 / 16, -1 / 16, 1 / 16));
	for (const part of parts) {
		const local = new THREE.Matrix4()
			.makeTranslation(...(part.offset as [number, number, number]))
			.multiply(
				new THREE.Matrix4().makeRotationFromEuler(
					new THREE.Euler(...(part.rotation as [number, number, number]), "ZYX")
				)
			);
		const transform = part.parent < 0 ? local : matrices[part.parent].clone().multiply(local);
		matrices.push(transform);
		for (const cube of part.cubes) {
			const [x, y, z, w, h, d] = cube.box;
			const [u, v] = cube.uv;
			const inflate = cube.inflate;
			const geometry = new THREE.BoxGeometry(w + 2 * inflate, h + 2 * inflate, d + 2 * inflate);
			// BoxGeometry face order: east, west, down, up, south, north (Java Y down).
			const rectangles = [
				[u + d + w, v + d, d, h],
				[u, v + d, d, h],
				[u + d + w, v, w, d],
				[u + d, v, w, d],
				[u + 2 * d + w, v + d, w, h],
				[u + d, v + d, w, h],
			];
			const uv = geometry.getAttribute("uv");
			for (let face = 0; face < 6; face++) {
				const [a, b, width, height] = rectangles[face];
				for (let i = 0; i < 4; i++) {
					const index = face * 4 + i;
					uv.setXY(
						index,
						(a + uv.getX(index) * width) / 64,
						1 - (b + uv.getY(index) * height) / 64
					);
				}
			}
			geometry.translate(x + w / 2, y + h / 2, z + d / 2);
			geometry.applyMatrix4(world.clone().multiply(transform));
			// Y reflection reverses winding, but not the transformed outward normals.
			const indices = geometry.index!;
			for (let i = 0; i < indices.count; i += 3) {
				const a = indices.getX(i);
				indices.setX(i, indices.getX(i + 2));
				indices.setX(i + 2, a);
			}
			const mesh = new THREE.Mesh(geometry, material);
			mesh.name = part.name;
			group.add(mesh);
		}
	}
	group.name = `copper_golem_statue:${pose ?? "standing"}`;
	mergeOwnedStaticModelParts(group);
	return group;
}
