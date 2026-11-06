// UVs and flow selection are baked once by the mesher using Minecraft's per-face mapping.
// One sample per vanilla fragment; a second sample only for packs requesting interpolation.
export const FLUID_VERT = /* glsl */ `
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
`;

export const FLUID_FRAG = /* glsl */ `
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
`;
