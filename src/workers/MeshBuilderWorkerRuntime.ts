import {
	buildChunkGeometry,
	type PaletteGeometryData,
	type ChunkBuildRequest,
	type ChunkResult,
	type MeshData,
} from "./MeshBuilderCore";

type Palette = Map<number, PaletteGeometryData>;

interface Context {
	palette: Palette;
	batch: ChunkResult[];
}

/** Accumulate chunks in compact typed arrays, then allocate final world-space
 * buffers once. No boxed per-vertex arrays or quantization of world coordinates. */
export function mergeChunkResults(chunks: ChunkResult[]): ChunkResult {
	const categories = new Map<string, Array<{ mesh: MeshData; origin: number[] }>>();
	for (const chunk of chunks) {
		for (const mesh of chunk.meshes) {
			if (!mesh.indices.length) continue;
			let list = categories.get(mesh.category);
			if (!list) categories.set(mesh.category, (list = []));
			list.push({ mesh, origin: chunk.origin });
		}
	}
	const meshes: MeshData[] = [];
	for (const [category, list] of categories) {
		let vertexCount = 0,
			indexCount = 0;
		for (const { mesh } of list) {
			vertexCount += mesh.positions.length / 3;
			indexCount += mesh.indices.length;
		}
		const positions = new Float32Array(vertexCount * 3);
		const normals = new Int8Array(vertexCount * 3);
		const uvs = new Float32Array(vertexCount * 2);
		const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
		const groups: MeshData["groups"] = [];
		let v = 0,
			idx = 0;
		for (const { mesh, origin } of list) {
			const scale = mesh.positions instanceof Int16Array ? 1 / 1024 : 1;
			for (let i = 0; i < mesh.positions.length; i += 3) {
				positions[v * 3 + i] = mesh.positions[i] * scale + origin[0];
				positions[v * 3 + i + 1] = mesh.positions[i + 1] * scale + origin[1];
				positions[v * 3 + i + 2] = mesh.positions[i + 2] * scale + origin[2];
			}
			normals.set(mesh.normals, v * 3);
			uvs.set(mesh.uvs, v * 2);
			for (let j = 0; j < mesh.indices.length; j++) indices[idx + j] = mesh.indices[j] + v;
			for (const group of mesh.groups) {
				groups.push({ ...group, start: idx + group.start });
			}
			v += mesh.positions.length / 3;
			idx += mesh.indices.length;
		}
		meshes.push({ category, positions, normals, uvs, indices, groups, isFloat32Positions: true });
	}
	return { meshes, origin: [0, 0, 0] };
}

export function resultTransferables(result: ChunkResult): Transferable[] {
	const buffers = new Set<Transferable>();
	for (const mesh of result.meshes) {
		for (const array of [mesh.positions, mesh.normals, mesh.uvs, mesh.indices])
			buffers.add(array.buffer as ArrayBuffer);
	}
	return [...buffers];
}

/** The JS and WASM workers share transport, per-renderer state, batching, SAB
 * decoding and error semantics. The geometry engine is the only difference. */
export class MeshBuilderWorkerRuntime {
	private readonly contexts = new Map<string, Context>();
	constructor(
		private readonly send: (message: any, transfer?: Transferable[]) => void,
		private readonly build = (request: ChunkBuildRequest, palette: Palette, _id: string) =>
			buildChunkGeometry(request, palette),
		private readonly update?: (palette: Palette, id: string) => void,
		private readonly release?: (id: string) => void
	) {}

	handle(message: any): void {
		const { type, meshContextId = "default", chunkId } = message;
		try {
			if (type === "disposeContext") {
				this.contexts.delete(meshContextId);
				this.release?.(meshContextId);
				return;
			}
			let context = this.contexts.get(meshContextId);
			if (!context) this.contexts.set(meshContextId, (context = { palette: new Map(), batch: [] }));
			switch (type) {
				case "updatePalette":
					context.palette = new Map(
						(message.paletteData as PaletteGeometryData[]).map((item) => [item.index, item])
					);
					this.update?.(context.palette, meshContextId);
					this.send({ type: "paletteUpdated", meshContextId, count: context.palette.size });
					break;
				case "startBatch":
					context.batch = [];
					this.send({ type: "batchStarted", meshContextId });
					break;
				case "buildChunk": {
					const result = this.build(message, context.palette, meshContextId);
					this.send(
						{ type: "chunkBuilt", meshContextId, chunkId, ...result },
						resultTransferables(result)
					);
					break;
				}
				case "buildChunkBatched": {
					const result = this.build(message, context.palette, meshContextId);
					context.batch.push(result);
					this.send({ type: "chunkAccumulated", meshContextId, chunkId, timings: result.timings });
					break;
				}
				case "finishBatch": {
					const result = mergeChunkResults(context.batch);
					context.batch = [];
					this.send(
						{ type: "batchFinished", meshContextId, chunkId, ...result },
						resultTransferables(result)
					);
					break;
				}
				case "setGreedyMeshing":
					// The old cube-merging algorithm disregards model geometry and atlas
					// tile boundaries. Retain exact culled meshes until a UV-aware merge
					// can be proven equivalent; callers must not lose their geometry.
					this.send({ type: "greedyMeshingSet", meshContextId, enabled: false });
					break;
				default:
					throw new Error(`Unknown mesh worker message: ${type}`);
			}
		} catch (error) {
			this.send({
				type: "error",
				meshContextId,
				chunkId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
