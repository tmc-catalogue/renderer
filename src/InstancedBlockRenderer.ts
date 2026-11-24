import * as THREE from "three";
import { INVISIBLE_BLOCKS } from "./WorldMeshBuilder";
// Fixed instanced rendering with proper geometry merging and block variants

export class InstancedBlockRenderer {
	private instancedMeshes: Map<string, THREE.InstancedMesh[]> = new Map();
	private instanceCounts: Map<string, number> = new Map();
	private maxInstancesPerType: number = 50000; // Increased limit
	private overflowInstances: Map<string, THREE.Object3D[]> = new Map(); // For overflow blocks

	constructor(
		private group: THREE.Group,
		private paletteCache: any
	) {}

	private createBlockTypeKey(blockData: any, paletteIndex: number): string {
		// Palette index already identifies the exact block state; blockData only
		// contains a name, so using that name silently aliases different variants.
		return `${blockData.blockName}#${paletteIndex}`;
	}

	private mergeGeometriesManual(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
		if (!geometries || geometries.length === 0) return null;
		if (geometries.length === 1) return geometries[0].clone();

		const validGeometries = geometries.filter(
			(geo) => geo && geo.attributes.position && geo.attributes.position.count > 0
		);

		if (validGeometries.length === 0) return null;
		if (validGeometries.length === 1) return validGeometries[0].clone();

		let totalVertices = 0;
		let totalIndices = 0;
		let hasNormals = false;
		let hasUVs = false;

		validGeometries.forEach((geo) => {
			totalVertices += geo.attributes.position.count;
			hasNormals = hasNormals || !!geo.attributes.normal;
			hasUVs = hasUVs || !!geo.attributes.uv;

			if (geo.index) {
				totalIndices += geo.index.count;
			} else {
				totalIndices += geo.attributes.position.count;
			}
		});

		const mergedPositions = new Float32Array(totalVertices * 3);
		const mergedNormals = hasNormals ? new Float32Array(totalVertices * 3) : null;
		const mergedUVs = hasUVs ? new Float32Array(totalVertices * 2) : null;
		const mergedIndices = new Uint32Array(totalIndices);

		let positionOffset = 0;
		let indexOffset = 0;
		let vertexOffset = 0;

		validGeometries.forEach((geo) => {
			const positions = geo.attributes.position.array as Float32Array;
			const normals = geo.attributes.normal?.array as Float32Array;
			const uvs = geo.attributes.uv?.array as Float32Array;
			const indices = geo.index?.array;

			mergedPositions.set(positions, positionOffset);

			if (normals && mergedNormals) {
				mergedNormals.set(normals, positionOffset);
			}

			if (uvs && mergedUVs) {
				mergedUVs.set(uvs, (positionOffset / 3) * 2);
			}

			const vertexCount = geo.attributes.position.count;
			let indexCount = 0;

			if (indices) {
				for (let i = 0; i < indices.length; i++) {
					mergedIndices[indexOffset + i] = indices[i] + vertexOffset;
				}
				indexCount = indices.length;
			} else {
				for (let i = 0; i < vertexCount; i++) {
					mergedIndices[indexOffset + i] = vertexOffset + i;
				}
				indexCount = vertexCount;
			}

			positionOffset += positions.length;
			indexOffset += indexCount;
			vertexOffset += vertexCount;
		});

		const mergedGeometry = new THREE.BufferGeometry();
		mergedGeometry.setAttribute("position", new THREE.BufferAttribute(mergedPositions, 3));

		if (mergedNormals) {
			mergedGeometry.setAttribute("normal", new THREE.BufferAttribute(mergedNormals, 3));
		}

		if (mergedUVs) {
			mergedGeometry.setAttribute("uv", new THREE.BufferAttribute(mergedUVs, 2));
		}

		mergedGeometry.setIndex(new THREE.BufferAttribute(mergedIndices, 1));

		return mergedGeometry;
	}

	public initializeInstancedMeshes(): void {
		if (!this.paletteCache?.isReady) {
			throw new Error("Palette cache not ready for instanced rendering");
		}

		this.disposeInstancedMeshes();

		const uniqueBlockTypes = new Set<string>();

		this.paletteCache.blockData.forEach((blockData: any, paletteIndex: number) => {
			const blockName = blockData.blockName;

			if (INVISIBLE_BLOCKS.has(blockName)) {
				return;
			}

			const blockTypeKey = this.createBlockTypeKey(blockData, paletteIndex);

			if (uniqueBlockTypes.has(blockTypeKey)) {
				return;
			}
			uniqueBlockTypes.add(blockTypeKey);

			const instancedMeshesForBlock: THREE.InstancedMesh[] = [];

			blockData.materialGroups.forEach((materialGroup: any, groupIndex: number) => {
				const geometry = materialGroup.baseGeometry;
				const material = materialGroup.material;

				if (!geometry || geometry.attributes.position.count === 0) {
					return;
				}

				const instancedMesh = new THREE.InstancedMesh(geometry, material, 0);

				instancedMesh.name = `instanced_${blockTypeKey}_part${groupIndex}`;
				instancedMesh.userData.paletteIndex = paletteIndex;
				instancedMesh.userData.blockTypeKey = blockTypeKey;
				instancedMesh.userData.materialGroupIndex = groupIndex;

				this.configureMeshForCategory(instancedMesh, blockData.category);

				instancedMesh.visible = false;
				instancedMesh.count = 0;

				instancedMeshesForBlock.push(instancedMesh);
				this.group.add(instancedMesh);
			});

			this.instancedMeshes.set(blockTypeKey, instancedMeshesForBlock);
			this.instanceCounts.set(blockTypeKey, 0);
		});
	}

