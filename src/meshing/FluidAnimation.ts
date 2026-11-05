import * as THREE from "three";

export interface FluidAnimationMetadata {
	animation?: {
		width?: number;
		height?: number;
		frametime?: number;
		frames?: (number | { index: number; time?: number })[];
		interpolate?: boolean;
	};
}
interface Animation {
	indices: number[];
	ends: number[];
	duration: number;
	interpolate: boolean;
	lastTime: number;
	frame: THREE.Vector3;
}
const animations = new WeakMap<THREE.DataArrayTexture, Animation>();

/** Compile the timeline once. Repeated indices share a GPU layer instead of duplicating pixels. */
export function registerFluidAnimation(
	texture: THREE.DataArrayTexture,
	metadata?: FluidAnimationMetadata
): void {
	const animation = metadata?.animation;
	const count = texture.image.depth;
	const defaultTime = Math.max(1, Math.floor(animation?.frametime || 1));
	const frames = animation ? (animation.frames ?? Array.from({ length: count }, (_, i) => i)) : [0];
	const indices: number[] = [],
		ends: number[] = [];
	let duration = 0;
	for (const entry of frames) {
		const index = typeof entry === "number" ? entry : entry.index;
		const time = typeof entry === "number" ? defaultTime : (entry.time ?? defaultTime);
		if (
			!Number.isInteger(index) ||
			index < 0 ||
			index >= count ||
			!Number.isInteger(time) ||
			time <= 0
		)
			continue;
		indices.push(index);
		ends.push((duration += time));
	}
	if (!indices.length) {
		indices.push(0);
		ends.push((duration = 1));
	}
	animations.set(texture, {
		indices,
		ends,
		duration,
		interpolate: !!animation?.interpolate,
		lastTime: NaN,
		frame: new THREE.Vector3(indices[0], indices[0], 0),
	});
}

/** Allocation-free sampling, shared by all materials using this texture at the same time. */
export function fluidAnimationFrame(
	texture: THREE.DataArrayTexture,
	seconds: number
): THREE.Vector3 {
	let animation = animations.get(texture);
	if (!animation) {
		registerFluidAnimation(texture);
		animation = animations.get(texture)!;
	}
	if (animation.lastTime === seconds) return animation.frame;
	animation.lastTime = seconds;
	const { indices, ends, duration, frame } = animation;
	const ticks = (((seconds * 20) % duration) + duration) % duration;
	let low = 0,
		high = ends.length - 1;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (ticks < ends[mid]) high = mid;
		else low = mid + 1;
	}
	const start = low ? ends[low - 1] : 0;
	const next = indices[(low + 1) % indices.length];
	// Vanilla interpolates RGB only, and only when explicitly requested by the pack.
	frame.set(
		indices[low],
		next,
		animation.interpolate && next !== indices[low] ? (ticks - start) / (ends[low] - start) : 0
	);
	return frame;
}

export function hasFluidAnimation(texture: THREE.DataArrayTexture | null): boolean {
	return !!texture && (animations.get(texture)?.indices.length ?? 1) > 1;
}
