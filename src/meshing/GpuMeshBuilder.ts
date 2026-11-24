/**
 * GPU compute mesh builder (WebGPU two-pass) — oracle-validated algorithm.
 *
 * Port of the standalone gpu-mesher (test/public/gpu-mesher/mesher.wgsl):
 *   PASS 1 counts visible triangles per category via atomics (exact allocation),
 *   PASS 2 emits world-space vertices/indices into per-category regions.
 * Culling semantics identical to mesh_builder_wasm::merge_category_geometries,
 * including the same-category + occlusion-bit neighbor rule and template-invariant
 * per-triangle cull slots precomputed at palette-upload time.
 *
 * v1: reads results back once and returns THREE.BufferGeometry per category
 * (drop-in for the batched path's output shape). Storage-buffer drawing is a
 * follow-up once three's WebGPURenderer path is validated for the atlas materials.
 */

import * as THREE from "three";
import { templateCullDirection } from "../workers/MeshBuilderCore";
import type { RecordMaterialRun, RecordStream } from "./RecordRenderer";

const NEIGHBOR_CULL = /* wgsl */ `
const DIRS = array<vec3<i32>, 6>(
  vec3<i32>(1, 0, 0), vec3<i32>(-1, 0, 0),
  vec3<i32>(0, 1, 0), vec3<i32>(0, -1, 0),
  vec3<i32>(0, 0, 1), vec3<i32>(0, 0, -1),
);

fn neighborOccludes(cell: vec3<u32>, side: u32, sourceFlags: u32) -> bool {
  let n = vec3<i32>(cell) + DIRS[side];
  if (n.x < 0 || n.y < 0 || n.z < 0 || n.x >= i32(dims.sx) || n.y >= i32(dims.sy) || n.z >= i32(dims.sz)) {
    return false;
  }
  let nu = vec3<u32>(n);
  let pv = grid[(nu.y * dims.sz + nu.z) * dims.sx + nu.x];
  if (pv == 0u) { return false; }
  let neighborFlags = desc[pv].w;
  let fluid = sourceFlags & 192u;
  return (neighborFlags & (1u << side)) != 0u ||
         (fluid != 0u && (neighborFlags & 192u) == fluid);
}
`;

// Record emission only uses eight storage buffers. Keep it independent of the
// conventional vertex pipeline so WebGPU adapters with the standard storage
// binding limit can run GPU culling and emit directly to the record renderer.
const RECORD_SHADER = /* wgsl */ `
struct Dims { sx: u32, sy: u32, sz: u32, mode: u32, nSlots: u32, y0: u32, slabH: u32, _p: u32 };
@group(0) @binding(0) var<storage, read> grid: array<u32>;
@group(0) @binding(1) var<uniform> dims: Dims;
@group(0) @binding(2) var<storage, read> desc: array<vec4<u32>>;
@group(0) @binding(3) var<storage, read> desc2: array<vec4<u32>>;
@group(0) @binding(4) var<storage, read> tpl_tri_cull: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> cat_offsets: array<u32>;
@group(0) @binding(7) var<storage, read> tpl_tri_mat: array<u32>;
@group(0) @binding(8) var<storage, read_write> out_records: array<vec2<u32>>;
${NEIGHBOR_CULL}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= dims.sx || gid.y >= dims.slabH || gid.z >= dims.sz) { return; }
  let cell = vec3<u32>(gid.x, gid.y + dims.y0, gid.z);
  let ci = (cell.y * dims.sz + cell.z) * dims.sx + cell.x;
  let pv = grid[ci];
  if (pv == 0u) { return; }
  let d0 = desc[pv];
  let d1 = desc2[pv];
  let triStart = d0.z;
  let triCount = d1.y / 3u;
  let slotBase = d1.w;
  var nbCulled: array<bool, 6>;
  var nbKnown: array<bool, 6>;
  for (var t = 0u; t < triCount; t++) {
    let side = tpl_tri_cull[triStart + t];
    if (side != 255u) {
      if (!nbKnown[side]) {
        nbKnown[side] = true;
        nbCulled[side] = neighborOccludes(cell, side, d0.w);
      }
      if (nbCulled[side]) { continue; }
    }
    let seg = slotBase + tpl_tri_mat[triStart + t];
    let i = atomicAdd(&counters[seg * 2u + 1u], 1u);
    if (dims.mode == 3u) {
      out_records[cat_offsets[dims.nSlots + seg] + i] = vec2<u32>(ci, triStart + t);
    }
  }
}
`;

