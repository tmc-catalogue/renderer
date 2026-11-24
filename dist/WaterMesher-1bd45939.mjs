var _e = Object.defineProperty;
var ye = (i, e, t) => e in i ? _e(i, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[e] = t;
var R = (i, e, t) => (ye(i, typeof e != "symbol" ? e + "" : e, t), t);
import * as F from "three";
import { h as Ae, W as Oe, f as le } from "./index-5a2c120d.mjs";
import "nucleation";
const Se = (
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
), Ue = (
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
), J = 0, E = 1, ge = 2, xe = ["water", "water", "lava"], De = /^(air|cave_air|void_air)$|glass|pane|bars|leaves|slab|stairs|fence|wall|torch|sign|button|pressure_plate|rail|carpet|trapdoor|door|chain|lantern|flower|grass|fern|sapling|kelp|seagrass|lily_pad|vine|ladder|scaffolding|cobweb|banner|candle|coral|pickle|bamboo|cactus|sugar_cane|bubble_column|campfire|hopper|cauldron|anvil|head|skull|pot|bed$|bell|lever|tripwire|redstone_wire|repeater|comparator|mushroom$|tulip|rose|dandelion|orchid|poppy|lilac|peony|azalea|dripleaf|moss_carpet|sculk_vein|amethyst_cluster|bud$|frogspawn|hanging_roots|spore_blossom|pointed_dripstone|end_rod|brewing_stand|enchanting_table|conduit|chest|shulker_box|cocoa|wheat|carrots|potatoes|beetroots|nether_wart|stem|ice$|slime_block|honey_block|daylight_detector|lectern|stonecutter|grindstone|composter|barrel|snow$|shelf$|dried_ghast|sulfur_spike|resin_clump|pale_hanging_moss|bush$|leaf_litter|copper_golem_statue$/;
function be(i) {
  const e = i.indexOf("level=");
  if (e < 0)
    return 0;
  let t = 0, s = e + 6;
  for (; s < i.length; ) {
    const d = i.charCodeAt(s);
    if (d < 48 || d > 57)
      break;
    t = t * 10 + (d - 48), s++;
  }
  return t > 15 ? 15 : t;
}
const Me = /* @__PURE__ */ new Set([
  "bubble_column",
  "kelp",
  "kelp_plant",
  "seagrass",
  "tall_seagrass"
]);
function Fe(i) {
  if (!i)
    return 0;
  let e = i, t = "";
  const s = i.indexOf("[");
  if (s >= 0 && (e = i.slice(0, s), t = i.slice(s + 1, i.length - 1)), e.startsWith("minecraft:") && (e = e.slice(10)), e === "water" || e === "flowing_water")
    return E | be(t) << 2;
  if (e === "lava" || e === "flowing_lava")
    return ge | be(t) << 2;
  if (e === "bubble_column")
    return E | 512 | (t.includes("drag=true") ? 1024 : 0);
  if (t.indexOf("waterlogged=true") >= 0 || Me.has(e))
    return E;
  const d = /^(?:glass|tinted_glass|.*_stained_glass|ice|frosted_ice|.*_leaves)$/.test(e);
  return (De.test(e) ? 0 : 256) | (d ? 2048 : 0);
}
function We(i) {
  return (Fe(i) & 3) !== J;
}
function G(i) {
  return i >= 8 || i === 0 ? 8 / 9 : (8 - i) / 9;
}
class Z {
  constructor(e) {
    R(this, "a");
    R(this, "n", 0);
    this.a = new Float32Array(Math.max(e, 64));
  }
  ensure(e) {
    if (this.n + e <= this.a.length)
      return;
    let t = this.a.length * 2;
    for (; t < this.n + e; )
      t *= 2;
    const s = new Float32Array(t);
    s.set(this.a.subarray(0, this.n)), this.a = s;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}
class Be {
  constructor(e) {
    R(this, "a");
    R(this, "n", 0);
    this.a = new Uint32Array(Math.max(e, 64));
  }
  ensure(e) {
    if (this.n + e <= this.a.length)
      return;
    let t = this.a.length * 2;
    for (; t < this.n + e; )
      t *= 2;
    const s = new Uint32Array(t);
    s.set(this.a.subarray(0, this.n)), this.a = s;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}
const T = 1 / 1024;
function Ne(i, e, t, s) {
  const d = performance.now(), L = e * t * s, f = new Uint8Array(L), $ = new Uint8Array(L), C = new Uint8Array(L), ce = /* @__PURE__ */ new Map(), fe = [];
  let Q = 0, ve = !1, de = !1;
  for (let l = 0; l < t; l++)
    for (let m = 0; m < s; m++) {
      const g = (l * s + m) * e;
      for (let n = 0; n < e; n++) {
        const p = i(n, l, m) || "";
        let w = ce.get(p);
        w === void 0 && (w = Fe(p), ce.set(p, w));
        const U = w & 3;
        f[g + n] = U, $[g + n] = w >> 2 & 15, C[g + n] = w >> 8 & 9, w & 512 && fe.push({ x: n, y: l, z: m, downward: !!(w & 1024) }), U !== J && (Q++, U === E ? ve = !0 : de = !0);
      }
    }
  const A = (l, m, g) => (m * s + g) * e + l, k = (l, m, g) => l >= 0 && m >= 0 && g >= 0 && l < e && m < t && g < s, z = (l, m, g, n) => {
    if (!k(m, g, n))
      return 0;
    const p = A(m, g, n);
    return (f[p] & 3) === l ? g + 1 < t && (f[A(m, g + 1, n)] & 3) === l ? 1 : G($[p]) : C[p] & 1 ? -1 : 0;
  }, me = (l) => {
    const m = Math.min(Math.max(Q, 1), 4096), n = (() => ({
      pos: new Z(m * 3 * 4 * 3),
      face: new Z(m * 3 * 4),
      uv: new Z(m * 3 * 4 * 2),
      texture: new Z(m * 3 * 4),
      idx: new Be(m * 3 * 6),
      vcount: 0
    }))();
    let p = 0, w = 0, U = 0, I = 0, pe = 0, te = 0, he = 0;
    const V = (r, a, o) => {
      n.pos.ensure(3), n.face.ensure(1), n.uv.ensure(2), n.texture.ensure(1), n.pos.a[n.pos.n++] = r, n.pos.a[n.pos.n++] = a, n.pos.a[n.pos.n++] = o, n.face.a[n.face.n++] = p;
      const c = r - pe + 0.5, v = o - he + 0.5;
      let x, b;
      return p <= 1 ? I === 1 ? (x = 0.5 + 0.5 * (U * (c - 0.5) - w * (v - 0.5)), b = 0.5 + 0.5 * (w * (c - 0.5) + U * (v - 0.5))) : (x = c, b = v) : (x = (p === 2 ? c : p === 3 ? 1 - c : p === 4 ? 1 - v : v) * 0.5, b = a <= te - 0.5 + T ? 0.5 : (te + 0.5 - a) * 0.5), n.uv.a[n.uv.n++] = x, n.uv.a[n.uv.n++] = b, n.texture.a[n.texture.n++] = I, n.vcount++;
    }, H = (r, a, o, c, v, x, b, D, M, W, B, O) => {
      const _ = V(r, a, o), S = V(c, v, x), y = V(b, D, M), h = V(W, B, O);
      n.idx.ensure(6), n.idx.a[n.idx.n++] = _, n.idx.a[n.idx.n++] = S, n.idx.a[n.idx.n++] = y, n.idx.a[n.idx.n++] = _, n.idx.a[n.idx.n++] = y, n.idx.a[n.idx.n++] = h;
    };
    let q = 0, N = 0;
    const K = (r) => {
      r >= 0.8 ? (q += r * 10, N += 10) : r >= 0 && (q += r, N += 1);
    }, P = (r, a, o, c, v, x) => {
      const b = z(l, r + c, a, o), D = z(l, r, a, o + v);
      if (b >= 1 || D >= 1)
        return 1;
      if (q = 0, N = 0, b > 0 || D > 0) {
        const M = z(l, r + c, a, o + v);
        if (M >= 1)
          return 1;
        K(M);
      }
      return K(x), K(b), K(D), N > 0 ? Math.min(1, q / N) : x;
    }, j = (r, a, o, c) => {
      if (!k(r, a, o))
        return 0;
      const v = A(r, a, o);
      return f[v] === l ? c - G($[v]) : f[v] !== J || C[v] & 1 ? 0 : a > 0 && f[A(r, a - 1, o)] === l ? c - G($[A(r, a - 1, o)]) + 8 / 9 : 0;
    };
    for (let r = 0; r < t; r++)
      for (let a = 0; a < s; a++)
        for (let o = 0; o < e; o++) {
          const c = A(o, r, a);
          if ((f[c] & 3) !== l)
            continue;
          const v = r + 1 < t && (f[A(o, r + 1, a)] & 3) === l;
          if (v && r > 0 && o > 0 && o + 1 < e && a > 0 && a + 1 < s && f[A(o, r - 1, a)] === l && f[c - 1] === l && f[c + 1] === l && f[c - e] === l && f[c + e] === l)
            continue;
          const x = v ? 1 : G($[c]);
          let b, D, M, W;
          x >= 1 ? b = D = M = W = 1 : (b = P(o, r, a, -1, -1, x), D = P(o, r, a, 1, -1, x), M = P(o, r, a, 1, 1, x), W = P(o, r, a, -1, 1, x)), w = U = 0;
          let B = 0;
          if (!v) {
            const u = G($[c]);
            w = j(o + 1, r, a, u) - j(o - 1, r, a, u), U = j(o, r, a + 1, u) - j(o, r, a - 1, u), B = Math.hypot(w, U), B > 0 && (w /= B, U /= B);
          }
          pe = o, te = r, he = a, v || (b -= T, D -= T, M -= T, W -= T);
          const O = o - 0.5, _ = o + 0.5, S = a - 0.5, y = a + 0.5, h = r - 0.5, re = h + b, ae = h + D, ne = h + M, oe = h + W;
          v || (p = 0, I = B > 0 ? 1 : 0, H(O, re, S, O, oe, y, _, ne, y, _, ae, S));
          {
            const u = r > 0 ? f[A(o, r - 1, a)] & 3 : J, X = r > 0 ? C[A(o, r - 1, a)] : 0;
            u !== l && !(X & 1) && (p = 1, I = 0, H(O, h + T, S, _, h + T, S, _, h + T, y, O, h + T, y));
          }
          const Y = (u, X) => {
            if (I = 1, !k(u, r, X))
              return !0;
            const ie = A(u, r, X);
            return l === E && C[ie] & 8 && (I = 2), (f[ie] & 3) !== l && !(C[ie] & 1);
          };
          if (Y(o, a - 1)) {
            p = 2;
            const u = S + T;
            H(_, h, u, O, h, u, O, re, u, _, ae, u);
          }
          if (Y(o, a + 1)) {
            p = 3;
            const u = y - T;
            H(O, h, u, _, h, u, _, ne, u, O, oe, u);
          }
          if (Y(o - 1, a)) {
            p = 4;
            const u = O + T;
            H(u, h, S, u, h, y, u, oe, y, u, re, S);
          }
          if (Y(o + 1, a)) {
            p = 5;
            const u = _ - T;
            H(u, h, y, u, h, S, u, ae, S, u, ne, y);
          }
        }
    const we = ((r) => {
      if (r.idx.n === 0)
        return null;
      const a = new F.BufferGeometry();
      a.setAttribute("position", new F.BufferAttribute(r.pos.view().slice(), 3)), a.setAttribute("aFace", new F.Uint8BufferAttribute(r.face.view(), 1)), a.setAttribute("uv", new F.BufferAttribute(r.uv.view().slice(), 2)), a.setAttribute("aTexture", new F.Uint8BufferAttribute(r.texture.view(), 1)), a.setIndex(new F.BufferAttribute(r.idx.view().slice(), 1)), a.computeBoundingSphere(), a.computeBoundingBox();
      const o = Ee(xe[l]), c = new F.Mesh(a, o);
      return c.name = `fluid:${xe[l]}`, c.userData.animatedSurface = ["uTex", "uFlowTex", "uOverlayTex"].some(
        (v) => Ae(o.uniforms[v].value)
      ), c.frustumCulled = !0, l === E && (c.renderOrder = 3), c.onBeforeRender = () => Le(o, performance.now() / 1e3), c;
    })(n);
    return we ? [we] : [];
  }, ee = [];
  return ve && ee.push(...me(E)), de && ee.push(...me(ge)), { meshes: ee, cells: Q, bubbleCells: fe, ms: performance.now() - d };
}
const ue = /* @__PURE__ */ new Set();
let Te = null;
function Re(i) {
  Te = i;
  for (const e of ue)
    e.userData.bound = !1, e.uniforms.uHasTex.value = 0, e.uniforms.uTex.value = null, e.uniforms.uFlowTex.value = null, se(e);
}
function Ee(i, e = !1) {
  const t = i === "water", s = new F.Color(t ? 4159204 : 16737792).convertLinearToSRGB(), d = new F.ShaderMaterial({
    glslVersion: F.GLSL3,
    vertexShader: Se,
    fragmentShader: Ue,
    uniforms: {
      uTex: { value: null },
      uFlowTex: { value: null },
      uOverlayTex: { value: null },
      uOverlayFrame: { value: new F.Vector3() },
      uOpaque: { value: !t },
      uStillFrame: { value: new F.Vector3() },
      uFlowFrame: { value: new F.Vector3() },
      uHasTex: { value: 0 },
      uTint: { value: s },
      uAlpha: { value: t ? Oe : 1 }
    },
    side: F.DoubleSide,
    forceSinglePass: !0,
    transparent: t,
    depthWrite: !t,
    depthTest: !0,
    // The host block wins coplanar ties on waterlogged faces.
    polygonOffset: t,
    polygonOffsetFactor: t ? 1 : 0,
    polygonOffsetUnits: t ? 1 : 0
  });
  return d.userData.kind = i, d.userData.fluidAlpha = d.uniforms.uAlpha.value, d.userData.bound = !1, ue.add(d), d.addEventListener("dispose", () => ue.delete(d)), se(d), d;
}
function se(i) {
  const e = Te ?? globalThis.liquidFrameTextures, t = i.userData.kind === "water", s = (e == null ? void 0 : e[i.userData.kind]) ?? null, d = (t ? e == null ? void 0 : e.waterFlow : e == null ? void 0 : e.lavaFlow) ?? s, L = (t ? e == null ? void 0 : e.waterOverlay : null) ?? d, f = i.uniforms;
  f.uTex.value === s && f.uFlowTex.value === d && f.uOverlayTex.value === L || (f.uTex.value = s, f.uFlowTex.value = d, f.uOverlayTex.value = L, f.uHasTex.value = s ? 1 : 0);
}
function Le(i, e) {
  se(i);
  const t = i.uniforms;
  t.uTex.value && t.uStillFrame.value.copy(le(t.uTex.value, e)), t.uFlowTex.value && t.uFlowFrame.value.copy(le(t.uFlowTex.value, e)), t.uOverlayTex.value && t.uOverlayFrame.value.copy(le(t.uOverlayTex.value, e));
}
export {
  Ne as buildFluidMeshes,
  Ee as createFluidMaterial,
  We as hasFluid,
  Re as setFluidTextures
};
