import * as THREE from "three";
/**
 * Global material registry to ensure materials are shared across all chunks
 * This significantly reduces GPU state changes and memory usage
 */
export declare class MaterialRegistry {
    private static instance;
    private materials;
    private materialRefCount;
    private materialKeys;
    private constructor();
    static getInstance(): MaterialRegistry;
    /**
     * Get or create a shared material based on the source material
     * This ensures identical materials are reused across chunks
     */
    static getMaterial(sourceMaterial: THREE.Material): THREE.Material;
    private getOrCreateMaterial;
    /**
     * Create a unique key for a material based on its properties
     */
    private createMaterialKey;
    /**
     * Release a material reference (for cleanup)
     */
    static releaseMaterial(material: THREE.Material): void;
    private releaseMaterialReference;
    /**
     * Get statistics about the material registry
     */
    static getStats(): {
        totalMaterials: number;
        totalReferences: number;
        avgReferencesPerMaterial: number;
    };
    private getStatistics;
    /**
     * Clear all cached materials (use with caution)
     */
    static clear(): void;
    private clearAll;
    /**
     * Log detailed statistics
     */
    static logStats(): void;
}
export declare function getSharedMaterial(sourceMaterial: THREE.Material): THREE.Material;
//# sourceMappingURL=MaterialRegistry.d.ts.map