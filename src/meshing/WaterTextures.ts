import * as THREE from "three";

// Scale the pack's alpha so submerged geometry stays readable through both
// sides of a waterfall. Vanilla's 180/255 mask yields about 42% per surface.
export const WATER_OPACITY = 0.6;

/** Tint vanilla grayscale masks without changing resource-pack alpha or colored water. */
export function tintWaterPixels(pixels: Uint8ClampedArray): void {
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 3] === 0) continue;
		if (Math.abs(pixels[i] - pixels[i + 1]) > 8 || Math.abs(pixels[i + 1] - pixels[i + 2]) > 8) {
			return;
		}
	}
	for (let i = 0; i < pixels.length; i += 4) {
		pixels[i] *= 63 / 255;
		pixels[i + 1] *= 118 / 255;
		pixels[i + 2] *= 228 / 255;
	}
}

/** One repeatable layer per square animation frame, including single-frame packs. */
export function createFluidFrameTexture(
	pixels: Uint8ClampedArray,
	width: number,
	height: number
): THREE.DataArrayTexture {
	const frames = Math.max(1, Math.floor(height / width));
	const texture = new THREE.DataArrayTexture(new Uint8Array(pixels), width, width, frames);
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;
}
