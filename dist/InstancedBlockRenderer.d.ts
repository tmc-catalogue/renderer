import * as THREE from "three";
export declare class InstancedBlockRenderer {
    private group;
    private paletteCache;
    private instancedMeshes;
    private instanceCounts;
    private maxInstancesPerType;
    private overflowInstances;
    constructor(group: THREE.Group, paletteCache: any);
    private createBlockTypeKey;
    private mergeGeometriesManual;
    initializeInstancedMeshes(): void;
    initializeInstancedMeshesMerged(): void;
    renderBlocksInstanced(allBlocks: Array<{
        x: number;
        y: number;
        z: number;
        paletteIndex: number;
    }>): void;
    private setInstancesWithOverflow;
    private ensureCapacity;
    private clearOverflowInstances;
    private logInstancedStats;
    private configureMeshForCategory;
    disposeInstancedMeshes(): void;
    getInstancedMeshes(blockName: string): THREE.InstancedMesh[];
}
//# sourceMappingURL=InstancedBlockRenderer.d.ts.map