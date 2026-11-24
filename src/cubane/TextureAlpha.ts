export type TextureAlpha = "opaque" | "cutout" | "blend";

export interface TextureAlphaInfo {
	alpha: TextureAlpha;
	hasOpaquePixels: boolean;
}

export function analyzeRGBA(pixels: ArrayLike<number>): TextureAlphaInfo {
	let alpha: TextureAlpha = pixels.length >= 4 ? "opaque" : "blend";
	let hasOpaquePixels = false;
	for (let i = 3; i < pixels.length; i += 4) {
		const value = pixels[i];
		if (value === 255) hasOpaquePixels = true;
		else if (value > 0) alpha = "blend";
		else if (alpha === "opaque") alpha = "cutout";
		if (hasOpaquePixels && alpha === "blend") break;
	}
	return { alpha, hasOpaquePixels };
}

/** Pixels with binary alpha can write depth after masking; partial alpha requires blending. */
export function classifyRGBA(pixels: ArrayLike<number>): TextureAlpha {
	return analyzeRGBA(pixels).alpha;
}