	public initializeInstancedMeshesMerged(): void {
		if (!this.paletteCache?.isReady) {
			throw new Error("Palette cache not ready for instanced rendering");
		}

		this.disposeInstancedMeshes();

		const uniqueBlockTypes = new Set<string>();

		this.paletteCache.blockData.forEach((blockData: any, paletteIndex: number) => {
			const blockName = blockData.blockName;

			if (INVISIBLE_BLOCKS.has(blockName)) {
				return;
			}

			const blockTypeKey = this.createBlockTypeKey(blockData, paletteIndex);

			if (uniqueBlockTypes.has(blockTypeKey)) {
				return;
			}
			uniqueBlockTypes.add(blockTypeKey);

			// Merge only compatible geometry sharing one material. This retains the
			// efficient instanced draw without flattening every face into material 0.
			const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
			for (const part of blockData.materialGroups) {
				if (!part.material || !part.baseGeometry?.attributes.position?.count) continue;
				let list = byMaterial.get(part.material);
				if (!list) byMaterial.set(part.material, (list = []));
				list.push(part.baseGeometry);
			}
			const meshes: THREE.InstancedMesh[] = [];
			for (const [material, geometries] of byMaterial) {
				const geometry = this.mergeGeometriesManual(geometries);
				if (!geometry) continue;
				const mesh = new THREE.InstancedMesh(geometry, material, 0);
				mesh.name = `instanced_${blockTypeKey}_merged_${meshes.length}`;
				mesh.userData.paletteIndex = paletteIndex;
				mesh.userData.blockTypeKey = blockTypeKey;
				mesh.userData.ownsMergedGeometry = true;
				this.configureMeshForCategory(mesh, blockData.category);
				mesh.visible = false;
				mesh.count = 0;
				meshes.push(mesh);
				this.group.add(mesh);
			}
			this.instancedMeshes.set(blockTypeKey, meshes);
			this.instanceCounts.set(blockTypeKey, 0);
		});

		console.log(
			`Created merged instanced meshes for ${uniqueBlockTypes.size} unique block variants`
		);
	}

	public renderBlocksInstanced(
		allBlocks: Array<{ x: number; y: number; z: number; paletteIndex: number }>
	): void {
		console.log(`Rendering ${allBlocks.length} blocks with overflow handling...`);
		const startTime = performance.now();

		this.instanceCounts.forEach((_, blockTypeKey) => {
			this.instanceCounts.set(blockTypeKey, 0);
		});
		this.clearOverflowInstances();

		const blocksByType = new Map<string, Array<{ x: number; y: number; z: number }>>();

		for (const block of allBlocks) {
			const blockData = this.paletteCache.blockData[block.paletteIndex];
			if (!blockData) continue;

			if (INVISIBLE_BLOCKS.has(blockData.blockName)) continue;

			const blockTypeKey = this.createBlockTypeKey(blockData, block.paletteIndex);

			if (!blocksByType.has(blockTypeKey)) {
				blocksByType.set(blockTypeKey, []);
			}
			blocksByType.get(blockTypeKey)!.push(block);
		}

		blocksByType.forEach((positions, blockTypeKey) => {
			this.setInstancesWithOverflow(blockTypeKey, positions);
		});

		this.instancedMeshes.forEach((meshes, blockTypeKey) => {
			const count = this.instanceCounts.get(blockTypeKey) || 0;

			meshes.forEach((mesh) => {
				mesh.visible = count > 0;
				mesh.count = Math.min(count, this.maxInstancesPerType);
			});
		});

		const duration = performance.now() - startTime;
		console.log(`⚡ Instanced rendering with overflow completed in ${duration.toFixed(2)}ms`);

		this.logInstancedStats();
	}

