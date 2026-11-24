import * as THREE from "three";
export type ChestType = "single" | "left" | "right";
export type ChestFacing = "north" | "east" | "south" | "west";
export type ChestKind = "normal" | "trapped" | "ender" | "copper" | "copper_exposed" | "copper_weathered" | "copper_oxidized";
/**
 * Builds the merged chest BufferGeometry in [0,1]^3 cell space (coords / 16).
 * UV order of operations (design §3):
 *   1) corner UVs from [u0,v0,u1,v1] by corner order (no min/max sorting),
 *   2) apply face rotation,
 *   3) flipY: u' = u/16, v' = 1 - v/16  (textures use three.js default flipY=true).
 * Returns a fresh geometry each call (cheap, ~56 verts) so existing
 * dispose-on-rebuild code can't invalidate a shared cache.
 */
export declare function chestModelGeo(type: "single" | "left" | "right"): THREE.BufferGeometry;
/** θ = −blockstate.y·π/180 (three.js rotateY, front at local −Z). */
export declare const CHEST_FACING_THETA: Record<ChestFacing, number>;
export declare function chestTexturePath(kind: ChestKind, type: ChestType): string;
type CellList = ReadonlyArray<unknown> | ArrayLike<number>;
export interface ChestBucketLike {
    state: unknown;
    double?: boolean;
    facing?: unknown;
    chest?: unknown;
    positions: CellList;
}
export interface ChestAssetLoaderLike {
    getTexture(path: string): THREE.Texture | Promise<THREE.Texture>;
}
/** The same state-aware templates used by GPU instances, for the CPU palette. */
export declare function buildChestBlockMesh(state: unknown, al: ChestAssetLoaderLike): Promise<THREE.Mesh | null>;
/**
 * Per-cell chest rendering. Re-buckets by FULL state (kind + facing + type);
 * one InstancedMesh per full state, one instance per cell, each half drawn
 * only in its own cell. No pairing / midpoint / stretching.
 * Non-chest buckets are returned untouched in `rest`.
 */
export declare function buildChestInstancedMeshes<B extends ChestBucketLike>(buckets: Iterable<B>, al: ChestAssetLoaderLike, sx: number, sy: number, sz: number): Promise<{
    meshes: THREE.InstancedMesh[];
    rest: B[];
}>;
export {};
//# sourceMappingURL=ChestModels.d.ts.map