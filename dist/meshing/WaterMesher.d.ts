import * as THREE from "three";
import type { BubbleCell } from "./BubbleColumns";
export type GetBlock = (x: number, y: number, z: number) => string | null | undefined;
export type FluidKind = "water" | "lava";
export interface FluidTextures {
    water?: THREE.DataArrayTexture | null;
    waterFlow?: THREE.DataArrayTexture | null;
    lava?: THREE.DataArrayTexture | null;
    lavaFlow?: THREE.DataArrayTexture | null;
    waterOverlay?: THREE.DataArrayTexture | null;
}
export interface FluidBuildResult {
    meshes: THREE.Mesh[];
    cells: number;
    ms: number;
    bubbleCells: BubbleCell[];
}
/** Palette-level early exit avoids scanning dry schematics for a fluid surface. */
export declare function hasFluid(state: string): boolean;
export declare function buildFluidMeshes(getBlock: GetBlock, sx: number, sy: number, sz: number): FluidBuildResult;
/** Optional explicit source; otherwise `globalThis.liquidFrameTextures` is used lazily. */
export declare function setFluidTextures(src: FluidTextures | null): void;
export declare function createFluidMaterial(kind: FluidKind, _logged?: boolean): THREE.ShaderMaterial;
/** Optional external clock; mesh callbacks update only their own material. */
export declare function updateFluidTime(t: number): void;
export declare function disposeFluidMeshes(meshes: THREE.Mesh[]): void;
//# sourceMappingURL=WaterMesher.d.ts.map