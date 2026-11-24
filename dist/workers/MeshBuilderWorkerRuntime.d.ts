import { type PaletteGeometryData, type ChunkBuildRequest, type ChunkResult } from "./MeshBuilderCore";
type Palette = Map<number, PaletteGeometryData>;
/** Accumulate chunks in compact typed arrays, then allocate final world-space
 * buffers once. No boxed per-vertex arrays or quantization of world coordinates. */
export declare function mergeChunkResults(chunks: ChunkResult[]): ChunkResult;
export declare function resultTransferables(result: ChunkResult): Transferable[];
/** The JS and WASM workers share transport, per-renderer state, batching, SAB
 * decoding and error semantics. The geometry engine is the only difference. */
export declare class MeshBuilderWorkerRuntime {
    private readonly send;
    private readonly build;
    private readonly update?;
    private readonly release?;
    private readonly contexts;
    constructor(send: (message: any, transfer?: Transferable[]) => void, build?: (request: ChunkBuildRequest, palette: Palette, _id: string) => ChunkResult, update?: ((palette: Palette, id: string) => void) | undefined, release?: ((id: string) => void) | undefined);
    handle(message: any): void;
}
export {};
//# sourceMappingURL=MeshBuilderWorkerRuntime.d.ts.map