	private setInstancesWithOverflow(
		blockTypeKey: string,
		positions: Array<{ x: number; y: number; z: number }>
	): void {
		const instancedMeshes = this.instancedMeshes.get(blockTypeKey);
		if (!instancedMeshes) return;

		const instanceCount = Math.min(positions.length, this.maxInstancesPerType);
		const overflowCount = positions.length - instanceCount;

		if (instanceCount > 0) {
			const matrix = new THREE.Matrix4();

			instancedMeshes.forEach((mesh, groupIndex) => {
				const instancedMesh = this.ensureCapacity(mesh, instanceCount);
				instancedMeshes[groupIndex] = instancedMesh;
				for (let i = 0; i < instanceCount; i++) {
					const pos = positions[i];
					matrix.setPosition(pos.x, pos.y, pos.z);
					instancedMesh.setMatrixAt(i, matrix);
				}
				instancedMesh.instanceMatrix.clearUpdateRanges();
				instancedMesh.instanceMatrix.addUpdateRange(0, instanceCount * 16);
				instancedMesh.instanceMatrix.needsUpdate = true;
				instancedMesh.boundingBox = null;
				instancedMesh.boundingSphere = null;
			});
		}

		if (overflowCount > 0) {
			console.log(
				`${blockTypeKey}: ${overflowCount} blocks exceed instance limit, creating individual meshes`
			);
			const overflowMeshes: THREE.Object3D[] = [];
			for (let i = instanceCount; i < positions.length; i++) {
				const pos = positions[i];
				instancedMeshes.forEach((instancedMesh, groupIndex) => {
					const overflowMesh = new THREE.Mesh(instancedMesh.geometry, instancedMesh.material);

					overflowMesh.position.set(pos.x, pos.y, pos.z);
					overflowMesh.name = `overflow_${blockTypeKey}_${i}_part${groupIndex}`;

					overflowMeshes.push(overflowMesh);
					this.group.add(overflowMesh);
				});
			}

			this.overflowInstances.set(blockTypeKey, overflowMeshes);
		}

		this.instanceCounts.set(blockTypeKey, positions.length);
	}

	private ensureCapacity(mesh: THREE.InstancedMesh, count: number): THREE.InstancedMesh {
		const previousCapacity = mesh.instanceMatrix.count;
		if (previousCapacity >= count) return mesh;
		const capacity = Math.min(this.maxInstancesPerType, Math.max(count, previousCapacity * 2));

		// Renderers cache instance bindings by mesh. Replace the mesh when the
		// allocation grows so its old GPU buffer and bindings can be released.
		const replacement = new THREE.InstancedMesh(mesh.geometry, mesh.material, 0);
		THREE.Object3D.prototype.copy.call(replacement, mesh, false);
		replacement.instanceMatrix = new THREE.InstancedBufferAttribute(
			new Float32Array(capacity * 16),
			16
		).setUsage(THREE.DynamicDrawUsage);
		this.group.remove(mesh);
		mesh.dispose();
		this.group.add(replacement);
		return replacement;
	}

	private clearOverflowInstances(): void {
		this.overflowInstances.forEach((meshes) => {
			meshes.forEach((mesh) => {
				this.group.remove(mesh);
			});
		});
		this.overflowInstances.clear();
	}

	private logInstancedStats(): void {
		console.log("ENHANCED INSTANCED RENDERING STATS:");
		console.log("=".repeat(60));

		let totalInstances = 0;
		let totalInstancedMeshObjects = 0;
		let totalOverflowMeshes = 0;
		let typesWithOverflow = 0;

		this.instanceCounts.forEach((count, blockTypeKey) => {
			if (count > 0) {
				const meshes = this.instancedMeshes.get(blockTypeKey) || [];
				const overflowMeshes = this.overflowInstances.get(blockTypeKey) || [];
				const instancedCount = Math.min(count, this.maxInstancesPerType);
				const overflowCount = overflowMeshes.length;

				if (overflowCount > 0) {
					console.log(
						`  ${blockTypeKey}: ${instancedCount} instanced + ${overflowCount} individual`
					);
					typesWithOverflow++;
				} else {
					console.log(`  ${blockTypeKey}: ${count} instances × ${meshes.length} parts`);
				}

				totalInstances += count;
				totalInstancedMeshObjects += meshes.length;
				totalOverflowMeshes += overflowCount;
			}
		});

		console.log("=".repeat(60));
		console.log(`Total Block Instances: ${totalInstances}`);
		console.log(`Instanced Mesh Objects: ${totalInstancedMeshObjects}`);
		console.log(`Overflow Individual Meshes: ${totalOverflowMeshes}`);
		console.log(`Block Types with Overflow: ${typesWithOverflow}`);
		console.log(`Estimated Draw Calls: ${totalInstancedMeshObjects + totalOverflowMeshes}`);
	}

	private configureMeshForCategory(mesh: THREE.InstancedMesh, category: string): void {
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;

		switch (category) {
			case "emissive":
				mesh.renderOrder = 1;
				break;
			case "redstone":
				mesh.userData.isDynamic = true;
				break;
		}
	}

	public disposeInstancedMeshes(): void {
		this.clearOverflowInstances();
		this.instancedMeshes.forEach((meshes) => {
			meshes.forEach((mesh) => {
				this.group.remove(mesh);
				if (mesh.userData.ownsMergedGeometry) mesh.geometry.dispose();
				mesh.dispose();
			});
		});
		this.instancedMeshes.clear();
		this.instanceCounts.clear();
	}

	public getInstancedMeshes(blockName: string): THREE.InstancedMesh[] {
		return (
			this.instancedMeshes.get(blockName) ??
			[...this.instancedMeshes.entries()]
				.filter(([key]) => key.startsWith(`${blockName}#`))
				.flatMap(([, meshes]) => meshes)
		);
	}
}
