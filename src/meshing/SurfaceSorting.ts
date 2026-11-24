import * as THREE from "three";

/** Stable linear-time depth sorting. Unchanged order never dirties the GPU buffer. */
export function installSurfaceSorting(
	mesh: THREE.Mesh,
	centers: Float32Array,
	onlyWhenTransparent = false
): void {
	const index = mesh.geometry.index!;
	const base = index.array.slice();
	const count = centers.length / 3;
	let order = Uint32Array.from({ length: count }, (_, i) => i);
	let scratch = new Uint32Array(count);
	const depths = new Float32Array(count);
	const bits = new Uint32Array(depths.buffer);
	const keys = new Uint32Array(count);
	const buckets = new Uint32Array(256);
	const view = new THREE.Matrix4();
	const previous = mesh.onBeforeRender;
	let lastX = NaN,
		lastY = NaN,
		lastZ = NaN;
	index.setUsage(THREE.DynamicDrawUsage);
	mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
		previous.call(mesh, renderer, scene, camera, geometry, material, group);
		if (onlyWhenTransparent && !material.transparent) return;
		view.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
		const e = view.elements,
			x = e[2],
			y = e[6],
			z = e[10];
		if (x === lastX && y === lastY && z === lastZ) return;
		lastX = x;
		lastY = y;
		lastZ = z;
		for (let i = 0; i < count; i++)
			depths[i] = centers[i * 3] * x + centers[i * 3 + 1] * y + centers[i * 3 + 2] * z;
		let sorted = true;
		for (let i = 1; i < count; i++)
			if (depths[order[i - 1]] > depths[order[i]]) {
				sorted = false;
				break;
			}
		if (sorted) return;
		for (let i = 0; i < count; i++)
			keys[i] = bits[i] & 0x80000000 ? ~bits[i] : bits[i] ^ 0x80000000;
		for (let shift = 0; shift < 32; shift += 8) {
			buckets.fill(0);
			for (let i = 0; i < count; i++) buckets[(keys[order[i]] >>> shift) & 255]++;
			let offset = 0;
			for (let b = 0; b < 256; b++) {
				const n = buckets[b];
				buckets[b] = offset;
				offset += n;
			}
			for (let i = 0; i < count; i++)
				scratch[buckets[(keys[order[i]] >>> shift) & 255]++] = order[i];
			[order, scratch] = [scratch, order];
		}
		let first = index.count,
			last = -1;
		for (let i = 0; i < count; i++) {
			const src = order[i] * 6,
				dst = i * 6;
			if (index.array[dst] === base[src]) continue;
			first = Math.min(first, dst);
			last = dst + 6;
			for (let k = 0; k < 6; k++) index.array[dst + k] = base[src + k];
		}
		if (last > first) {
			index.addUpdateRange(first, last - first);
			index.needsUpdate = true;
		}
	};
}
