var Ee = Object.defineProperty;
var Le = (i, e, n) => e in i ? Ee(i, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : i[e] = n;
var P = (i, e, n) => (Le(i, typeof e != "symbol" ? e + "" : e, n), n);
import * as F from "three";
import { W as $e, h as Ce, i as Ie, f as de } from "./index-95fd77aa.mjs";
import "nucleation";
const We = (
  /* glsl */
  `
in float aFace;
in float aTexture;
out vec2 vUv;
flat out int vFace;
flat out int vTexture;
void main() {
  vUv = uv;
  vFace = int(aFace + 0.5);
  vTexture = int(aTexture + 0.5);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
), Ne = (
  /* glsl */
  `
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform sampler2DArray uFlowTex;
uniform sampler2DArray uOverlayTex;
uniform vec3 uStillFrame;
uniform vec3 uFlowFrame;
uniform vec3 uOverlayFrame;
uniform float uHasTex;
uniform vec3 uTint;
uniform float uAlpha;
uniform bool uOpaque;
in vec2 vUv;
flat in int vFace;
flat in int vTexture;
layout(location = 0) out vec4 fragColor;

vec4 sampleFrame(sampler2DArray tex, vec3 frame, vec2 dx, vec2 dy) {
  vec4 color = textureGrad(tex, vec3(vUv, frame.x), dx, dy);
  if (frame.z > 0.0) {
    // Sprite interpolation retains the current frame's alpha, as in the game.
    color.rgb = mix(color.rgb, textureGrad(tex, vec3(vUv, frame.y), dx, dy).rgb, frame.z);
  }
  return color;
}
void main() {
  vec2 dx = dFdx(vUv), dy = dFdy(vUv);
  vec4 color = vec4(uTint * 0.6, 0.706);
  if (uHasTex > 0.5) {
    if (vTexture == 2) color = sampleFrame(uOverlayTex, uOverlayFrame, dx, dy);
    else if (vTexture == 1) color = sampleFrame(uFlowTex, uFlowFrame, dx, dy);
    else color = sampleFrame(uTex, uStillFrame, dx, dy);
  }
  // Overlay faces against transparent blocks have no reverse face in vanilla.
  if (vTexture == 2 && !gl_FrontFacing) discard;
  float shade = vFace == 0 ? 1.0 : (vFace == 1 ? 0.5 : (vFace <= 3 ? 0.8 : 0.6));
  fragColor = vec4(color.rgb * shade, (uOpaque ? 1.0 : color.a) * uAlpha);
}
`
), te = 0, $ = 1, Oe = 2, Te = ["water", "water", "lava"], He = /^(air|cave_air|void_air)$|glass|pane|bars|leaves|slab|stairs|fence|wall|torch|sign|button|pressure_plate|rail|carpet|trapdoor|door|chain|lantern|flower|grass|fern|sapling|kelp|seagrass|lily_pad|vine|ladder|scaffolding|cobweb|banner|candle|coral|pickle|bamboo|cactus|sugar_cane|bubble_column|campfire|hopper|cauldron|anvil|head|skull|pot|bed$|bell|lever|tripwire|redstone_wire|repeater|comparator|mushroom$|tulip|rose|dandelion|orchid|poppy|lilac|peony|azalea|dripleaf|moss_carpet|sculk_vein|amethyst_cluster|bud$|frogspawn|hanging_roots|spore_blossom|pointed_dripstone|end_rod|brewing_stand|enchanting_table|conduit|chest|shulker_box|cocoa|wheat|carrots|potatoes|beetroots|nether_wart|stem|ice$|slime_block|honey_block|daylight_detector|lectern|stonecutter|grindstone|composter|barrel|snow$|shelf$|dried_ghast|sulfur_spike|resin_clump|pale_hanging_moss|bush$|leaf_litter|copper_golem_statue$/;
function ye(i) {
  const e = i.indexOf("level=");
  if (e < 0)
    return 0;
  let n = 0, l = e + 6;
  for (; l < i.length; ) {
    const _ = i.charCodeAt(l);
    if (_ < 48 || _ > 57)
      break;
    n = n * 10 + (_ - 48), l++;
  }
  return n > 15 ? 15 : n;
}
const Re = /* @__PURE__ */ new Set([
  "bubble_column",
  "kelp",
  "kelp_plant",
  "seagrass",
  "tall_seagrass"
]);
function Se(i) {
  if (!i)
    return 0;
  let e = i, n = "";
  const l = i.indexOf("[");
  if (l >= 0 && (e = i.slice(0, l), n = i.slice(l + 1, i.length - 1)), e.startsWith("minecraft:") && (e = e.slice(10)), e === "water" || e === "flowing_water")
    return $ | ye(n) << 2;
  if (e === "lava" || e === "flowing_lava")
    return Oe | ye(n) << 2;
  if (e === "bubble_column")
    return $ | 512 | (n.includes("drag=true") ? 1024 : 0);
  if (n.indexOf("waterlogged=true") >= 0 || Re.has(e))
    return $;
  const _ = /^(?:glass|tinted_glass|.*_stained_glass|ice|frosted_ice|.*_leaves)$/.test(e);
  return (!(e === "packed_ice" || e === "blue_ice" || e === "grass_block") && He.test(e) ? 0 : 256) | (_ ? 2048 : 0);
}
function Ye(i) {
  return (Se(i) & 3) !== te;
}
function j(i) {
  return i >= 8 || i === 0 ? 8 / 9 : (8 - i) / 9;
}
class ee {
  constructor(e) {
    P(this, "a");
    P(this, "n", 0);
    this.a = new Float32Array(Math.max(e, 64));
  }
  ensure(e) {
    if (this.n + e <= this.a.length)
      return;
    let n = this.a.length * 2;
    for (; n < this.n + e; )
      n *= 2;
    const l = new Float32Array(n);
    l.set(this.a.subarray(0, this.n)), this.a = l;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}
class qe {
  constructor(e) {
    P(this, "a");
    P(this, "n", 0);
    this.a = new Uint32Array(Math.max(e, 64));
  }
  ensure(e) {
    if (this.n + e <= this.a.length)
      return;
    let n = this.a.length * 2;
    for (; n < this.n + e; )
      n *= 2;
    const l = new Uint32Array(n);
    l.set(this.a.subarray(0, this.n)), this.a = l;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}
const y = 1 / 1024;
function Ze(i, e, n, l, _) {
  const w = performance.now(), S = e * n * l, x = new Uint8Array(S), I = new Uint8Array(S), W = new Uint8Array(S), pe = /* @__PURE__ */ new Map(), he = [];
  let re = 0, me = !1, we = !1, xe = !1;
  for (let u = 0; u < n; u++)
    for (let h = 0; h < l; h++) {
      const p = (u * l + h) * e;
      for (let b = 0; b < e; b++) {
        const o = i(b, u, h) || "";
        let T = pe.get(o);
        T === void 0 && (T = Se(o), pe.set(o, T));
        const V = T & 3;
        x[p + b] = V, I[p + b] = T >> 2 & 15, W[p + b] = T >> 8 & 9, T & 2048 && (xe = !0), T & 512 && he.push({ x: b, y: u, z: h, downward: !!(T & 1024) }), V !== te && (re++, V === $ ? me = !0 : we = !0);
      }
    }
  const M = (u, h, p) => (h * l + p) * e + u, ne = (u, h, p) => u >= 0 && h >= 0 && p >= 0 && u < e && h < n && p < l, ae = (u, h, p, b) => {
    if (!ne(h, p, b))
      return 0;
    const o = M(h, p, b);
    return (x[o] & 3) === u ? p + 1 < n && (x[M(h, p + 1, b)] & 3) === u ? 1 : j(I[o]) : W[o] & 1 ? -1 : 0;
  }, ge = (u) => {
    const h = u === $ && xe && (e > 16 || n > 16 || l > 16), p = h ? 8 : Math.min(Math.max(re, 1), 4096), b = () => ({
      pos: new ee(p * 3 * 4 * 3),
      face: new ee(p * 3 * 4),
      uv: new ee(p * 3 * 4 * 2),
      texture: new ee(p * 3 * 4),
      idx: new qe(p * 3 * 6),
      vcount: 0
    });
    let o = b();
    const T = /* @__PURE__ */ new Map(), V = Math.ceil(e / 16), De = Math.ceil(l / 16);
    let be = -1, U = 0, N = 0, H = 0, R = 0, Fe = 0, ie = 0, _e = 0;
    const X = (t, r, a) => {
      o.pos.ensure(3), o.face.ensure(1), o.uv.ensure(2), o.texture.ensure(1), o.pos.a[o.pos.n++] = t, o.pos.a[o.pos.n++] = r, o.pos.a[o.pos.n++] = a, o.face.a[o.face.n++] = U;
      const c = t - Fe + 0.5, f = a - _e + 0.5;
      let v, d;
      return U <= 1 ? R === 1 ? (v = 0.5 + 0.5 * (H * (c - 0.5) - N * (f - 0.5)), d = 0.5 + 0.5 * (N * (c - 0.5) + H * (f - 0.5))) : (v = c, d = f) : (v = (U === 2 ? c : U === 3 ? 1 - c : U === 4 ? 1 - f : f) * 0.5, d = r <= ie - 0.5 + y ? 0.5 : (ie + 0.5 - r) * 0.5), o.uv.a[o.uv.n++] = v, o.uv.a[o.uv.n++] = d, o.texture.a[o.texture.n++] = R, o.vcount++;
    }, q = (t, r, a, c, f, v, d, g, E, G, C, D) => {
      const A = X(t, r, a), B = X(c, f, v), O = X(d, g, E), m = X(G, C, D);
      o.idx.ensure(6), o.idx.a[o.idx.n++] = A, o.idx.a[o.idx.n++] = B, o.idx.a[o.idx.n++] = O, o.idx.a[o.idx.n++] = A, o.idx.a[o.idx.n++] = O, o.idx.a[o.idx.n++] = m;
    };
    let Y = 0, K = 0;
    const Z = (t) => {
      t >= 0.8 ? (Y += t * 10, K += 10) : t >= 0 && (Y += t, K += 1);
    }, k = (t, r, a, c, f, v) => {
      const d = ae(u, t + c, r, a), g = ae(u, t, r, a + f);
      if (d >= 1 || g >= 1)
        return 1;
      if (Y = 0, K = 0, d > 0 || g > 0) {
        const E = ae(u, t + c, r, a + f);
        if (E >= 1)
          return 1;
        Z(E);
      }
      return Z(v), Z(d), Z(g), K > 0 ? Math.min(1, Y / K) : v;
    }, J = (t, r, a, c) => {
      if (!ne(t, r, a))
        return 0;
      const f = M(t, r, a);
      return x[f] === u ? c - j(I[f]) : x[f] !== te || W[f] & 1 ? 0 : r > 0 && x[M(t, r - 1, a)] === u ? c - j(I[M(t, r - 1, a)]) + 8 / 9 : 0;
    };
    for (let t = 0; t < n; t++)
      for (let r = 0; r < l; r++)
        for (let a = 0; a < e; a++) {
          const c = M(a, t, r);
          if ((x[c] & 3) !== u)
            continue;
          const f = t + 1 < n && (x[M(a, t + 1, r)] & 3) === u;
          if (f && t > 0 && a > 0 && a + 1 < e && r > 0 && r + 1 < l && x[M(a, t - 1, r)] === u && x[c - 1] === u && x[c + 1] === u && x[c - e] === u && x[c + e] === u)
            continue;
          if (h) {
            const s = ((t >> 4) * De + (r >> 4)) * V + (a >> 4);
            if (s !== be) {
              be = s;
              let L = T.get(s);
              L || T.set(s, L = b()), o = L;
            }
          }
          const v = f ? 1 : j(I[c]);
          let d, g, E, G;
          v >= 1 ? d = g = E = G = 1 : (d = k(a, t, r, -1, -1, v), g = k(a, t, r, 1, -1, v), E = k(a, t, r, 1, 1, v), G = k(a, t, r, -1, 1, v)), N = H = 0;
          let C = 0;
          if (!f) {
            const s = j(I[c]);
            N = J(a + 1, t, r, s) - J(a - 1, t, r, s), H = J(a, t, r + 1, s) - J(a, t, r - 1, s), C = Math.hypot(N, H), C > 0 && (N /= C, H /= C);
          }
          Fe = a, ie = t, _e = r, f || (d -= y, g -= y, E -= y, G -= y);
          const D = a - 0.5, A = a + 0.5, B = r - 0.5, O = r + 0.5, m = t - 0.5, se = m + d, ue = m + g, ce = m + E, fe = m + G;
          f || (U = 0, R = C > 0 ? 1 : 0, q(D, se, B, D, fe, O, A, ce, O, A, ue, B));
          {
            const s = t > 0 ? x[M(a, t - 1, r)] & 3 : te, L = t > 0 ? W[M(a, t - 1, r)] : 0;
            s !== u && !(L & 1) && (U = 1, R = 0, q(D, m + y, B, A, m + y, B, A, m + y, O, D, m + y, O));
          }
          const z = (s, L) => {
            if (R = 1, !ne(s, t, L))
              return !0;
            const ve = M(s, t, L);
            return u === $ && W[ve] & 8 && (R = 2), (x[ve] & 3) !== u && !(W[ve] & 1);
          };
          if (z(a, r - 1)) {
            U = 2;
            const s = B + y;
            q(A, m, s, D, m, s, D, se, s, A, ue, s);
          }
          if (z(a, r + 1)) {
            U = 3;
            const s = O - y;
            q(D, m, s, A, m, s, A, ce, s, D, fe, s);
          }
          if (z(a - 1, r)) {
            U = 4;
            const s = D + y;
            q(s, m, B, s, m, O, s, fe, O, s, se, B);
          }
          if (z(a + 1, r)) {
            U = 5;
            const s = A - y;
            q(s, m, O, s, m, B, s, ue, B, s, ce, O);
          }
        }
    const Q = Ve(Te[u], !1, _), Be = (t) => {
      if (t.idx.n === 0)
        return null;
      const r = new F.BufferGeometry();
      r.setAttribute("position", new F.BufferAttribute(t.pos.view().slice(), 3)), r.setAttribute("aFace", new F.Uint8BufferAttribute(t.face.view(), 1)), r.setAttribute("uv", new F.BufferAttribute(t.uv.view().slice(), 2)), r.setAttribute("aTexture", new F.Uint8BufferAttribute(t.texture.view(), 1)), r.setIndex(new F.BufferAttribute(t.idx.view().slice(), 1)), r.computeBoundingSphere(), r.computeBoundingBox();
      const a = new F.Mesh(r, Q);
      if (a.name = `fluid:${Te[u]}`, a.userData.animatedSurface = ["uTex", "uFlowTex", "uOverlayTex"].some(
        (c) => Ce(Q.uniforms[c].value)
      ), a.frustumCulled = !0, a.onBeforeRender = () => Ke(Q, performance.now() / 1e3), u === $) {
        const c = new Float32Array(t.vcount / 4 * 3), f = t.pos.a;
        for (let v = 0; v < t.vcount / 4; v++)
          for (let d = 0; d < 3; d++) {
            const g = v * 12 + d;
            c[v * 3 + d] = (f[g] + f[g + 3] + f[g + 6] + f[g + 9]) * 0.25;
          }
        Ie(a, c);
      }
      return a;
    }, le = [];
    for (const t of h ? T.values() : [o]) {
      const r = Be(t);
      r && le.push(r);
    }
    return le.length === 0 && Q.dispose(), le;
  }, oe = [];
  return me && oe.push(...ge($)), we && oe.push(...ge(Oe)), { meshes: oe, cells: re, bubbleCells: he, ms: performance.now() - w };
}
const Ae = /* @__PURE__ */ new Set(), Me = /* @__PURE__ */ new WeakMap();
let Ge = null;
function Ve(i, e = !1, n) {
  const l = i === "water", _ = new F.Color(l ? 4159204 : 16737792).convertLinearToSRGB(), w = new F.ShaderMaterial({
    glslVersion: F.GLSL3,
    vertexShader: We,
    fragmentShader: Ne,
    uniforms: {
      uTex: { value: null },
      uFlowTex: { value: null },
      uOverlayTex: { value: null },
      uOverlayFrame: { value: new F.Vector3() },
      uOpaque: { value: !l },
      uStillFrame: { value: new F.Vector3() },
      uFlowFrame: { value: new F.Vector3() },
      uHasTex: { value: 0 },
      uTint: { value: _ },
      uAlpha: { value: l ? $e : 1 }
    },
    side: F.DoubleSide,
    forceSinglePass: !0,
    transparent: l,
    depthWrite: !l,
    depthTest: !0,
    // The host block wins coplanar ties on waterlogged faces.
    polygonOffset: l,
    polygonOffsetFactor: l ? 1 : 0,
    polygonOffsetUnits: l ? 1 : 0
  });
  return w.userData.kind = i, w.userData.fluidAlpha = w.uniforms.uAlpha.value, n && Me.set(w, n), Ae.add(w), w.addEventListener("dispose", () => Ae.delete(w)), Ue(w), w;
}
function Ue(i) {
  const e = Me.get(i) ?? Ge, n = i.userData.kind === "water", l = (e == null ? void 0 : e[i.userData.kind]) ?? null, _ = (n ? e == null ? void 0 : e.waterFlow : e == null ? void 0 : e.lavaFlow) ?? l, w = (n ? e == null ? void 0 : e.waterOverlay : null) ?? _, S = i.uniforms;
  S.uTex.value === l && S.uFlowTex.value === _ && S.uOverlayTex.value === w || (S.uTex.value = l, S.uFlowTex.value = _, S.uOverlayTex.value = w, S.uHasTex.value = l ? 1 : 0);
}
function Ke(i, e) {
  Ue(i);
  const n = i.uniforms;
  n.uTex.value && n.uStillFrame.value.copy(de(n.uTex.value, e)), n.uFlowTex.value && n.uFlowFrame.value.copy(de(n.uFlowTex.value, e)), n.uOverlayTex.value && n.uOverlayFrame.value.copy(de(n.uOverlayTex.value, e));
}
export {
  Ze as buildFluidMeshes,
  Ve as createFluidMaterial,
  Ye as hasFluid
};
