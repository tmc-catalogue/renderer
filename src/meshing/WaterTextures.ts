import * as THREE from "three";
import { registerFluidAnimation, type FluidAnimationMetadata } from "./FluidAnimation";

// The texture already carries Minecraft's water alpha; do not attenuate it again.
export const WATER_OPACITY = 1;

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

/** Pack frames into array layers once; supports strips, grids, and static resource packs. */
export function createFluidFrameTexture(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	metadata?: FluidAnimationMetadata
): THREE.DataArrayTexture {
	const animation = metadata?.animation;
	const fw = animation
		? (animation.width ?? (animation.height ? width : Math.min(width, height)))
		: width;
	const fh = animation
		? (animation.height ?? (animation.width ? height : Math.min(width, height)))
		: height;
	if (
		fw <= 0 ||
		fh <= 0 ||
		!Number.isInteger(fw) ||
		!Number.isInteger(fh) ||
		width % fw ||
		height % fh
	) {
		throw new Error(`Invalid fluid animation frame size ${fw}x${fh} for ${width}x${height}`);
	}
	const columns = width / fw,
		rows = height / fh;
	const layers = new Uint8Array(pixels.length);
	for (let row = 0; row < rows; row++)
		for (let col = 0; col < columns; col++) {
			const layerOffset = (row * columns + col) * fw * fh * 4;
			for (let y = 0; y < fh; y++) {
				const offset = ((row * fh + y) * width + col * fw) * 4;
				layers.set(pixels.subarray(offset, offset + fw * 4), layerOffset + y * fw * 4);
			}
		}
	const texture = new THREE.DataArrayTexture(layers, fw, fh, columns * rows);
	texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	registerFluidAnimation(texture, metadata);
	return texture;
}
