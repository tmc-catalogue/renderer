export type TextureAlpha = "opaque" | "cutout" | "blend";
export interface TextureAlphaInfo {
    alpha: TextureAlpha;
    hasOpaquePixels: boolean;
}
export declare function analyzeRGBA(pixels: ArrayLike<number>): TextureAlphaInfo;
/** Pixels with binary alpha can write depth after masking; partial alpha requires blending. */
export declare function classifyRGBA(pixels: ArrayLike<number>): TextureAlpha;
//# sourceMappingURL=TextureAlpha.d.ts.map