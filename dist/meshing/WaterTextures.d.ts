import * as THREE from "three";
import { type FluidAnimationMetadata } from "./FluidAnimation";
export declare const WATER_OPACITY = 1;
/** Tint vanilla grayscale masks without changing resource-pack alpha or colored water. */
export declare function tintWaterPixels(pixels: Uint8ClampedArray): void;
/** Pack frames into array layers once; supports strips, grids, and static resource packs. */
export declare function createFluidFrameTexture(pixels: Uint8ClampedArray, width: number, height: number, metadata?: FluidAnimationMetadata): THREE.DataArrayTexture;
//# sourceMappingURL=WaterTextures.d.ts.map