const SHADER = /* wgsl */ `
struct Dims { sx: u32, sy: u32, sz: u32, mode: u32, nSlots: u32, y0: u32, slabH: u32, _p: u32 };
// modes: 0 = count (f32 vertex path), 1 = emit (f32 vertex path),
//        2 = count (records path, TRIANGLE counters), 3 = emit (records path)
@group(0) @binding(0) var<storage, read> grid: array<u32>;
@group(0) @binding(1) var<uniform> dims: Dims;
@group(0) @binding(2) var<storage, read> desc: array<vec4<u32>>;
@group(0) @binding(3) var<storage, read> desc2: array<vec4<u32>>;
@group(0) @binding(4) var<storage, read> tpl_pos: array<f32>;
@group(0) @binding(5) var<storage, read> tpl_idx: array<u32>;
@group(0) @binding(6) var<storage, read> tpl_tri_cull: array<u32>;
@group(0) @binding(7) var<storage, read_write> out_pos: array<f32>;
@group(0) @binding(8) var<storage, read_write> out_idx: array<u32>;
@group(0) @binding(9) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(10) var<storage, read> cat_offsets: array<u32>;
@group(0) @binding(11) var<storage, read> tpl_tri_mat: array<u32>; // per template triangle
// binding 12 was out_mat (per-vertex material) — dead since groups derive from segment
// layout; the slot now carries the records-path output (adapter caps at 16 storage bindings)
@group(0) @binding(12) var<storage, read_write> out_records: array<vec2<u32>>; // (blockIdx, templateTriRow) per triangle
@group(0) @binding(13) var<storage, read> tpl_nrm: array<f32>;
@group(0) @binding(14) var<storage, read> tpl_uv: array<f32>;
@group(0) @binding(15) var<storage, read_write> out_nrm: array<f32>;
@group(0) @binding(16) var<storage, read_write> out_uv: array<f32>;

${NEIGHBOR_CULL}

const MAXV: u32 = 128u; // local unique-vertex table; templates above this fall back to 3/tri

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sx = dims.sx; let sy = dims.sy; let sz = dims.sz;
  // slab chunking: dispatch covers only [y0, y0+slabH) but ALL indexing/culling uses world
  // coordinates against the FULL grid, so the emitted triangle set is identical to a
  // monolithic run — interior seam faces still cull against neighbors outside the slab
  if (gid.x >= sx || gid.y >= dims.slabH || gid.z >= sz) { return; }
  let cell = vec3<u32>(gid.x, gid.y + dims.y0, gid.z);
  let ci = (cell.y * sz + cell.z) * sx + cell.x;
  let pv = grid[ci];
  if (pv == 0u) { return; }

  let d0 = desc[pv];
  let d1 = desc2[pv];
  let vertStart = d0.x; let idxStart = d0.y; let triStart = d0.z;
  let vertCount = d1.x; let idxCount = d1.y; let category = d1.z;
  let slotBase = d1.w; // first (category, material) counter slot for this blockstate's category

  var nbCulled: array<bool, 6>;
  var nbKnown: array<bool, 6>;
  for (var s = 0u; s < 6u; s++) { nbKnown[s] = false; nbCulled[s] = false; }

  let triCount = idxCount / 3u;
  let dedup = vertCount <= MAXV;

  // pass 1: determine surviving triangles; collect unique template vertices (deterministic
  // single-threaded order, identical in count and emit passes)
  var uniq: array<u32, MAXV>; // local template-vertex ids in first-seen order
  var nUniq: u32 = 0u;
  var slot0: u32 = 0xFFFFFFFFu; // segment receiving this cell's deduplicated vertices
  if (dedup) { for (var u = 0u; u < vertCount; u++) { uniq[u] = 0xFFFFFFFFu; } }

  for (var t = 0u; t < triCount; t++) {
    let slot = tpl_tri_cull[triStart + t];
    if (slot != 255u) {
      let s = slot;
      if (!nbKnown[s]) {
        nbKnown[s] = true; nbCulled[s] = neighborOccludes(cell, s, d0.w);
      }
      if (nbCulled[s]) { continue; }
    }

    if (slot0 == 0xFFFFFFFFu) { slot0 = slotBase + tpl_tri_mat[triStart + t]; }
    if (dedup && dims.mode < 2u) {
      for (var k = 0u; k < 3u; k++) {
        let loc = tpl_idx[idxStart + t * 3u + k] - vertStart;
        if (loc < MAXV && uniq[loc] == 0xFFFFFFFFu) { uniq[loc] = nUniq; nUniq++; }
      }
    }
  }

  // count pass: idx per material slot (3/tri); verts: deduped once per cell (or 3/tri legacy)
  if (dims.mode == 0u) {
    for (var t = 0u; t < triCount; t++) {
      let slot = tpl_tri_cull[triStart + t];
      if (slot != 255u && nbCulled[slot]) { continue; }
      atomicAdd(&counters[(slotBase + tpl_tri_mat[triStart + t]) * 2u + 1u], 3u);
      if (!dedup) { atomicAdd(&counters[(slotBase + tpl_tri_mat[triStart + t]) * 2u + 0u], 3u); }
    }
    if (dedup && slot0 != 0xFFFFFFFFu) { atomicAdd(&counters[slot0 * 2u + 0u], nUniq); }
    return;
  }

  // RECORDS path (mode 2 count / mode 3 emit): one 8-byte record per surviving triangle —
  // (linear cell index, global template-triangle row). Vertices/UVs/normals are expanded
  // by the consumer (render shader or CPU oracle) from the template tables. Material
  // segmentation still applies: records are written into per-(category x material)
  // segments so the record stream can be drawn in material runs without per-tri tags.
  if (dims.mode == 2u || dims.mode == 3u) {
    let ci = (cell.y * sz + cell.z) * sx + cell.x;
    for (var t = 0u; t < triCount; t++) {
      let slot = tpl_tri_cull[triStart + t];
      if (slot != 255u && nbCulled[slot]) { continue; }
      let matIdx = tpl_tri_mat[triStart + t];
      let seg = slotBase + matIdx;
      if (dims.mode == 2u) {
        atomicAdd(&counters[seg * 2u + 1u], 1u); // TRIANGLE count
      } else {
        let i = atomicAdd(&counters[seg * 2u + 1u], 1u);
        out_records[cat_offsets[dims.nSlots + seg] + i] = vec2<u32>(ci, triStart + t);
      }
    }
    return;
  }

  // emit pass
  let catVertRegion = cat_offsets[slotBase];
  if (dedup && slot0 != 0xFFFFFFFFu) {
    let vRegion = cat_offsets[slot0];
    let vBase = atomicAdd(&counters[slot0 * 2u + 0u], nUniq);
    for (var w = 0u; w < vertCount; w++) {
      let u = uniq[w];
      if (u == 0xFFFFFFFFu) { continue; } // local vertex not used by any surviving triangle
      let vi = vertStart + w;
      let ob = vRegion + vBase + u;
      out_pos[ob * 3u + 0u] = f32(cell.x) + tpl_pos[vi * 3u + 0u];
      out_pos[ob * 3u + 1u] = f32(cell.y) + tpl_pos[vi * 3u + 1u];
      out_pos[ob * 3u + 2u] = f32(cell.z) + tpl_pos[vi * 3u + 2u];
      out_nrm[ob * 3u + 0u] = tpl_nrm[vi * 3u + 0u];
      out_nrm[ob * 3u + 1u] = tpl_nrm[vi * 3u + 1u];
      out_nrm[ob * 3u + 2u] = tpl_nrm[vi * 3u + 2u];
      out_uv[ob * 2u + 0u] = tpl_uv[vi * 2u + 0u];
      out_uv[ob * 2u + 1u] = tpl_uv[vi * 2u + 1u];
    }
    for (var t = 0u; t < triCount; t++) {
      let slot = tpl_tri_cull[triStart + t];
      if (slot != 255u && nbCulled[slot]) { continue; }
      let matIdx = tpl_tri_mat[triStart + t];
      let iRegion = cat_offsets[dims.nSlots + slotBase + matIdx];
      let iBase = atomicAdd(&counters[(slotBase + matIdx) * 2u + 1u], 3u);
      for (var k = 0u; k < 3u; k++) {
        let loc = tpl_idx[idxStart + t * 3u + k] - vertStart;
        let u = uniq[loc];
        out_idx[iRegion + iBase + k] = (vRegion + vBase + u) - catVertRegion;
      }
    }
  } else {
    // legacy: 3 vertices per triangle, verts in the triangle's own material slot
    for (var t = 0u; t < triCount; t++) {
      let slot = tpl_tri_cull[triStart + t];
      if (slot != 255u && nbCulled[slot]) { continue; }
      let matIdx = tpl_tri_mat[triStart + t];
      let vRegion = cat_offsets[slotBase + matIdx];
      let iRegion = cat_offsets[dims.nSlots + slotBase + matIdx];
      let vBase = atomicAdd(&counters[(slotBase + matIdx) * 2u + 0u], 3u);
      let iBase = atomicAdd(&counters[(slotBase + matIdx) * 2u + 1u], 3u);
      for (var k = 0u; k < 3u; k++) {
        let vi = tpl_idx[idxStart + t * 3u + k];
        let ob = vRegion + vBase + k;
        out_pos[ob * 3u + 0u] = f32(cell.x) + tpl_pos[vi * 3u + 0u];
        out_pos[ob * 3u + 1u] = f32(cell.y) + tpl_pos[vi * 3u + 1u];
        out_pos[ob * 3u + 2u] = f32(cell.z) + tpl_pos[vi * 3u + 2u];
        out_nrm[ob * 3u + 0u] = tpl_nrm[vi * 3u + 0u];
        out_nrm[ob * 3u + 1u] = tpl_nrm[vi * 3u + 1u];
        out_nrm[ob * 3u + 2u] = tpl_nrm[vi * 3u + 2u];
        out_uv[ob * 2u + 0u] = tpl_uv[vi * 2u + 0u];
        out_uv[ob * 2u + 1u] = tpl_uv[vi * 2u + 1u];
        out_idx[iRegion + iBase + k] = (vRegion + vBase + k) - catVertRegion;
      }
    }
  }
}
`;

