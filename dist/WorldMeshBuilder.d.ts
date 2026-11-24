import * as THREE from "three";
import { SchematicRenderer } from "./SchematicRenderer";
import { SchematicObject } from "./managers/SchematicObject";
import type { ProcessedBlockGeometry, ChunkGeometryData } from "./types";
import { Cubane } from "./cubane";
export declare const INVISIBLE_BLOCKS: Set<string>;
export declare class WorldMeshBuilder {
    private schematicRenderer;
    private cubane;
    private paletteCache;
    private paletteUsesFluidSurface;
    private instancedRenderer;
    private useInstancedRendering;
    private static nextMeshContextId;
    private readonly meshContextId;
    private nextWorkerRequest;
    private workers;
    private freeWorkers;
    private workerQueue;
    private readonly leasedWorkers;
    private readonly workerWaiters;
    private disposed;
    private pendingRequests;
    private maxWorkers;
    private chunkSize;
    private useQuantization;
    private useGPUCompute;
    private computeMeshBuilder;
    private gpuInitPromise;
    private useWasmMeshBuilder;
    private _timingStats;
    private sharedMemoryPool;
    private useSharedMemory;
    constructor(schematicRenderer: SchematicRenderer, cubane: Cubane);
    /**
     * Initialize WebGPU compute for mesh building
     * Falls back to workers if WebGPU is not available
     */
    private initializeGPUCompute;
    private _doInitializeGPU;
    /**
     * Check if GPU compute is being used
     */
    isUsingGPUCompute(): boolean;
    private initializeWorkers;
    /**
     * Check if using WASM mesh builder
     */
    isUsingWasmMeshBuilder(): boolean;
    /**
     * Check if using SharedArrayBuffer
     */
    isUsingSharedMemory(): boolean;
    private greedyMeshingEnabled;
    /**
     * Enable or disable greedy meshing optimization
     * Greedy meshing merges coplanar faces into larger quads, reducing vertex count significantly
     */
    setGreedyMeshing(enabled: boolean): void;
    /**
     * Check if greedy meshing is enabled
     */
    isGreedyMeshingEnabled(): boolean;
    static stats: {
        totalSetup: number;
        totalSort: number;
        totalMerge: number;
        totalWorkerTime: number;
        chunkCount: number;
    };
    static resetStats(): void;
    private batchPendingChunks;
    private batchFinishRequests;
    private handleWorkerMessage;
    private returnWorker;
    private newWorkerRequestId;
    setChunkSize(newChunkSize: number): void;
    getChunkSize(): number;
    setQuantization(enabled: boolean): void;
    getQuantization(): boolean;
    private computeOcclusionFlags;
    /**
     * Invalidate the palette cache to force re-computation of geometries.
     * Call this when textures/materials change (e.g., resource pack change).
     */
    invalidateCache(): void;
    private releasePaletteBlocks;
    precomputePaletteGeometries(palette: any[], fluidSurface?: boolean): Promise<void>;
    private getFreeWorker;
    private buildChunkWithWorker;
    /**
     * Process all chunks in batch mode - returns merged meshes
     * instead of one mesh per chunk. This reduces main thread work significantly.
     *
     * CRITICAL: We split into sub-batches to avoid creating meshes that are too large.
     * Without this, a 256³ schematic creates 3 meshes with millions of vertices = crash.
     *
     * @param allChunks - Iterator or array of chunk data
     * @param onProgress - Optional progress callback
     * @returns Promise with merged meshes
     */
    processChunksBatched(allChunks: Array<{
        blocks: Int32Array | number[][];
        chunk_x: number;
        chunk_y: number;
        chunk_z: number;
        apronBlocks?: Int32Array;
    }>, onProgress?: (processed: number, total: number) => void): Promise<THREE.Mesh[]>;
    /**
     * Helper to create Three.js meshes from a batch result
     */
    private createMeshesFromBatchResult;
    /**
     * OPTIMIZATION: Sort geometry data by material index to merge groups
     * This reduces draw calls from N_blocks to N_materials per mesh
     */
    private optimizeGeometryGroups;
    getChunkGeometries(chunkData: {
        blocks: Array<number[]> | Int32Array;
        chunk_x: number;
        chunk_y: number;
        chunk_z: number;
    }, renderingBounds?: {
        min: THREE.Vector3;
        max: THREE.Vector3;
        enabled?: boolean;
    }): Promise<{
        geometries: ChunkGeometryData[];
        origin: number[];
    }>;
    /**
     * Render sign block entities as standalone meshes, independent of the build mode.
     *
     * The `batched` and `instanced` build paths don't process block entities at all,
     * and even the chunk path's tile-entity handling lacks the blockstate properties
     * (facing/rotation) signs need. Signs require BOTH per-instance NBT (the text) and
     * the blockstate (orientation), so we render them here once per schematic build and
     * the caller adds the results to the schematic group. The greedy/palette paths emit
     * nothing for signs (cubane returns empty when called without NBT), so there's no
     * doubling.
     */
    buildSignMeshes(schematicObject: SchematicObject): Promise<THREE.Object3D[]>;
    getChunkMesh(chunkData: {
        blocks: Array<number[]> | Int32Array;
        chunk_x: number;
        chunk_y: number;
        chunk_z: number;
        apronBlocks?: Int32Array;
    }, schematicObject: SchematicObject, renderingBounds?: {
        min: THREE.Vector3;
        max: THREE.Vector3;
        enabled?: boolean;
    }, preFilteredEntities?: any[]): Promise<THREE.Object3D[]>;
    private createBlockStringFromPaletteEntry;
    private getMaterialCategory;
    private configureMeshForCategory;
    extractAllMeshData(rootCubaneObject: THREE.Object3D): ProcessedBlockGeometry[];
    private createFallbackObject3D;
    getPaletteStats(): {
        isReady: boolean;
        paletteSize: number;
        uniqueMaterials: number;
        memoryEstimate: number;
    };
    enableInstancedRendering(group: THREE.Group, merged?: boolean): void;
    disableInstancedRendering(): void;
    renderSchematicInstanced(schematicObject: SchematicObject): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=WorldMeshBuilder.d.ts.map