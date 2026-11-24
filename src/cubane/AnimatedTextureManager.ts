import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { TextureAnimationMetadata } from "./types";
import { analyzeRGBA } from "./TextureAlpha";
/**
 * Animation metadata structure that matches Minecraft's mcmeta format
 */

/**
 * Extended class to handle animated textures
 */
interface InterpolatedFrames {
	texture: THREE.DataTexture;
	pixels: Uint8ClampedArray;
	width: number;
	height: number;
	columns: number;
	lastFrame: number;
	lastNext: number;
	lastMix: number;
}

/** Blend the two frames' RGB only; Minecraft preserves alpha from the current frame. */
function sampleInterpolated(
	frames: InterpolatedFrames,
	frame: number,
	next: number,
	mix: number
): boolean {
	if (frame === frames.lastFrame && next === frames.lastNext && mix === frames.lastMix)
		return false;
	frames.lastFrame = frame;
	frames.lastNext = next;
	frames.lastMix = mix;
	const { width, height, columns, pixels, texture } = frames;
	const data = texture.image.data as Uint8Array;
	const sourceWidth = width * columns;
	const x0 = (frame % columns) * width,
		x1 = (next % columns) * width;
	const y0 = Math.floor(frame / columns) * height,
		y1 = Math.floor(next / columns) * height;
	for (let y = 0; y < height; y++) {
		// DataTexture pixels start at the bottom, while decoded PNG pixels start at the top.
		let cur = ((y0 + height - 1 - y) * sourceWidth + x0) * 4;
		let following = ((y1 + height - 1 - y) * sourceWidth + x1) * 4;
		let out = y * width * 4;
		for (let x = 0; x < width; x++, cur += 4, following += 4, out += 4) {
			for (let c = 0; c < 3; c++)
				data[out + c] = Math.round(
					pixels[cur + c] + (pixels[following + c] - pixels[cur + c]) * mix
				);
			data[out + 3] = pixels[cur + 3];
		}
	}
	texture.needsUpdate = true;
	return true;
}

function createInterpolatedFrames(
	image: HTMLImageElement,
	width: number,
	height: number,
	columns: number
): InterpolatedFrames | undefined {
	try {
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) return;
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(0, 0, image.width, image.height).data;
		const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height);
		const alpha = analyzeRGBA(pixels);
		texture.userData.sourceAlpha = alpha.alpha;
		texture.userData.sourceHasOpaquePixels = alpha.hasOpaquePixels;
		return { texture, pixels, width, height, columns, lastFrame: -1, lastNext: -1, lastMix: -1 };
	} catch {
		// A blocked canvas read is unusual for a local ZIP image; retain the native
		// stepped timeline instead of losing the texture entirely.
		return undefined;
	}
}

export class AnimatedTextureManager {
	private animatedTextures: Map<
		string,
		{
			texture: THREE.Texture;
			indices: number[];
			ends: number[];
			duration: number;
			columns: number;
			rows: number;
			currentFrame: number;
			startedAt: number;
			interpolated?: InterpolatedFrames;
		}
	> = new Map();
	private pending = new Map<string, Promise<THREE.Texture | null>>();
	private generation = 0;
	private pendingImages = new Set<() => void>();

	constructor(private assetLoader: AssetLoader) {}

	/** True when at least one animated texture is registered (drives continuous rendering). */
	public hasActiveTextures(): boolean {
		return this.animatedTextures.size > 0;
	}

	/** Stop old animations and return their textures to the owner's disposal pass. */
	public clear(): THREE.Texture[] {
		this.generation++;
		const textures = [...this.animatedTextures.values()].map(({ texture }) => texture);
		this.animatedTextures.clear();
		this.pending.clear();
		for (const cancel of this.pendingImages) cancel();
		return textures;
	}

