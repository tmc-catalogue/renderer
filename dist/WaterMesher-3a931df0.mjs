var ye = Object.defineProperty;
var Te = (a, e, t) => e in a ? ye(a, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : a[e] = t;
var $ = (a, e, t) => (Te(a, typeof e != "symbol" ? e + "" : e, t), t);
import * as m from "three";
import { W as Ae } from "./index-e23dccc8.mjs";
import "nucleation";
const Me = (
  /* glsl */
  `
in float aFace;
in vec3  aFlow;

out vec3 vPos;          // group-local, center-indexed (continuous across cells)
flat out int  vFace;    // 0 top, 1 bottom, 2 -z, 3 +z, 4 -x, 5 +x
flat out vec3 vFlow;    // xy = downhill gradient (|v| <= 1), z = falling flag

void main() {
  vPos  = position;
  vFace = int(aFace + 0.5);
  vFlow = aFlow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
), Se = (
  /* glsl */
  `
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uTex;
uniform sampler2DArray uFlowTex;
uniform float uHasTex;
uniform vec3 uTint;
uniform vec3 uStillFrame; // current layer, next layer, interpolation
uniform vec3 uFlowFrame;
uniform float uAlpha;

in vec3 vPos;
flat in int vFace;
flat in vec3 vFlow;
layout(location = 0) out vec4 fragColor;

void main() {
  vec3 dx = dFdx(vPos);
  vec3 dy = dFdy(vPos);
  bool side = vFace > 1;
  float speed = length(vFlow.xy);
  bool flowing = side || (vFace == 0 && speed > 0.01);
  vec2 uv;
  vec2 du;
  vec2 dv;
  if (side) {
    // Array layers use image coordinates (Y down). A 32px flow tile spans
    // two blocks, matching the game's 16px/block water texture scale.
    uv = vec2(vPos.x + vPos.z + 0.5, 0.5 - vPos.y) * 0.5;
    du = vec2(dx.x + dx.z, -dx.y) * 0.5;
    dv = vec2(dy.x + dy.z, -dy.y) * 0.5;
  } else {
    uv = vPos.xz + 0.5;
    du = dx.xz;
    dv = dy.xz;
    if (flowing) {
      vec2 dir = vFlow.xy / speed;
      mat2 rotation = mat2(dir.y, dir.x, -dir.x, dir.y);
      uv = rotation * uv * 0.5;
      du = rotation * du * 0.5;
      dv = rotation * dv * 0.5;
    }
  }
  vec4 color = vec4(uTint * 0.6, 0.6);
  if (uHasTex > 0.5) {
    if (flowing) {
      color = mix(textureGrad(uFlowTex, vec3(uv, uFlowFrame.x), du, dv),
                  textureGrad(uFlowTex, vec3(uv, uFlowFrame.y), du, dv), uFlowFrame.z);
    } else {
      color = mix(textureGrad(uTex, vec3(uv, uStillFrame.x), du, dv),
                  textureGrad(uTex, vec3(uv, uStillFrame.y), du, dv), uStillFrame.z);
    }
  }
  float shade = vFace == 0 ? 1.0 : (vFace == 1 ? 0.5 : (vFace <= 3 ? 0.8 : 0.6));
  fragColor = vec4(color.rgb * shade, color.a * uAlpha);
}
`
), _e = (
  /* glsl */
  `
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uTex;
uniform float uHasTex;
uniform vec3  uTint;

uniform float uTime;        // seconds
uniform float uCycle;       // seconds per flow cycle
uniform float uFlowScale;   // blocks/cycle at |gradient| = 1
uniform float uFallSpeed;   // blocks/cycle, downward on falling faces
uniform vec2  uAmbient;     // blocks/cycle drift on flat tops

uniform float uFrame0;      // still-frame array crossfade (computed on CPU)
uniform float uFrame1;
uniform float uFrameMix;

uniform float uLumMean;     // mean luminance of the source texels
uniform float uLumTarget;   // desired mean luminance after recovery
uniform float uGain;        // contrast gain around the mean
uniform float uFoam;
uniform float uLodBias;
uniform float uMaxLod;
uniform float uAlpha;

in vec3 vPos;
flat in int  vFace;
flat in vec3 vFlow;

layout(location = 0) out vec4 fragColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 sampleAnim(vec2 uv, float lod) {
  vec3 a = textureLod(uTex, vec3(uv, uFrame0), lod).rgb;
  vec3 b = textureLod(uTex, vec3(uv, uFrame1), lod).rgb;
  return mix(a, b, uFrameMix);
}

// Two-phase flow mapping: two layers half a cycle apart, each displaced by
// a bounded, centered offset; triangle-wave weights hide the resetting layer.
vec3 sampleFlow(vec2 uv, vec2 perCycle, float phase, float lod) {
  float p0 = fract(phase);
  float p1 = fract(phase + 0.5);
  float w0 = 1.0 - abs(2.0 * p0 - 1.0);
  vec3 c0 = sampleAnim(uv - perCycle * (p0 - 0.5), lod);
  vec3 c1 = sampleAnim(uv - perCycle * (p1 - 0.5), lod);
  return mix(c1, c0, w0);
}

void main() {
  // --- derivatives ONCE, in uniform control flow ---
  vec3 dpx = dFdx(vPos);
  vec3 dpy = dFdy(vPos);
  float fw   = max(length(dpx), length(dpy));          // world units per pixel
  float lodA = clamp(log2(max(fw * 16.0, 1e-6)) + uLodBias, 0.0, uMaxLod);
  float lodB = clamp(lodA - 2.0, 0.0, uMaxLod);        // quarter-scale octave

  // --- per-face UV / flow / brightness (keyed on flat varyings only) ---
  float mag      = length(vFlow.xy);
  vec2  grad     = vFlow.xy * uFlowScale;
  float flatness = 1.0 - smoothstep(0.02, 0.25, mag);
  float strength = min(1.0, mag);

  vec2  uv;
  vec2  flow;
  float bright;

  if (vFace <= 1) {
    uv     = vPos.xz;
    flow   = grad + uAmbient * flatness;
    bright = (vFace == 0) ? 1.0 : 0.5;
  } else {
    uv = vec2(vPos.x + vPos.z, vPos.y);
    if (vFlow.z > 0.5) {
      flow     = vec2(0.0, -uFallSpeed);
      strength = 1.0;
    } else {
      flow = vec2(grad.x + grad.y, -0.15 * uFallSpeed * strength);
    }
    bright = (vFace <= 3) ? 0.8 : 0.6;
  }

  // --- two octaves, each two-phase flow + still-frame crossfade ---
  float phase = uTime / uCycle;
  vec3 cA = sampleFlow(uv, flow, phase, lodA);
  vec2 uvB   = vec2(uv.y, -uv.x) * 0.25;
  vec2 flowB = vec2(flow.y, -flow.x) * 0.25;
  vec3 cB = sampleFlow(uvB, flowB, phase * 0.7 + 0.37, lodB);
  vec3 tex = mix(cA, cB, 0.35);

  vec3 rgb;
  if (uHasTex < 0.5) {
    rgb = uTint * 0.6;
  } else {
    // --- mask recovery: contrast-stretch luminance around its mean, keep hue ---
    float lum  = dot(tex, LUMA);
    float lumC = max(uLumTarget + (lum - uLumMean) * uGain, 0.02);
    rgb = tex * (lumC / max(lum, 1e-4));
    float crest = smoothstep(uLumTarget, uLumTarget * 1.6 + 0.05, lumC);
    rgb = mix(rgb, vec3(0.88, 0.94, 1.0), crest * strength * uFoam);
  }

  fragColor = vec4(min(rgb * bright, vec3(1.0)), uAlpha);
}
`
), ce = 0, I = 1, xe = 2, pe = ["water", "water", "lava"], Le = /^(air|cave_air|void_air)$|glass|pane|bars|leaves|slab|stairs|fence|wall|torch|sign|button|pressure_plate|rail|carpet|trapdoor|door|chain|lantern|flower|grass|fern|sapling|kelp|seagrass|lily_pad|vine|ladder|scaffolding|cobweb|banner|candle|coral|pickle|bamboo|cactus|sugar_cane|bubble_column|campfire|hopper|cauldron|anvil|head|skull|pot|bed$|bell|lever|tripwire|redstone_wire|repeater|comparator|mushroom$|tulip|rose|dandelion|orchid|poppy|lilac|peony|azalea|dripleaf|moss_carpet|sculk_vein|amethyst_cluster|bud$|frogspawn|hanging_roots|spore_blossom|pointed_dripstone|end_rod|brewing_stand|enchanting_table|conduit|chest|shulker_box|cocoa|wheat|carrots|potatoes|beetroots|nether_wart|stem|ice$|slime_block|honey_block|daylight_detector|lectern|stonecutter|grindstone|composter|barrel|snow$/;
function we(a) {
  const e = a.indexOf("level=");
  if (e < 0)
    return 0;
  let t = 0, r = e + 6;
  for (; r < a.length; ) {
    const p = a.charCodeAt(r);
    if (p < 48 || p > 57)
      break;
    t = t * 10 + (p - 48), r++;
  }
  return t > 15 ? 15 : t;
}
const De = /* @__PURE__ */ new Set([
  "bubble_column",
  "kelp",
  "kelp_plant",
  "seagrass",
  "tall_seagrass"
]);
function ge(a) {
  if (!a)
    return 0;
  let e = a, t = "";
  const r = a.indexOf("[");
  return r >= 0 && (e = a.slice(0, r), t = a.slice(r + 1, a.length - 1)), e.startsWith("minecraft:") && (e = e.slice(10)), e === "water" || e === "flowing_water" ? I | we(t) << 2 : e === "lava" || e === "flowing_lava" ? xe | we(t) << 2 : e === "bubble_column" ? I | 512 | (t.includes("drag=true") ? 1024 : 0) : t.indexOf("waterlogged=true") >= 0 || De.has(e) ? I : Le.test(e) ? 0 : 256;
}
function ze(a) {
  return (ge(a) & 3) !== ce;
}
function ue(a) {
  return a >= 8 ? 1 : a === 0 ? 8 / 9 : (8 - a) / 9;
}
class ie {
  constructor(e) {
    $(this, "a");
    $(this, "n", 0);
    this.a = new Float32Array(Math.max(e, 64));
  }
  ensure(e) {
    if (this.n + e <= this.a.length)
      return;
    let t = this.a.length * 2;
    for (; t < this.n + e; )
      t *= 2;
    const r = new Float32Array(t);
    r.set(this.a.subarray(0, this.n)), this.a = r;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}
class Be {
  constructor(e) {
    $(this, "a");
    $(this, "n", 0);
    this.a = new Uint32Array(Math.max(e, 64));
  }
  ensure(e) {
    if (this.n + e <= this.a.length)
      return;
    let t = this.a.length * 2;
    for (; t < this.n + e; )
      t *= 2;
    const r = new Uint32Array(t);
    r.set(this.a.subarray(0, this.n)), this.a = r;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}
const X = 1 / 1024;
function Oe(a, e, t, r) {
  const p = performance.now(), c = e * t * r, f = new Uint8Array(c), S = new Uint8Array(c), w = new Uint8Array(c), D = /* @__PURE__ */ new Map(), G = [];
  let _ = 0, L = !1, z = !1;
  for (let s = 0; s < t; s++)
    for (let d = 0; d < r; d++) {
      const x = (s * r + d) * e;
      for (let o = 0; o < e; o++) {
        const h = a(o, s, d) || "";
        let g = D.get(h);
        g === void 0 && (g = ge(h), D.set(h, g));
        const C = g & 3;
        f[x + o] = C, S[x + o] = g >> 2 & 15, w[x + o] = g >> 8 & 1, g & 512 && G.push({ x: o, y: s, z: d, downward: !!(g & 1024) }), C !== ce && (_++, C === I ? L = !0 : z = !0);
      }
    }
  const B = (s, d, x) => (d * r + x) * e + s, Z = (s, d, x) => s >= 0 && d >= 0 && x >= 0 && s < e && d < t && x < r, ee = (s, d, x, o) => {
    if (!Z(d, x, o))
      return -1;
    const h = B(d, x, o);
    return (f[h] & 3) === s ? x + 1 < t && (f[B(d, x + 1, o)] & 3) === s ? 1 : ue(S[h]) : w[h] ? -1 : 0;
  }, ve = (s) => {
    const d = Math.min(Math.max(_, 1), 4096), o = (() => ({
      pos: new ie(d * 3 * 4 * 3),
      face: new ie(d * 3 * 4),
      flow: new ie(d * 3 * 4 * 3),
      idx: new Be(d * 3 * 6),
      vcount: 0
    }))();
    let h = 0, g = 0, C = 0, ae = 0;
    const K = (n, l, u) => (o.pos.ensure(3), o.face.ensure(1), o.flow.ensure(3), o.pos.a[o.pos.n++] = n, o.pos.a[o.pos.n++] = l, o.pos.a[o.pos.n++] = u, o.face.a[o.face.n++] = h, o.flow.a[o.flow.n++] = g, o.flow.a[o.flow.n++] = C, o.flow.a[o.flow.n++] = ae, o.vcount++), O = (n, l, u, b, k, F, P, U, R, N, T, A) => {
      const y = K(n, l, u), M = K(b, k, F), v = K(P, U, R), V = K(N, T, A);
      o.idx.ensure(6), o.idx.a[o.idx.n++] = y, o.idx.a[o.idx.n++] = M, o.idx.a[o.idx.n++] = v, o.idx.a[o.idx.n++] = y, o.idx.a[o.idx.n++] = v, o.idx.a[o.idx.n++] = V;
    };
    let j = 0, W = 0;
    const q = (n) => {
      n >= 0.8 ? (j += n * 10, W += 10) : n >= 0 && (j += n, W += 1);
    }, Y = (n, l, u, b, k, F) => {
      const P = ee(s, n + b, l, u), U = ee(s, n, l, u + k);
      if (P >= 1 || U >= 1)
        return 1;
      if (j = 0, W = 0, P > 0 || U > 0) {
        const R = ee(s, n + b, l, u + k);
        if (R >= 1)
          return 1;
        q(R);
      }
      return q(F), q(P), q(U), W > 0 ? Math.min(1, j / W) : F;
    };
    for (let n = 0; n < t; n++)
      for (let l = 0; l < r; l++)
        for (let u = 0; u < e; u++) {
          const b = B(u, n, l);
          if ((f[b] & 3) !== s)
            continue;
          const k = n + 1 < t && (f[B(u, n + 1, l)] & 3) === s, F = k ? 1 : ue(S[b]);
          let P, U, R, N;
          if (F >= 1 ? P = U = R = N = 1 : (P = Y(u, n, l, -1, -1, F), U = Y(u, n, l, 1, -1, F), R = Y(u, n, l, 1, 1, F), N = Y(u, n, l, -1, 1, F)), ae = F >= 1 ? 1 : 0, g = 0, C = 0, !ae) {
            const i = (H, le) => {
              if (!Z(H, n, le))
                return 0;
              const Q = B(H, n, le);
              return (f[Q] & 3) === s ? S[Q] >= 8 || n + 1 < t && (f[B(H, n + 1, le)] & 3) === s ? F : F - ue(S[Q]) : w[Q] ? 0 : F;
            };
            g = i(u + 1, l) - i(u - 1, l), C = i(u, l + 1) - i(u, l - 1);
            const E = Math.hypot(g, C);
            E > 1 && (g /= E, C /= E);
          }
          const T = u - 0.5, A = u + 0.5, y = l - 0.5, M = l + 0.5, v = n - 0.5, V = v + P, oe = v + U, re = v + R, ne = v + N;
          k || (h = 0, O(T, V, y, T, ne, M, A, re, M, A, oe, y));
          {
            const i = n > 0 ? f[B(u, n - 1, l)] & 3 : ce, E = n > 0 ? w[B(u, n - 1, l)] : 0;
            i !== s && !E && (h = 1, O(T, v, y, A, v, y, A, v, M, T, v, M));
          }
          const J = (i, E) => {
            if (!Z(i, n, E))
              return !0;
            const H = B(i, n, E);
            return (f[H] & 3) !== s && !w[H];
          };
          if (J(u, l - 1)) {
            h = 2;
            const i = y + X;
            O(A, v, i, T, v, i, T, V, i, A, oe, i);
          }
          if (J(u, l + 1)) {
            h = 3;
            const i = M - X;
            O(T, v, i, A, v, i, A, re, i, T, ne, i);
          }
          if (J(u - 1, l)) {
            h = 4;
            const i = T + X;
            O(i, v, y, i, v, M, i, ne, M, i, V, y);
          }
          if (J(u + 1, l)) {
            h = 5;
            const i = A - X;
            O(i, v, M, i, v, y, i, oe, y, i, re, M);
          }
        }
    const me = ((n) => {
      if (n.idx.n === 0)
        return null;
      const l = new m.BufferGeometry();
      l.setAttribute("position", new m.BufferAttribute(n.pos.view().slice(), 3)), l.setAttribute("aFace", new m.BufferAttribute(n.face.view().slice(), 1)), l.setAttribute("aFlow", new m.BufferAttribute(n.flow.view().slice(), 3)), l.setIndex(new m.BufferAttribute(n.idx.view().slice(), 1)), l.computeBoundingSphere(), l.computeBoundingBox();
      const u = Ce(pe[s]), b = new m.Mesh(l, u);
      return b.name = `fluid:${pe[s]}`, b.frustumCulled = !0, s === I && (b.renderOrder = 3), b.onBeforeRender = () => Ue(u, performance.now() / 1e3), b;
    })(o);
    return me ? [me] : [];
  }, te = [];
  return L && te.push(...ve(I)), z && te.push(...ve(xe)), { meshes: te, cells: _, bubbleCells: G, ms: performance.now() - p };
}
const Fe = {
  // vanilla #3F76E4 tint (luma .448); outMean .85 targets mean luma ~.38 —
  // the old #2F58AB × .60 pair rendered a 20%-gray surface (user: "really dark")
  water: {
    tint: 4159204,
    frameRate: 10,
    cycle: 2.5,
    flowScale: 0.9,
    fallSpeed: 1.4,
    ambient: [0.05, 0.03],
    outMean: 0.85,
    targetStd: 0.17,
    foam: 0.35
  },
  lava: {
    tint: 16777215,
    frameRate: 4,
    cycle: 6,
    flowScale: 0.4,
    fallSpeed: 0.6,
    ambient: [0.02, 0.01],
    outMean: 0.62,
    targetStd: 0.14,
    foam: 0
  }
}, se = new m.Vector3(0.2126, 0.7152, 0.0722), fe = /* @__PURE__ */ new Set();
let be = null;
function He(a) {
  be = a;
  for (const e of fe)
    e.userData.bound = !1, e.uniforms.uHasTex.value = 0, e.uniforms.uTex.value = null, e.uniforms.uFlowTex.value = null, de(e);
}
function Ce(a, e = !1) {
  const t = Fe[a], r = a === "water", p = new m.Color(t.tint).convertLinearToSRGB(), c = new m.ShaderMaterial({
    glslVersion: m.GLSL3,
    vertexShader: Me,
    fragmentShader: r ? Se : _e,
    uniforms: {
      uTex: { value: null },
      uFlowTex: { value: null },
      uStillFrame: { value: new m.Vector3() },
      uFlowFrame: { value: new m.Vector3() },
      uHasTex: { value: 0 },
      uTint: { value: p },
      uTime: { value: 0 },
      uCycle: { value: t.cycle },
      uFlowScale: { value: t.flowScale },
      uFallSpeed: { value: t.fallSpeed },
      uAmbient: { value: new m.Vector2(t.ambient[0], t.ambient[1]) },
      uFrame0: { value: 0 },
      uFrame1: { value: 0 },
      uFrameMix: { value: 0 },
      uLumMean: { value: 0.3 },
      uLumTarget: { value: 0.6 },
      uGain: { value: 1 },
      uFoam: { value: t.foam },
      uLodBias: { value: 0 },
      uMaxLod: { value: 4 },
      uAlpha: { value: r ? Ae : 1 }
    },
    side: r ? m.DoubleSide : m.FrontSide,
    forceSinglePass: !0,
    transparent: r,
    depthWrite: !r,
    depthTest: !0,
    // The host block wins coplanar ties on waterlogged faces.
    polygonOffset: r,
    polygonOffsetFactor: r ? 1 : 0,
    polygonOffsetUnits: r ? 1 : 0
  });
  return c.userData.kind = a, c.userData.fluidAlpha = c.uniforms.uAlpha.value, c.userData.bound = !1, c.userData.layers = 1, c.userData.frameRate = t.frameRate, fe.add(c), c.addEventListener("dispose", () => fe.delete(c)), de(c), c;
}
function Pe(a) {
  const e = a.image, t = e == null ? void 0 : e.data, r = (e == null ? void 0 : e.width) | 0, p = (e == null ? void 0 : e.height) | 0, c = (e == null ? void 0 : e.depth) | 0, f = r * p * c;
  if (!(t instanceof Uint8Array || t instanceof Uint8ClampedArray) || f === 0 || t.length < f * 4)
    return { mean: 0.33, std: 0.08 };
  let S = 0, w = 0;
  for (let _ = 0; _ < f; _++) {
    const L = _ * 4, z = (0.2126 * t[L] + 0.7152 * t[L + 1] + 0.0722 * t[L + 2]) / 255;
    S += z, w += z * z;
  }
  const D = S / f, G = Math.sqrt(Math.max(w / f - D * D, 1e-8));
  return { mean: D, std: G };
}
function de(a) {
  var G, _;
  const e = be ?? globalThis.liquidFrameTextures, t = e == null ? void 0 : e[a.userData.kind];
  if (!t)
    return;
  if (a.userData.kind === "water") {
    const L = (e == null ? void 0 : e.waterFlow) ?? t;
    if (a.uniforms.uTex.value === t && a.uniforms.uFlowTex.value === L)
      return;
    a.uniforms.uTex.value = t, a.uniforms.uFlowTex.value = L, a.uniforms.uHasTex.value = 1, a.userData.layers = t.image.depth, a.userData.flowLayers = L.image.depth, a.userData.bound = !0;
    return;
  }
  if (a.userData.bound)
    return;
  const r = Fe[a.userData.kind], p = new m.Color(r.tint).convertLinearToSRGB(), c = p.r * se.x + p.g * se.y + p.b * se.z, { mean: f, std: S } = Pe(t), w = a.uniforms;
  w.uTex.value = t, w.uHasTex.value = 1, w.uLumMean.value = f, w.uLumTarget.value = c * r.outMean, w.uGain.value = m.MathUtils.clamp(r.targetStd * c / S, 1, 8);
  const D = ((G = t.image) == null ? void 0 : G.width) | 0;
  w.uMaxLod.value = D > 0 ? Math.log2(D) : 4, a.userData.layers = Math.max(1, ((_ = t.image) == null ? void 0 : _.depth) | 0), a.userData.bound = !0, a.needsUpdate = !0;
}
function he(a, e, t, r) {
  const p = a * t, c = Math.floor(p), f = (c % e + e) % e;
  r.set(f, (f + 1) % e, p - c);
}
function Ue(a, e) {
  de(a);
  const t = a.uniforms;
  if (t.uTime.value = e, he(e, a.userData.layers || 1, a.userData.frameRate, t.uStillFrame.value), a.userData.kind === "water")
    he(e, a.userData.flowLayers || 1, 20, t.uFlowFrame.value);
  else {
    const r = t.uStillFrame.value;
    t.uFrame0.value = r.x, t.uFrame1.value = r.y, t.uFrameMix.value = r.z;
  }
}
export {
  Oe as buildFluidMeshes,
  Ce as createFluidMaterial,
  ze as hasFluid,
  He as setFluidTextures
};
