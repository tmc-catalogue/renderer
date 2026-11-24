import * as l from "three";
const z = 8192, M = 1024, H = z * 1024, W = 16, k = 64, E = 1024, te = 4e7;
function Q(e, t, a, o, c) {
  if (t === 0)
    return { rec: e, sections: [] };
  if (t > te)
    return {
      rec: e,
      sections: [{ base: 0, count: t, box: [-2, -2, -2, a + 2, o + 2, c + 2] }]
    };
  const v = Math.ceil(a / W), p = Math.ceil(o / W), x = Math.ceil(c / W), m = v * p * x, h = new Uint32Array(m + 1), d = (s) => {
    const n = e[s * 2], f = n / (a * c) | 0, r = (n / a | 0) % c;
    return (n % a / W | 0) + (r / W | 0) * v + (f / W | 0) * v * x;
  };
  for (let s = 0; s < t; s++)
    h[d(s) + 1]++;
  for (let s = 0; s < m; s++)
    h[s + 1] += h[s];
  const u = new Uint32Array(t * 2), g = h.slice(0, m);
  for (let s = 0; s < t; s++) {
    const n = g[d(s)]++;
    u[n * 2] = e[s * 2], u[n * 2 + 1] = e[s * 2 + 1];
  }
  const y = [];
  for (let s = 0; s < m; s++) {
    const n = h[s + 1] - h[s];
    if (n === 0)
      continue;
    const f = (s / (v * x) | 0) * W, r = (s / v | 0) % x * W, b = s % v * W, T = Math.min(a, b + W) - 1, i = Math.min(o, f + W) - 1, A = Math.min(c, r + W) - 1, w = 2;
    y.push({
      base: h[s],
      count: n,
      box: [b - w, f - w, r - w, T + 1 + w, i + 1 + w, A + 1 + w]
    });
  }
  return { rec: u, sections: y };
}
function Y(e, t, a) {
  const o = [];
  for (let c = 0; c < $(t); c += H) {
    const v = Math.min(H, $(t) - c), p = [];
    for (const x of t) {
      const m = Math.max(x.base, c), h = Math.min(x.base + x.count, c + v);
      m < h && p.push({ base: m - c, count: h - m, box: x.box });
    }
    o.push({ rec: e.subarray(c * 2, (c + v) * 2), items: v, sections: p });
  }
  return o.length === 0 && o.push({ rec: new Uint32Array(0), items: 0, sections: [] }), o;
}
function $(e) {
  let t = 0;
  for (const a of e)
    t = Math.max(t, a.base + a.count);
  return t;
}
function j(e, t, a, o, c, v) {
  const p = new l.Frustum(), x = new l.Matrix4(), m = t.map(() => new l.Box3()), h = t.map(
    (u) => new l.Box3(
      new l.Vector3(u.box[0], u.box[1], u.box[2]),
      new l.Vector3(u.box[3], u.box[4], u.box[5])
    )
  ), d = [];
  e.onBeforeRender = (u, g, y) => {
    var b, T;
    const s = e.material;
    (b = s.uniforms) != null && b.uTime && (s.uniforms.uTime.value = performance.now() / 1e3), (T = s.uniforms) != null && T.uWaterFramesOn && s.uniforms.uWaterFramesOn.value === 0 && Z.water && (s.uniforms.uWaterFrames.value = Z.water, s.uniforms.uWaterFramesOn.value = 1), x.multiplyMatrices(y.projectionMatrix, y.matrixWorldInverse), p.setFromProjectionMatrix(x), e.updateWorldMatrix(!0, !1);
    for (let i = 0; i < h.length; i++)
      m[i].copy(h[i]).applyMatrix4(e.matrixWorld);
    d.length = 0;
    const n = y.getWorldPosition(new l.Vector3());
    for (let i = 0; i < m.length; i++)
      p.intersectsBox(m[i]) && d.push(i);
    d.sort((i, A) => {
      const w = X(m[i], n), _ = X(m[A], n);
      return v ? _ - w : w - _;
    });
    let f = 0;
    for (const i of d) {
      const A = t[i];
      for (let w = 0; w < A.count && !(f * 2 + 1 >= o.length); w += k)
        o[f * 2] = A.base + w, o[f * 2 + 1] = Math.min(k, A.count - w), f++;
    }
    for (let i = f; i < o.length / 2; i++)
      o[i * 2] = 0, o[i * 2 + 1] = 0;
    a.needsUpdate = !0, e.userData.pagesDrawn = f;
    const r = e.geometry.index ? e.geometry.index.count : 1 / 0;
    e.geometry.setDrawRange(0, Math.min(f * k * c, r));
  }, e.userData.pagesDrawn = Math.ceil($(t) / k);
}
function X(e, t) {
  const a = Math.max(e.min.x - t.x, 0, t.x - e.max.x), o = Math.max(e.min.y - t.y, 0, t.y - e.max.y), c = Math.max(e.min.z - t.z, 0, t.z - e.max.z);
  return a * a + o * o + c * c;
}
const ee = (
  /* glsl */
  `
precision highp float;
precision highp int;
precision highp usampler2D;
uniform highp usampler2D uRecords;  // RG32UI: (linear cell index, template triangle row)
uniform highp usampler2D uRows;     // RGBA32UI: (c0, c1, c2, _) absolute template vertex ids
uniform highp usampler2D uPages;    // RG32UI: (base item, count) per ${k}-item page
uniform highp sampler2D uPos;       // RGBA32F corner positions (block-local)
uniform highp sampler2D uNrm;       // RGBA32F
uniform highp sampler2D uUv;        // RGBA32F atlas-space uvs
uniform vec3 uDims;                 // sx, sy, sz (vec3 — uvec3 uniform setters vary)
uniform vec4 uPow2;                 // (xMask, zShiftZMask, yShift, enabled) — pow2 fast decode (gpt-6 #3)
out vec2 vUv;
out float vShade;
out float vWy;
out float vCy;
// strip animation (liquid still/flow): signed frames, frame step, frame-0 top V.
// FLAT: these are per-face constants; interpolating them lets a quad straddle
// two parameter sets and feeds a varying into fragment control flow.
flat out float vAnimF;
flat out float vStep;
flat out float vTop;
// fable water: full world position (smooth) + face normal (flat) for the frame-array path
out vec3 vWp;
flat out vec3 vNw;
uniform vec2 uLayerClip; // (enabled, topY) — slice view: discard fragments above grid Y
void main() {
  uint vid = uint(gl_VertexID);
  // slot -> page -> real record (culling happens by rewriting the page table per frame)
  uint slot = vid / 3u;
  uint k = vid - slot * 3u;
  uint page = slot / ${k}u;
  uint local = slot - page * ${k}u;
  uvec2 pe = texelFetch(uPages, ivec2(int(page & ${E - 1}u), int(page / ${E}u)), 0).rg;
  if (local >= pe.y) { gl_Position = vec4(2e9, 2e9, 2e9, 1.0); return; } // padded slot
  uint tri = pe.x + local;
  uvec2 rec = texelFetch(uRecords, ivec2(int(tri & ${z - 1}u), int(tri / ${z}u)), 0).rg;
  uint cell = rec.x;
  uint row = rec.y;
  uint sx = uint(uDims.x), sy = uint(uDims.y), sz = uint(uDims.z);
  // pow2 dims avoid three runtime integer div/mod per vertex (uniform branch, cheap);
  // the general path stays for builds like 64x48x64 whose sy isn't a power of two
  uvec3 bc;
  if (uPow2.w > 0.5) {
    bc = uvec3(cell & uint(uPow2.x), cell >> uint(uPow2.z), (cell >> uint(uPow2.y)) & uint(uPow2.x));
  } else {
    bc = uvec3(cell % sx, cell / (sx * sz), (cell / sx) % sz); // x, y, z
  }
  uvec4 corners = texelFetch(uRows, ivec2(int(row) & ${M - 1}, int(row) / ${M}), 0);
  uint vi = k == 0u ? corners.x : (k == 1u ? corners.y : corners.z);
  ivec2 ct = ivec2(int(vi) & ${M - 1}, int(vi) / ${M});
  vec3 pos = texelFetch(uPos, ct, 0).xyz;
  vUv = texelFetch(uUv, ct, 0).xy;
  // Fixed WORLD-space face shading (vanilla-style: top 1.0, bottom 0.5, z 0.8, x 0.6).
  // The previous view-space light (normalMatrix * n dotted with a fixed dir) made the
  // bright/dark set reshuffle with every camera move — the "black/white checker that
  // flickers when moving" artifact. Template normals are grid-space = world-space.
  vec3 wn = texelFetch(uNrm, ct, 0).xyz;
  float ax = abs(wn.x), ay = abs(wn.y), az = abs(wn.z);
  vShade = (ay >= ax && ay >= az) ? (wn.y > 0.0 ? 1.0 : 0.5) : (az >= ax ? 0.8 : 0.6);
  // oracle-frozen arithmetic: same componentwise f32 add the compute mesher performs
  vec3 world = vec3(bc) + pos;
  vWy = world.y;
  vCy = float(bc.y); // owning CELL y — layer slicing is cell-aligned, not a geometry cut
  // animation channels ride in the free w components of the corner tables
  vAnimF = texelFetch(uUv, ct, 0).w;
  vStep = texelFetch(uPos, ct, 0).w;
  vTop = texelFetch(uNrm, ct, 0).w;
  // world position + normal for the water frame-array path (fable)
  vWp = world;
  vNw = wn;
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(world, 1.0));
}`
), oe = ee.replace("uint slot = vid / 3u;", "uint slot = vid / 4u;").replace("uint k = vid - slot * 3u;", "uint k = vid - slot * 4u;").replace(
  "uint vi = k == 0u ? corners.x : (k == 1u ? corners.y : corners.z);",
  "uint vi = k == 0u ? corners.x : (k == 1u ? corners.y : (k == 2u ? corners.z : corners.w));"
), K = (
  /* glsl */
  `
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uAtlas;
uniform sampler2DArray uWaterFrames; // fable: liquid frames as array LAYERS (hardware wrap, no atlas bleed)
uniform float uWaterFramesOn;        // 1.0 when the array texture is loaded
uniform vec2 uLayerClip;
uniform float uShadeMix;
uniform float uTime;
in vec2 vUv;
in float vShade;
in float vWy;
in float vCy;
// per-primitive constants: flat, so a quad never blends two faces' parameters
flat in float vAnimF;
flat in float vStep;
flat in float vTop;
in vec3 vWp;
flat in vec3 vNw;
layout(location = 0) out vec4 outColor;

// ONE world-space flow for the whole water body (blocks per second).
// Tops scroll by (x,z); x-normal sides scroll along z by WATER_FLOW.y; z-normal
// sides scroll along x by WATER_FLOW.x; every side also falls by WATER_FALL.
// Shared edges therefore move identically on both faces ("one continuous flow").
const vec2  WATER_FLOW = vec2(0.045, 0.030);
const float WATER_FALL = 0.090;
const float WATER_FPS  = 5.0;
const float WATER_TEXELS_PER_BLOCK = 16.0;
// second octave at 1/4 scale breaks the 1-block tile period (same mean, same flow)
const float WATER_OCT2_SCALE = 0.25;
const float WATER_OCT2_MIX   = 0.35;

// two-frame cross-fade at ONE explicit LOD (no implicit derivatives anywhere in
// the water path -> defined regardless of the enclosing non-uniform branch)
vec4 waterTap(vec2 uv, float k0, float k1, float fk, float lod) {
  vec4 a = textureLod(uWaterFrames, vec3(uv, k0), lod);
  vec4 b = textureLod(uWaterFrames, vec3(uv, k1), lod);
  return mix(a, b, fk);
}

void main() {
  // ---- ALL derivatives up front, in uniform control flow, before any discard ----
  // atlas path
  vec2 duv = vUv * 2048.0;
  float dx2 = dot(dFdx(duv), dFdx(duv));
  float dy2 = dot(dFdy(duv), dFdy(duv));
  float lod = 0.5 * log2(max(dx2, dy2));

  // water path: world-space uv for THIS face (normal is flat -> constant per primitive)
  vec3 an = abs(vNw);
  vec2 wuv;
  vec2 scroll;
  if (an.y > 0.5) {
    wuv = vWp.xz;
    scroll = WATER_FLOW;
  } else if (an.x > 0.5) {
    wuv = vWp.zy;
    scroll = vec2(WATER_FLOW.y, WATER_FALL);
  } else {
    wuv = vWp.xy;
    scroll = vec2(WATER_FLOW.x, WATER_FALL);
  }
  // scroll is spatially constant, so it does not change the derivatives
  wuv += scroll * uTime;
  vec2 wduv = wuv * WATER_TEXELS_PER_BLOCK;
  float wdx2 = dot(dFdx(wduv), dFdx(wduv));
  float wdy2 = dot(dFdy(wduv), dFdy(wduv));
  // ISOTROPIC (max-axis) LOD: the footprint's long axis decides, so the result does
  // not depend on footprint orientation -> no view-direction-dependent mip patchwork.
  // Level 4 of a 16x16 layer is its 1x1 mean: distance converges to a uniform sheet.
  float wlod = clamp(0.5 * log2(max(max(wdx2, wdy2), 1e-12)), 0.0, 4.0);
  // 1/4-scale octave has 4x fewer texels per pixel -> two levels sharper
  float wlod2 = clamp(wlod - 2.0, 0.0, 4.0);

  // layer slice, CELL-aligned: partial geometry (fences are 1.5 tall, slabs 0.5)
  // belongs wholly to its owning cell, so Minecraft layer view must cut on bc.y,
  // not on world Y (a Y-plane halves fences/panes at layer boundaries)
  if (uLayerClip.x > 0.5 && vCy > uLayerClip.y + 0.5) discard;

  // Cap atlas mip selection at level 4 (a 16px tile is 1px there): levels 5+ average
  // across atlas tiles — foreign colors and the transparent padding between tiles.
  // ISOTROPIC textureLod, not textureGrad: anisotropic footprints at the LOD-4 cap
  // stretch flat-on wall faces ACROSS neighbouring atlas tiles.
  vec4 c;
  if (vAnimF != 0.0 && uWaterFramesOn > 0.5) {
    // fable WATER ARRAY PATH: frames are array LAYERS (16x16 each) with hardware
    // RepeatWrapping; uvs are world coordinates (continuous across every block
    // boundary by construction); nothing can sample outside the water texture.
    float nFrames = float(textureSize(uWaterFrames, 0).z);
    float ft = mod(uTime * WATER_FPS, nFrames);
    float k0 = floor(ft);
    float k1 = mod(k0 + 1.0, nFrames);
    float fk = ft - k0;
    vec4 c1 = waterTap(wuv, k0, k1, fk, wlod);
    vec4 c2 = waterTap(wuv * WATER_OCT2_SCALE + vec2(0.37, 0.61), k0, k1, fk, wlod2);
    c = mix(c1, c2, WATER_OCT2_MIX);
  } else {
    vec2 tuv = vUv;
    if (vAnimF > 0.5) {
      float k = floor(mod(uTime * 5.0, vAnimF));
      float lv = clamp(vUv.y - (vTop - vStep), 0.03 * vStep, 0.97 * vStep);
      tuv.y = (vTop - vStep) + lv - k * vStep;
    } else if (vAnimF < -0.5) {
      float frames = -vAnimF;
      float k = floor(mod(uTime * 5.0, frames));
      float q = clamp(fract(vWy * 0.5 + uTime * 0.25), 0.03, 0.97);
      tuv.y = (vTop - k * vStep) - q * vStep;
      float lu = clamp(fract(vUv.x / vStep), 0.03, 0.97);
      float u0 = vUv.x - lu * vStep;
      tuv.x = u0 + fract(lu + vWp.x + vWp.z + uTime * 0.08) * vStep;
    }
    c = textureLod(uAtlas, tuv, min(lod, 4.0));
  }
  /*CUTOUT*/
  // uShadeMix: 1.0 = full vanilla directional shade (opaque blocks); transparent
  // materials (water) soften toward 1.0 — vanilla's 0.5 bottom-face shade makes
  // water read near-black when looked at from below ("dark blue from underneath")
  outColor = vec4(c.rgb * mix(1.0, vShade, uShadeMix), /*ALPHA*/);
  #ifdef TONE_MAPPING
    outColor.rgb = toneMapping(outColor.rgb);
  #endif
  outColor = linearToOutputTexel(outColor);
}`
), Z = {
  water: null,
  waterFlow: null,
  lava: null,
  lavaFlow: null,
  waterOverlay: null
};
function J(e, t = !1) {
  const a = e ? K.replace("/*CUTOUT*/", "if (c.a < 0.5) discard;").replace("/*ALPHA*/", "c.a") : K.replace("/*CUTOUT*/", "").replace("/*ALPHA*/", "1.0");
  return new l.ShaderMaterial({
    glslVersion: l.GLSL3,
    vertexShader: t ? oe : ee,
    fragmentShader: a,
    transparent: e,
    depthWrite: !e,
    side: l.FrontSide,
    forceSinglePass: !0,
    uniforms: {
      uRecords: { value: null },
      uRows: { value: null },
      uPages: { value: null },
      uPos: { value: null },
      uNrm: { value: null },
      uUv: { value: null },
      uAtlas: { value: null },
      uDims: { value: new l.Vector3(1, 1, 1) },
      uPow2: { value: new l.Vector4(0, 0, 0, 0) },
      // (xMask, xBits, yShift, enabled)
      uLayerClip: { value: new l.Vector2(0, 1e9) },
      // transparent (water/glass): NO directional shading — vShade varies by face
      // (top 1.0 / bottom 0.5) which reads as water changing color with view
      // angle. Opaque blocks keep full vanilla shading for 3D read.
      uShadeMix: { value: e ? 0 : 1 },
      uTime: { value: 0 },
      // strip animation clock (set per frame in onBeforeRender)
      uWaterFrames: { value: null },
      uWaterFramesOn: { value: 0 }
    }
  });
}
function ne(e, t, a, o) {
  if (a.length >= e * t * o)
    return a;
  const c = new Uint32Array(e * t * o);
  return c.set(a), c;
}
function re(e, t, a) {
  if (a.length >= e * t * 4)
    return a;
  const o = new Float32Array(e * t * 4);
  return o.set(a), o;
}
function D(e, t, a, o, c) {
  const v = o === l.RGIntegerFormat ? 2 : 4;
  a = ne(e, t, a, v);
  const p = new l.DataTexture(a, e, t, o, l.UnsignedIntType);
  return p.internalFormat = c, p.needsUpdate = !0, p.magFilter = l.NearestFilter, p.minFilter = l.NearestFilter, p.generateMipmaps = !1, p;
}
function V(e, t, a) {
  a = re(e, t, a);
  const o = new l.DataTexture(a, e, t, l.RGBAFormat, l.FloatType);
  return o.internalFormat = "RGBA32F", o.needsUpdate = !0, o.magFilter = l.NearestFilter, o.minFilter = l.NearestFilter, o.generateMipmaps = !1, o;
}
function ae(e, t, a) {
  const o = /* @__PURE__ */ new Map(), c = (n) => {
    if (!o.has(n)) {
      const f = a(n, n + 1);
      o.set(n, f.quad ? f.corners : null);
    }
    return o.get(n);
  }, v = [], p = /* @__PURE__ */ new Map(), x = new Uint32Array(Math.ceil(t / 2)), m = new Uint32Array(Math.ceil(t / 2)), h = new Uint32Array(t * 2);
  let d = 0, u = 0;
  const g = new Uint8Array(t), y = /* @__PURE__ */ new Map();
  for (let n = 0; n < t; n++) {
    const f = e[n * 2], r = e[n * 2 + 1], b = y.get(f);
    if (b !== void 0 && e[b * 2 + 1] === r - 1) {
      const T = c(r - 1);
      if (T) {
        const i = T.join(",");
        let A = p.get(i);
        A === void 0 && (A = v.length / 4, v.push(T[0], T[1], T[2], T[3]), p.set(i, A)), x[d] = f, m[d] = A, d++, g[b] = 1, g[n] = 1, y.delete(f);
        continue;
      }
    }
    y.set(f, n);
  }
  const s = new Uint32Array(d * 2);
  for (let n = 0; n < d; n++)
    s[n * 2] = x[n], s[n * 2 + 1] = m[n];
  for (let n = 0; n < t; n++)
    g[n] || (h[u++] = e[n * 2], h[u++] = e[n * 2 + 1]);
  return {
    quadRec: s,
    quads: d,
    cornerTable: v,
    triRec: h.subarray(0, u),
    triTris: u / 2
  };
}
function se(e) {
  const t = new Uint32Array(e * 6);
  for (let a = 0, o = 0, c = 0; a < e; a++, o += 4)
    t[c++] = o, t[c++] = o + 1, t[c++] = o + 2, t[c++] = o, t[c++] = o + 2, t[c++] = o + 3;
  return new l.BufferAttribute(t, 1);
}
function le(e, t, a) {
  const o = e.tables, c = Math.ceil(o.rows / M), v = Math.ceil(o.verts / M), p = V(M, v, o.tplPos), x = V(M, v, o.tplNrm), m = V(M, v, o.tplUv), h = D(M, c, o.rowCorners, l.RGBAIntegerFormat, "RGBA32UI"), d = [];
  for (const u of e.perCategory) {
    if (u.tris === 0)
      continue;
    const g = u.category !== "solid", y = u.y0 ?? 0, s = u.h ?? e.sy;
    let n = null, f = u.records, r = u.tris;
    if (a) {
      const i = ae(u.records, u.tris, a);
      n = { quadRec: i.quadRec, quads: i.quads, cornerTable: i.cornerTable }, f = i.triRec, r = i.triTris;
    }
    const b = Q(f, r, e.sx, e.sy, e.sz), T = n ? Q(n.quadRec, n.quads, e.sx, e.sy, e.sz) : null;
    for (const i of Y(b.rec, b.sections)) {
      const { rec: A, items: w, sections: _ } = i;
      if (w === 0)
        continue;
      const L = Math.ceil(w / z), q = new Uint32Array(L * z * 2);
      q.set(A);
      const B = D(z, L, q, l.RGIntegerFormat, "RG32UI"), O = Math.ceil(w / k), I = new Uint32Array(E * Math.ceil(O / E) * 2), F = D(
        E,
        Math.ceil(O / E),
        I,
        l.RGIntegerFormat,
        "RG32UI"
      ), R = J(g);
      u.category === "water" && (R.depthWrite = !0), R.uniforms.uRecords.value = B, R.uniforms.uRows.value = h, R.uniforms.uPages.value = F, R.uniforms.uPos.value = p, R.uniforms.uNrm.value = x, R.uniforms.uUv.value = m, R.uniforms.uDims.value.set(e.sx, e.sy, e.sz);
      {
        const P = Math.log2(e.sx), S = e.sx === e.sz && Number.isInteger(P) && e.sx > 0;
        R.uniforms.uPow2.value.set(
          S ? e.sx - 1 : 0,
          S ? P : 0,
          S ? P * 2 : 0,
          S ? 1 : 0
        );
      }
      R.uniforms.uAtlas.value = t;
      const C = new l.BufferGeometry();
      C.setDrawRange(0, Math.ceil(w / k) * k * 3), C.boundingBox = new l.Box3(
        new l.Vector3(-0.51, y - 0.51, -0.51),
        new l.Vector3(e.sx - 0.49, y + s + 0.01, e.sz - 0.49)
      ), C.boundingSphere = C.boundingBox.getBoundingSphere(new l.Sphere());
      const U = new l.Mesh(C, R);
      U.userData.category = u.category, U.userData.gpuBuilt = !0, U.userData.recordDrawn = w, U.frustumCulled = !0, U.matrixAutoUpdate = !1, U.updateMatrix(), j(U, _, F, I, 3, g), d.push(U);
    }
    if (n && n.quads > 0) {
      const i = new Uint32Array(Math.max(n.cornerTable.length, M * 4));
      i.set(n.cornerTable);
      const A = D(
        M,
        Math.ceil(i.length / 4 / M),
        i,
        l.RGBAIntegerFormat,
        "RGBA32UI"
      );
      for (const w of Y(T.rec, T.sections)) {
        const { rec: _, items: L, sections: q } = w;
        if (L === 0)
          continue;
        const B = Math.ceil(L / z), O = new Uint32Array(B * z * 2);
        O.set(_);
        const I = D(z, B, O, l.RGIntegerFormat, "RG32UI"), F = J(g, !0);
        u.category === "water" && (F.depthWrite = !0), F.uniforms.uRecords.value = I, F.uniforms.uRows.value = A, F.uniforms.uPos.value = p, F.uniforms.uNrm.value = x, F.uniforms.uUv.value = m, F.uniforms.uDims.value.set(e.sx, e.sy, e.sz);
        {
          const N = Math.log2(e.sx), G = e.sx === e.sz && Number.isInteger(N) && e.sx > 0;
          F.uniforms.uPow2.value.set(
            G ? e.sx - 1 : 0,
            G ? N : 0,
            G ? N * 2 : 0,
            G ? 1 : 0
          );
        }
        F.uniforms.uAtlas.value = t;
        const R = Math.ceil(L / k), C = new Uint32Array(E * Math.ceil(R / E) * 2), U = D(
          E,
          Math.ceil(R / E),
          C,
          l.RGIntegerFormat,
          "RG32UI"
        );
        F.uniforms.uPages.value = U;
        const P = new l.BufferGeometry();
        P.setIndex(se(L)), P.setDrawRange(0, Math.min(Math.ceil(L / k) * k * 6, L * 6)), P.boundingBox = new l.Box3(
          new l.Vector3(-0.51, y - 0.51, -0.51),
          new l.Vector3(e.sx - 0.49, y + s + 0.01, e.sz - 0.49)
        ), P.boundingSphere = P.boundingBox.getBoundingSphere(new l.Sphere());
        const S = new l.Mesh(P, F);
        S.userData.category = u.category, S.userData.gpuBuilt = !0, S.userData.recordDrawn = L, S.matrixAutoUpdate = !1, S.updateMatrix(), j(S, q, U, C, 6, g), d.push(S);
      }
    }
  }
  return d;
}
function ie(e, t, a, o, c, v, p, x = [], m = [], h = []) {
  const d = e.length / 3, u = new Float32Array(d * 4), g = new Float32Array(d * 4), y = new Float32Array(d * 4);
  for (let r = 0; r < d; r++)
    u[r * 4] = e[r * 3], u[r * 4 + 1] = e[r * 3 + 1], u[r * 4 + 2] = e[r * 3 + 2], g[r * 4] = t[r * 3], g[r * 4 + 1] = t[r * 3 + 1], g[r * 4 + 2] = t[r * 3 + 2], y[r * 4] = a[r * 2], y[r * 4 + 1] = a[r * 2 + 1], u[r * 4 + 3] = x[r] || 0, g[r * 4 + 3] = m[r] || 0, y[r * 4 + 3] = h[r] || 0;
  let s = 0;
  for (let r = 1; r <= p; r++)
    s += Math.floor(v[r * 4 + 1] / 3);
  const n = new Uint32Array(Math.max(s, 1) * 4);
  let f = 0;
  for (let r = 1; r <= p; r++) {
    const b = c[r * 4 + 1], T = Math.floor(v[r * 4 + 1] / 3);
    for (let i = 0; i < T; i++)
      n[f * 4] = o[b + i * 3], n[f * 4 + 1] = o[b + i * 3 + 1], n[f * 4 + 2] = o[b + i * 3 + 2], f++;
  }
  return { rowCorners: n, rows: Math.max(f, 1), tplPos: u, tplNrm: g, tplUv: y, verts: d };
}
export {
  te as SECTIONIZE_MAX,
  ie as buildRecordTables,
  Z as liquidFrameTextures,
  J as makePullMaterial,
  se as makeQuadIndexBuffer,
  le as makeRecordMeshes,
  ae as quadify,
  Q as sectionize
};