	/**
	 * Check if a texture has animation metadata
	 */
	public async isAnimated(texturePath: string): Promise<boolean> {
		// Check if a .mcmeta file exists for this texture
		const metadataPath = `${texturePath}.png.mcmeta`;
		const metadata = await this.assetLoader.getResourceString(metadataPath);
		if (!metadata) return false;
		try {
			const parsed = JSON.parse(metadata);
			return (
				!!parsed.animation &&
				typeof parsed.animation === "object" &&
				!Array.isArray(parsed.animation)
			);
		} catch {
			return false;
		}
	}

	/**
	 * Load animation metadata for a texture
	 */
	public async loadAnimationMetadata(
		texturePath: string
	): Promise<TextureAnimationMetadata | null> {
		const metadataPath = `textures/${texturePath}.png.mcmeta`;
		const metadataString = await this.assetLoader.getResourceString(metadataPath);

		if (!metadataString) {
			return null;
		}

		try {
			const metadata = JSON.parse(metadataString) as TextureAnimationMetadata;
			return metadata.animation &&
				typeof metadata.animation === "object" &&
				!Array.isArray(metadata.animation)
				? metadata
				: null;
		} catch (error) {
			console.error(`Failed to parse animation metadata for ${texturePath}:`, error);
			return null;
		}
	}

	/**
	 * Create an animated texture
	 */
	public async createAnimatedTexture(texturePath: string): Promise<THREE.Texture | null> {
		// Reuse an already-registered animated texture. Without this, a block whose
		// faces share one texture (e.g. kelp's 4 cross faces) creates a new texture
		// per face, but only the last one is tracked in `animatedTextures` and gets
		// advanced by update() — so only some faces animate. Returning the shared
		// instance makes every face animate together.
		const existing = this.animatedTextures.get(texturePath);
		if (existing) {
			return existing.texture;
		}
		const pending = this.pending.get(texturePath);
		if (pending) return pending;
		const load = this.loadTexture(texturePath, this.generation);
		this.pending.set(texturePath, load);
		try {
			return await load;
		} finally {
			if (this.pending.get(texturePath) === load) this.pending.delete(texturePath);
		}
	}

