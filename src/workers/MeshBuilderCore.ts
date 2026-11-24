import { CHUNK_INPUT_HEADER_SIZE } from "./SharedMemoryManager";

export type PaletteGeometryData = {
	index: number;
	occlusionFlags: number; // Bitmask: 0=West, 1=East, 2=Down, 3=Up, 4=North, 5=South
	category?: string;
	fluid?: "water" | "lava";
	geometries: Array<{
		positions: Float32Array;
		normals: Float32Array;
		uvs: Float32Array;
		indices: Uint16Array | Uint32Array;
		materialIndex: number;
		category?: string;
		fluid?: "water" | "lava";
	}>;
};

export type ChunkBuildRequest = {
	chunkId: string;
	blocks?: number[][] | Int32Array; // [x, y, z, paletteIndex] or flat array
	sharedInputBuffer?: SharedArrayBuffer;
	meshContextId?: string;
	chunkOrigin?: [number, number, number]; // [x, y, z] origin for relative coordinates
	// Boundary blocks from neighbouring chunks (flat [x, y, z, paletteIndex, …] in
	// world coords). Written into the voxel map for cross-chunk face culling only —
	// never rendered. Lets boundary faces cull against the adjacent chunk.
	apronBlocks?: Int32Array;
};

export type MeshData = {
	category: string;
	positions: Int16Array | Float32Array;
	normals: Int8Array;
	uvs: Float32Array;
	indices: Uint16Array | Uint32Array;
	groups: Array<{ start: number; count: number; materialIndex: number }>;
	isFloat32Positions?: boolean;
};

type TemplateGeometry = PaletteGeometryData["geometries"][number];
const templateBounds = new WeakMap<TemplateGeometry, [number[], number[]]>();

export function getTemplateBounds(geometry: TemplateGeometry): [number[], number[]] {
	let bounds = templateBounds.get(geometry);
	if (bounds) return bounds;
	const min = [Infinity, Infinity, Infinity],
		max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < geometry.positions.length; i++) {
		const a = i % 3;
		min[a] = Math.min(min[a], geometry.positions[i]);
		max[a] = Math.max(max[a], geometry.positions[i]);
	}
	bounds = [min, max];
	templateBounds.set(geometry, bounds);
	return bounds;
}

/** Actual Cubane coordinates are cell-centred; 0 and 1 are not alternate
 * cell boundaries. All three vertices must be on the face and inside its
 * square to be guaranteed occluded by a neighbour's full-face mask. */
export function templateCullDirection(
	geom: {
		positions: ArrayLike<number>;
		normals?: ArrayLike<number>;
		indices: ArrayLike<number> | null;
	},
	i: number,
	legacy = false
): number {
	const n = (geom.indices?.[i] ?? i) * 3;
	if (!geom.normals?.length) return -1;
	const round = legacy ? (v: number) => Math.sign(v) * Math.round(Math.abs(v)) : Math.round;
	const dx = round(geom.normals[n]),
		dy = round(geom.normals[n + 1]),
		dz = round(geom.normals[n + 2]);
	if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1) return -1;
	const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
	const sign = axis === 0 ? dx : axis === 1 ? dy : dz;
	const position = geom.positions[n + axis];
	const EPS = 0.01;
	if (legacy) {
		if (Math.abs(position - sign * 0.5) >= EPS && Math.abs(position - (sign > 0 ? 1 : 0)) >= EPS)
			return -1;
	} else {
		for (let j = 0; j < 3; j++) {
			const p = (geom.indices?.[i + j] ?? i + j) * 3;
			if (Math.abs(geom.positions[p + axis] - sign * 0.5) >= EPS) return -1;
			for (let a = 0; a < 3; a++)
				if (a !== axis && Math.abs(geom.positions[p + a]) > 0.5 + EPS) return -1;
		}
	}
	// Opposite face bit on the neighbour.
	return axis * 2 + (sign < 0 ? 1 : 0);
}

const templateCulls = new WeakMap<TemplateGeometry, Int8Array>();
function getTemplateCulls(geometry: TemplateGeometry): Int8Array {
	let dirs = templateCulls.get(geometry);
	if (!dirs) {
		dirs = new Int8Array(geometry.indices.length / 3);
		for (let t = 0; t < dirs.length; t++) dirs[t] = templateCullDirection(geometry, t * 3);
		templateCulls.set(geometry, dirs);
	}
	return dirs;
}

export type ChunkResult = {
	meshes: MeshData[];
	origin: number[];
	timings?: Record<string, number>;
};

// Constants
const POSITION_SCALE = 1024;
const NORMAL_SCALE = 127;

