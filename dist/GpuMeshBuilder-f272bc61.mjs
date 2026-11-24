var Ee = Object.defineProperty;
var ze = (ie, g, o) => g in ie ? Ee(ie, g, { enumerable: !0, configurable: !0, writable: !0, value: o }) : ie[g] = o;
var Te = (ie, g, o) => (ze(ie, typeof g != "symbol" ? g + "" : g, o), o);
import * as se from "three";
const De = (
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

const DIRS = array<vec3<i32>, 6>(
  vec3<i32>(1, 0, 0), vec3<i32>(-1, 0, 0),
  vec3<i32>(0, 1, 0), vec3<i32>(0, -1, 0),
  vec3<i32>(0, 0, 1), vec3<i32>(0, 0, -1),
);

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
        var culled = false;
        let nx = vec3<i32>(cell) + DIRS[s];
        if (nx.x >= 0 && nx.y >= 0 && nx.z >= 0 && nx.x < i32(sx) && nx.y < i32(sy) && nx.z < i32(sz)) {
          let nu = vec3<u32>(nx);
          let nv = grid[(nu.y * sz + nu.z) * sx + nu.x];
          if (nv != 0u) {
            if (desc2[nv].z == category && (desc[nv].w & (1u << s)) != 0u) { culled = true; }
          }
        }
        nbKnown[s] = true; nbCulled[s] = culled;
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
), W = 0.01, ke = (ie, g, o) => ie === 1 ? 0 : ie === -1 ? 1 : g === 1 ? 2 : g === -1 ? 3 : o === 1 ? 4 : o === -1 ? 5 : 255;
class qe {
  constructor() {
    Te(this, "device", null);
    Te(this, "pipeline", null);
    Te(this, "module", null);
    Te(this, "available", !1);
  }
  async init() {
    if (this.device)
      return !0;
    if (typeof navigator < "u" && navigator.gpu)
      try {
        const g = await navigator.gpu.requestAdapter();
        if (!g)
          return !1;
        const o = await g.requestDevice({
          requiredLimits: {
            // the shader binds 16 storage buffers (0, 2..16). Request EXACTLY that:
            // if the adapter can't provide it, requestDevice rejects and the caller
            // falls back to batched — requesting the adapter's own limit instead
            // would succeed and then silently dispatch nothing (invalid pipeline)
            maxStorageBuffersPerShaderStage: 16,
            // adapter max here; bindings 0,2..16 fit exactly
            // large builds need big output buffers (3.1M blocks -> ~360MB positions)
            maxStorageBufferBindingSize: g.limits.maxStorageBufferBindingSize,
            maxBufferSize: g.limits.maxBufferSize
          }
        });
        this.device = o, this.module = o.createShaderModule({ code: De });
        const b = await this.module.getCompilationInfo();
        for (const u of b.messages)
          (u.type === "error" || u.type === "warning") && console.warn(`[GpuMeshBuilder][wgsl:${u.type}] line ${u.lineNum}: ${u.message}`);
        return o.lost.then(
          (u) => console.warn("[GpuMeshBuilder] device lost:", u == null ? void 0 : u.reason, u == null ? void 0 : u.message)
        ), this.pipeline = o.createComputePipeline({
          layout: "auto",
          compute: { module: this.module, entryPoint: "main" }
        }), this.available = !0, !0;
      } catch (g) {
        return console.warn("[GpuMeshBuilder] WebGPU init failed, falling back:", g), !1;
      }
    return !1;
  }
  /** Flatten palette descriptors + templates into GPU buffers (reusable across meshes). */
  buildTemplateBuffers(g) {
    const o = [...new Set(g.map((B) => B.category))].sort(), b = new Map(o.map((B, U) => [B, U])), u = o.map(() => 1);
    for (const B of g) {
      const U = b.get(B.category);
      for (const a of B.geometries)
        u[U] = Math.max(u[U], (a.materialIndex || 0) + 1);
    }
    const ce = [];
    let we = 0;
    for (let B = 0; B < o.length; B++)
      ce.push(we), we += u[B];
    const e = [], z = [], D = [], le = [], T = [], w = [], ne = [], pe = [], me = [], ye = /* @__PURE__ */ new Map(), he = [[0, 0, 0, 0]], be = [[0, 0, 0, 0]], Be = Math.max(...g.map((B) => B.index)), _e = new Map(g.map((B) => [B.index, B]));
    for (let B = 1; B <= Be; B++) {
      const U = _e.get(B);
      if (!U) {
        he.push([0, 0, 0, 0]), be.push([0, 0, 0, 0]);
        continue;
      }
      const a = z.length, K = D.length, P = e.length / 3;
      for (const n of U.geometries) {
        const X = n.materialIndex || 0, j = e.length / 3, q = z.length, fe = D.length, J = n.positions, F = n.normals || [], Q = n.indices;
        for (let r = 0; r < J.length; r++)
          e.push(J[r]);
        const Ue = n.uvs || [];
        for (let r = 0; r < F.length; r++)
          T.push(F[r]);
        for (let r = 0; r < Ue.length; r++)
          w.push(Ue[r]);
        const Y = n.anim, Ae = J.length / 3;
        for (let r = 0; r < Ae; r++)
          ne.push(Y ? Y.frames : 0), pe.push(Y ? Y.step : 0), me.push(Y ? Y.vTop : 0);
        for (; T.length < e.length; )
          T.push(0);
        for (; w.length < e.length / 3 * 2; )
          w.push(0);
        for (let r = 0; r < Q.length; r++)
          z.push(j + Q[r]);
        for (let r = 0; r + 2 < Q.length; r += 3) {
          const G = Q[r];
          let c = 255;
          if (F.length > G * 3 + 2) {
            const p = Math.round(F[G * 3]), x = Math.round(F[G * 3 + 1]), M = Math.round(F[G * 3 + 2]);
            if (Math.abs(p) + Math.abs(x) + Math.abs(M) === 1) {
              const S = J[G * 3], y = J[G * 3 + 1], k = J[G * 3 + 2];
              (p === 1 && (Math.abs(S - 1) < W || Math.abs(S - 0.5) < W) || p === -1 && (Math.abs(S) < W || Math.abs(S + 0.5) < W) || x === 1 && (Math.abs(y - 1) < W || Math.abs(y - 0.5) < W) || x === -1 && (Math.abs(y) < W || Math.abs(y + 0.5) < W) || M === 1 && (Math.abs(k - 1) < W || Math.abs(k - 0.5) < W) || M === -1 && (Math.abs(k) < W || Math.abs(k + 0.5) < W)) && (c = ke(p, x, M));
            }
          }
          D.push(c), le.push(X);
        }
        const Se = Math.floor(Q.length / 3);
        for (let r = 0; r + 1 < Se; r += 2) {
          const G = fe + r, c = z[q + r * 3], p = z[q + r * 3 + 1], x = z[q + r * 3 + 2], M = z[q + r * 3 + 3], S = z[q + r * 3 + 4], y = z[q + r * 3 + 5], k = [c, p, x].filter((s) => [M, S, y].includes(s));
          if (k.length !== 2)
            continue;
          const I = [M, S, y].find((s) => !k.includes(s)), Z = [c, p, x].find((s) => !k.includes(s));
          if (I === void 0 || Z === void 0 || I === c || I === p || I === x)
            continue;
          const [$, V] = k, l = (s, m, i, h) => s[0] === m && s[1] === i && s[2] === h || s[0] === i && s[1] === h && s[2] === m || s[0] === h && s[1] === m && s[2] === i, R = [c, p, x], t = [M, S, y];
          l(R, $, Z, V) && l(t, $, V, I) ? ye.set(G, [$, Z, V, I]) : l(R, V, Z, $) && l(t, V, $, I) && ye.set(G, [V, Z, $, I]);
        }
      }
      he.push([P, a, K, U.occlusionFlags]), be.push([
        e.length / 3 - P,
        z.length - a,
        b.get(U.category),
        ce[b.get(U.category)]
      ]);
    }
    return {
      catNames: o,
      catMatCount: u,
      slotBase: ce,
      nSlots: we,
      tplPos: e,
      tplIdx: z,
      tplCull: D,
      tplTriMat: le,
      tplNrm: T,
      tplUv: w,
      tplPosW: pe,
      tplNrmW: me,
      tplUvW: ne,
      quadStart: ye,
      desc: he.flat(),
      desc2: be.flat()
    };
  }
  /**
   * Build meshes for a full-block grid. `grid` is palette-index-per-cell in
   * (y*sz+z)*sx+x order, 0 = air. Returns BufferGeometry per category with the
   * same {category, positions, indices} shape the batched wasm path produces.
   */
  async buildMeshes(g, o, b, u, ce, we) {
    var R;
    if (ce.length === 0)
      return [];
    if (!this.device || !this.pipeline)
      throw new Error("GpuMeshBuilder not initialized");
    const e = this.device, z = performance.now(), {
      catNames: D,
      catMatCount: le,
      slotBase: T,
      nSlots: w,
      tplPos: ne,
      tplIdx: pe,
      tplCull: me,
      tplTriMat: ye,
      tplNrm: he,
      tplUv: be,
      desc: Be,
      desc2: _e
    } = this.buildTemplateBuffers(ce), B = D.length, U = (t, s) => {
      const m = e.createBuffer({
        size: t.byteLength + 3 & -4,
        usage: s | GPUBufferUsage.COPY_DST
      });
      return e.queue.writeBuffer(m, 0, t.buffer, t.byteOffset, t.byteLength), m;
    }, a = {
      grid: U(g, GPUBufferUsage.STORAGE),
      desc: U(new Uint32Array(Be), GPUBufferUsage.STORAGE),
      desc2: U(new Uint32Array(_e), GPUBufferUsage.STORAGE),
      tp: U(new Float32Array(ne), GPUBufferUsage.STORAGE),
      ti: U(new Uint32Array(pe), GPUBufferUsage.STORAGE),
      tc: U(new Uint32Array(me), GPUBufferUsage.STORAGE),
      tm: U(new Uint32Array(ye), GPUBufferUsage.STORAGE),
      tn: U(new Float32Array(he), GPUBufferUsage.STORAGE),
      tu: U(new Float32Array(be), GPUBufferUsage.STORAGE),
      co: U(new Uint32Array(2 * w), GPUBufferUsage.STORAGE)
    }, K = U(
      new Uint32Array([o, b, u, 0, w, 0, 0, 0]),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    ), P = Math.max(64, w * 2) * 4, n = e.createBuffer({
      size: P,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    }), X = e.createBuffer({
      size: P,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    }), j = async () => {
      const t = e.createCommandEncoder();
      t.copyBufferToBuffer(n, 0, X, 0, P), e.queue.submit([t.finish()]), await X.mapAsync(GPUMapMode.READ);
      const s = new Uint32Array(X.getMappedRange().slice(0));
      return X.unmap(), s;
    }, q = (t, s, m, i, h) => e.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: a.grid } },
        { binding: 1, resource: { buffer: K } },
        { binding: 2, resource: { buffer: a.desc } },
        { binding: 3, resource: { buffer: a.desc2 } },
        { binding: 4, resource: { buffer: a.tp } },
        { binding: 5, resource: { buffer: a.ti } },
        { binding: 6, resource: { buffer: a.tc } },
        { binding: 7, resource: { buffer: t } },
        { binding: 8, resource: { buffer: s } },
        { binding: 9, resource: { buffer: n } },
        { binding: 10, resource: { buffer: a.co } },
        { binding: 11, resource: { buffer: a.tm } },
        { binding: 12, resource: { buffer: h } },
        { binding: 13, resource: { buffer: a.tn } },
        { binding: 14, resource: { buffer: a.tu } },
        { binding: 15, resource: { buffer: m } },
        { binding: 16, resource: { buffer: i } }
      ]
    }), fe = Math.ceil(o / 4), J = Math.ceil(u / 4), F = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), Q = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), Ue = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), Y = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), Ae = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), Se = e.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), r = () => [
      F,
      Q,
      Ue,
      Y,
      Ae,
      Se,
      a.grid,
      a.desc,
      a.desc2,
      a.tp,
      a.ti,
      a.tc,
      a.tm,
      a.tn,
      a.tu,
      a.co,
      K,
      n,
      X
    ].forEach((t) => t.destroy()), G = async (t, s, m, i) => {
      e.queue.writeBuffer(K, 0, new Uint32Array([o, b, u, t, w, s, m, 0]));
      const h = e.createCommandEncoder(), f = h.beginComputePass();
      f.setPipeline(this.pipeline), f.setBindGroup(
        0,
        q(
          i ? i[0] : F,
          i ? i[1] : Q,
          i ? i[2] : Ue,
          i ? i[3] : Y,
          i ? i[4] : Ae
        )
      ), f.dispatchWorkgroups(fe, Math.ceil(m / 4), J), f.end(), e.queue.submit([h.finish()]), await e.queue.onSubmittedWorkDone();
    }, c = () => e.queue.writeBuffer(n, 0, new Uint32Array(w * 2));
    c(), await G(0, 0, b, null);
    const p = await j(), x = performance.now() - z;
    let M = 0, S = 0;
    for (let t = 0; t < w; t++)
      M += p[t * 2], S += p[t * 2 + 1];
    const y = M * 32 + S * 8;
    if (y > 4 * 1024 ** 3)
      throw r(), new Error(
        `[GpuMeshBuilder] output ${Math.round(y / 1048576)}MB exceeds the 4GB budget — batched fallback`
      );
    const k = 384 * 1024 * 1024, I = Math.min(
      b,
      Math.max(8, y <= k ? b : Math.floor(b * k / y))
    ), Z = [], $ = async (t, s, m, i) => {
      const h = e.createBuffer({
        size: m * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      }), f = e.createCommandEncoder();
      f.copyBufferToBuffer(t, s, h, 0, m * 4), e.queue.submit([f.finish()]), await h.mapAsync(GPUMapMode.READ);
      const E = new i(h.getMappedRange().slice(0));
      return h.unmap(), h.destroy(), E;
    };
    let V = 0, l = !0;
    try {
      for (let t = 0; t < b; t += I) {
        const s = Math.min(I, b - t);
        let m = p;
        l && s === b || (c(), await G(0, t, s, null), m = await j());
        const i = [], h = [];
        let f = 0, E = 0;
        for (let A = 0; A < w; A++)
          i.push(f), f += m[A * 2], h.push(E), E += m[A * 2 + 1];
        if (e.queue.writeBuffer(a.co, 0, new Uint32Array([...i, ...h])), c(), l && window.__gpuOracle && (window.__gpuDebug = {
          nSlots: w,
          slotBase: T,
          catMatCount: le,
          counts: Array.from(p),
          segV: i,
          segI: h
        }), E === 0) {
          l = !1;
          continue;
        }
        const ee = e.createBuffer({
          size: f * 3 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), ve = e.createBuffer({
          size: E * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), de = e.createBuffer({
          size: f * 3 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), H = e.createBuffer({
          size: f * 2 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        }), Re = performance.now();
        await G(1, t, s, [ee, ve, de, H, Se]), V += performance.now() - Re;
        const Pe = await j();
        for (let A = 0; A < B; A++) {
          const d = D[A];
          let O = 0, te = 0;
          for (let v = 0; v < le[A]; v++)
            O += Pe[(T[A] + v) * 2 + 1], te += Pe[(T[A] + v) * 2];
          if (O === 0)
            continue;
          const oe = i[T[A]], ae = h[T[A]], L = await $(ee, oe * 3 * 4, te * 3, Float32Array), _ = await $(ve, ae * 4, O, Uint32Array), N = await $(de, oe * 3 * 4, te * 3, Float32Array), xe = await $(H, oe * 2 * 4, te * 2, Float32Array), C = new se.BufferGeometry();
          C.setAttribute("position", new se.BufferAttribute(L, 3)), C.setAttribute("normal", new se.BufferAttribute(N, 3)), C.setAttribute("uv", new se.BufferAttribute(xe, 2)), C.setIndex(
            O > 65535 ? new se.BufferAttribute(_, 1) : new se.BufferAttribute(Uint16Array.from(_), 1)
          );
          for (const v of [
            C.attributes.position,
            C.attributes.normal,
            C.attributes.uv,
            C.index
          ])
            v.onUpload(() => {
              v.array = null;
            });
          const Fe = we(d);
          for (let v = 0; v < le[A]; v++) {
            const ge = Pe[(T[A] + v) * 2 + 1];
            ge > 0 && C.addGroup(h[T[A] + v] - ae, ge, v);
          }
          C.boundingBox = new se.Box3(
            new se.Vector3(-0.51, t - 0.51, -0.51),
            new se.Vector3(o - 0.49, t + s + 0.01, u - 0.49)
          ), C.boundingSphere = C.boundingBox.getBoundingSphere(new se.Sphere());
          const Ce = new se.Mesh(C, Fe);
          if (window.__gpuOracle) {
            const v = window;
            (v.__gpuDump = v.__gpuDump || {})[d] = {
              posArr: L,
              idxArr: _,
              groups: ((R = C.groups) == null ? void 0 : R.length) ?? 0
            };
          }
          Ce.userData.category = d, Ce.userData.gpuBuilt = !0, Z.push(Ce);
          try {
            const v = window;
            if (v.__meshHashes = v.__meshHashes || [], v.__gpuOracle) {
              let ge = 2166136261;
              const Me = [];
              for (let ue = 0; ue + 2 < O; ue += 3) {
                const re = [];
                for (let Ge = 0; Ge < 3; Ge++) {
                  const Oe = _[ue + Ge];
                  re.push(
                    `${Math.round(L[Oe * 3] * 1024)},${Math.round(L[Oe * 3 + 1] * 1024)},${Math.round(L[Oe * 3 + 2] * 1024)}`
                  );
                }
                re.sort(), Me.push(re.join(";"));
              }
              Me.sort();
              for (const ue of Me)
                for (let re = 0; re < ue.length; re++)
                  ge ^= ue.charCodeAt(re), ge = ge * 16777619 >>> 0;
              v.__meshHashes.push({ category: d, tris: Me.length, hash: ge.toString(16) });
            }
          } catch {
          }
        }
        [ee, ve, de, H].forEach((A) => A.destroy()), l = !1;
      }
      if (window.__gpuRecords) {
        const t = performance.now(), s = _e.length / 4 - 1, m = new Uint32Array(me.length);
        for (let d = 1; d <= s; d++) {
          const O = Be[d * 4 + 2];
          for (let te = 0; te < _e[d * 4 + 1] / 3; te++)
            m[O + te] = d;
        }
        c(), await G(2, 0, b, null);
        const i = await j(), h = [];
        let f = 0;
        for (let d = 0; d < w; d++)
          h.push(f), f += i[d * 2 + 1];
        e.queue.writeBuffer(
          a.co,
          0,
          new Uint32Array([...new Array(w).fill(0), ...h])
        ), c();
        const E = e.createBuffer({
          size: Math.max(f, 1) * 8,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        await G(3, 0, b, [F, Q, Ue, Y, E]);
        const ee = await j(), ve = performance.now() - t, de = /* @__PURE__ */ new Map();
        for (const d of window.__meshHashes ?? []) {
          const O = de.get(d.category) ?? [];
          O.push(d), de.set(d.category, O);
        }
        let H = !0, Re = 0, Pe = 0;
        for (let d = 0; d < B; d++) {
          let O = 0;
          for (let _ = 0; _ < le[d]; _++)
            O += ee[(T[d] + _) * 2 + 1];
          if (O === 0)
            continue;
          Re += O, Pe += O * 8;
          const te = await $(E, h[T[d]] * 8, O * 2, Uint32Array);
          let oe = 2166136261;
          const ae = [];
          for (let _ = 0; _ < O; _++) {
            const N = te[_ * 2], xe = te[_ * 2 + 1], C = N % o, Fe = N / (o * u) | 0, Ce = (N / o | 0) % u, v = m[xe], ge = xe - Be[v * 4 + 2], Me = Be[v * 4 + 1], ue = [];
            for (let re = 0; re < 3; re++) {
              const Ge = pe[Me + ge * 3 + re];
              ue.push(
                Math.round(Math.fround(C + ne[Ge * 3]) * 1024) + "," + Math.round(Math.fround(Fe + ne[Ge * 3 + 1]) * 1024) + "," + Math.round(Math.fround(Ce + ne[Ge * 3 + 2]) * 1024)
              );
            }
            ue.sort(), ae.push(ue.join(";"));
          }
          ae.sort();
          for (const _ of ae)
            for (let N = 0; N < _.length; N++)
              oe ^= _.charCodeAt(N), oe = oe * 16777619 >>> 0;
          const L = de.get(D[d]) ?? [];
          if (L.length === 1) {
            const _ = L[0].tris === ae.length && L[0].hash === (oe >>> 0).toString(16);
            _ || (H = !1), console.log(
              `[GpuMeshBuilder][records] ${D[d]}: ${ae.length} tris ${(oe >>> 0).toString(16)} vs vertex-path ${L[0].tris} ${L[0].hash} ${_ ? "✓ MATCH" : "✗ MISMATCH"}`
            );
          } else {
            const _ = L.reduce((xe, C) => xe + C.tris, 0), N = _ === ae.length;
            N || (H = !1), console.log(
              `[GpuMeshBuilder][records] ${D[d]}: ${ae.length} tris (multi-slab, ${(oe >>> 0).toString(16)}) vs vertex-path slabs ${L.length} totaling ${_} ${N ? "✓ TOTAL MATCH" : "✗ MISMATCH"}`
            );
          }
        }
        E.destroy();
        const A = Re === Math.round(S / 3);
        A || (H = !1), console.log(
          `[GpuMeshBuilder][records] ${H ? "★ ALL MATCH" : "✗ FAILED"} — ${Re.toLocaleString()} tris as ${(Pe / 1048576).toFixed(1)} MB of records (${ve.toFixed(0)}ms count+emit+verify; count-pass total ${A ? "exact" : "DIFFERS"})`
        );
      }
    } finally {
      r();
    }
    return console.log(
      `[GpuMeshBuilder] count=${x.toFixed(1)}ms emit=${V.toFixed(1)}ms ${Z.length} meshes, ${Math.round(S / 3).toLocaleString()} tris / ${M.toLocaleString()} verts (dedup ${((1 - M / S) * 100).toFixed(1)}%)`
    ), Z;
  }
  /**
   * Phase B: build meshes that RENDER DIRECTLY from the 8B/triangle record stream
   * (WebGL2 gl_VertexID vertex pulling — no vertex data readback at all).
   * Returns one pulling mesh per non-empty category plus the record stream for
   * verification. Falls back to plain buildMeshes on any WebGPU failure upstream.
   */
  async buildRecordMeshes(g, o, b, u, ce, we) {
    var G;
    if (ce.length === 0)
      return { meshes: [], stream: null };
    const e = this.device, z = performance.now(), {
      catNames: D,
      catMatCount: le,
      slotBase: T,
      nSlots: w,
      tplPos: ne,
      tplIdx: pe,
      tplCull: me,
      tplTriMat: ye,
      tplNrm: he,
      tplUv: be,
      tplPosW: Be,
      tplNrmW: _e,
      tplUvW: B,
      quadStart: U,
      desc: a,
      desc2: K
    } = this.buildTemplateBuffers(ce), P = (c, p) => {
      const x = e.createBuffer({
        size: c.byteLength + 3 & -4,
        usage: p | GPUBufferUsage.COPY_DST
      });
      return e.queue.writeBuffer(x, 0, c.buffer, c.byteOffset, c.byteLength), x;
    }, n = {
      grid: P(g, GPUBufferUsage.STORAGE),
      desc: P(new Uint32Array(a), GPUBufferUsage.STORAGE),
      desc2: P(new Uint32Array(K), GPUBufferUsage.STORAGE),
      tp: P(new Float32Array(ne), GPUBufferUsage.STORAGE),
      ti: P(new Uint32Array(pe), GPUBufferUsage.STORAGE),
      tc: P(new Uint32Array(me), GPUBufferUsage.STORAGE),
      tm: P(new Uint32Array(ye), GPUBufferUsage.STORAGE),
      tn: P(new Float32Array(he), GPUBufferUsage.STORAGE),
      tu: P(new Float32Array(be), GPUBufferUsage.STORAGE),
      co: P(new Uint32Array(2 * w), GPUBufferUsage.STORAGE)
    }, X = P(
      new Uint32Array([o, b, u, 0, w, 0, 0, 0]),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    ), j = Math.max(64, w * 2) * 4, q = e.createBuffer({
      size: j,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    }), fe = e.createBuffer({
      size: j,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    }), J = async () => {
      const c = e.createCommandEncoder();
      c.copyBufferToBuffer(q, 0, fe, 0, j), e.queue.submit([c.finish()]), await fe.mapAsync(GPUMapMode.READ);
      const p = new Uint32Array(fe.getMappedRange().slice(0));
      return fe.unmap(), p;
    }, F = Array.from(
      { length: 5 },
      () => e.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    ), Q = (c) => e.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: n.grid } },
        { binding: 1, resource: { buffer: X } },
        { binding: 2, resource: { buffer: n.desc } },
        { binding: 3, resource: { buffer: n.desc2 } },
        { binding: 4, resource: { buffer: n.tp } },
        { binding: 5, resource: { buffer: n.ti } },
        { binding: 6, resource: { buffer: n.tc } },
        { binding: 7, resource: { buffer: F[0] } },
        { binding: 8, resource: { buffer: F[1] } },
        { binding: 9, resource: { buffer: q } },
        { binding: 10, resource: { buffer: n.co } },
        { binding: 11, resource: { buffer: n.tm } },
        { binding: 12, resource: { buffer: c } },
        { binding: 13, resource: { buffer: n.tn } },
        { binding: 14, resource: { buffer: n.tu } },
        { binding: 15, resource: { buffer: F[2] } },
        { binding: 16, resource: { buffer: F[3] } }
      ]
    }), Ue = Math.ceil(o / 4), Y = Math.ceil(u / 4), Ae = async (c, p, x, M) => {
      e.queue.writeBuffer(X, 0, new Uint32Array([o, b, u, c, w, x, M, 0]));
      const S = e.createCommandEncoder(), y = S.beginComputePass();
      y.setPipeline(this.pipeline), y.setBindGroup(0, Q(p)), y.dispatchWorkgroups(Ue, Math.ceil(M / 4), Y), y.end(), e.queue.submit([S.finish()]), await e.queue.onSubmittedWorkDone();
    }, Se = () => e.queue.writeBuffer(q, 0, new Uint32Array(w * 2)), r = F[4];
    try {
      const p = [];
      for (let l = 0; l < b; l += 16) {
        const R = Math.min(16, b - l);
        Se(), await Ae(2, r, l, R);
        const t = await J(), s = [];
        let m = 0;
        for (let f = 0; f < w; f++)
          s.push(m), m += t[f * 2 + 1];
        if (m === 0)
          continue;
        e.queue.writeBuffer(
          n.co,
          0,
          new Uint32Array([...new Array(w).fill(0), ...s])
        ), Se();
        const i = e.createBuffer({
          size: m * 8,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        await Ae(3, i, l, R);
        const h = await J();
        for (let f = 0; f < D.length; f++) {
          let E = 0;
          for (let H = 0; H < le[f]; H++)
            E += h[(T[f] + H) * 2 + 1];
          if (E === 0)
            continue;
          const ee = e.createBuffer({
            size: E * 8,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
          }), ve = e.createCommandEncoder();
          ve.copyBufferToBuffer(i, s[T[f]] * 8, ee, 0, E * 8), e.queue.submit([ve.finish()]), await ee.mapAsync(GPUMapMode.READ);
          const de = new Uint32Array(ee.getMappedRange().slice(0));
          ee.unmap(), ee.destroy(), p.push({ category: D[f], records: de, tris: E, y0: l, h: R });
        }
        i.destroy();
      }
      const { buildRecordTables: x, makeRecordMeshes: M } = await import("./RecordRenderer-a129cd0f.mjs"), S = x(
        ne,
        he,
        be,
        pe,
        a,
        K,
        K.length / 4 - 1,
        Be,
        _e,
        B
      ), y = we(D[0] ?? "solid"), k = ((G = y == null ? void 0 : y[0]) == null ? void 0 : G.map) ?? null, I = K.length / 4 - 1, Z = new Uint32Array(me.length);
      for (let l = 1; l <= I; l++)
        for (let R = 0; R < K[l * 4 + 1] / 3; R++)
          Z[a[l * 4 + 2] + R] = l;
      const V = M({ perCategory: p, tables: S, sx: o, sy: b, sz: u }, k, (l, R) => {
        const t = U.get(l);
        return t ? { quad: !0, corners: t } : { quad: !1, corners: null };
      });
      return console.log(
        `[GpuMeshBuilder][pull] ${p.reduce((l, R) => l + R.tris, 0).toLocaleString()} tris → ${V.length} pulling meshes in ${(performance.now() - z).toFixed(0)}ms (readback ${(p.reduce((l, R) => l + R.tris * 8, 0) / 1048576).toFixed(1)}MB)`
      ), { meshes: V, stream: { perCategory: p, tables: S, sx: o, sy: b, sz: u } };
    } finally {
      [
        ...F,
        n.grid,
        n.desc,
        n.desc2,
        n.tp,
        n.ti,
        n.tc,
        n.tm,
        n.tn,
        n.tu,
        n.co,
        X,
        q,
        fe
      ].forEach((c) => c.destroy());
    }
  }
}
export {
  qe as GpuMeshBuilder
};
