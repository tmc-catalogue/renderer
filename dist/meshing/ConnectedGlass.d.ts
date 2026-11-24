import * as THREE from "three";
import type { ProcessedBlockGeometry } from "../types";
import type { GetBlock } from "./WaterMesher";
import type { SurfaceCell } from "./SurfaceIndex";
export declare function isGlass(state: string): boolean;
export declare function isSurfaceBlock(state: string): boolean;
export interface SurfaceFace {
    positions: THREE.Vector3[];
    uvs: THREE.Vector2[];
    normal: THREE.Vector3;
    box: THREE.Box3;
    texture: string;
}
/** Keep the resource pack's geometry, rotations, pane arms, and face UVs. */
export declare function surfaceFaces(parts: ProcessedBlockGeometry[]): SurfaceFace[];
/** A boundary face is hidden only by the same glass, with matching face coverage. */
export declare function hiddenGlassFace(face: SurfaceFace, neighbors: SurfaceFace[]): boolean;
export declare function glassConnections(face: SurfaceFace, state: string, x: number, y: number, z: number, getBlock: GetBlock, templates: ReadonlyMap<string, SurfaceFace[]>, names?: ReadonlyMap<string, string>): number[];
export declare function makeGlassMaterial(map: THREE.Texture, connected: boolean, clip?: {
    value: THREE.Vector2;
}, source?: THREE.Material): THREE.MeshBasicMaterial;
/** Called once per occupied section. Work scales with surface cells, not bounds. */
export declare function buildGlassMeshes(getBlock: GetBlock, cells: Iterable<SurfaceCell>, templates: ReadonlyMap<string, SurfaceFace[]>, materials: ReadonlyMap<string, THREE.Material>): THREE.Mesh[];
//# sourceMappingURL=ConnectedGlass.d.ts.map