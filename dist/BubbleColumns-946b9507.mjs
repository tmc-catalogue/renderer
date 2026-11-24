import * as n from "three";
const x = 8192;
function B(c, y) {
  if (!c.length)
    return null;
  const r = [], m = /* @__PURE__ */ new Map();
  for (const e of c) {
    const o = `${e.x},${e.z}`, t = m.get(o);
    if (t && t.y + t.height === e.y && t.downward === e.downward)
      t.height++;
    else {
      const w = { ...e, height: 1 };
      r.push(w), m.set(o, w);
    }
  }
  const b = c.length * 3, i = Math.min(b, x), f = new Float32Array(i * 4), g = new Float32Array(i * 4), u = new n.Box3();
  for (const e of r)
    u.expandByPoint(new n.Vector3(e.x - 0.5, e.y - 0.5, e.z - 0.5)), u.expandByPoint(new n.Vector3(e.x + 0.5, e.y + e.height - 0.5, e.z + 0.5));
  let h = 0, p = r[0].height * 3;
  const s = (e) => {
    const o = Math.sin(e * 127.1 + 311.7) * 43758.5453;
    return o - Math.floor(o);
  };
  for (let e = 0; e < i; e++) {
    const o = e * b / i;
    for (; o >= p; )
      p += r[++h].height * 3;
    const t = r[h];
    f.set([t.x, t.y - 0.4, t.z, t.height - 0.3], e * 4), g.set(
      [
        s(e * 4),
        s(e * 4 + 1),
        0.08 + s(e * 4 + 2) * 0.06,
        (t.downward ? -1 : 1) * (0.7 + s(e * 4 + 3) * 0.5)
      ],
      e * 4
    );
  }
  const d = new n.PlaneGeometry(1, 1), a = new n.InstancedBufferGeometry();
  a.setIndex(d.index), a.setAttribute("position", d.getAttribute("position")), a.setAttribute("uv", d.getAttribute("uv")), a.setAttribute("aColumn", new n.InstancedBufferAttribute(f, 4)), a.setAttribute("aSeed", new n.InstancedBufferAttribute(g, 4)), a.instanceCount = i, a.boundingBox = u, a.boundingSphere = u.getBoundingSphere(new n.Sphere());
  const l = new n.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBubble: { value: y }, uOpacity: { value: 1 } },
    vertexShader: `
			attribute vec4 aColumn;
			attribute vec4 aSeed;
			uniform float uTime;
			varying vec2 vUv;
			varying float vFade;
			void main() {
				float travel = fract(aSeed.x + uTime * aSeed.w / aColumn.w);
				float angle = aSeed.y * 6.283185 + uTime * (aSeed.w < 0.0 ? 3.0 : 0.8);
				float radius = 0.1 + aSeed.y * 0.2;
				vec3 center = aColumn.xyz + vec3(cos(angle) * radius, travel * aColumn.w, sin(angle) * radius);
				vec4 view = modelViewMatrix * vec4(center, 1.0);
				float scale = length(modelMatrix[0].xyz);
				view.xy += position.xy * aSeed.z * scale;
				gl_Position = projectionMatrix * view;
				vUv = uv;
				vFade = smoothstep(0.0, 0.04, travel) * smoothstep(0.0, 0.04, 1.0 - travel);
			}`,
    fragmentShader: `
			uniform sampler2D uBubble;
			uniform float uOpacity;
			varying vec2 vUv;
			varying float vFade;
			void main() {
				vec4 bubble = texture2D(uBubble, vUv);
				if (bubble.a < 0.1) discard;
				gl_FragColor = vec4(bubble.rgb, bubble.a * vFade * uOpacity);
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
			}`,
    transparent: !0,
    depthWrite: !1
  }), v = new n.Mesh(a, l);
  return v.name = "bubble-column-particles", v.onBeforeRender = () => {
    l.uniforms.uTime.value = performance.now() / 1e3, l.uniforms.uOpacity.value = l.opacity;
  }, v;
}
export {
  x as MAX_BUBBLES,
  B as buildBubbleMesh
};
