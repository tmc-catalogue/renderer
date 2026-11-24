import * as THREE from "three";

export interface BubbleCell {
	x: number;
	y: number;
	z: number;
	downward: boolean;
}

// Three small sprites per block, bounded even for schematics full of columns.
export const MAX_BUBBLES = 8192;

/** One immutable instance buffer; the GPU handles travel, sway and respawning. */
export function buildBubbleMesh(cells: BubbleCell[], texture: THREE.Texture): THREE.Mesh | null {
	if (!cells.length) return null;
	const runs: Array<BubbleCell & { height: number }> = [];
	const lastRun = new Map<string, (typeof runs)[number]>();
	// Fluid meshing visits cells bottom-up, so adjacent cells merge in O(n).
	for (const cell of cells) {
		const key = `${cell.x},${cell.z}`;
		const run = lastRun.get(key);
		if (run && run.y + run.height === cell.y && run.downward === cell.downward) run.height++;
		else {
			const next = { ...cell, height: 1 };
			runs.push(next);
			lastRun.set(key, next);
		}
	}
	const total = cells.length * 3;
	const count = Math.min(total, MAX_BUBBLES);
	const origins = new Float32Array(count * 4);
	const seeds = new Float32Array(count * 4);
	const bounds = new THREE.Box3();
	for (const run of runs) {
		bounds.expandByPoint(new THREE.Vector3(run.x - 0.5, run.y - 0.5, run.z - 0.5));
		bounds.expandByPoint(new THREE.Vector3(run.x + 0.5, run.y + run.height - 0.5, run.z + 0.5));
	}
	let runIndex = 0,
		runEnd = runs[0].height * 3;
	const random = (n: number) => {
		const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
		return v - Math.floor(v);
	};
	for (let i = 0; i < count; i++) {
		const sample = (i * total) / count;
		while (sample >= runEnd) runEnd += runs[++runIndex].height * 3;
		const run = runs[runIndex];
		origins.set([run.x, run.y - 0.4, run.z, run.height - 0.3], i * 4);
		seeds.set(
			[
				random(i * 4),
				random(i * 4 + 1),
				0.08 + random(i * 4 + 2) * 0.06,
				(run.downward ? -1 : 1) * (0.7 + random(i * 4 + 3) * 0.5),
			],
			i * 4
		);
	}
	const plane = new THREE.PlaneGeometry(1, 1);
	const geometry = new THREE.InstancedBufferGeometry();
	geometry.setIndex(plane.index!);
	geometry.setAttribute("position", plane.getAttribute("position"));
	geometry.setAttribute("uv", plane.getAttribute("uv"));
	geometry.setAttribute("aColumn", new THREE.InstancedBufferAttribute(origins, 4));
	geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
	geometry.instanceCount = count;
	geometry.boundingBox = bounds;
	geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
	const material = new THREE.ShaderMaterial({
		uniforms: { uTime: { value: 0 }, uBubble: { value: texture }, uOpacity: { value: 1 } },
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
		transparent: true,
		depthWrite: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = "bubble-column-particles";
	// Participate in normal camera-depth sorting with other translucent batches.
	mesh.onBeforeRender = () => {
		material.uniforms.uTime.value = performance.now() / 1000;
		material.uniforms.uOpacity.value = material.opacity;
	};
	return mesh;
}
