import { Effect as t, BlendFunction as r } from "./index-0eb91b38.mjs";
import { Uniform as n } from "three";
class u extends t {
  constructor(o = 2.2) {
    super("GammaCorrectionEffect", m, {
      blendFunction: r.NORMAL,
      uniforms: /* @__PURE__ */ new Map([["gamma", new n(o)]])
    });
  }
  setGamma(o) {
    this.uniforms.get("gamma").value = o;
  }
}
const m = `
uniform float gamma;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (gamma == 0.0) {
        outputColor = inputColor;
        return;
    }
    vec3 color = pow(inputColor.rgb, vec3(1.0 / gamma));
    outputColor = vec4(color, inputColor.a);
}
`;
export {
  u as GammaCorrectionEffect
};