type PaletteEntry = {
	index: number;
	category: string;
	occlusionFlags: number;
	fluid?: "water" | "lava";
	geometries: Array<{
		positions: Float32Array | number[];
		normals: Float32Array | number[];
		uvs: Float32Array | number[];
		indices: Uint32Array | Uint16Array | number[] | null;
		materialIndex: number;
		category?: string;
	}>;
};

export class GpuMeshBuilder {
	private device: GPUDevice | null = null;
	private pipeline: GPUComputePipeline | null = null;
	private recordPipeline: GPUComputePipeline | null = null;
	private generation = 0;
	available = false;

	/** Each schematic owns its compute device; release it when the schematic is removed. */
	dispose(): void {
		this.generation++;
		this.available = false;
		this.pipeline = null;
		this.recordPipeline = null;
		this.device?.destroy();
		this.device = null;
	}

	async init(): Promise<boolean> {
		if (this.device && this.available) return true;
		const generation = this.generation;
		if (typeof navigator !== "undefined" && (navigator as any).gpu) {
			try {
				const adapter = await (navigator as any).gpu.requestAdapter();
				if (!adapter || generation !== this.generation) return false;
				const storageLimit = adapter.limits.maxStorageBuffersPerShaderStage;
				if (storageLimit < 8) return false;
				const device: GPUDevice = await adapter.requestDevice({
					requiredLimits: {
						// The record path runs on the minimum eight-buffer WebGPU limit.
						// Devices with sixteen buffers retain the direct vertex-output path.
						maxStorageBuffersPerShaderStage: storageLimit >= 16 ? 16 : 8,
						// large builds need big output buffers (3.1M blocks -> ~360MB positions)
						maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
						maxBufferSize: adapter.limits.maxBufferSize,
					},
				});
				if (generation !== this.generation) {
					device.destroy();
					return false;
				}
				this.device = device;
				device.lost.then((i: any) => {
					if (this.device === device) {
						this.available = false;
						this.device = null;
						this.pipeline = null;
						this.recordPipeline = null;
						console.warn("[GpuMeshBuilder] device lost:", i?.reason, i?.message);
					}
				});
				const compile = async (code: string) => {
					const module = device.createShaderModule({ code });
					const info = await module.getCompilationInfo();
					for (const m of info.messages) {
						if (m.type === "error" || m.type === "warning")
							console.warn(`[GpuMeshBuilder][wgsl:${m.type}] line ${m.lineNum}: ${m.message}`);
					}
					if (info.messages.some((m) => m.type === "error"))
						throw new Error("Invalid GPU mesher shader");
					return device.createComputePipelineAsync({
						layout: "auto",
						compute: { module, entryPoint: "main" },
					});
				};
				const recordPipeline = await compile(RECORD_SHADER);
				if (generation !== this.generation || this.device !== device) return false;
				this.recordPipeline = recordPipeline;
				if (storageLimit >= 16) {
					try {
						const vertexPipeline = await compile(SHADER);
						if (generation !== this.generation || this.device !== device) return false;
						this.pipeline = vertexPipeline;
					} catch (error) {
						console.warn(
							"[GpuMeshBuilder] Direct vertex pipeline unavailable; expanding GPU records instead",
							error
						);
					}
				}
				if (generation !== this.generation || this.device !== device) return false;
				this.available = true;
				return true;
			} catch (e) {
				if (generation === this.generation) this.dispose();
				console.warn("[GpuMeshBuilder] WebGPU init failed, falling back:", e);
				return false;
			}
		}
		return false;
	}

