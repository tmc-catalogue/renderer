import { MeshBuilder } from "../wasm/mesh_builder_wasm.js";
import {
	buildChunkGeometry,
	decodeBlocks,
	getTemplateBounds,
	templateCullDirection,
	type ChunkBuildRequest,
	type ChunkResult,
	type MeshData,
	type PaletteGeometryData,
} from "./MeshBuilderCore";

const EMPTY_APRON = new Int32Array(0);

/** The shipped WASM module groups and culls by block category. Its input
 * adapter places all ordinary geometry in one internal group so strict opaque
 * occlusion flags work across render passes; outputs are then partitioned by
 * original material. Fluids (legacy-only) and unrepresentable coordinates use
 * the exact shared CPU engine rather than the old destructive assumptions. */
export class WasmChunkEngine {
	private readonly builder = new MeshBuilder();
	private readonly materialCategories = new Map<number, string>();
	private readonly fluidStates = new Set<number>();
	private readonly unsafeLegacyCullStates = new Set<number>();
	private readonly bounds = new Map<number, [number[], number[]]>();

	update(palette: Map<number, PaletteGeometryData>) {
		this.materialCategories.clear();
		this.fluidStates.clear();
		this.unsafeLegacyCullStates.clear();
		this.bounds.clear();
		const adapted = [];
		for (const entry of palette.values()) {
			const min = [Infinity, Infinity, Infinity],
				max = [-Infinity, -Infinity, -Infinity];
			for (const geom of entry.geometries) {
				this.materialCategories.set(geom.materialIndex, geom.category ?? entry.category ?? "solid");
				if (geom.fluid || entry.fluid) this.fluidStates.add(entry.index);
				const [lo, hi] = getTemplateBounds(geom);
				for (let axis = 0; axis < 3; axis++) {
					min[axis] = Math.min(min[axis], lo[axis]);
					max[axis] = Math.max(max[axis], hi[axis]);
				}
				for (let i = 0; i + 2 < geom.indices.length; i += 3) {
					if (templateCullDirection(geom, i, true) !== templateCullDirection(geom, i)) {
						this.unsafeLegacyCullStates.add(entry.index);
						break;
					}
				}
			}
			this.bounds.set(entry.index, [min, max]);
			adapted.push({
				...entry,
				category: "solid",
				geometries: entry.geometries.map((geom) => ({
					...geom,
					indices:
						geom.indices instanceof Uint16Array ? new Uint32Array(geom.indices) : geom.indices,
				})),
			});
		}
		this.builder.update_palette(adapted);
	}

	build(request: ChunkBuildRequest, palette: Map<number, PaletteGeometryData>): ChunkResult {
		const start = performance.now();
		const decoded = decodeBlocks(request);
		const blocks =
			decoded.blocks instanceof Int32Array
				? decoded.blocks
				: Int32Array.from(decoded.blocks.flat());
		if (!blocks.length) return { meshes: [], origin: [0, 0, 0] };
		let origin = decoded.chunkOrigin;
		if (!origin) {
			origin = [Infinity, Infinity, Infinity];
			for (let i = 0; i < blocks.length; i += 4)
				for (let a = 0; a < 3; a++) origin[a] = Math.min(origin[a], blocks[i + a]);
		}
		// Keep default-size chunks on the compact binary path; check actual
		// template extents so oversized models cannot overflow either.
		for (let i = 0; i < blocks.length; i += 4) {
			const id = blocks[i + 3];
			const bounds = this.bounds.get(id);
			let overflow = false;
			if (bounds)
				for (let a = 0; a < 3; a++) {
					const delta = blocks[i + a] - origin[a];
					if ((delta + bounds[0][a]) * 1024 < -32768 || (delta + bounds[1][a]) * 1024 > 32767) {
						overflow = true;
						break;
					}
				}
			if (this.fluidStates.has(id) || this.unsafeLegacyCullStates.has(id) || overflow) {
				return buildChunkGeometry(
					{ ...request, blocks, chunkOrigin: origin, sharedInputBuffer: undefined },
					palette
				);
			}
		}
		const result = this.builder.build_chunk(
			blocks,
			origin[0],
			origin[1],
			origin[2],
			request.apronBlocks ?? EMPTY_APRON
		) as ChunkResult;
		const elapsed = performance.now() - start;
		return {
			meshes: result.meshes.flatMap((mesh) => splitMeshPasses(mesh, this.materialCategories)),
			origin,
			timings: { total: elapsed, setup: 0, sort: 0, merge: elapsed },
		};
	}

	dispose() {
		this.builder.free();
	}
}

/** Each emitted material group owns a consecutive vertex run (the WASM core
 * appends template geometry sequentially). Copy only those runs into separate
 * pass buffers; a single-category chunk is reused unmodified. */
export function splitMeshPasses(
	mesh: MeshData,
	materialCategories: Map<number, string>
): MeshData[] {
	if (!mesh.indices.length) return [];
	const passGroups = new Map<string, MeshData["groups"]>();
	for (const group of mesh.groups) {
		const category = materialCategories.get(group.materialIndex) ?? mesh.category;
		let groups = passGroups.get(category);
		if (!groups) passGroups.set(category, (groups = []));
		groups.push(group);
	}
	if (passGroups.size <= 1)
		return [{ ...mesh, category: passGroups.keys().next().value ?? mesh.category }];
	const outputs: MeshData[] = [];
	for (const [category, groups] of passGroups) {
		const runs = groups
			.filter((group) => group.count > 0)
			.map((group) => {
				let min = Infinity,
					max = -Infinity;
				for (let i = group.start; i < group.start + group.count; i++) {
					const id = mesh.indices[i];
					min = Math.min(min, id);
					max = Math.max(max, id);
				}
				return { group, min, count: max - min + 1 };
			});
		const verts = runs.reduce((n, r) => n + r.count, 0);
		const indexCount = runs.reduce((n, r) => n + r.group.count, 0);
		const positions =
			mesh.positions instanceof Int16Array
				? new Int16Array(verts * 3)
				: new Float32Array(verts * 3);
		const normals = new Int8Array(verts * 3),
			uvs = new Float32Array(verts * 2);
		const indices = verts > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
		const outGroups: MeshData["groups"] = [];
		let v = 0,
			idx = 0;
		for (const { group, min, count } of runs) {
			positions.set(mesh.positions.subarray(min * 3, (min + count) * 3), v * 3);
			normals.set(mesh.normals.subarray(min * 3, (min + count) * 3), v * 3);
			uvs.set(mesh.uvs.subarray(min * 2, (min + count) * 2), v * 2);
			for (let i = 0; i < group.count; i++)
				indices[idx + i] = mesh.indices[group.start + i] - min + v;
			outGroups.push({ ...group, start: idx });
			v += count;
			idx += group.count;
		}
		outputs.push({ category, positions, normals, uvs, indices, groups: outGroups });
	}
	return outputs;
}
