var Ee = Object.defineProperty;
var ze = (O, a, o) => a in O ? Ee(O, a, { enumerable: !0, configurable: !0, writable: !0, value: o }) : O[a] = o;
var Me = (O, a, o) => (ze(O, typeof a != "symbol" ? a + "" : a, o), o);
import * as re from "three";
function De(O, a, o = !1) {
  var _, $, E;
  const u = (((_ = O.indices) == null ? void 0 : _[a]) ?? a) * 3;
  if (!(($ = O.normals) != null && $.length))
    return -1;
  const l = o ? (D) => Math.sign(D) * Math.round(Math.abs(D)) : Math.round, R = l(O.normals[u]), q = l(O.normals[u + 1]), e = l(O.normals[u + 2]);
  if (Math.abs(R) + Math.abs(q) + Math.abs(e) !== 1)
    return -1;
  const t = R !== 0 ? 0 : q !== 0 ? 1 : 2, y = t === 0 ? R : t === 1 ? q : e, P = O.positions[u + t], U = 0.01;
  if (o) {
    if (Math.abs(P - y * 0.5) >= U && Math.abs(P - (y > 0 ? 1 : 0)) >= U)
      return -1;
  } else
    for (let D = 0; D < 3; D++) {
      const se = (((E = O.indices) == null ? void 0 : E[a + D]) ?? a + D) * 3;
      if (Math.abs(O.positions[se + t] - y * 0.5) >= U)
        return -1;
      for (let W = 0; W < 3; W++)
        if (W !== t && Math.abs(O.positions[se + W]) > 0.5 + U)
          return -1;
    }
  return t * 2 + (y < 0 ? 1 : 0);
}
const Oe = (
  /* wgsl */
  `
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
`
), ke = (
  /* wgsl */
  `
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
${Oe}

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
`
), Ie = (
  /* wgsl */
  `
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

${Oe}

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
  // (linear cell index, globalThis template-triangle row). Vertices/UVs/normals are expanded
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
`
);
class $e {
  constructor() {
    Me(this, "device", null);
    Me(this, "pipeline", null);
    Me(this, "recordPipeline", null);
    Me(this, "generation", 0);
    Me(this, "available", !1);
  }
  /** Each schematic owns its compute device; release it when the schematic is removed. */
  dispose() {
    var a;
    this.generation++, this.available = !1, this.pipeline = null, this.recordPipeline = null, (a = this.device) == null || a.destroy(), this.device = null;
  }
  async init() {
    if (this.device && this.available)
      return !0;
    const a = this.generation;
    if (typeof navigator < "u" && navigator.gpu)
      try {
        const o = await navigator.gpu.requestAdapter();
        if (!o || a !== this.generation)
          return !1;
        const u = o.limits.maxStorageBuffersPerShaderStage;
        if (u < 8)
          return !1;
        const l = await o.requestDevice({
          requiredLimits: {
            // The record path runs on the minimum eight-buffer WebGPU limit.
            // Devices with sixteen buffers retain the direct vertex-output path.
            maxStorageBuffersPerShaderStage: u >= 16 ? 16 : 8,
            // large builds need big output buffers (3.1M blocks -> ~360MB positions)
            maxStorageBufferBindingSize: o.limits.maxStorageBufferBindingSize,
            maxBufferSize: o.limits.maxBufferSize
          }
        });
        if (a !== this.generation)
          return l.destroy(), !1;
        this.device = l, l.lost.then((e) => {
          this.device === l && (this.available = !1, this.device = null, this.pipeline = null, this.recordPipeline = null, console.warn("[GpuMeshBuilder] device lost:", e == null ? void 0 : e.reason, e == null ? void 0 : e.message));
        });
        const R = async (e) => {
          const t = l.createShaderModule({ code: e }), y = await t.getCompilationInfo();
          for (const P of y.messages)
            (P.type === "error" || P.type === "warning") && console.warn(`[GpuMeshBuilder][wgsl:${P.type}] line ${P.lineNum}: ${P.message}`);
          if (y.messages.some((P) => P.type === "error"))
            throw new Error("Invalid GPU mesher shader");
          return l.createComputePipelineAsync({
            layout: "auto",
            compute: { module: t, entryPoint: "main" }
          });
        }, q = await R(ke);
        if (a !== this.generation || this.device !== l)
          return !1;
        if (this.recordPipeline = q, u >= 16)
          try {
            const e = await R(Ie);
            if (a !== this.generation || this.device !== l)
              return !1;
            this.pipeline = e;
          } catch (e) {
            console.warn(
              "[GpuMeshBuilder] Direct vertex pipeline unavailable; expanding GPU records instead",
              e
            );
          }
        return a !== this.generation || this.device !== l ? !1 : (this.available = !0, !0);
      } catch (o) {
        return a === this.generation && this.dispose(), console.warn("[GpuMeshBuilder] WebGPU init failed, falling back:", o), !1;
      }
    return !1;
  }
  /** Flatten palette descriptors + templates into GPU buffers (reusable across meshes). */
  buildTemplateBuffers(a) {
    const o = [...new Set(a.map((v) => v.category))].sort(), u = new Map(o.map((v, m) => [v, m])), l = o.map(() => 1);
    for (const v of a) {
      const m = u.get(v.category);
      for (const c of v.geometries)
        l[m] = Math.max(l[m], (c.materialIndex || 0) + 1);
    }
    const R = [];
    let q = 0;
    for (let v = 0; v < o.length; v++)
      R.push(q), q += l[v];
    const e = [], t = [], y = [], P = [], U = [], _ = [], $ = [], E = [], D = [], se = /* @__PURE__ */ new Map(), W = [[0, 0, 0, 0]], be = [[0, 0, 0, 0]], ge = Math.max(...a.map((v) => v.index)), ve = new Map(a.map((v) => [v.index, v]));
    for (let v = 1; v <= ge; v++) {
      const m = ve.get(v);
      if (!m) {
        W.push([0, 0, 0, 0]), be.push([0, 0, 0, 0]);
        continue;
      }
      const c = t.length, Be = y.length, ce = e.length / 3;
      for (const S of m.geometries) {
        const A = S.materialIndex || 0, Ue = e.length / 3, K = t.length, pe = y.length, L = S.positions, fe = S.normals || [], J = S.indices ?? Array.from({ length: L.length / 3 }, (r, d) => d);
        for (let r = 0; r < L.length; r++)
          e.push(L[r]);
        const me = S.uvs || [];
        for (let r = 0; r < fe.length; r++)
          U.push(fe[r]);
        for (let r = 0; r < me.length; r++)
          _.push(me[r]);
        const Q = S.anim, Ae = L.length / 3;
        for (let r = 0; r < Ae; r++)
          $.push(Q ? Q.frames : 0), E.push(Q ? Q.step : 0), D.push(Q ? Q.vTop : 0);
        for (; U.length < e.length; )
          U.push(0);
        for (; _.length < e.length / 3 * 2; )
          _.push(0);
        for (let r = 0; r < J.length; r++)
          t.push(Ue + J[r]);
        for (let r = 0; r + 2 < J.length; r += 3) {
          const d = De(S, r);
          y.push(d < 0 ? 255 : d), P.push(A);
        }
        const we = Math.floor(J.length / 3);
        for (let r = 0; r + 1 < we; r += 2) {
          const d = pe + r, C = t[K + r * 3], H = t[K + r * 3 + 1], Y = t[K + r * 3 + 2], F = t[K + r * 3 + 3], k = t[K + r * 3 + 4], he = t[K + r * 3 + 5], ie = [C, H, Y].filter((i) => [F, k, he].includes(i));
          if (ie.length !== 2)
            continue;
          const I = [F, k, he].find((i) => !ie.includes(i)), h = [C, H, Y].find((i) => !ie.includes(i));
          if (I === void 0 || h === void 0 || I === C || I === H || I === Y)
            continue;
          const [x, z] = ie, Z = (i, n, f, g) => i[0] === n && i[1] === f && i[2] === g || i[0] === f && i[1] === g && i[2] === n || i[0] === g && i[1] === n && i[2] === f, s = [C, H, Y], b = [F, k, he];
          Z(s, x, h, z) && Z(b, x, z, I) ? se.set(d, [x, h, z, I]) : Z(s, z, h, x) && Z(b, z, x, I) && se.set(d, [z, h, x, I]);
        }
      }
      const ne = m.fluid === "water" ? 64 : m.fluid === "lava" ? 128 : 0;
      W.push([ce, c, Be, m.occlusionFlags & 63 | ne]), be.push([
        e.length / 3 - ce,
        t.length - c,
        u.get(m.category),
        R[u.get(m.category)]
      ]);
    }
    return {
      catNames: o,
      catMatCount: l,
      slotBase: R,
      nSlots: q,
      tplPos: e,
      tplIdx: t,
      tplCull: y,
      tplTriMat: P,
      tplNrm: U,
      tplUv: _,
      tplPosW: E,
      tplNrmW: D,
      tplUvW: $,
      quadStart: se,
      desc: W.flat(),
      desc2: be.flat()
    };
  }
  /**
   * Build meshes for a full-block grid. `grid` is palette-index-per-cell in
   * (y*sz+z)*sx+x order, 0 = air. Returns BufferGeometry per category with the
   * same {category, positions, indices} shape the batched wasm path produces.
   */
  async buildMeshes(a, o, u, l, R, q) {
    var Z;
    if (R.length === 0)
      return [];
    if (!this.device || !this.recordPipeline)
      throw new Error("GpuMeshBuilder not initialized");
    if (!this.pipeline) {
      const { stream: s } = await this.buildRecordMeshes(
        a,
        o,
        u,
        l,
        R,
        q,
        !1
      ), { materializeRecordMeshes: b } = await import("./index-95fd77aa.mjs").then((i) => i.y);
      return s ? b(s) : [];
    }
    const e = this.device, t = performance.now(), {
      catNames: y,
      catMatCount: P,
      slotBase: U,
      nSlots: _,
      tplPos: $,
      tplIdx: E,
      tplCull: D,
      tplTriMat: se,
      tplNrm: W,
      tplUv: be,
      desc: ge,
      desc2: ve
    } = this.buildTemplateBuffers(R), v = y.length, m = (s, b) => {
      const i = e.createBuffer({
        size: s.byteLength + 3 & -4,
        usage: b | GPUBufferUsage.COPY_DST
      });
      return e.queue.writeBuffer(i, 0, s.buffer, s.byteOffset, s.byteLength), i;
    }, c = {
      grid: m(a, GPUBufferUsage.STORAGE),
      desc: m(new Uint32Array(ge), GPUBufferUsage.STORAGE),
      desc2: m(new Uint32Array(ve), GPUBufferUsage.STORAGE),
      tp: m(new Float32Array($), GPUBufferUsage.STORAGE),
      ti: m(new Uint32Array(E), GPUBufferUsage.STORAGE),
      tc: m(new Uint32Array(D), GPUBufferUsage.STORAGE),
      tm: m(new Uint32Array(se), GPUBufferUsage.STORAGE),
      tn: m(new Float32Array(W), GPUBufferUsage.STORAGE),
      tu: m(new Float32Array(be), GPUBufferUsage.STORAGE),
      co: m(new Uint32Array(2 * _), GPUBufferUsage.STORAGE)
    }, Be = m(
      new Uint32Array([o, u, l, 0, _, 0, 0, 0]),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    ), ce = Math.max(64, _ * 2) * 4, ne = e.createBuffer({
      size: ce,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    }), S = e.createBuffer({
      size: ce,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    }), A = async () => {
      const s = e.createCommandEncoder();
      s.copyBufferToBuffer(ne, 0, S, 0, ce), e.queue.submit([s.finish()]), await S.mapAsync(GPUMapMode.READ);
      const b = new Uint32Array(S.getMappedRange().slice(0));
      return S.unmap(), b;
    }, Ue = (s, b, i, n, f) => e.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: c.grid } },
        { binding: 1, resource: { buffer: Be } },
        { binding: 2, resource: { buffer: c.desc } },
        { binding: 3, resource: { buffer: c.desc2 } },
        { binding: 4, resource: { buffer: c.tp } },
        { binding: 5, resource: { buffer: c.ti } },
        { binding: 6, resource: { buffer: c.tc } },
        { binding: 7, resource: { buffer: s } },
        { binding: 8, resource: { buffer: b } },
        { binding: 9, resource: { buffer: ne } },
        { binding: 10, resource: { buffer: c.co } },
        { binding: 11, resource: { buffer: c.tm } },
        { binding: 12, resource: { buffer: f } },
        { binding: 13, resource: { buffer: c.tn } },
        { binding: 14, resource: { buffer: c.tu } },
        { binding: 15, resource: { buffer: i } },
        { binding: 16, resource: { buffer: n } }
      ]
    }), K = Math.ceil(o / 4), pe = Math.ceil(l / 4), L = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), fe = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), J = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), me = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), Q = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), Ae = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), we = () => [
      L,
      fe,
      J,
      me,
      Q,
      Ae,
      c.grid,
      c.desc,
      c.desc2,
      c.tp,
      c.ti,
      c.tc,
      c.tm,
      c.tn,
      c.tu,
      c.co,
      Be,
      ne,
      S
    ].forEach((s) => s.destroy()), r = async (s, b, i, n) => {
      e.queue.writeBuffer(Be, 0, new Uint32Array([o, u, l, s, _, b, i, 0]));
      const f = e.createCommandEncoder(), g = f.beginComputePass();
      g.setPipeline(this.pipeline), g.setBindGroup(
        0,
        Ue(
          n ? n[0] : L,
          n ? n[1] : fe,
          n ? n[2] : J,
          n ? n[3] : me,
          n ? n[4] : Q
        )
      ), g.dispatchWorkgroups(K, Math.ceil(i / 4), pe), g.end(), e.queue.submit([f.finish()]), await e.queue.onSubmittedWorkDone();
    }, d = () => e.queue.writeBuffer(ne, 0, new Uint32Array(_ * 2));
    d(), await r(0, 0, u, null);
    const C = await A(), H = performance.now() - t;
    let Y = 0, F = 0;
    for (let s = 0; s < _; s++)
      Y += C[s * 2], F += C[s * 2 + 1];
    const k = Y * 32 + F * 8;
    if (k > 4 * 1024 ** 3)
      throw we(), new Error(
        `[GpuMeshBuilder] output ${Math.round(k / 1048576)}MB exceeds the 4GB budget — batched fallback`
      );
    const he = 384 * 1024 * 1024, ie = Math.min(
      u,
      Math.max(8, k <= he ? u : Math.floor(u * he / k))
    ), I = [], h = async (s, b, i, n) => {
      const f = e.createBuffer({
        size: i * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      }), g = e.createCommandEncoder();
      g.copyBufferToBuffer(s, b, f, 0, i * 4), e.queue.submit([g.finish()]), await f.mapAsync(GPUMapMode.READ);
      const V = new n(f.getMappedRange().slice(0));
      return f.unmap(), f.destroy(), V;
    };
    let x = 0, z = !0;
    try {
      for (let s = 0; s < u; s += ie) {
        const b = Math.min(ie, u - s);
        let i = C;
        z && b === u || (d(), await r(0, s, b, null), i = await A());
        const n = [], f = [];
        let g = 0, V = 0;
        for (let G = 0; G < _; G++)
          n.push(g), g += i[G * 2], f.push(V), V += i[G * 2 + 1];
        if (e.queue.writeBuffer(c.co, 0, new Uint32Array([...n, ...f])), d(), z && window.__gpuOracle && (window.__gpuDebug = {
          nSlots: _,
          slotBase: U,
          catMatCount: P,
          counts: Array.from(C),
          segV: n,
          segI: f
        }), V === 0) {
          z = !1;
          continue;
        }
        const ye = e.createBuffer({
          size: g * 3 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), _e = e.createBuffer({
          size: V * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), X = e.createBuffer({
          size: g * 3 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), oe = e.createBuffer({
          size: g * 2 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), Re = performance.now();
        await r(1, s, b, [ye, _e, X, oe, Ae]), x += performance.now() - Re;
        const Ge = await A();
        for (let G = 0; G < v; G++) {
          const p = y[G];
          let T = 0, ee = 0;
          for (let B = 0; B < P[G]; B++)
            T += Ge[(U[G] + B) * 2 + 1], ee += Ge[(U[G] + B) * 2];
          if (T === 0)
            continue;
          const ae = n[U[G]], ue = f[U[G]], N = await h(ye, ae * 3 * 4, ee * 3, Float32Array), w = await h(_e, ue * 4, T, Uint32Array), j = await h(X, ae * 3 * 4, ee * 3, Float32Array), Pe = await h(oe, ae * 2 * 4, ee * 2, Float32Array), M = new re.BufferGeometry();
          M.setAttribute("position", new re.BufferAttribute(N, 3)), M.setAttribute("normal", new re.BufferAttribute(j, 3)), M.setAttribute("uv", new re.BufferAttribute(Pe, 2)), M.setIndex(
            T > 65535 ? new re.BufferAttribute(w, 1) : new re.BufferAttribute(Uint16Array.from(w), 1)
          );
          for (const B of [
            M.attributes.position,
            M.attributes.normal,
            M.attributes.uv,
            M.index
          ])
            B.onUpload(() => {
              B.array = null;
            });
          const Fe = q(p);
          for (let B = 0; B < P[G]; B++) {
            const de = Ge[(U[G] + B) * 2 + 1];
            de > 0 && M.addGroup(f[U[G] + B] - ue, de, B);
          }
          M.boundingBox = new re.Box3(
            new re.Vector3(-0.51, s - 0.51, -0.51),
            new re.Vector3(o - 0.49, s + b + 0.01, l - 0.49)
          ), M.boundingSphere = M.boundingBox.getBoundingSphere(new re.Sphere());
          const Ce = new re.Mesh(M, Fe);
          if (window.__gpuOracle) {
            const B = window;
            (B.__gpuDump = B.__gpuDump || {})[p] = {
              posArr: N,
              idxArr: w,
              groups: ((Z = M.groups) == null ? void 0 : Z.length) ?? 0
            };
          }
          Ce.userData.category = p, Ce.userData.gpuBuilt = !0, I.push(Ce);
          try {
            const B = window;
            if (B.__meshHashes = B.__meshHashes || [], B.__gpuOracle) {
              let de = 2166136261;
              const xe = [];
              for (let le = 0; le + 2 < T; le += 3) {
                const te = [];
                for (let Se = 0; Se < 3; Se++) {
                  const Te = w[le + Se];
                  te.push(
                    `${Math.round(N[Te * 3] * 1024)},${Math.round(N[Te * 3 + 1] * 1024)},${Math.round(N[Te * 3 + 2] * 1024)}`
                  );
                }
                te.sort(), xe.push(te.join(";"));
              }
              xe.sort();
              for (const le of xe)
                for (let te = 0; te < le.length; te++)
                  de ^= le.charCodeAt(te), de = de * 16777619 >>> 0;
              B.__meshHashes.push({ category: p, tris: xe.length, hash: de.toString(16) });
            }
          } catch {
          }
        }
        [ye, _e, X, oe].forEach((G) => G.destroy()), z = !1;
      }
      if (window.__gpuRecords) {
        const s = performance.now(), b = ve.length / 4 - 1, i = new Uint32Array(D.length);
        for (let p = 1; p <= b; p++) {
          const T = ge[p * 4 + 2];
          for (let ee = 0; ee < ve[p * 4 + 1] / 3; ee++)
            i[T + ee] = p;
        }
        d(), await r(2, 0, u, null);
        const n = await A(), f = [];
        let g = 0;
        for (let p = 0; p < _; p++)
          f.push(g), g += n[p * 2 + 1];
        e.queue.writeBuffer(
          c.co,
          0,
          new Uint32Array([...new Array(_).fill(0), ...f])
        ), d();
        const V = e.createBuffer({
          size: Math.max(g, 1) * 8,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        await r(3, 0, u, [L, fe, J, me, V]);
        const ye = await A(), _e = performance.now() - s, X = /* @__PURE__ */ new Map();
        for (const p of window.__meshHashes ?? []) {
          const T = X.get(p.category) ?? [];
          T.push(p), X.set(p.category, T);
        }
        let oe = !0, Re = 0, Ge = 0;
        for (let p = 0; p < v; p++) {
          let T = 0;
          for (let w = 0; w < P[p]; w++)
            T += ye[(U[p] + w) * 2 + 1];
          if (T === 0)
            continue;
          Re += T, Ge += T * 8;
          const ee = await h(V, f[U[p]] * 8, T * 2, Uint32Array);
          let ae = 2166136261;
          const ue = [];
          for (let w = 0; w < T; w++) {
            const j = ee[w * 2], Pe = ee[w * 2 + 1], M = j % o, Fe = j / (o * l) | 0, Ce = (j / o | 0) % l, B = i[Pe], de = Pe - ge[B * 4 + 2], xe = ge[B * 4 + 1], le = [];
            for (let te = 0; te < 3; te++) {
              const Se = E[xe + de * 3 + te];
              le.push(
                Math.round(Math.fround(M + $[Se * 3]) * 1024) + "," + Math.round(Math.fround(Fe + $[Se * 3 + 1]) * 1024) + "," + Math.round(Math.fround(Ce + $[Se * 3 + 2]) * 1024)
              );
            }
            le.sort(), ue.push(le.join(";"));
          }
          ue.sort();
          for (const w of ue)
            for (let j = 0; j < w.length; j++)
              ae ^= w.charCodeAt(j), ae = ae * 16777619 >>> 0;
          const N = X.get(y[p]) ?? [];
          if (N.length === 1) {
            const w = N[0].tris === ue.length && N[0].hash === (ae >>> 0).toString(16);
            w || (oe = !1), console.log(
              `[GpuMeshBuilder][records] ${y[p]}: ${ue.length} tris ${(ae >>> 0).toString(16)} vs vertex-path ${N[0].tris} ${N[0].hash} ${w ? "✓ MATCH" : "✗ MISMATCH"}`
            );
          } else {
            const w = N.reduce((Pe, M) => Pe + M.tris, 0), j = w === ue.length;
            j || (oe = !1), console.log(
              `[GpuMeshBuilder][records] ${y[p]}: ${ue.length} tris (multi-slab, ${(ae >>> 0).toString(16)}) vs vertex-path slabs ${N.length} totaling ${w} ${j ? "✓ TOTAL MATCH" : "✗ MISMATCH"}`
            );
          }
        }
        V.destroy();
        const G = Re === Math.round(F / 3);
        G || (oe = !1), console.log(
          `[GpuMeshBuilder][records] ${oe ? "★ ALL MATCH" : "✗ FAILED"} — ${Re.toLocaleString()} tris as ${(Ge / 1048576).toFixed(1)} MB of records (${_e.toFixed(0)}ms count+emit+verify; count-pass total ${G ? "exact" : "DIFFERS"})`
        );
      }
    } finally {
      we();
    }
    return console.log(
      `[GpuMeshBuilder] count=${H.toFixed(1)}ms emit=${x.toFixed(1)}ms ${I.length} meshes, ${Math.round(F / 3).toLocaleString()} tris / ${Y.toLocaleString()} verts (dedup ${((1 - Y / F) * 100).toFixed(1)}%)`
    ), I;
  }
  /**
   * Phase B: build meshes that RENDER DIRECTLY from the 8B/triangle record stream
   * (WebGL2 gl_VertexID vertex pulling — no vertex data readback at all).
   * Returns one pulling mesh per non-empty category plus the record stream for
   * verification. Falls back to plain buildMeshes on any WebGPU failure upstream.
   */
  async buildRecordMeshes(a, o, u, l, R, q, e = !0) {
    if (R.length === 0)
      return { meshes: [], stream: null };
    if (!this.device || !this.recordPipeline)
      throw new Error("GpuMeshBuilder not initialized");
    const t = this.device, y = this.recordPipeline, P = performance.now(), {
      catNames: U,
      catMatCount: _,
      slotBase: $,
      nSlots: E,
      tplPos: D,
      tplIdx: se,
      tplCull: W,
      tplTriMat: be,
      tplNrm: ge,
      tplUv: ve,
      tplPosW: v,
      tplNrmW: m,
      tplUvW: c,
      quadStart: Be,
      desc: ce,
      desc2: ne
    } = this.buildTemplateBuffers(R), S = (d, C) => {
      const H = t.createBuffer({
        size: d.byteLength + 3 & -4,
        usage: C | GPUBufferUsage.COPY_DST
      });
      return t.queue.writeBuffer(H, 0, d.buffer, d.byteOffset, d.byteLength), H;
    }, A = {
      grid: S(a, GPUBufferUsage.STORAGE),
      desc: S(new Uint32Array(ce), GPUBufferUsage.STORAGE),
      desc2: S(new Uint32Array(ne), GPUBufferUsage.STORAGE),
      tc: S(new Uint32Array(W), GPUBufferUsage.STORAGE),
      tm: S(new Uint32Array(be), GPUBufferUsage.STORAGE),
      co: S(new Uint32Array(2 * E), GPUBufferUsage.STORAGE)
    }, Ue = S(
      new Uint32Array([o, u, l, 0, E, 0, 0, 0]),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    ), K = Math.max(64, E * 2) * 4, pe = t.createBuffer({
      size: K,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    }), L = t.createBuffer({
      size: K,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    }), fe = async () => {
      const d = t.createCommandEncoder();
      d.copyBufferToBuffer(pe, 0, L, 0, K), t.queue.submit([d.finish()]), await L.mapAsync(GPUMapMode.READ);
      const C = new Uint32Array(L.getMappedRange().slice(0));
      return L.unmap(), C;
    }, J = t.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }), me = (d) => t.createBindGroup({
      layout: y.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: A.grid } },
        { binding: 1, resource: { buffer: Ue } },
        { binding: 2, resource: { buffer: A.desc } },
        { binding: 3, resource: { buffer: A.desc2 } },
        { binding: 4, resource: { buffer: A.tc } },
        { binding: 5, resource: { buffer: pe } },
        { binding: 6, resource: { buffer: A.co } },
        { binding: 7, resource: { buffer: A.tm } },
        { binding: 8, resource: { buffer: d } }
      ]
    }), Q = Math.ceil(o / 4), Ae = Math.ceil(l / 4), we = async (d, C, H, Y) => {
      t.queue.writeBuffer(Ue, 0, new Uint32Array([o, u, l, d, E, H, Y, 0]));
      const F = t.createCommandEncoder(), k = F.beginComputePass();
      k.setPipeline(y), k.setBindGroup(0, me(C)), k.dispatchWorkgroups(Q, Math.ceil(Y / 4), Ae), k.end(), t.queue.submit([F.finish()]), await t.queue.onSubmittedWorkDone();
    }, r = () => t.queue.writeBuffer(pe, 0, new Uint32Array(E * 2));
    try {
      const { buildRecordTables: C, makeRecordMeshes: H, splitRecordMaterialRuns: Y } = await import("./index-95fd77aa.mjs").then((h) => h.y), F = [];
      for (let h = 0; h < u; h += 16) {
        const x = Math.min(16, u - h);
        r(), await we(2, J, h, x);
        const z = await fe(), Z = [];
        let s = 0;
        for (let n = 0; n < E; n++)
          Z.push(s), s += z[n * 2 + 1];
        if (s === 0)
          continue;
        t.queue.writeBuffer(
          A.co,
          0,
          new Uint32Array([...new Array(E).fill(0), ...Z])
        ), r();
        const b = t.createBuffer({
          size: s * 8,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        await we(3, b, h, x);
        const i = await fe();
        for (let n = 0; n < U.length; n++) {
          let f = 0;
          for (let X = 0; X < _[n]; X++)
            f += i[($[n] + X) * 2 + 1];
          if (f === 0)
            continue;
          const g = t.createBuffer({
            size: f * 8,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
          }), V = t.createCommandEncoder();
          V.copyBufferToBuffer(b, Z[$[n]] * 8, g, 0, f * 8), t.queue.submit([V.finish()]), await g.mapAsync(GPUMapMode.READ);
          const ye = new Uint32Array(g.getMappedRange().slice(0));
          g.unmap(), g.destroy();
          const _e = Array.from(
            { length: _[n] },
            (X, oe) => i[($[n] + oe) * 2 + 1]
          );
          F.push(
            ...Y(ye, _e, q(U[n]), U[n], h, x)
          );
        }
        b.destroy();
      }
      const k = C(
        D,
        ge,
        ve,
        se,
        ce,
        ne,
        ne.length / 4 - 1,
        v,
        m,
        c
      ), he = (h, x) => {
        const z = Be.get(h);
        return z ? { quad: !0, corners: z } : { quad: !1, corners: null };
      }, ie = { perCategory: F, tables: k, sx: o, sy: u, sz: l }, I = e ? H(ie, null, he) : [];
      return console.log(
        `[GpuMeshBuilder][pull] ${F.reduce((h, x) => h + x.tris, 0).toLocaleString()} tris → ${I.length} pulling meshes in ${(performance.now() - P).toFixed(0)}ms (readback ${(F.reduce((h, x) => h + x.tris * 8, 0) / 1048576).toFixed(1)}MB)`
      ), { meshes: I, stream: ie };
    } finally {
      [
        J,
        A.grid,
        A.desc,
        A.desc2,
        A.tc,
        A.tm,
        A.co,
        Ue,
        pe,
        L
      ].forEach((d) => d.destroy());
    }
  }
}
export {
  $e as GpuMeshBuilder
};