	/** Flatten palette descriptors + templates into GPU buffers (reusable across meshes). */
	private buildTemplateBuffers(palette: PaletteEntry[]) {
		const catNames = [...new Set(palette.map((p) => p.category))].sort();
		const catIds = new Map(catNames.map((c, i) => [c, i]));
		// per-(category, material) segment slots: emission groups triangles by material so the
		// readback geometry has a handful of contiguous material runs instead of ~one per block
		const catMatCount: number[] = catNames.map(() => 1);
		for (const p of palette) {
			const c = catIds.get(p.category)!;
			for (const g of p.geometries)
				catMatCount[c] = Math.max(catMatCount[c], (g.materialIndex || 0) + 1);
		}
		const slotBase: number[] = [];
		let nSlots = 0;
		for (let c = 0; c < catNames.length; c++) {
			slotBase.push(nSlots);
			nSlots += catMatCount[c];
		}
		const tplPos: number[] = [],
			tplIdx: number[] = [],
			tplCull: number[] = [],
			tplTriMat: number[] = [],
			tplNrm: number[] = [],
			tplUv: number[] = [];
		// per-vertex anim channels: uv.w = signed frames (+cycle / -flow), pos.w = frame
		// step in atlas V, nrm.w = frame-0 content top V — the record shaders animate
		// by frame-cycling (still) or world-Y flow sampling (flow faces)
		const tplUvW: number[] = [],
			tplPosW: number[] = [],
			tplNrmW: number[] = [];
		// quadStart: global template row -> merged-quad corner ids [p0,p1,p2,p3] where the
		// static [0,1,2, 0,2,3] pattern reproduces rows (t, t+1) EXACTLY (winding included).
		// Marked ONLY within one geometry (element face) — cross-element pairs are the
		// black/atlas-soup corruption source. Built here where geometry bounds are known.
		const quadStart = new Map<number, [number, number, number, number]>();
		const desc: number[][] = [[0, 0, 0, 0]],
			desc2: number[][] = [[0, 0, 0, 0]];
		const maxIdx = Math.max(...palette.map((p) => p.index));
		const byIndex = new Map(palette.map((p) => [p.index, p]));

		for (let pi = 1; pi <= maxIdx; pi++) {
			const t = byIndex.get(pi);
			if (!t) {
				desc.push([0, 0, 0, 0]);
				desc2.push([0, 0, 0, 0]);
				continue;
			}
			const idxStart = tplIdx.length,
				triStart = tplCull.length;
			const vertStart = tplPos.length / 3;
			for (const g of t.geometries) {
				const gMat = g.materialIndex || 0;
				const vBase = tplPos.length / 3;
				const gIdxBase = tplIdx.length; // this geometry's indices start here
				const gTriBase = tplCull.length; // this geometry's triangle rows start here
				const pos = g.positions,
					nrm = g.normals || [],
					idx = g.indices ?? Array.from({ length: pos.length / 3 }, (_, i) => i);
				for (let v = 0; v < pos.length; v++) tplPos.push(pos[v]);
				const uv = g.uvs || [];
				for (let v = 0; v < nrm.length; v++) tplNrm.push(nrm[v]);
				for (let v = 0; v < uv.length; v++) tplUv.push(uv[v]);
				const gAnim = (g as any).anim as
					| { frames: number; step: number; vTop: number }
					| null
					| undefined;
				const nVerts = pos.length / 3;
				for (let v = 0; v < nVerts; v++) {
					tplUvW.push(gAnim ? gAnim.frames : 0);
					tplPosW.push(gAnim ? gAnim.step : 0);
					tplNrmW.push(gAnim ? gAnim.vTop : 0);
				}
				// pad normals/uvs to vertex-count alignment if a geometry lacks them
				while (tplNrm.length < tplPos.length) tplNrm.push(0);
				while (tplUv.length < (tplPos.length / 3) * 2) tplUv.push(0);
				for (let i = 0; i < idx.length; i++) tplIdx.push(vBase + idx[i]);
				for (let tr = 0; tr + 2 < idx.length; tr += 3) {
					const direction = templateCullDirection(g, tr);
					tplCull.push(direction < 0 ? 255 : direction);
					tplTriMat.push(gMat);
				}
				// mark in-geometry quad pairs (t even offsets): rows (2k, 2k+1)
				const nTri = Math.floor(idx.length / 3);
				for (let k = 0; k + 1 < nTri; k += 2) {
					const r0 = gTriBase + k;
					const a = tplIdx[gIdxBase + k * 3],
						b = tplIdx[gIdxBase + k * 3 + 1],
						c = tplIdx[gIdxBase + k * 3 + 2];
					const d = tplIdx[gIdxBase + k * 3 + 3],
						e = tplIdx[gIdxBase + k * 3 + 4],
						f = tplIdx[gIdxBase + k * 3 + 5];
					const shared = [a, b, c].filter((id) => [d, e, f].includes(id));
					if (shared.length !== 2) continue;
					const g4 = [d, e, f].find((id) => !shared.includes(id));
					const x = [a, b, c].find((id) => !shared.includes(id));
					// vertex id 0 is a VALID absolute template id — !g4/!x wrongly rejected
					// those quads (missed merges, not corruption) (astra)
					if (g4 === undefined || x === undefined) continue;
					if (g4 === a || g4 === b || g4 === c) continue;
					const [u, v] = shared as [number, number];
					const rot = (t: number[], p0: number, p1: number, p2: number) =>
						(t[0] === p0 && t[1] === p1 && t[2] === p2) ||
						(t[0] === p1 && t[1] === p2 && t[2] === p0) ||
						(t[0] === p2 && t[1] === p0 && t[2] === p1);
					const t1 = [a, b, c],
						t2 = [d, e, f];
					if (rot(t1, u, x, v) && rot(t2, u, v, g4)) quadStart.set(r0, [u, x, v, g4]);
					else if (rot(t1, v, x, u) && rot(t2, v, u, g4)) quadStart.set(r0, [v, x, u, g4]);
				}
			}
			const fluidFlag = t.fluid === "water" ? 64 : t.fluid === "lava" ? 128 : 0;
			desc.push([vertStart, idxStart, triStart, (t.occlusionFlags & 63) | fluidFlag]);
			desc2.push([
				tplPos.length / 3 - vertStart,
				tplIdx.length - idxStart,
				catIds.get(t.category)!,
				slotBase[catIds.get(t.category)!],
			]);
		}
		return {
			catNames,
			catMatCount,
			slotBase,
			nSlots,
			tplPos,
			tplIdx,
			tplCull,
			tplTriMat,
			tplNrm,
			tplUv,
			tplPosW,
			tplNrmW,
			tplUvW,
			quadStart,
			desc: desc.flat(),
			desc2: desc2.flat(),
		};
	}

	/**
	 * Build meshes for a full-block grid. `grid` is palette-index-per-cell in
	 * (y*sz+z)*sx+x order, 0 = air. Returns BufferGeometry per category with the
	 * same {category, positions, indices} shape the batched wasm path produces.
	 */
	async buildMeshes(
		grid: Uint32Array,
		sx: number,
		sy: number,
		sz: number,
		palette: PaletteEntry[],
		materialLookup: (category: string) => THREE.Material[]
	): Promise<THREE.Mesh[]> {
		// A glass/portal-only schematic is rendered entirely by the surface pass.
		if (palette.length === 0) return [];
		if (!this.device || !this.recordPipeline) throw new Error("GpuMeshBuilder not initialized");
		if (!this.pipeline) {
			const { stream } = await this.buildRecordMeshes(
				grid,
				sx,
				sy,
				sz,
				palette,
				materialLookup,
				false
			);
			const { materializeRecordMeshes } = await import("./RecordRenderer");
			return stream ? materializeRecordMeshes(stream) : [];
		}
		const device = this.device;
		const t0 = performance.now();

		const {
			catNames,
			catMatCount,
			slotBase,
			nSlots,
			tplPos,
			tplIdx,
			tplCull,
			tplTriMat,
			tplNrm,
			tplUv,
			desc,
			desc2,
		} = this.buildTemplateBuffers(palette);
		const nCat = catNames.length;
		const mk = (arr: ArrayBufferView, usage: number) => {
			const b = device.createBuffer({
				size: (arr.byteLength + 3) & ~3,
				usage: usage | GPUBufferUsage.COPY_DST,
			});
			device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength);
			return b;
		};
		const bufs = {
			grid: mk(grid, GPUBufferUsage.STORAGE),
			desc: mk(new Uint32Array(desc), GPUBufferUsage.STORAGE),
			desc2: mk(new Uint32Array(desc2), GPUBufferUsage.STORAGE),
			tp: mk(new Float32Array(tplPos), GPUBufferUsage.STORAGE),
			ti: mk(new Uint32Array(tplIdx), GPUBufferUsage.STORAGE),
			tc: mk(new Uint32Array(tplCull), GPUBufferUsage.STORAGE),
			tm: mk(new Uint32Array(tplTriMat), GPUBufferUsage.STORAGE),
			tn: mk(new Float32Array(tplNrm), GPUBufferUsage.STORAGE),
			tu: mk(new Float32Array(tplUv), GPUBufferUsage.STORAGE),
			co: mk(new Uint32Array(2 * nSlots), GPUBufferUsage.STORAGE),
		};
		const dims = mk(
			new Uint32Array([sx, sy, sz, 0, nSlots, 0, 0, 0]),
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		);
		const cntBytes = Math.max(64, nSlots * 2) * 4; // [slot*2]: verts, [slot*2+1]: idx
		const counters = device.createBuffer({
			size: cntBytes,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		});
		const countersRead = device.createBuffer({
			size: cntBytes,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});

