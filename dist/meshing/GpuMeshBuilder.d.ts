/**
 * GPU compute mesh builder (WebGPU two-pass) — oracle-validated algorithm.
 *
 * Port of the standalone gpu-mesher (test/public/gpu-mesher/mesher.wgsl):
 *   PASS 1 counts visible triangles per category via atomics (exact allocation),
 *   PASS 2 emits world-space vertices/indices into per-category regions.
 * Culling semantics identical to mesh_builder_wasm::merge_category_geometries,
 * including the same-category + occlusion-bit neighbor rule and template-invariant
 * per-triangle cull slots precomputed at palette-upload time.
 *
 * v1: reads results back once and returns THREE.BufferGeometry per category
 * (drop-in for the batched path's output shape). Storage-buffer drawing is a
 * follow-up once three's WebGPURenderer path is validated for the atlas materials.
 */
import * as THREE from "three";
import type { RecordStream } from "./RecordRenderer";
type PaletteEntry = {
    index: number;
    category: string;
    occlusionFlags: number;
    fluid?: "water" | "lava";
    geometries: Array<{
        positions: Float32Array | number[];
        normals: Float32Array | number[];
        uvs: Float32Array | number[];
        indices: Uint32Array | Uint16Array | number[] | null;
        materialIndex: number;
        category?: string;
    }>;
};
export declare class GpuMeshBuilder {
    private device;
    private pipeline;
    private recordPipeline;
    private generation;
    available: boolean;
    /** Each schematic owns its compute device; release it when the schematic is removed. */
    dispose(): void;
    init(): Promise<boolean>;
    /** Flatten palette descriptors + templates into GPU buffers (reusable across meshes). */
    private buildTemplateBuffers;
    /**
     * Build meshes for a full-block grid. `grid` is palette-index-per-cell in
     * (y*sz+z)*sx+x order, 0 = air. Returns BufferGeometry per category with the
     * same {category, positions, indices} shape the batched wasm path produces.
     */
    buildMeshes(grid: Uint32Array, sx: number, sy: number, sz: number, palette: PaletteEntry[], materialLookup: (category: string) => THREE.Material[]): Promise<THREE.Mesh[]>;
    /**
     * Phase B: build meshes that RENDER DIRECTLY from the 8B/triangle record stream
     * (WebGL2 gl_VertexID vertex pulling — no vertex data readback at all).
     * Returns one pulling mesh per non-empty category plus the record stream for
     * verification. Falls back to plain buildMeshes on any WebGPU failure upstream.
     */
    buildRecordMeshes(grid: Uint32Array, sx: number, sy: number, sz: number, palette: PaletteEntry[], materialLookup: (category: string) => THREE.Material[], makeDrawingMeshes?: boolean): Promise<{
        meshes: THREE.Mesh[];
        stream: RecordStream | null;
    }>;
}
export {};
//# sourceMappingURL=GpuMeshBuilder.d.ts.map