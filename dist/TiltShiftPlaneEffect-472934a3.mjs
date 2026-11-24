var d = Object.defineProperty;
var m = (n, o, e) => o in n ? d(n, o, { enumerable: !0, configurable: !0, writable: !0, value: e }) : n[o] = e;
var l = (n, o, e) => (m(n, typeof o != "symbol" ? o + "" : o, e), e);
import { Effect as v, EffectAttribute as f } from "./index-0eb91b38.mjs";
import { Uniform as i, Matrix4 as g, Vector3 as s } from "three";
const w = `
uniform mat4 invViewProjection;
uniform vec3 focusPoint;
uniform vec3 focusNormal;
uniform float focusRange;
uniform float blurStrength;

// Postprocessing auto-injects \`depthBuffer\` and \`DEPTH_PACKING\` when the
// effect has the DEPTH attribute; we just read from them here. The two
// branches handle the standard RGBA-packed depth and the raw float depth
// representations the framework can choose between.
float sampleDepth(vec2 uv) {
#if DEPTH_PACKING == 3201
    return unpackRGBAToDepth(texture2D(depthBuffer, uv));
#else
    return texture2D(depthBuffer, uv).r;
#endif
}

// Reconstruct the pixel's world position from screen UV + depth-buffer depth.
// The depth value is in [0,1] non-linear z-buffer space; NDC is [-1,1].
vec3 reconstructWorld(vec2 uv, float depth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 wp = invViewProjection * ndc;
    return wp.xyz / wp.w;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float depth = sampleDepth(uv);

    // Skybox / nothing-rendered pixels stay sharp.
    if (depth >= 0.9999) {
        outputColor = inputColor;
        return;
    }

    vec3 world = reconstructWorld(uv, depth);

    // Perpendicular distance to the focus plane. CoC ramps from 0 inside
    // the in-focus slab to 1 once we're a full \`focusRange\` outside it.
    float planeDist = abs(dot(world - focusPoint, focusNormal));
    float coc = clamp((planeDist - focusRange) / max(focusRange, 0.001), 0.0, 1.0);

    if (coc < 0.01) {
        outputColor = inputColor;
        return;
    }

    // Vogel disk sampling: golden-angle spiral, gives evenly distributed taps
    // without needing a pre-baked lookup array (works in WebGL1 and WebGL2).
    float radius = coc * blurStrength;
    vec2 aspectFix = vec2(1.0 / aspect, 1.0);
    vec4 sum = vec4(0.0);
    const float GOLDEN_ANGLE = 2.39996323;
    for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / 16.0);
        float theta = fi * GOLDEN_ANGLE;
        vec2 offset = vec2(cos(theta), sin(theta)) * r * radius * aspectFix;
        sum += texture2D(inputBuffer, uv + offset);
    }
    outputColor = sum * (1.0 / 16.0);
}
`;
class N extends v {
  constructor(e, r = {}) {
    var a, t;
    super("TiltShiftPlaneEffect", w, {
      // DEPTH: composer attaches the depth texture so we can read it.
      // CONVOLUTION: forces the effect into its own pass (so the merged-
      // pass varying-name collisions we hit earlier can't happen).
      attributes: f.DEPTH | f.CONVOLUTION,
      uniforms: /* @__PURE__ */ new Map([
        ["invViewProjection", new i(new g())],
        ["focusPoint", new i(((a = r.focusPoint) == null ? void 0 : a.clone()) ?? new s())],
        [
          "focusNormal",
          new i((((t = r.focusNormal) == null ? void 0 : t.clone()) ?? new s(0, 0, -1)).normalize())
        ],
        ["focusRange", new i(r.focusRange ?? 2)],
        ["blurStrength", new i(r.blurStrength ?? 0.01)]
      ])
    });
    l(this, "camera");
    this.camera = e;
  }
  /**
   * Recompute the inverse view-projection matrix each frame. The shader
   * uses it to convert sampled depths into world positions.
   */
  update(e, r, a) {
    const t = this.camera;
    t.updateMatrixWorld(), this.uniforms.get("invViewProjection").value.multiplyMatrices(t.projectionMatrix, t.matrixWorldInverse).invert();
  }
  setFocusPoint(e) {
    this.uniforms.get("focusPoint").value.copy(e);
  }
  setFocusNormal(e) {
    this.uniforms.get("focusNormal").value.copy(e).normalize();
  }
  setFocusRange(e) {
    this.uniforms.get("focusRange").value = Math.max(1e-3, e);
  }
  setBlurStrength(e) {
    this.uniforms.get("blurStrength").value = Math.max(0, e);
  }
  /**
   * Convenience: tilt the focus plane by `pitchDeg`/`yawDeg` relative to the
   * current camera frame. Pitch rotates around the camera's local right
   * axis, yaw rotates around the camera's local up axis. Pitch ≠ 0 is the
   * actual Scheimpflug "tilt" that produces the diagonal focus plane.
   */
  setTiltAngles(e, r) {
    const a = this.camera;
    a.updateMatrixWorld();
    const t = a.quaternion, c = new s(0, 0, -1).applyQuaternion(t), p = new s(1, 0, 0).applyQuaternion(t), h = new s(0, 1, 0).applyQuaternion(t), u = c.clone();
    u.applyAxisAngle(p, e * Math.PI / 180), u.applyAxisAngle(h, r * Math.PI / 180), this.setFocusNormal(u);
  }
}
export {
  N as TiltShiftPlaneEffect
};