	private async loadTexture(
		texturePath: string,
		generation: number
	): Promise<THREE.Texture | null> {
		// Load the metadata
		const metadata = await this.loadAnimationMetadata(texturePath).catch((error) => {
			if (generation !== this.generation) return null;
			throw error;
		});
		if (!metadata || generation !== this.generation) {
			return null;
		}

		// Load the texture image
		const textureBlob = await this.assetLoader
			.getResourceBlob(`textures/${texturePath}.png`)
			.catch((error) => {
				if (generation !== this.generation) return null;
				throw error;
			});
		if (!textureBlob || generation !== this.generation) {
			return null;
		}

		// Create image to determine frame count
		const image = new Image();
		const objectUrl = URL.createObjectURL(textureBlob);

		return new Promise<THREE.Texture | null>((resolve) => {
			let settled = false;
			const finish = (texture: THREE.Texture | null) => {
				if (settled) return;
				settled = true;
				this.pendingImages.delete(cancel);
				image.onload = null;
				image.onerror = null;
				URL.revokeObjectURL(objectUrl);
				resolve(texture);
			};
			const cancel = () => finish(null);
			this.pendingImages.add(cancel);
			image.onload = () => {
				if (settled || generation !== this.generation) {
					finish(null);
					return;
				}

				// Minecraft also accepts horizontal sheets and explicit rectangular frames.
				const animation = metadata.animation ?? {};
				const width =
					animation.width ?? (animation.height ? image.width : Math.min(image.width, image.height));
				const height =
					animation.height ??
					(animation.width ? image.height : Math.min(image.width, image.height));
				if (
					!Number.isInteger(width) ||
					!Number.isInteger(height) ||
					width <= 0 ||
					height <= 0 ||
					image.width % width ||
					image.height % height
				) {
					finish(null);
					return;
				}
				const columns = image.width / width,
					rows = image.height / height;
				const frameCount = columns * rows;
				const frameTime = animation.frametime ?? 1;
				const defaultTime = Number.isSafeInteger(frameTime) && frameTime > 0 ? frameTime : 1;
				const indices: number[] = [],
					ends: number[] = [];
				let duration = 0;
				const frames = Array.isArray(animation.frames) ? animation.frames : undefined;
				const length = frames?.length ?? frameCount;
				for (let i = 0; i < length; i++) {
					const frame = frames ? frames[i] : i;
					if (typeof frame !== "number" && (typeof frame !== "object" || frame === null)) continue;
					const index = typeof frame === "number" ? frame : frame.index;
					const time = typeof frame === "number" ? defaultTime : (frame.time ?? defaultTime);
					if (
						!Number.isInteger(index) ||
						index < 0 ||
						index >= frameCount ||
						!Number.isSafeInteger(time) ||
						time <= 0 ||
						!Number.isSafeInteger(duration + time)
					)
						continue;
					indices.push(index);
					ends.push((duration += time));
				}
				if (!indices.length) {
					indices.push(0);
					ends.push((duration = 1));
				}

				// Create texture
				const interpolated =
					animation.interpolate && indices.length > 1
						? createInterpolatedFrames(image, width, height, columns)
						: undefined;
				const texture = interpolated?.texture ?? new THREE.Texture(image);
				texture.minFilter = THREE.NearestFilter;
				texture.magFilter = THREE.NearestFilter;
				texture.wrapS = THREE.RepeatWrapping;
				texture.wrapT = THREE.RepeatWrapping;

				// Configure texture repeat and offset for animation
				const first = indices[0];
				if (interpolated) sampleInterpolated(interpolated, first, first, 0);
				else {
					texture.repeat.set(1 / columns, 1 / rows);
					texture.offset.set(
						(first % columns) / columns,
						1 - (Math.floor(first / columns) + 1) / rows
					);
					texture.needsUpdate = true;
				}

				// Store in animated textures map
				this.animatedTextures.set(texturePath, {
					texture,
					indices,
					ends,
					duration,
					columns,
					rows,
					currentFrame: first,
					startedAt: Date.now(),
					interpolated,
				});

				finish(texture);
			};

			image.onerror = cancel;

			image.src = objectUrl;
		});
	}

	/**
	 * Update all animated textures. Returns `true` if any texture advanced a frame
	 * this call (i.e. the scene now needs a redraw). Returning a dirty flag lets the
	 * render loop stay event-driven — it redraws only when a frame actually flips
	 * (~10fps for water) instead of every vsync.
	 */
	public update(): boolean {
		const now = Date.now();
		let advanced = false;

		this.animatedTextures.forEach((data, _texturePath) => {
			const { texture, indices, ends, duration, columns, rows } = data;
			// Absolute timeline avoids drift, even after a background tab stalls.
			const ticks = Math.max(0, Math.floor((now - data.startedAt) / 50)) % duration;
			let low = 0,
				high = ends.length - 1;
			while (low < high) {
				const mid = (low + high) >>> 1;
				if (ticks < ends[mid]) high = mid;
				else low = mid + 1;
			}
			const frame = indices[low];
			if (data.interpolated) {
				const start = low ? ends[low - 1] : 0;
				const next = indices[(low + 1) % indices.length];
				const mix = next === frame ? 0 : (ticks - start) / (ends[low] - start);
				advanced =
					sampleInterpolated(data.interpolated, frame, mix ? next : frame, mix) || advanced;
			} else if (frame !== data.currentFrame) {
				data.currentFrame = frame;
				texture.offset.set(
					(frame % columns) / columns,
					1 - (Math.floor(frame / columns) + 1) / rows
				);
				// Only the texture transform changes; no GPU image re-upload is needed.
				advanced = true;
			}
		});

		return advanced;
	}
}
