import * as THREE from "three";
export interface RecordTables {
    rowCorners: Uint32Array;
    rows: number;
    tplPos: Float32Array;
    tplNrm: Float32Array;
    tplUv: Float32Array;
    verts: number;
}
export interface RecordStream {
    perCategory: RecordMaterialRun[];
    tables: RecordTables;
    sx: number;
    sy: number;
    sz: number;
}
/** A material-contiguous record run. The actual material, not the block's summary
 * category, determines the render pass. Multiple states sharing the atlas/material
 * remain batched together. */
export interface RecordMaterialRun {
    category: string;
    records: Uint32Array;
    tris: number;
    material?: THREE.Material;
    y0?: number;
    h?: number;
}
/** Expand compute-selected triangles into conventional Three geometry on adapters
 * that cannot bind all of the direct vertex-output storage buffers at once. */
export declare function materializeRecordMeshes(stream: RecordStream): THREE.Mesh[];
export declare function recordMaterialCategory(material: THREE.Material, fluid?: string): string;
/** The compute pass writes material-contiguous records. Reuse their backing
 * buffer as zero-copy views so the normal shared-atlas/material fast path does
 * not add geometry copies or per-triangle classification work. */
export declare function splitRecordMaterialRuns(records: Uint32Array, counts: readonly number[], materials: readonly THREE.Material[], category: string, y0?: number, h?: number): RecordMaterialRun[];
export interface SectionRange {
    base: number;
    count: number;
    box: [number, number, number, number, number, number];
}
/** Reorder a record stream into 16³-section-contiguous order and return section ranges.
 * Pure permutation — the emission stream and oracle hashes are untouched.
 * Streams above SECTIONIZE_MAX items keep their original order with ONE whole-range
 * section: the reorder would double record memory (317M tris → +2.5GB) for little
 * culling benefit when the build fills the view anyway. */
export declare const SECTIONIZE_MAX = 40000000;
export declare function sectionize(records: Uint32Array, items: number, sx: number, sy: number, sz: number): {
    rec: Uint32Array;
    sections: SectionRange[];
};
/** Each independently culled section starts on a page boundary. */
export declare function sectionPageCount(sections: readonly SectionRange[]): number;
/** Fresh material per mesh (uniforms carry per-mesh textures; the compiled program is
 * shared automatically by three's program cache). */
export declare function makePullMaterial(source: boolean | THREE.Material, quad?: boolean, fallbackMap?: THREE.Texture | null): THREE.ShaderMaterial;
/** Build the pulling meshes from a record stream. One mesh per category; each mesh gets
 *  its OWN material instance (uniforms carry per-mesh textures; three still shares the
 *  compiled program across identical ShaderMaterials). drawRange drives the draws;
 *  bounding volumes are set manually from the grid bounds. */
export declare function quadify(records: Uint32Array, tris: number, isQuadPair: (rowA: number, rowB: number) => {
    quad: boolean;
    corners: [number, number, number, number] | null;
}): {
    quadRec: Uint32Array;
    quads: number;
    cornerTable: number[];
    triRec: Uint32Array;
    triTris: number;
};
export declare function makeQuadIndexBuffer(maxQuads: number): THREE.BufferAttribute;
export declare function makeRecordMeshes(stream: RecordStream, atlas: THREE.Texture | null, isQuadPair?: (rowA: number, rowB: number) => {
    quad: boolean;
    corners: [number, number, number, number] | null;
}): THREE.Mesh[];
/** Release only the generated record resources; asset maps remain asset-loader owned. */
export declare function disposeRecordMeshes(meshes: Iterable<THREE.Object3D>): void;
export declare function buildRecordTables(tplPos: number[], tplNrm: number[], tplUv: number[], tplIdx: number[], desc: number[], // flat [vertStart, idxStart, triStart, occ] per state (stride 4)
desc2: number[], // flat [vertCount, idxCount, category, slotBase] per state (stride 4)
states: number, // maxIdx
tplPosW?: number[], // per-vertex anim frame step (pos.w)
tplNrmW?: number[], // per-vertex anim frame-top V (nrm.w)
tplUvW?: number[]): RecordTables;
//# sourceMappingURL=RecordRenderer.d.ts.map