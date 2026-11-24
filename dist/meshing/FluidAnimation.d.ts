import * as THREE from "three";
export interface FluidAnimationMetadata {
    animation?: {
        width?: number;
        height?: number;
        frametime?: number;
        frames?: (number | {
            index: number;
            time?: number;
        })[];
        interpolate?: boolean;
    };
}
/** Compile the timeline once. Repeated indices share a GPU layer instead of duplicating pixels. */
export declare function registerFluidAnimation(texture: THREE.DataArrayTexture, metadata?: FluidAnimationMetadata): void;
/** Allocation-free sampling, shared by all materials using this texture at the same time. */
export declare function fluidAnimationFrame(texture: THREE.DataArrayTexture, seconds: number): THREE.Vector3;
export declare function hasFluidAnimation(texture: THREE.DataArrayTexture | null): boolean;
//# sourceMappingURL=FluidAnimation.d.ts.map