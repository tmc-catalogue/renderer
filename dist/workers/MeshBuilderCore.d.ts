export type PaletteGeometryData = {
    index: number;
    occlusionFlags: number;
    category?: string;
    fluid?: "water" | "lava";
    geometries: Array<{
        positions: Float32Array;
        normals: Float32Array;
        uvs: Float32Array;
        indices: Uint16Array | Uint32Array;
        materialIndex: number;
        category?: string;
        fluid?: "water" | "lava";
    }>;
};
export type ChunkBuildRequest = {
    chunkId: string;
    blocks?: number[][] | Int32Array;
    sharedInputBuffer?: SharedArrayBuffer;
    meshContextId?: string;
    chunkOrigin?: [number, number, number];
    apronBlocks?: Int32Array;
};
export type MeshData = {
    category: string;
    positions: Int16Array | Float32Array;
    normals: Int8Array;
    uvs: Float32Array;
    indices: Uint16Array | Uint32Array;
    groups: Array<{
        start: number;
        count: number;
        materialIndex: number;
    }>;
    isFloat32Positions?: boolean;
};
type TemplateGeometry = PaletteGeometryData["geometries"][number];
export declare function getTemplateBounds(geometry: TemplateGeometry): [number[], number[]];
/** Actual Cubane coordinates are cell-centred; 0 and 1 are not alternate
 * cell boundaries. All three vertices must be on the face and inside its
 * square to be guaranteed occluded by a neighbour's full-face mask. */
export declare function templateCullDirection(geom: {
    positions: ArrayLike<number>;
    normals?: ArrayLike<number>;
    indices: ArrayLike<number> | null;
}, i: number, legacy?: boolean): number;
export type ChunkResult = {
    meshes: MeshData[];
    origin: number[];
    timings?: Record<string, number>;
};
export declare function decodeBlocks(request: ChunkBuildRequest): {
    blocks: Int32Array<ArrayBufferLike> | number[][];
    chunkOrigin: [number, number, number] | undefined;
};
export declare function buildChunkGeometry(request: ChunkBuildRequest, paletteGeometries: Map<number, PaletteGeometryData>): ChunkResult;
export {};
//# sourceMappingURL=MeshBuilderCore.d.ts.map