import type { FluidStateFilter } from "./FluidStateLookup";
/** Extract the same half-open, cell-aligned volume used by the surface passes.
 * Zero is reserved by the GPU mesher; remap palette indices if zero isn't air. */
export declare function extractVisibleGrid(schematic: {
    create_lazy_chunk_iterator: (...args: any[]) => any;
}, palette: ReadonlyArray<{
    name?: string;
    Name?: string;
}>, sx: number, sy: number, sz: number, { bounds, hiddenCells }?: FluidStateFilter): {
    grid: Uint32Array;
    indexOffset: number;
};
//# sourceMappingURL=VisibleGrid.d.ts.map