export function decodeBlocks(request: ChunkBuildRequest) {
	if (request.sharedInputBuffer) {
		const view = new DataView(request.sharedInputBuffer);
		const count = view.getUint32(0, true);
		return {
			blocks: new Int32Array(request.sharedInputBuffer, CHUNK_INPUT_HEADER_SIZE, count * 4),
			chunkOrigin: [view.getInt32(4, true), view.getInt32(8, true), view.getInt32(12, true)] as [
				number,
				number,
				number,
			],
		};
	}
	return { blocks: request.blocks ?? new Int32Array(0), chunkOrigin: request.chunkOrigin };
}

export function buildChunkGeometry(
	request: ChunkBuildRequest,
	paletteGeometries: Map<number, PaletteGeometryData>
): ChunkResult {
	const { blocks, chunkOrigin } = decodeBlocks(request);
	const { apronBlocks } = request;

	// Calculate bounds for voxel map
	const startSetup = performance.now();
	let minX = Infinity,
		minY = Infinity,
		minZ = Infinity;
	let maxX = -Infinity,
		maxY = -Infinity,
		maxZ = -Infinity;

	if (blocks.length > 0) {
		if (blocks instanceof Int32Array) {
			for (let i = 0; i < blocks.length; i += 4) {
				const x = blocks[i];
				const y = blocks[i + 1];
				const z = blocks[i + 2];
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				minZ = Math.min(minZ, z);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
				maxZ = Math.max(maxZ, z);
			}
		} else {
			for (const [x, y, z] of blocks) {
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				minZ = Math.min(minZ, z);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
				maxZ = Math.max(maxZ, z);
			}
		}
	} else {
		return {
			meshes: [],
			origin: chunkOrigin ?? [0, 0, 0],
			timings: { setup: 0, sort: 0, merge: 0, total: 0 },
		};
	}

	// If chunkOrigin is provided, use it. Otherwise fallback to minX/minY/minZ (auto-detected origin)
	// NOTE: For consistent meshing across sparse chunks, chunkOrigin SHOULD be provided by main thread
	const originX = chunkOrigin ? chunkOrigin[0] : minX;
	const originY = chunkOrigin ? chunkOrigin[1] : minY;
	const originZ = chunkOrigin ? chunkOrigin[2] : minZ;

	const sizeX = maxX - minX + 1;
	const sizeY = maxY - minY + 1;
	const sizeZ = maxZ - minZ + 1;

	// Voxel map stores palette index + 1 (0 = empty)
	const pad = 1;
	const strideX = 1;
	const strideY = sizeX + 2 * pad;
	const strideZ = (sizeX + 2 * pad) * (sizeY + 2 * pad);
	const voxelMap = new Int32Array(strideZ * (sizeZ + 2 * pad));

	const getIndex = (x: number, y: number, z: number) => {
		return (x - minX + pad) * strideX + (y - minY + pad) * strideY + (z - minZ + pad) * strideZ;
	};

	// Populate voxel map
	if (blocks instanceof Int32Array) {
		for (let i = 0; i < blocks.length; i += 4) {
			const x = blocks[i];
			const y = blocks[i + 1];
			const z = blocks[i + 2];
			const paletteIndex = blocks[i + 3];
			voxelMap[getIndex(x, y, z)] = paletteIndex + 1;
		}
	} else {
		for (const [x, y, z, paletteIndex] of blocks) {
			voxelMap[getIndex(x, y, z)] = paletteIndex + 1; // Store index + 1 so 0 is empty
		}
	}

	// Populate the 1-voxel apron with neighbouring chunks' boundary blocks so faces
	// on a chunk seam cull against the adjacent chunk. These are written to the voxel
	// map ONLY (not the render batches below), and bounds-checked so sparse/far ghost
	// blocks that fall outside this chunk's padded volume are skipped. Real blocks are
	// never overwritten.
	if (apronBlocks && apronBlocks.length > 0) {
		for (let i = 0; i < apronBlocks.length; i += 4) {
			const x = apronBlocks[i];
			const y = apronBlocks[i + 1];
			const z = apronBlocks[i + 2];
			if (
				x < minX - pad ||
				x > maxX + pad ||
				y < minY - pad ||
				y > maxY + pad ||
				z < minZ - pad ||
				z > maxZ + pad
			) {
				continue;
			}
			const vi = getIndex(x, y, z);
			if (voxelMap[vi] === 0) {
				voxelMap[vi] = apronBlocks[i + 3] + 1;
			}
		}
	}

	// Intermediate storage: Category -> Map<PaletteIndex, List of block indices (into original array)>
	// OPTIMIZATION: Store indices instead of creating new arrays to reduce GC pressure
	const setupTime = performance.now() - startSetup;
	const startSort = performance.now();
	const categoryBatches = new Map<string, Map<number, number[]>>();
	const categoryByPalette = new Map<number, string[]>();
	const addBlock = (paletteIndex: number, blockIndex: number) => {
		let categories = categoryByPalette.get(paletteIndex);
		if (!categories) {
			const item = paletteGeometries.get(paletteIndex);
			if (!item) return;
			categories = [
				...new Set(item.geometries.map((geom) => geom.category ?? item.category ?? "solid")),
			];
			categoryByPalette.set(paletteIndex, categories);
		}
		for (const category of categories) {
			let catMap = categoryBatches.get(category);
			if (!catMap) categoryBatches.set(category, (catMap = new Map()));
			let pList = catMap.get(paletteIndex);
			if (!pList) catMap.set(paletteIndex, (pList = []));
			pList.push(blockIndex);
		}
	};

	// 1. Segregate blocks by category and palette index
	// For Int32Array, store the starting index of each block (i) instead of creating new arrays
	if (blocks instanceof Int32Array) {
		for (let i = 0; i < blocks.length; i += 4) {
			addBlock(blocks[i + 3], i);
		}
	} else {
		// Legacy path for array-of-arrays format
		for (let i = 0; i < blocks.length; i++) {
			addBlock(blocks[i][3], i);
		}
	}

	const results: MeshData[] = [];
	const sortTime = performance.now() - startSort;
	let mergeTime = 0;

	// 2. Process each category
	// OPTIMIZATION: Use typed references instead of destructuring
	const isInt32 = blocks instanceof Int32Array;

	for (const [category, paletteMap] of categoryBatches) {
		const mergeStart = performance.now();
		const sortedIndices = Array.from(paletteMap.keys()).sort((a, b) => a - b);

		const positions: number[] = [];
		const geometryData: any[] = [];
		const occlusionFlags: number[] = [];

		// Expand blocks into flat arrays in sorted order
		for (const pIdx of sortedIndices) {
			const blockIndices = paletteMap.get(pIdx)!;
			const paletteItem = paletteGeometries.get(pIdx)!;

			for (const blockIdx of blockIndices) {
				// Extract x, y, z from original blocks array using stored index
				let x: number, y: number, z: number;
				if (isInt32) {
					x = (blocks as Int32Array)[blockIdx];
					y = (blocks as Int32Array)[blockIdx + 1];
					z = (blocks as Int32Array)[blockIdx + 2];
				} else {
					const block = (blocks as number[][])[blockIdx];
					x = block[0];
					y = block[1];
					z = block[2];
				}

				for (const geom of paletteItem.geometries) {
					if ((geom.category ?? paletteItem.category ?? "solid") !== category) continue;
					positions.push(x, y, z);
					geometryData.push(geom);
					occlusionFlags.push(paletteItem.occlusionFlags || 0);
				}
			}
		}

		if (positions.length === 0) continue;

		const merged = mergeGeometriesWithCulling(
			geometryData,
			positions,
			occlusionFlags,
			voxelMap,
			getIndex,
			originX,
			originY,
			originZ,
			paletteGeometries
		);

		if (merged && merged.indices.length) {
			results.push({
				category,
				...merged,
			});
		}
		mergeTime += performance.now() - mergeStart;
	}

	return {
		meshes: results,
		origin: [originX, originY, originZ],
		timings: {
			setup: setupTime,
			sort: sortTime,
			merge: mergeTime,
			total: performance.now() - startSetup,
		},
	};
}

