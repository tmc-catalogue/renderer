import { type ChunkBuildRequest, type ChunkResult, type MeshData, type PaletteGeometryData } from "./MeshBuilderCore";
/** The shipped WASM module groups and culls by block category. Its input
 * adapter places all ordinary geometry in one internal group so strict opaque
 * occlusion flags work across render passes; outputs are then partitioned by
 * original material. Fluids (legacy-only) and unrepresentable coordinates use
 * the exact shared CPU engine rather than the old destructive assumptions. */
export declare class WasmChunkEngine {
    private readonly builder;
    private readonly materialCategories;
    private readonly fluidStates;
    private readonly unsafeLegacyCullStates;
    private readonly bounds;
    update(palette: Map<number, PaletteGeometryData>): void;
    build(request: ChunkBuildRequest, palette: Map<number, PaletteGeometryData>): ChunkResult;
    dispose(): void;
}
/** Each emitted material group owns a consecutive vertex run (the WASM core
 * appends template geometry sequentially). Copy only those runs into separate
 * pass buffers; a single-category chunk is reused unmodified. */
export declare function splitMeshPasses(mesh: MeshData, materialCategories: Map<number, string>): MeshData[];
//# sourceMappingURL=WasmChunkEngine.d.ts.map