		const readCounters = async () => {
			const e = device.createCommandEncoder();
			e.copyBufferToBuffer(counters, 0, countersRead, 0, cntBytes);
			device.queue.submit([e.finish()]);
			await countersRead.mapAsync(GPUMapMode.READ);
			const c = new Uint32Array(countersRead.getMappedRange().slice(0));
			countersRead.unmap();
			return c;
		};
		const mkBind = (
			outPos: GPUBuffer,
			outIdx: GPUBuffer,
			outNrmB: GPUBuffer,
			outUvB: GPUBuffer,
			outRec: GPUBuffer
		) =>
			device.createBindGroup({
				layout: this.pipeline!.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: bufs.grid } },
					{ binding: 1, resource: { buffer: dims } },
					{ binding: 2, resource: { buffer: bufs.desc } },
					{ binding: 3, resource: { buffer: bufs.desc2 } },
					{ binding: 4, resource: { buffer: bufs.tp } },
					{ binding: 5, resource: { buffer: bufs.ti } },
					{ binding: 6, resource: { buffer: bufs.tc } },
					{ binding: 7, resource: { buffer: outPos } },
					{ binding: 8, resource: { buffer: outIdx } },
					{ binding: 9, resource: { buffer: counters } },
					{ binding: 10, resource: { buffer: bufs.co } },
					{ binding: 11, resource: { buffer: bufs.tm } },
					{ binding: 12, resource: { buffer: outRec } },
					{ binding: 13, resource: { buffer: bufs.tn } },
					{ binding: 14, resource: { buffer: bufs.tu } },
					{ binding: 15, resource: { buffer: outNrmB } },
					{ binding: 16, resource: { buffer: outUvB } },
				],
			});

		const wx = Math.ceil(sx / 4),
			wz = Math.ceil(sz / 4);
		// count pass needs five DISTINCT writable buffers — any aliasing silently rejects the dispatch
		const dummyA = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		const dummyB = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		const dummyC = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		const dummyD = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		const dummyE = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		const dummyF = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		const cleanupInputs = () =>
			[
				dummyA,
				dummyB,
				dummyC,
				dummyD,
				dummyE,
				dummyF,
				bufs.grid,
				bufs.desc,
				bufs.desc2,
				bufs.tp,
				bufs.ti,
				bufs.tc,
				bufs.tm,
				bufs.tn,
				bufs.tu,
				bufs.co,
				dims,
				counters,
				countersRead,
			].forEach((b) => b.destroy());

		const runPass = async (mode: number, y0: number, slabH: number, outs: GPUBuffer[] | null) => {
			device.queue.writeBuffer(dims, 0, new Uint32Array([sx, sy, sz, mode, nSlots, y0, slabH, 0]));
			const enc = device.createCommandEncoder();
			const pass = enc.beginComputePass();
			pass.setPipeline(this.pipeline!);
			pass.setBindGroup(
				0,
				mkBind(
					outs ? outs[0] : dummyA,
					outs ? outs[1] : dummyB,
					outs ? outs[2] : dummyC,
					outs ? outs[3] : dummyD,
					outs ? outs[4] : dummyE
				)
			);
			pass.dispatchWorkgroups(wx, Math.ceil(slabH / 4), wz);
			pass.end();
			device.queue.submit([enc.finish()]);
			await device.queue.onSubmittedWorkDone();
		};
		const zeroCounters = () => device.queue.writeBuffer(counters, 0, new Uint32Array(nSlots * 2));

		// PASS 1 over the FULL grid: exact totals for slab sizing + a memory pre-flight —
		// allocating past VRAM doesn't throw in WebGPU, it kills the GPU process (measured)
		zeroCounters();
		await runPass(0, 0, sy, null);
		const counts = await readCounters();
		const tCount = performance.now() - t0;
		let totV = 0,
			totI = 0;
		for (let s = 0; s < nSlots; s++) {
			totV += counts[s * 2];
			totI += counts[s * 2 + 1];
		}
		const outBytes = totV * 32 + totI * 8; // f32 pos+nrm+uv per vert, u32 idx+mat per index
		if (outBytes > 4 * 1024 ** 3) {
			cleanupInputs();
			throw new Error(
				`[GpuMeshBuilder] output ${Math.round(outBytes / 1048576)}MB exceeds the 4GB budget — batched fallback`
			);
		}
		// slab the emission when the monolithic output wouldn't fit comfortably in VRAM.
		// Chunking only bounds the OUTPUT buffers — indexing and culling stay world-space
		// against the full grid, so the triangle set is identical to a monolithic run
		// (interior seam faces still cull against neighbors outside the slab).
		const SLAB_BUDGET = 384 * 1024 * 1024;
		const slabH = Math.min(
			sy,
			Math.max(8, outBytes <= SLAB_BUDGET ? sy : Math.floor((sy * SLAB_BUDGET) / outBytes))
		);

		const meshes: THREE.Mesh[] = [];
		const readRange = async (buf: GPUBuffer, byteOff: number, len: number, ctor: any) => {
			const tmp = device.createBuffer({
				size: len * 4,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			});
			const e2 = device.createCommandEncoder();
			e2.copyBufferToBuffer(buf, byteOff, tmp, 0, len * 4);
			device.queue.submit([e2.finish()]);
			await tmp.mapAsync(GPUMapMode.READ);
			const out = new ctor(tmp.getMappedRange().slice(0));
			tmp.unmap();
			tmp.destroy();
			return out;
		};
		let tEmitAcc = 0,
			firstSlab = true;
		try {
			for (let y0 = 0; y0 < sy; y0 += slabH) {
				const h = Math.min(slabH, sy - y0);
				let slabCounts = counts;
				if (!(firstSlab && h === sy)) {
					zeroCounters();
					await runPass(0, y0, h, null);
					slabCounts = await readCounters();
				}
				// exact allocation + segment offsets. With dedup, vertex and index counts differ, so
				// each (category, material) slot has TWO regions: verts ([0, nSlots) in cat_offsets)
				// and indices ([nSlots, 2*nSlots)). Cat regions stay contiguous (slots are cat-major).
				// NO padding — the readback treats each category range as one dense array; any gap
				// would surface as garbage triangles (caught by the golden-hash oracle once already).
				const segV: number[] = [],
					segI: number[] = [];
				let accV = 0,
					accI = 0;
				for (let s = 0; s < nSlots; s++) {
					segV.push(accV);
					accV += slabCounts[s * 2];
					segI.push(accI);
					accI += slabCounts[s * 2 + 1];
				}
				device.queue.writeBuffer(bufs.co, 0, new Uint32Array([...segV, ...segI]));
				zeroCounters();
				if (firstSlab && (window as any).__gpuOracle)
					(window as any).__gpuDebug = {
						nSlots,
						slotBase,
						catMatCount,
						counts: Array.from(counts),
						segV,
						segI,
					};
				if (accI === 0) {
					firstSlab = false;
					continue;
				} // empty slab: zero-size storage bindings are a validation error
				const outPos = device.createBuffer({
					size: accV * 3 * 4,
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
				});
				const outIdx = device.createBuffer({
					size: accI * 4,
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
				});
				const outNrm = device.createBuffer({
					size: accV * 3 * 4,
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
				});
				const outUv = device.createBuffer({
					size: accV * 2 * 4,
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
				});

				// PASS 2: emit (this slab)
				const te0 = performance.now();
				await runPass(1, y0, h, [outPos, outIdx, outNrm, outUv, dummyF]);
				tEmitAcc += performance.now() - te0;
				const cnt2 = await readCounters();
				for (let c = 0; c < nCat; c++) {
					const name = catNames[c];
					// sum this category's material segments (contiguous, cat-major slot layout)
					let nIdx = 0,
						nVerts = 0;
					for (let s = 0; s < catMatCount[c]; s++) {
						nIdx += cnt2[(slotBase[c] + s) * 2 + 1];
						nVerts += cnt2[(slotBase[c] + s) * 2];
					}
					if (nIdx === 0) continue;
					const vRegion = segV[slotBase[c]];
					const iRegion = segI[slotBase[c]];
					const posArr = await readRange(outPos, vRegion * 3 * 4, nVerts * 3, Float32Array);
					const idxArr = await readRange(outIdx, iRegion * 4, nIdx, Uint32Array);
					const nrmArr = await readRange(outNrm, vRegion * 3 * 4, nVerts * 3, Float32Array);
					const uvArr = await readRange(outUv, vRegion * 2 * 4, nVerts * 2, Float32Array);
					const geometry = new THREE.BufferGeometry();
					geometry.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
					geometry.setAttribute("normal", new THREE.BufferAttribute(nrmArr, 3));
					geometry.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
					geometry.setIndex(
						nIdx > 65535
							? new THREE.BufferAttribute(idxArr, 1)
							: new THREE.BufferAttribute(Uint16Array.from(idxArr), 1)
					);
					// free the CPU-side arrays once WebGL has its copy (halves peak JS heap on huge
					// builds). Picking is voxel-DDA based, so nothing needs the triangle data back.
					// The oracle runs before first render, so hashes are unaffected.
					for (const a of [
						geometry.attributes.position,
						geometry.attributes.normal,
						geometry.attributes.uv,
						geometry.index,
					]) {
						(a as any).onUpload(() => {
							(a as any).array = null;
						});
					}
					// material groups come straight from the (category × material) segment layout —
					// no per-index material readback needed (segments are material-contiguous by
					// construction). Saves an entire nIdx×4B copy per category.
					const mats = materialLookup(name);
					for (let s = 0; s < catMatCount[c]; s++) {
						const cnt = cnt2[(slotBase[c] + s) * 2 + 1];
						if (cnt > 0) geometry.addGroup(segI[slotBase[c] + s] - iRegion, cnt, s);
					}
					// manual bounding volumes: the slab's AABB is known from the grid — avoids
					// computeBoundingSphere()'s full CPU scan of the position array on first cull.
					// Geometry uses the centered convention (block b spans [b-0.5, b+0.5]).
					geometry.boundingBox = new THREE.Box3(
						new THREE.Vector3(-0.51, y0 - 0.51, -0.51),
						new THREE.Vector3(sx - 0.49, y0 + h + 0.01, sz - 0.49)
					);
					geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
					const mesh = new THREE.Mesh(geometry, mats);
					if ((window as any).__gpuOracle) {
						const w = window as any;
						(w.__gpuDump = w.__gpuDump || {})[name] = {
							posArr,
							idxArr,
							groups: (geometry as any).groups?.length ?? 0,
						};
					}
					mesh.userData.category = name;
					mesh.userData.gpuBuilt = true;
					meshes.push(mesh);
					// ORACLE: same canonical hash bookkeeping as the batched path (opt-in — hashing
					// 900K+ triangles in JS costs real time and is verification-only overhead)
					try {
						const w = window as any;
						w.__meshHashes = w.__meshHashes || [];
						if (w.__gpuOracle) {
							let h = 0x811c9dc5;
							const tris: string[] = [];
							for (let t = 0; t + 2 < nIdx; t += 3) {
								const v: string[] = [];
								for (let k = 0; k < 3; k++) {
									const vi = idxArr[t + k];
									v.push(
										`${Math.round(posArr[vi * 3] * 1024)},${Math.round(posArr[vi * 3 + 1] * 1024)},${Math.round(posArr[vi * 3 + 2] * 1024)}`
									);
								}
								v.sort();
								tris.push(v.join(";"));
							}
							tris.sort();
							for (const t of tris)
								for (let ch = 0; ch < t.length; ch++) {
									h ^= t.charCodeAt(ch);
									h = (h * 0x01000193) >>> 0;
								}
							w.__meshHashes.push({ category: name, tris: tris.length, hash: h.toString(16) });
						}
					} catch {
						/* oracle must never break the build */
					}
				}
				[outPos, outIdx, outNrm, outUv].forEach((b) => b.destroy());
				firstSlab = false;
			}
			// RECORDS PATH — phase A: oracle verification of the 8B/triangle record stream
			// ((linear cell, template triangle row) per triangle). Expands on CPU with
			// Math.fround so the arithmetic is bit-identical to the GPU f32 adds, then
			// compares canonical hashes against the vertex-path hashes from THIS run.
			if ((window as any).__gpuRecords) {
				const tr0 = performance.now();
				const maxIdx = desc2.length / 4 - 1;
				const rowToState = new Uint32Array(tplCull.length);
				for (let pi = 1; pi <= maxIdx; pi++) {
					const triStart = desc[pi * 4 + 2];
					for (let r = 0; r < desc2[pi * 4 + 1] / 3; r++) rowToState[triStart + r] = pi;
				}
				zeroCounters();
				await runPass(2, 0, sy, null);
				const recCounts = await readCounters();
				const segR: number[] = [];
				let accR = 0;
				for (let s = 0; s < nSlots; s++) {
					segR.push(accR);
					accR += recCounts[s * 2 + 1];
				}
				device.queue.writeBuffer(
					bufs.co,
					0,
					new Uint32Array([...new Array(nSlots).fill(0), ...segR])
				);
				zeroCounters();
				const outRec = device.createBuffer({
					size: Math.max(accR, 1) * 8,
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
				});
				await runPass(3, 0, sy, [dummyA, dummyB, dummyC, dummyD, outRec]);
				const cntR = await readCounters();
				const recMs = performance.now() - tr0;
				const mode1 = new Map<string, any[]>();
				for (const h2 of ((window as any).__meshHashes ?? []) as any[]) {
					const list = mode1.get(h2.category) ?? [];
					list.push(h2);
					mode1.set(h2.category, list);
				}
				let allOk = true;
				let totalTris = 0,
					totalBytes = 0;
				for (let c = 0; c < nCat; c++) {
					let nTris = 0;
					for (let s = 0; s < catMatCount[c]; s++) nTris += cntR[(slotBase[c] + s) * 2 + 1];
					if (nTris === 0) continue;
					totalTris += nTris;
					totalBytes += nTris * 8;
					const rec = await readRange(outRec, segR[slotBase[c]] * 8, nTris * 2, Uint32Array);
					let h = 0x811c9dc5;
					const tris: string[] = [];
					for (let i = 0; i < nTris; i++) {
						const ci = rec[i * 2],
							row = rec[i * 2 + 1];
						const x = ci % sx,
							y = (ci / (sx * sz)) | 0,
							z = ((ci / sx) | 0) % sz;
						const p = rowToState[row];
						const t = row - desc[p * 4 + 2];
						const idxStart = desc[p * 4 + 1];
						const v: string[] = [];
						for (let k = 0; k < 3; k++) {
							const vi = tplIdx[idxStart + t * 3 + k];
							v.push(
								Math.round(Math.fround(x + tplPos[vi * 3]) * 1024) +
									"," +
									Math.round(Math.fround(y + tplPos[vi * 3 + 1]) * 1024) +
									"," +
									Math.round(Math.fround(z + tplPos[vi * 3 + 2]) * 1024)
							);
						}
						v.sort();
						tris.push(v.join(";"));
					}
					tris.sort();
					for (const t of tris)
						for (let ch = 0; ch < t.length; ch++) {
							h ^= t.charCodeAt(ch);
							h = (h * 0x01000193) >>> 0;
						}
					const refs = mode1.get(catNames[c]) ?? [];
					// single-slab builds: vertex-path hash covers the whole build → hash must match.
					// multi-slab: vertex-path hashes are per-slab (not combinable) → verify via the
					// count-pass totals instead, which are computed independently over the full grid.
					if (refs.length === 1) {
						const ok = refs[0].tris === tris.length && refs[0].hash === (h >>> 0).toString(16);
						if (!ok) allOk = false;
						console.log(
							`[GpuMeshBuilder][records] ${catNames[c]}: ${tris.length} tris ${(h >>> 0).toString(16)} vs vertex-path ${refs[0].tris} ${refs[0].hash} ${ok ? "✓ MATCH" : "✗ MISMATCH"}`
						);
					} else {
						const refTris = refs.reduce((a: number, r: any) => a + r.tris, 0);
						const ok = refTris === tris.length;
						if (!ok) allOk = false;
						console.log(
							`[GpuMeshBuilder][records] ${catNames[c]}: ${tris.length} tris (multi-slab, ${(h >>> 0).toString(16)}) vs vertex-path slabs ${refs.length} totaling ${refTris} ${ok ? "✓ TOTAL MATCH" : "✗ MISMATCH"}`
						);
					}
				}
				outRec.destroy();
				const totalOk = totalTris === Math.round(totI / 3);
				if (!totalOk) allOk = false;
				console.log(
					`[GpuMeshBuilder][records] ${allOk ? "★ ALL MATCH" : "✗ FAILED"} — ${totalTris.toLocaleString()} tris as ${(totalBytes / 1048576).toFixed(1)} MB of records (${recMs.toFixed(0)}ms count+emit+verify; count-pass total ${totalOk ? "exact" : "DIFFERS"})`
				);
			}
		} finally {
			// even on mid-slab failure (device lost, mapAsync reject): free every GPU buffer
			// before the caller's batched fallback runs
			cleanupInputs();
		}

		console.log(
			`[GpuMeshBuilder] count=${tCount.toFixed(1)}ms emit=${tEmitAcc.toFixed(1)}ms ${meshes.length} meshes, ${Math.round(totI / 3).toLocaleString()} tris / ${totV.toLocaleString()} verts (dedup ${((1 - totV / totI) * 100).toFixed(1)}%)`
		);

		return meshes;
	}

	/**
	 * Phase B: build meshes that RENDER DIRECTLY from the 8B/triangle record stream
	 * (WebGL2 gl_VertexID vertex pulling — no vertex data readback at all).
	 * Returns one pulling mesh per non-empty category plus the record stream for
	 * verification. Falls back to plain buildMeshes on any WebGPU failure upstream.
	 */
	async buildRecordMeshes(
		grid: Uint32Array,
		sx: number,
		sy: number,
		sz: number,
		palette: PaletteEntry[],
		materialLookup: (category: string) => THREE.Material[],
		makeDrawingMeshes = true
	): Promise<{ meshes: THREE.Mesh[]; stream: RecordStream | null }> {
		if (palette.length === 0) return { meshes: [], stream: null };
		if (!this.device || !this.recordPipeline) throw new Error("GpuMeshBuilder not initialized");
		const device = this.device;
		const pipeline = this.recordPipeline;
		const t0 = performance.now();
		const {
			catNames,
			catMatCount,
			slotBase,
			nSlots,
			tplPos,
			tplIdx,
			tplCull,
			tplTriMat,
			tplNrm,
			tplUv,
			tplPosW,
			tplNrmW,
			tplUvW,
			quadStart,
			desc,
			desc2,
		} = this.buildTemplateBuffers(palette);
		const mk = (arr: ArrayBufferView, usage: number) => {
			const b = device.createBuffer({
				size: (arr.byteLength + 3) & ~3,
				usage: usage | GPUBufferUsage.COPY_DST,
			});
			device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength);
			return b;
		};
		const bufs = {
			grid: mk(grid, GPUBufferUsage.STORAGE),
			desc: mk(new Uint32Array(desc), GPUBufferUsage.STORAGE),
			desc2: mk(new Uint32Array(desc2), GPUBufferUsage.STORAGE),
			tc: mk(new Uint32Array(tplCull), GPUBufferUsage.STORAGE),
			tm: mk(new Uint32Array(tplTriMat), GPUBufferUsage.STORAGE),
			co: mk(new Uint32Array(2 * nSlots), GPUBufferUsage.STORAGE),
		};
		const dims = mk(
			new Uint32Array([sx, sy, sz, 0, nSlots, 0, 0, 0]),
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		);
		const cntBytes = Math.max(64, nSlots * 2) * 4;
		const counters = device.createBuffer({
			size: cntBytes,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		});
		const countersRead = device.createBuffer({
			size: cntBytes,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		const readCounters = async () => {
			const e = device.createCommandEncoder();
			e.copyBufferToBuffer(counters, 0, countersRead, 0, cntBytes);
			device.queue.submit([e.finish()]);
			await countersRead.mapAsync(GPUMapMode.READ);
			const c = new Uint32Array(countersRead.getMappedRange().slice(0));
			countersRead.unmap();
			return c;
		};
		const outRecDummy = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
		const mkBind = (outRec: GPUBuffer) =>
			device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: bufs.grid } },
					{ binding: 1, resource: { buffer: dims } },
					{ binding: 2, resource: { buffer: bufs.desc } },
					{ binding: 3, resource: { buffer: bufs.desc2 } },
					{ binding: 4, resource: { buffer: bufs.tc } },
					{ binding: 5, resource: { buffer: counters } },
					{ binding: 6, resource: { buffer: bufs.co } },
					{ binding: 7, resource: { buffer: bufs.tm } },
					{ binding: 8, resource: { buffer: outRec } },
				],
			});
		const wx = Math.ceil(sx / 4),
			wz = Math.ceil(sz / 4);
		const dispatchSlab = async (mode: number, outRec: GPUBuffer, y0: number, h: number) => {
			device.queue.writeBuffer(dims, 0, new Uint32Array([sx, sy, sz, mode, nSlots, y0, h, 0]));
			const enc = device.createCommandEncoder();
			const pass = enc.beginComputePass();
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, mkBind(outRec));
			pass.dispatchWorkgroups(wx, Math.ceil(h / 4), wz);
			pass.end();
			device.queue.submit([enc.finish()]);
			await device.queue.onSubmittedWorkDone();
		};
		const zeroCounters = () => device.queue.writeBuffer(counters, 0, new Uint32Array(nSlots * 2));

		try {
			// SPATIAL CHUNKING (Opus perf round 2): emit per Y-slab (16 layers) so each
			// record chunk has a real bounding volume — frustum culling becomes possible
			// and three's opaque sort gives front-to-back (early-Z recovery). Records are
			// tiny, so per-slab count+emit passes are cheap.
			const SLAB = 16;
			const { buildRecordTables, makeRecordMeshes, splitRecordMaterialRuns } =
				await import("./RecordRenderer");
			const perCategory: RecordMaterialRun[] = [];
			for (let y0 = 0; y0 < sy; y0 += SLAB) {
				const h = Math.min(SLAB, sy - y0);
				zeroCounters();
				await dispatchSlab(2, outRecDummy, y0, h);
				const counts = await readCounters();
				const segR: number[] = [];
				let accR = 0;
				for (let s = 0; s < nSlots; s++) {
					segR.push(accR);
					accR += counts[s * 2 + 1];
				}
				if (accR === 0) continue;
				device.queue.writeBuffer(
					bufs.co,
					0,
					new Uint32Array([...new Array(nSlots).fill(0), ...segR])
				);
				zeroCounters();
				const outRec = device.createBuffer({
					size: accR * 8,
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
				});
				await dispatchSlab(3, outRec, y0, h);
				const cnt = await readCounters();
				for (let c = 0; c < catNames.length; c++) {
					let nTris = 0;
					for (let s = 0; s < catMatCount[c]; s++) nTris += cnt[(slotBase[c] + s) * 2 + 1];
					if (nTris === 0) continue;
					const tmp = device.createBuffer({
						size: nTris * 8,
						usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
					});
					const e = device.createCommandEncoder();
					e.copyBufferToBuffer(outRec, segR[slotBase[c]] * 8, tmp, 0, nTris * 8);
					device.queue.submit([e.finish()]);
					await tmp.mapAsync(GPUMapMode.READ);
					const rec = new Uint32Array(tmp.getMappedRange().slice(0));
					tmp.unmap();
					tmp.destroy();
					const counts = Array.from(
						{ length: catMatCount[c] },
						(_, s) => cnt[(slotBase[c] + s) * 2 + 1]
					);
					perCategory.push(
						...splitRecordMaterialRuns(rec, counts, materialLookup(catNames[c]), catNames[c], y0, h)
					);
				}
				outRec.destroy();
			}
			const tables = buildRecordTables(
				tplPos,
				tplNrm,
				tplUv,
				tplIdx,
				desc,
				desc2,
				desc2.length / 4 - 1,
				tplPosW,
				tplNrmW,
				tplUvW
			);

			// quad merge via the TEMPLATE-PRECOMPUTED quadStart map (same-geometry pairs only —
			// the runtime predicate's cross-element pairings were the corruption source)
			const quadStartLookup = (rowA: number, _rowB: number) => {
				const corners = quadStart.get(rowA);
				return corners ? { quad: true, corners } : { quad: false, corners: null };
			};
			const stream = { perCategory, tables, sx, sy, sz };
			const meshes = makeDrawingMeshes ? makeRecordMeshes(stream, null, quadStartLookup) : [];
			console.log(
				`[GpuMeshBuilder][pull] ${perCategory.reduce((a, p) => a + p.tris, 0).toLocaleString()} tris → ${meshes.length} pulling meshes in ${(performance.now() - t0).toFixed(0)}ms (readback ${(perCategory.reduce((a, p) => a + p.tris * 8, 0) / 1048576).toFixed(1)}MB)`
			);
			return { meshes, stream };
		} finally {
			[
				outRecDummy,
				bufs.grid,
				bufs.desc,
				bufs.desc2,
				bufs.tc,
				bufs.tm,
				bufs.co,
				dims,
				counters,
				countersRead,
			].forEach((b) => b.destroy());
		}
	}
}