function mergeGeometriesWithCulling(
	geometries: any[],
	positions: number[],
	// occlusionFlags: number[], // Unused directly in loop, but kept for signature if needed
	_occlusionFlags: number[],
	voxelMap: Int32Array,
	getIndex: (x: number, y: number, z: number) => number,
	originX: number,
	originY: number,
	originZ: number,
	paletteGeometries: Map<number, PaletteGeometryData>
) {
	let totalVerts = 0;
	let totalIndices = 0;

	const validLocalIndices: number[] = [];
	const neighborCache = new Int8Array(6);
	for (let i = 0; i < geometries.length; i++) {
		totalVerts += geometries[i].positions.length / 3;
		totalIndices += geometries[i].indices.length;
	}

	if (totalVerts === 0) return null;

	// Use quantized types for memory optimization for positions/normals, but Float32 for UVs to avoid tiling issues
	// Float32 for exceptional, large-relative-coordinate chunks; default 16-block
	// chunks retain the compact quantized path. Check actual template coordinates,
	// not just nominal chunk size (models may extend outside their cell).
	let quantized = true;
	for (let i = 0; i < geometries.length && quantized; i++) {
		const geom = geometries[i];
		const [min, max] = getTemplateBounds(geom);
		for (let a = 0; a < 3; a++) {
			const offset = positions[i * 3 + a] - (a === 0 ? originX : a === 1 ? originY : originZ);
			if (
				(offset + min[a]) * POSITION_SCALE < -32768 ||
				(offset + max[a]) * POSITION_SCALE > 32767
			) {
				quantized = false;
				break;
			}
		}
	}
	const mergedPositions = quantized
		? new Int16Array(totalVerts * 3)
		: new Float32Array(totalVerts * 3);
	const mergedNormals = new Int8Array(totalVerts * 3);
	const mergedUVs = new Float32Array(totalVerts * 2);
	const mergedIndices =
		totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

	const groups: { start: number; count: number; materialIndex: number }[] = [];

	let vOffset = 0;
	let iOffset = 0;

	let currentGroup = null;

	for (let i = 0; i < geometries.length; i++) {
		const geom = geometries[i];
		const px = positions[i * 3];
		const py = positions[i * 3 + 1];
		const pz = positions[i * 3 + 2];

		const numLocalVerts = geom.positions.length / 3;
		const localIndices = geom.indices;
		validLocalIndices.length = 0;

		const cullDirs = getTemplateCulls(geom);
		neighborCache.fill(0);
		for (let j = 0; j < localIndices.length; j += 3) {
			const idx0 = localIndices[j];
			const idx1 = localIndices[j + 1];
			const idx2 = localIndices[j + 2];

			let isVisible = true;

			const slot = cullDirs[j / 3];
			if (slot >= 0) {
				if (!neighborCache[slot]) {
					const axis = slot >> 1,
						sign = (slot & 1) === 0 ? 1 : -1;
					const ni = getIndex(
						px + (axis === 0 ? sign : 0),
						py + (axis === 1 ? sign : 0),
						pz + (axis === 2 ? sign : 0)
					);
					const neighbor = paletteGeometries.get(voxelMap[ni] - 1);
					const culled =
						neighbor &&
						((neighbor.occlusionFlags & (1 << slot)) !== 0 ||
							(geom.fluid && neighbor.fluid === geom.fluid));
					neighborCache[slot] = culled ? 2 : 1;
				}
				isVisible = neighborCache[slot] !== 2;
			}

			if (isVisible) {
				validLocalIndices.push(idx0, idx1, idx2);
			}
		}

		if (validLocalIndices.length === 0) continue;

		for (let v = 0; v < numLocalVerts; v++) {
			// Quantize Positions RELATIVE TO CHUNK ORIGIN
			// px, py, pz are absolute world coords. originX/Y/Z are chunk origin.
			// Relative pos: (px - originX) + geom.pos
			const rx = px - originX + geom.positions[v * 3];
			const ry = py - originY + geom.positions[v * 3 + 1];
			const rz = pz - originZ + geom.positions[v * 3 + 2];

			// Multiply by POSITION_SCALE to preserve precision
			const vx = quantized ? rx * POSITION_SCALE : rx;
			const vy = quantized ? ry * POSITION_SCALE : ry;
			const vz = quantized ? rz * POSITION_SCALE : rz;

			mergedPositions[(vOffset + v) * 3] = vx;
			mergedPositions[(vOffset + v) * 3 + 1] = vy;
			mergedPositions[(vOffset + v) * 3 + 2] = vz;

			if (geom.normals) {
				mergedNormals[(vOffset + v) * 3] = geom.normals[v * 3] * NORMAL_SCALE;
				mergedNormals[(vOffset + v) * 3 + 1] = geom.normals[v * 3 + 1] * NORMAL_SCALE;
				mergedNormals[(vOffset + v) * 3 + 2] = geom.normals[v * 3 + 2] * NORMAL_SCALE;
			} else {
				mergedNormals[(vOffset + v) * 3 + 1] = NORMAL_SCALE;
			}

			if (geom.uvs) {
				mergedUVs[(vOffset + v) * 2] = geom.uvs[v * 2];
				mergedUVs[(vOffset + v) * 2 + 1] = geom.uvs[v * 2 + 1];
			}
		}

		for (const idx of validLocalIndices) {
			mergedIndices[iOffset++] = idx + vOffset;
		}

		const matIndex = geom.materialIndex;
		if (!currentGroup || currentGroup.materialIndex !== matIndex) {
			if (currentGroup) groups.push(currentGroup);
			currentGroup = {
				start: iOffset - validLocalIndices.length,
				count: validLocalIndices.length,
				materialIndex: matIndex,
			};
		} else {
			currentGroup.count += validLocalIndices.length;
		}

		vOffset += numLocalVerts;
	}

	if (currentGroup) groups.push(currentGroup);

	const finalPositions = mergedPositions.slice(0, vOffset * 3);
	const finalNormals = mergedNormals.slice(0, vOffset * 3);
	const finalUVs = mergedUVs.slice(0, vOffset * 2);
	const finalIndices = mergedIndices.slice(0, iOffset);

	return {
		positions: finalPositions,
		normals: finalNormals,
		uvs: finalUVs,
		indices: finalIndices,
		groups,
		isFloat32Positions: !quantized,
	};
}
