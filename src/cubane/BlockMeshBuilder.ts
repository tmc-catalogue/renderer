import * as THREE from "three";
import { mergeBufferGeometries } from "./mergeBufferGeometries";
import { AssetLoader } from "./AssetLoader";
import { Block, BlockModel, BlockModelElement, OptimizedFace } from "./types";

interface GeometryGroup {
	geometry: THREE.BufferGeometry;
	material: THREE.Material;
	isLiquid?: boolean;
	isWater?: boolean;
	isLava?: boolean;
}

export class BlockMeshBuilder {
	private assetLoader: AssetLoader;
	// When false (default), blocks Cubane can't build render nothing instead of
	// a purple debug placeholder. Set via debugOptions.showUnknownBlocks.
	private showUnknownBlocks: boolean;
	private useAtlas: boolean;

	constructor(
		assetLoader: AssetLoader,
		options: { showUnknownBlocks?: boolean; useAtlas?: boolean } = {}
	) {
		this.assetLoader = assetLoader;
		this.useAtlas = options.useAtlas ?? true;
		this.showUnknownBlocks = options.showUnknownBlocks ?? false;
	}

	public async createBlockMesh(
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean; block?: Block } = {},
		block?: Block,
		biome: string = "plains"
	): Promise<THREE.Object3D> {
		const blockData = block || transform.block;
		let mesh: THREE.Object3D;
		if (this.isWaterlogged(blockData)) {
			mesh = await this.createWaterloggedBlockMesh(model, transform, block, biome);
		} else if (blockData && this.isLiquidBlock(blockData)) {
			// liquids render as FULL CUBES (shulkr/vanilla-source look): the pack's
			// level-based water model has sub-1.0 heights, so stacked cells had
			// horizontal gaps between them — "thin block" look, water vanishing when
			// looking up through the slits, and non-flush faces that never culled
			// against liquid neighbours (an interior shell at every block boundary).
			// Full cubes are flush, so same-category neighbour culling keeps only
			// the outer surface — one continuous shell.
			mesh = await this.createBlockMeshNoWater(
				this.fullCubeLiquidModel(blockData),
				transform,
				block,
				biome
			);
		} else {
			mesh = await this.createBlockMeshNoWater(model, transform, block, biome);
		}
		return mesh;
	}

	/** Full-cube liquid model: every face the still texture (tops and sides render
	 * the same pattern; side motion comes from the record path's world-space scroll). */
	private fullCubeLiquidModel(blockData: Block): BlockModel {
		const still = this.isLavaBlock(blockData) ? "block/lava_still" : "block/water_still";
		return {
			elements: [
				{
					from: [0, 0, 0],
					to: [16, 16, 16],
					faces: {
						down: { texture: still },
						up: { texture: still },
						north: { texture: still },
						south: { texture: still },
						west: { texture: still },
						east: { texture: still },
					},
				},
			],
		};
	}

	public async createBlockMeshNoWater(
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean; block?: Block } = {},
		block?: Block,
		biome: string = "plains"
	): Promise<THREE.Object3D> {
		if (!model.elements || model.elements.length === 0) {
			return this.createPlaceholderCube();
		}
		const blockData = block || transform.block;
		const isLiquidBlockType = blockData && this.isLiquidBlock(blockData);
		const isWaterBlockType = blockData && this.isWaterBlock(blockData);

		const geometryGroups = new Map<string, GeometryGroup>();

		for (const element of model.elements) {
			try {
				const elementGeometries = await this.createElementGeometries(
					element,
					model,
					transform, // Pass the whole transform object
					blockData,
					biome
				);

				for (const {
					geometry,
					material,
					materialKey,
					isLiquid,
					isWater,
					isLava,
				} of elementGeometries) {
					if (!geometryGroups.has(materialKey)) {
						geometryGroups.set(materialKey, {
							geometry: new THREE.BufferGeometry(),
							material: material,
							isLiquid,
							isWater,
							isLava,
						});
					}
					const group = geometryGroups.get(materialKey)!;
					if (group.geometry.attributes.position && group.geometry.attributes.position.count > 0) {
						group.geometry = this.mergeGeometries([group.geometry, geometry]);
					} else {
						group.geometry = geometry;
					}
				}
			} catch (error) {
				console.error("Error creating element geometries for element:", element, error);
			}
		}

		// --- CRITICAL CHANGE ---
		// The final group should NOT have the block-level rotation applied here.
		// The caller (e.g., your code that uses Cubane) is responsible for applying the
		// final rotation to this returned object.
		const finalGroup = new THREE.Group();

		for (const [, { geometry, material, isLiquid, isWater, isLava }] of geometryGroups) {
			if (geometry.attributes.position && geometry.attributes.position.count > 0) {
				const mesh = new THREE.Mesh(geometry, material);
				if (isLiquid) {
					mesh.userData.isLiquid = true;
					mesh.userData.isWater = isWater;
					mesh.userData.isLava = isLava;
					mesh.renderOrder = isWater ? 1 : 0;
				}
				finalGroup.add(mesh);
			}
		}

		if (finalGroup.children.length === 0) {
			return this.createPlaceholderCube();
		}

		if (blockData) {
			(finalGroup as any).blockData = blockData;
		}
		(finalGroup as any).biome = biome;
		if (isLiquidBlockType) {
			(finalGroup as any).isLiquid = true;
			(finalGroup as any).isWater = isWaterBlockType;
			(finalGroup as any).isLava = isLiquidBlockType && !isWaterBlockType;
		}

		return finalGroup;
	}

	// Add this method to your BlockMeshBuilder class
	public async createWaterloggedBlockMesh(
		model: BlockModel,
		transform: {
			x?: number;
			y?: number;
			uvlock?: boolean;
			block?: Block;
		} = {},
		block?: Block,
		biome: string = "plains"
	): Promise<THREE.Object3D> {
		const blockData = block || transform.block;

		// Create the main block mesh
		const mainBlockMesh = await this.createBlockMeshNoWater(model, transform, block, biome);

		// Check if this block is waterlogged (explicit property or implicitly, e.g. kelp)
		if (!this.isWaterlogged(blockData)) {
			return mainBlockMesh;
		}

		// Create a container group for both the block and water
		const waterloggedGroup = new THREE.Group();

		// Add the main block
		waterloggedGroup.add(mainBlockMesh);

		// Create water block - use a simple cube model for water
		const waterModel: BlockModel = {
			elements: [
				{
					from: [0, 0, 0],
					to: [16, 16, 16],
					faces: {
						down: { texture: "block/water_still" },
						up: { texture: "block/water_still" },
						north: { texture: "block/water_flow" },
						south: { texture: "block/water_flow" },
						west: { texture: "block/water_flow" },
						east: { texture: "block/water_flow" },
					},
				},
			],
		};

		// Create water block data
		const waterBlock: Block = {
			namespace: "minecraft",
			name: "water",
			properties: {},
		};

		// Create the water mesh
		const waterMesh = await this.createBlockMesh(waterModel, transform, waterBlock, biome);

		// Set water-specific properties
		if (waterMesh instanceof THREE.Group) {
			waterMesh.children.forEach((child) => {
				if (child instanceof THREE.Mesh) {
					// Ensure water renders after solid blocks
					child.renderOrder = 1;
					// Make sure water material is properly transparent
					if (child.material instanceof THREE.Material) {
						child.material.transparent = true;
						child.material.depthWrite = false;
					}
				}
			});
		}

		// Add water to the group
		waterloggedGroup.add(waterMesh);

		// Add metadata to indicate this is waterlogged
		(waterloggedGroup as any).isWaterlogged = true;
		(waterloggedGroup as any).blockData = blockData;
		(waterloggedGroup as any).biome = biome;

		return waterloggedGroup;
	}

	private getFaceNormal(direction: string): [number, number, number] {
		switch (direction) {
			case "down":
				return [0, -1, 0];
			case "up":
				return [0, 1, 0];
			case "north":
				return [0, 0, -1];
			case "south":
				return [0, 0, 1];
			case "west":
				return [-1, 0, 0];
			case "east":
				return [1, 0, 0];
			default:
				return [0, 1, 0];
		}
	}

	private async createElementGeometries(
		element: BlockModelElement,
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean },
		blockData?: Block,
		biome: string = "plains"
	): Promise<
		Array<{
			geometry: THREE.BufferGeometry;
			material: THREE.Material;
			materialKey: string;
			isLiquid?: boolean;
			isWater?: boolean;
			isLava?: boolean;
		}>
	> {
		const fromJSON = element.from || [0, 0, 0];
		const toJSON = element.to || [16, 16, 16];

		// Map coordinates to [-0.5, 0.5] space (block centered at origin)
		const from = fromJSON.map((c) => c / 16 - 0.5);
		const to = toJSON.map((c) => c / 16 - 0.5);

		let size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
		size = size.map((s) => Math.max(0, s));

		let center = [from[0] + size[0] / 2, from[1] + size[1] / 2, from[2] + size[2] / 2];

		// Water level adjustment
		if (blockData && this.isWaterBlock(blockData) && toJSON[1] === 16) {
			const adjustedToY_mc = 14;
			to[1] = adjustedToY_mc / 16 - 0.5;
			size[1] = to[1] - from[1];
			size[1] = Math.max(0, size[1]);
			center[1] = from[1] + size[1] / 2;
		}

		// USE the new indexed approach
		const indexedResult = await this.createIndexedElementGeometry(
			element,
			from,
			to,
			model,
			transform,
			blockData,
			biome
		);

		// Apply element transforms to each geometry (same as before)
		for (const result of indexedResult) {
			this.applyElementTransforms(result.geometry, element, center);
		}

		return indexedResult;
	}

	private async createIndexedElementGeometry(
		element: BlockModelElement,
		from: number[],
		to: number[],
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean },
		blockData?: Block,
		biome: string = "plains"
	): Promise<
		Array<{
			geometry: THREE.BufferGeometry;
			material: THREE.Material;
			materialKey: string;
			isLiquid?: boolean;
			isWater?: boolean;
			isLava?: boolean;
		}>
	> {
		if (!element.faces) return [];

		const elementSize = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];

		// Group faces by material to create fewer geometries
		const materialGroups = new Map<
			string,
			{
				faces: Array<{
					direction: string;
					faceData: any;
					vertices: number[][];
					uvs: number[];
					indices: number[];
				}>;
				material: THREE.Material;
				materialKey: string;
				isLiquid?: boolean;
				isWater?: boolean;
				isLava?: boolean;
				texturePath: string; // ADD THIS
			}
		>();

		// Process each face using the SAME logic as the working original
		for (const [direction, sourceFace] of Object.entries(element.faces)) {
			if (!sourceFace) continue;
			const faceData = {
				...this.withDefaultUV(sourceFace, element, direction),
				light_emission: element.light_emission,
			};

			// Create a temporary PlaneGeometry to get the correct vertex positions and UVs
			const tempFaceResult = await this.createTempFaceGeometry(
				direction,
				elementSize,
				faceData,
				transform
			);

			// Get material (same as before)
			let texturePath = this.assetLoader.resolveTexture(faceData.texture, model);
			const isWater = this.isWaterBlock(blockData);
			const isLava = this.isLavaBlock(blockData);
			const isLiquid = isWater || isLava;

			if (isWater) {
				texturePath = direction === "up" ? "block/water_still" : "block/water_flow";
			} else if (isLava) {
				texturePath = direction === "up" ? "block/lava_still" : "block/lava_flow";
			}

			const material = await this.createFaceMaterial(
				texturePath,
				direction,
				faceData,
				model,
				blockData,
				biome,
				elementSize,
				isLiquid,
				isWater,
				isLava
			);

			const materialKey = this.getMaterialKey(texturePath, direction, faceData, blockData, biome);

			if (!materialGroups.has(materialKey)) {
				materialGroups.set(materialKey, {
					faces: [],
					material,
					materialKey,
					isLiquid,
					isWater,
					isLava,
					texturePath, // ADD THIS
				});
			}

			materialGroups.get(materialKey)!.faces.push({
				direction,
				faceData,
				vertices: tempFaceResult.vertices,
				uvs: tempFaceResult.uvs,
				indices: tempFaceResult.indices,
			});
		}

		// Create geometries for each material group
		const results: Array<{
			geometry: THREE.BufferGeometry;
			material: THREE.Material;
			materialKey: string;
			isLiquid?: boolean;
			isWater?: boolean;
			isLava?: boolean;
		}> = [];

		for (const group of materialGroups.values()) {
			const geometry = this.createIndexedGeometryFromFaces(group.faces);

			// APPLY ATLAS UV MAPPING HERE
			const atlas = this.assetLoader.getTextureAtlas();
			if (atlas && group.material.userData?.atlasUV && this.shouldUseAtlas()) {
				this.applyAtlasUVMapping(geometry, group.material.userData.atlasUV);
			}

			results.push({
				geometry,
				material: group.material,
				materialKey: group.materialKey,
				isLiquid: group.isLiquid,
				isWater: group.isWater,
				isLava: group.isLava,
			});
		}

		return results;
	}

	private async createTempFaceGeometry(
		direction: string,
		elementSize: number[],
		faceData: any,
		transform: { x?: number; y?: number; uvlock?: boolean }
	): Promise<{ vertices: number[][]; uvs: number[]; indices: number[] }> {
		// Replicate the EXACT same logic as the working createFaceGeometry
		let geometry: THREE.PlaneGeometry;
		let facePositionOffset: [number, number, number] = [0, 0, 0];

		switch (direction) {
			case "down":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[2]);
				geometry.rotateX(Math.PI / 2);
				facePositionOffset = [0, -elementSize[1] / 2, 0];
				break;
			case "up":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[2]);
				geometry.rotateX(-Math.PI / 2);
				facePositionOffset = [0, elementSize[1] / 2, 0];
				break;
			case "north":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[1]);
				geometry.rotateY(Math.PI);
				facePositionOffset = [0, 0, -elementSize[2] / 2];
				break;
			case "south":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[1]);
				facePositionOffset = [0, 0, elementSize[2] / 2];
				break;
			case "west":
				geometry = new THREE.PlaneGeometry(elementSize[2], elementSize[1]);
				geometry.rotateY(-Math.PI / 2);
				facePositionOffset = [-elementSize[0] / 2, 0, 0];
				break;
			case "east":
				geometry = new THREE.PlaneGeometry(elementSize[2], elementSize[1]);
				geometry.rotateY(Math.PI / 2);
				facePositionOffset = [elementSize[0] / 2, 0, 0];
				break;
			default:
				throw new Error(`Unknown face direction: ${direction}`);
		}

		geometry.translate(...facePositionOffset);

		// Apply the SAME UV mapping logic that works
		this.mapUVCoordinates(geometry, direction, faceData, transform);

		// Extract vertex positions, UVs, AND indices from the working geometry
		const positions = geometry.attributes.position.array as Float32Array;
		const uvs = geometry.attributes.uv.array as Float32Array;
		const geometryIndices = geometry.index?.array as Uint16Array;

		const vertices: number[][] = [];
		for (let i = 0; i < positions.length; i += 3) {
			vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
		}

		return {
			vertices,
			uvs: Array.from(uvs),
			indices: geometryIndices ? Array.from(geometryIndices) : [0, 1, 2, 0, 2, 3], // fallback
		};
	}

	// Create indexed geometry from extracted face data
	private createIndexedGeometryFromFaces(
		faces: Array<{
			direction: string;
			faceData: any;
			vertices: number[][];
			uvs: number[];
			indices: number[];
		}>
	): THREE.BufferGeometry {
		const positions: number[] = [];
		const normals: number[] = [];
		const uvs: number[] = [];
		const indices: number[] = [];

		// Map to track unique vertices: "x,y,z,nx,ny,nz,u,v" -> index
		const vertexMap = new Map<string, number>();
		let nextVertexIndex = 0;

		for (const face of faces) {
			const faceNormal = this.getFaceNormal(face.direction);
			const faceIndices: number[] = [];

			// Process each vertex in this face
			for (let i = 0; i < face.vertices.length; i++) {
				const vertex = face.vertices[i];
				const normal = faceNormal;
				const uv = [face.uvs[i * 2], face.uvs[i * 2 + 1]];

				// Create unique key for this vertex+normal+UV combination
				const key = `${vertex[0].toFixed(6)},${vertex[1].toFixed(
					6
				)},${vertex[2].toFixed(6)},${normal[0]},${normal[1]},${
					normal[2]
				},${uv[0].toFixed(6)},${uv[1].toFixed(6)}`;

				let vertexIndex: number;
				if (vertexMap.has(key)) {
					// Reuse existing vertex
					vertexIndex = vertexMap.get(key)!;
				} else {
					// Add new unique vertex
					vertexIndex = nextVertexIndex++;
					vertexMap.set(key, vertexIndex);

					positions.push(...vertex);
					normals.push(...normal);
					uvs.push(...uv);
				}

				faceIndices.push(vertexIndex);
			}

			// Add triangles for this face using the (possibly shared) vertex indices
			for (let i = 0; i < face.indices.length; i += 3) {
				indices.push(
					faceIndices[face.indices[i]],
					faceIndices[face.indices[i + 1]],
					faceIndices[face.indices[i + 2]]
				);
			}
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
		geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
		geometry.setIndex(indices);

		return geometry;
	}

	private shouldUseAtlas(): boolean {
		if (!this.useAtlas) return false;
		// Check if atlas is available
		const atlas = this.assetLoader.getTextureAtlas();
		if (!atlas) {
			console.log(`📝 No atlas available`);
			return false;
		}

		// Liquids (water/lava/bubble columns) now share the atlas: their strips are
		// 16xN animated textures with no model referencing them, and AssetLoader's
		// animated branch clamps the atlas rect to a FIRST-FRAME sub-rect. The old
		// exclusion kept 0..1 UVs on liquid materials, which the GPU record paths
		// misread as atlas coordinates — every liquid cell sampled the WHOLE atlas.
		// CPU-side frame scrolling is traded away for mode coherence; animation can
		// return later as a shader-side frame offset.
		return true;
	}

	private async createFaceGeometry(
		direction: string,
		elementSize: number[],
		faceData: any,
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean },
		blockData?: Block,
		biome?: string
	): Promise<{
		geometry: THREE.BufferGeometry;
		material: THREE.Material;
		materialKey: string;
		isLiquid?: boolean;
		isWater?: boolean;
		isLava?: boolean;
	}> {
		let geometry: THREE.PlaneGeometry;
		let facePositionOffset: [number, number, number] = [0, 0, 0];

		switch (direction) {
			case "down":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[2]);
				geometry.rotateX(Math.PI / 2);
				facePositionOffset = [0, -elementSize[1] / 2, 0];
				break;
			case "up":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[2]);
				geometry.rotateX(-Math.PI / 2);
				facePositionOffset = [0, elementSize[1] / 2, 0];
				break;
			case "north":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[1]);
				geometry.rotateY(Math.PI);
				facePositionOffset = [0, 0, -elementSize[2] / 2];
				break;
			case "south":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[1]);
				facePositionOffset = [0, 0, elementSize[2] / 2];
				break;
			case "west":
				geometry = new THREE.PlaneGeometry(elementSize[2], elementSize[1]);
				geometry.rotateY(-Math.PI / 2);
				facePositionOffset = [-elementSize[0] / 2, 0, 0];
				break;
			case "east":
				geometry = new THREE.PlaneGeometry(elementSize[2], elementSize[1]);
				geometry.rotateY(Math.PI / 2);
				facePositionOffset = [elementSize[0] / 2, 0, 0];
				break;
			default:
				throw new Error(`Unknown face direction: ${direction}`);
		}

		// Translate face to its position relative to the element's center
		geometry.translate(...facePositionOffset);

		// Resolve texture path (before UV mapping — flow textures skip UV rotation)
		let texturePath = this.assetLoader.resolveTexture(faceData.texture, model);
		const isWater = this.isWaterBlock(blockData);
		const isLava = this.isLavaBlock(blockData);
		const isLiquid = isWater || isLava;

		if (isWater) {
			texturePath = direction === "up" ? "block/water_still" : "block/water_flow";
		} else if (isLava) {
			texturePath = direction === "up" ? "block/lava_still" : "block/lava_flow";
		}

		// Map UVs based on face data and transform (this gives us the "local" UVs for this face)
		this.mapUVCoordinates(geometry, direction, faceData, transform, texturePath);

		// Create material using atlas if appropriate
		const material = await this.createFaceMaterial(
			texturePath,
			direction,
			faceData,
			model,
			blockData,
			biome,
			elementSize,
			isLiquid,
			isWater,
			isLava
		);

		const materialKey = this.getMaterialKey(texturePath, direction, faceData, blockData, biome);

		// Apply atlas UV mapping if available and appropriate
		const atlas = this.assetLoader.getTextureAtlas();
		if (atlas && material.userData?.atlasUV && this.shouldUseAtlas()) {
			this.applyAtlasUVMapping(geometry, material.userData.atlasUV);
		}

		return {
			geometry,
			material,
			materialKey,
			isLiquid,
			isWater,
			isLava,
		};
	}

	/**
	 * Apply atlas UV mapping to geometry
	 * This transforms the existing face UVs to point to the correct region in the atlas
	 */
	private applyAtlasUVMapping(
		geometry: THREE.BufferGeometry,
		atlasUV: { u: number; v: number; width: number; height: number }
	): void {
		const uvAttr = geometry.attributes.uv as THREE.BufferAttribute;
		if (!uvAttr) {
			console.warn("⚠️ No UV attribute found on geometry for atlas mapping");
			return;
		}

		const uvArray = uvAttr.array as Float32Array;
		const { u, v, width, height } = atlasUV;

		// Apply Y-flip to the atlas region coordinates (same as shader)
		const flippedV = 1.0 - v - height; // Flip the atlas region itself

		// Transform each UV coordinate from [0,1] space to atlas space
		for (let i = 0; i < uvArray.length; i += 2) {
			const localU = uvArray[i]; // UV coordinate within the face (0-1)
			const localV = uvArray[i + 1]; // UV coordinate within the face (0-1)

			// Map to atlas coordinates using flipped V
			uvArray[i] = u + localU * width;
			uvArray[i + 1] = flippedV + localV * height;
		}

		uvAttr.needsUpdate = true;
	}

	/**
	 * Enhanced UV coordinate mapping that preserves face-specific logic
	 */
	private mapUVCoordinates(
		geometry: THREE.PlaneGeometry,
		direction: string,
		faceData: any,
		transform: { x?: number; y?: number; uvlock?: boolean },
		texturePath?: string
	): void {
		const uvAttribute = geometry.attributes.uv as THREE.BufferAttribute;
		const [uMinPx, vMinPx, uMaxPx, vMaxPx] = faceData.uv;

		// Convert from pixel coordinates to normalized coordinates
		const u1 = uMinPx / 16;
		const v1 = vMinPx / 16;
		const u2 = uMaxPx / 16;
		const v2 = vMaxPx / 16;

		// Create UV coordinates for the quad (these are in "local" texture space 0-1)
		const uvCoords = new Float32Array([
			u1,
			1 - v1, // Top-left
			u2,
			1 - v1, // Top-right
			u1,
			1 - v2, // Bottom-left
			u2,
			1 - v2, // Bottom-right
		]);

		// Calculate total rotation including face rotation and block transform rotation
		let totalRotation = faceData.rotation || 0;

		// Apply block rotation if uvlock is not enabled
		if (transform.uvlock !== true) {
			const yRot = transform.y || 0;

			switch (direction) {
				case "up":
					totalRotation += yRot;
					break;
				case "down":
					totalRotation -= yRot;
					break;
				case "north":
					totalRotation += yRot;
					break;
				case "south":
					totalRotation -= yRot;
					break;
				case "east":
					totalRotation += yRot;
					break;
				case "west":
					totalRotation -= yRot;
					break;
			}
		}

		// Normalize and apply rotation — EXCEPT on liquid textures: side faces'
		// V axis must stay world-vertical (the record shader scrolls V for connected
		// downward flow; model per-face rotation turns V into world-horizontal)
		if (/(water|lava)_(still|flow)$/.test(String(texturePath || ""))) totalRotation = 0;
		totalRotation = ((totalRotation % 360) + 360) % 360;
		if (totalRotation !== 0) {
			const roundedRotation = Math.round(totalRotation / 90) * 90;
			this.applyUVRotation(uvCoords, roundedRotation);
		}

		// Set the UVs (these are still in local 0-1 space, will be transformed to atlas space later)
		uvAttribute.array.set(uvCoords);
		uvAttribute.needsUpdate = true;
	}

	/** Minecraft projects omitted UVs from the element's bounds, at 16 pixels/block. */
	private withDefaultUV(face: any, element: BlockModelElement, direction: string): any {
		if (face.uv) return face;
		const [x0, y0, z0] = element.from;
		const [x1, y1, z1] = element.to;
		let uv: number[];
		switch (direction) {
			case "down":
				uv = [x0, 16 - z1, x1, 16 - z0];
				break;
			case "up":
				uv = [x0, z0, x1, z1];
				break;
			case "north":
				uv = [16 - x1, 16 - y1, 16 - x0, 16 - y0];
				break;
			case "south":
				uv = [x0, 16 - y1, x1, 16 - y0];
				break;
			case "west":
				uv = [z0, 16 - y1, z1, 16 - y0];
				break;
			case "east":
				uv = [16 - z1, 16 - y1, 16 - z0, 16 - y0];
				break;
			default:
				throw new Error(`Unknown face direction: ${direction}`);
		}
		// Models are cached: never write generated UVs back into the source face.
		return { ...face, uv };
	}

	/**
	 * Create separated face data for optimization
	 */
	public async createOptimizedFaceData(
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean; block?: Block } = {},
		block?: Block,
		biome: string = "plains"
	): Promise<{
		cullableFaces: Map<string, OptimizedFace[]>;
		nonCullableFaces: OptimizedFace[];
		hasTransparency: boolean;
	}> {
		const blockData = block || transform.block;
		const cullableFaces = new Map<string, OptimizedFace[]>();
		const nonCullableFaces: OptimizedFace[] = [];
		let hasTransparency = false;

		if (!model.elements || model.elements.length === 0) {
			return { cullableFaces, nonCullableFaces, hasTransparency };
		}

		for (const element of model.elements) {
			const elementFaces = await this.extractElementFaces(
				element,
				model,
				transform,
				blockData,
				biome
			);

			for (const face of elementFaces) {
				if (face.material.transparent || face.material.opacity < 1.0) {
					hasTransparency = true;
				}

				if (face.cullface) {
					if (!cullableFaces.has(face.cullface)) {
						cullableFaces.set(face.cullface, []);
					}
					cullableFaces.get(face.cullface)!.push(face);
				} else {
					nonCullableFaces.push(face);
				}
			}
		}

		return { cullableFaces, nonCullableFaces, hasTransparency };
	}

	/**
	 * Extract individual faces from an element
	 */
	private async extractElementFaces(
		element: BlockModelElement,
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean },
		blockData?: Block,
		biome: string = "plains"
	): Promise<OptimizedFace[]> {
		const faces: OptimizedFace[] = [];

		if (!element.faces) return faces;

		const fromJSON = element.from || [0, 0, 0];
		const toJSON = element.to || [16, 16, 16];
		const from = fromJSON.map((c) => c / 16 - 0.5);
		const to = toJSON.map((c) => c / 16 - 0.5);
		let size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
		size = size.map((s) => Math.max(0, s));
		let center = [from[0] + size[0] / 2, from[1] + size[1] / 2, from[2] + size[2] / 2];

		// Water level adjustment (same as existing code)
		if (blockData && this.isWaterBlock(blockData) && toJSON[1] === 16) {
			const adjustedToY_mc = 14;
			to[1] = adjustedToY_mc / 16 - 0.5;
			size[1] = to[1] - from[1];
			size[1] = Math.max(0, size[1]);
			center[1] = from[1] + size[1] / 2;
		}

		const faceDirections = ["down", "up", "north", "south", "west", "east"] as const;

		for (const direction of faceDirections) {
			const sourceFace = element.faces[direction];
			if (!sourceFace) continue;
			const faceData = {
				...this.withDefaultUV(sourceFace, element, direction),
				light_emission: element.light_emission,
			};

			// Create the face geometry (reuse existing logic)
			const { geometry, material } = await this.createFaceGeometry(
				direction,
				size,
				faceData,
				model,
				transform,
				blockData,
				biome
			);

			// Apply element transforms (reuse existing logic)
			this.applyElementTransforms(geometry, element, center);

			// Determine if this face can be batched
			const canBatch = this.canFaceBeBatched(element, faceData, direction);

			faces.push({
				geometry,
				material,
				direction,
				cullface: faceData.cullface,
				elementBounds: [fromJSON, toJSON],
				canBatch,
			});
		}

		return faces;
	}

	/**
	 * Determine if a face can be batched efficiently
	 */
	private canFaceBeBatched(element: BlockModelElement, faceData: any, direction: string): boolean {
		// Faces with rotations are harder to batch
		if (element.rotation && element.rotation.angle !== 0) {
			return false;
		}

		// Faces with custom UVs might need individual handling
		if (faceData.uv && !this.isStandardUV(faceData.uv, direction)) {
			return false;
		}

		return true;
	}

	/**
	 * Check if UV coordinates are standard for the face
	 */
	private isStandardUV(uv: number[], _direction: string): boolean {
		// Standard UVs for a full face would be [0, 0, 16, 16]
		return uv[0] === 0 && uv[1] === 0 && uv[2] === 16 && uv[3] === 16;
	}

	private applyElementTransforms(
		geometry: THREE.BufferGeometry, // Geometry of a single face, relative to element center
		element: BlockModelElement,
		elementCenterInBlock: number[] // Element's center in block's [-0.5, 0.5] space
	): void {
		// The geometry is already positioned as a face of an element centered at (0,0,0).
		// First, if there's rotation, apply it. The rotation origin is specified in block coordinates.
		if (element.rotation) {
			const rotationOriginJSON = element.rotation.origin || [8, 8, 8]; // Default MC pivot is block center
			// Convert MC rotation origin to current block-centered space [-0.5, 0.5]
			const rotationOriginInBlock = rotationOriginJSON.map((c) => c / 16 - 0.5);

			// The pivot for rotation is (rotationOriginInBlock - elementCenterInBlock)
			// in the element's local coordinate system (where element's center is 0,0,0).
			const pivotLocalX = rotationOriginInBlock[0] - elementCenterInBlock[0];
			const pivotLocalY = rotationOriginInBlock[1] - elementCenterInBlock[1];
			const pivotLocalZ = rotationOriginInBlock[2] - elementCenterInBlock[2];

			// Translate geometry so the local pivot is at origin
			geometry.translate(-pivotLocalX, -pivotLocalY, -pivotLocalZ);

			// Apply rescaling if specified
			if (element.rotation.rescale) {
				const angle = (element.rotation.angle * Math.PI) / 180;
				const rescaleFactor = 1 / Math.cos(angle);

				// Apply rescaling to the geometry vertices
				const positionAttribute = geometry.attributes.position as THREE.BufferAttribute;
				const positions = positionAttribute.array as Float32Array;

				// Rescale coordinates perpendicular to the rotation axis
				for (let i = 0; i < positions.length; i += 3) {
					const x = positions[i];
					const y = positions[i + 1];
					const z = positions[i + 2];

					switch (element.rotation.axis) {
						case "x":
							// Rescale Y and Z coordinates
							positions[i + 1] = y * rescaleFactor;
							positions[i + 2] = z * rescaleFactor;
							break;
						case "y":
							// Rescale X and Z coordinates
							positions[i] = x * rescaleFactor;
							positions[i + 2] = z * rescaleFactor;
							break;
						case "z":
							// Rescale X and Y coordinates
							positions[i] = x * rescaleFactor;
							positions[i + 1] = y * rescaleFactor;
							break;
					}
				}

				positionAttribute.needsUpdate = true;
			}

			// Apply rotation
			const angle = (element.rotation.angle * Math.PI) / 180;
			// Note: Minecraft's rotation can be -45, -22.5, 0, 22.5, 45.

			switch (element.rotation.axis) {
				case "x":
					geometry.rotateX(angle);
					break;
				case "y":
					geometry.rotateY(angle);
					break;
				case "z":
					geometry.rotateZ(angle);
					break;
			}

			// Translate back from local pivot
			geometry.translate(pivotLocalX, pivotLocalY, pivotLocalZ);
		}

		// Finally, translate the (now possibly rotated and rescaled) element face
		// by the element's center in block space to position it correctly within the block.
		geometry.translate(elementCenterInBlock[0], elementCenterInBlock[1], elementCenterInBlock[2]);
	}

	private getMaterialKey(
		texturePath: string,
		direction: string,
		faceData: any,
		blockData?: Block,
		biome?: string
	): string {
		const tintIndex = faceData.tintindex !== undefined ? faceData.tintindex : "none";
		const cullFace = faceData.cullface || "none";
		const blockId = blockData ? `${blockData.namespace}:${blockData.name}` : "none";
		const props = blockData?.properties
			? JSON.stringify(blockData.properties) // Consider sorted stringify for consistency
			: "none";

		return `${texturePath}_dir:${direction}_tint:${tintIndex}_cull:${cullFace}_block:${blockId}_props:${props}_biome:${biome}_emission:${faceData.light_emission ?? 0}`;
	}

	private async createFaceMaterial(
		texturePath: string,
		direction: string,
		faceData: any,
		_model: BlockModel,
		blockData?: Block,
		biome?: string,
		elementSize?: number[],
		isLiquid?: boolean,
		isWater?: boolean,
		isLava?: boolean
	): Promise<THREE.Material> {
		try {
			let tint: THREE.Color | undefined = undefined;

			// Handle tinting for blocks with tintindex
			if (blockData && faceData.tintindex !== undefined) {
				const blockIdForTint = `${blockData.namespace}:${blockData.name}`;
				tint = this.assetLoader.getTint(blockIdForTint, blockData.properties, biome);
			}

			// Apply default water tint if no specific tint is set
			if (isWater && !tint) {
				tint = this.assetLoader.getTint("minecraft:water", {}, "default");
			}

			// Determine if we should use atlas for this texture
			const useAtlas = this.shouldUseAtlas();

			// A liquid is "flowing" when it has a non-zero level (source water is
			// level 0). Only flowing liquid uses the *_flow texture on its sides.
			const liquidLevel = blockData?.properties?.level;
			const isFlowing = (isWater || isLava) && liquidLevel !== undefined && liquidLevel !== "0";

			// Material options for AssetLoader
			const materialOptions: any = {
				tint: tint,
				lightEmission: faceData.light_emission,
				isLiquid: isLiquid,
				isWater: isWater,
				isLava: isLava,
				isFlowing: isFlowing,
				faceDirection: direction,
				forceAnimation: isLiquid,
				biome: biome,
				useAtlas: useAtlas, // Pass the atlas flag to AssetLoader
			};

			// Get the base material from AssetLoader
			const material = await this.assetLoader.getMaterial(texturePath, materialOptions);

			// Clone the material to avoid modifying the cached version
			const clonedMaterial = material.clone();

			// Determine if this should be double-sided based on element characteristics
			const isThinElementHeuristic =
				elementSize && (elementSize[0] < 0.01 || elementSize[1] < 0.01 || elementSize[2] < 0.01);

			const knownThinTexture =
				texturePath.includes("pane") ||
				texturePath.includes("fence") ||
				texturePath.includes("rail") ||
				texturePath.includes("ladder") ||
				texturePath.includes("chain") ||
				texturePath.includes("bars");

			const isRedstoneTorchElement =
				texturePath.includes("redstone_torch") || texturePath.includes("lit");

			// Set sidedness based on element type
			if (
				!isRedstoneTorchElement &&
				(isThinElementHeuristic ||
					knownThinTexture ||
					(faceData.cullface === undefined && !isLiquid))
			) {
				clonedMaterial.side = THREE.DoubleSide;
			} else {
				clonedMaterial.side = THREE.FrontSide;
			}

			// Copy transparency and rendering properties from base material
			clonedMaterial.transparent = material.transparent;
			clonedMaterial.alphaTest = material.alphaTest;
			clonedMaterial.depthWrite = material.depthWrite;
			clonedMaterial.opacity = material.opacity;

			// Copy over userData including atlas information
			clonedMaterial.userData = { ...material.userData };

			// Additional liquid-specific properties
			if (isWater) {
				clonedMaterial.userData.isWater = true;
				clonedMaterial.userData.faceDirection = direction;
				clonedMaterial.userData.renderToWaterPass = true;
			}

			if (isLava) {
				clonedMaterial.userData.isLava = true;
				clonedMaterial.userData.faceDirection = direction;
				clonedMaterial.userData.renderToLavaPass = true;
				clonedMaterial.userData.lavaAnimationParams = {
					pulseSpeed: 0.4,
					pulseMin: 0.4,
					pulseMax: 0.6,
				};
			}

			// Store general liquid status
			if (isLiquid) {
				clonedMaterial.userData.isLiquid = true;
			}

			return clonedMaterial;
		} catch (error) {
			console.warn(`Failed to create material for ${texturePath}:`, error);

			// Return a fallback material that's clearly visible as an error
			const fallbackMaterial = new THREE.MeshStandardMaterial({
				color: 0xff00ff,
				wireframe: true,
				side: THREE.DoubleSide,
				transparent: true,
				alphaTest: 0.01,
			});

			// Add userData to indicate this is a fallback
			fallbackMaterial.userData = {
				isFallback: true,
				originalTexturePath: texturePath,
				error: (error as Error).message,
			};

			return fallbackMaterial;
		}
	}

	private mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
		// Delegates to a typed-array merge: bulk `.set()` copies instead of spreading
		// each float as a call argument, which kept large schematics from blowing the
		// call stack ("Maximum call stack size exceeded"). See mergeBufferGeometries.
		return mergeBufferGeometries(geometries);
	}

	private isLiquidBlock(blockData?: Block): boolean {
		if (!blockData) return false;
		const blockId = `${blockData.namespace}:${blockData.name}`;
		return this.isWaterBlock(blockData) || blockId === "minecraft:lava";
	}

	private isWaterBlock(blockData?: Block): boolean {
		if (!blockData) return false;

		const blockId = `${blockData.namespace}:${blockData.name}`;
		return blockId === "minecraft:water" || blockId === "minecraft:bubble_column";
	}

	// Blocks that are implicitly waterlogged in vanilla — they hold water without
	// ever exposing a `waterlogged` property, so they must still generate a
	// surrounding water mesh.
	private static readonly ALWAYS_WATERLOGGED = new Set<string>([
		"minecraft:kelp",
		"minecraft:kelp_plant",
		"minecraft:seagrass",
		"minecraft:tall_seagrass",
	]);

	private isWaterlogged(blockData?: Block): boolean {
		if (!blockData) return false;
		if (blockData.properties?.waterlogged === "true") return true;
		return BlockMeshBuilder.ALWAYS_WATERLOGGED.has(`${blockData.namespace}:${blockData.name}`);
	}

	private isLavaBlock(blockData?: Block): boolean {
		if (!blockData) return false;
		return `${blockData.namespace}:${blockData.name}` === "minecraft:lava";
	}

	// This function assumes uvCoords are [TL, TR, BL, BR]
	private applyUVRotation(uvCoords: Float32Array, rotation: number): void {
		const uvs = [
			{ u: uvCoords[0], v: uvCoords[1] }, // TL
			{ u: uvCoords[2], v: uvCoords[3] }, // TR
			{ u: uvCoords[4], v: uvCoords[5] }, // BL
			{ u: uvCoords[6], v: uvCoords[7] }, // BR
		];

		let rotatedUVs;

		switch (rotation) {
			case 0:
				return; // No change
			case 90: // TL->BL, TR->TL, BL->BR, BR->TR
				rotatedUVs = [uvs[2], uvs[0], uvs[3], uvs[1]]; // BL, TL, BR, TR (mapping to new TL, TR, BL, BR positions)
				break;
			case 180: // TL->BR, TR->BL, BL->TR, BR->TL
				rotatedUVs = [uvs[3], uvs[2], uvs[1], uvs[0]]; // BR, BL, TR, TL
				break;
			case 270: // TL->TR, TR->BR, BL->TL, BR->BL
				rotatedUVs = [uvs[1], uvs[3], uvs[0], uvs[2]]; // TR, BR, TL, BL
				break;
			default:
				console.warn(`Unsupported UV rotation: ${rotation}`);
				return;
		}

		uvCoords[0] = rotatedUVs[0].u;
		uvCoords[1] = rotatedUVs[0].v;
		uvCoords[2] = rotatedUVs[1].u;
		uvCoords[3] = rotatedUVs[1].v;
		uvCoords[4] = rotatedUVs[2].u;
		uvCoords[5] = rotatedUVs[2].v;
		uvCoords[6] = rotatedUVs[3].u;
		uvCoords[7] = rotatedUVs[3].v;
	}

	private createPlaceholderCube(): THREE.Object3D {
		// Unhandled/unknown block. By default render nothing (an empty group);
		// when debug placeholders are enabled, show a purple wireframe cube.
		if (!this.showUnknownBlocks) {
			return new THREE.Group();
		}
		// BoxGeometry is 1x1x1 centered at origin, which is consistent
		// with the new centered coordinate system for blocks.
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0x800080, // Purple, less jarring than magenta
				wireframe: true,
				side: THREE.FrontSide, // Placeholder is solid
			})
		);
	}
}
