import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { EntityRenderer } from "./EntityRenderer";
import { Block, BlockGeometryInfo, BlockOptimizationData, ResourcePackLoader, ResourcePackLoadOptions, ResourcePackInfo, PackFetchOptions, PackEventType, PackEventCallback, AssetConflict, PackAssetList, PackConfiguration, MemoryStats } from "./types";
import { ModelResolver } from "./ModelResolver";
import { BlockMeshBuilder } from "./BlockMeshBuilder";
import { ResourcePackManager } from "./ResourcePackManager";
export interface HybridBlockDynamicPart {
    entityType: string;
    offset?: [number, number, number];
    rotation?: [number, number, number];
}
/**
 * Cubane - A Minecraft block and entity renderer for Three.js
 */
export declare class Cubane {
    private assetLoader;
    modelResolver: ModelResolver;
    private blockMeshBuilder;
    private entityRenderer;
    private signRenderer;
    private showUnknownBlocks;
    private initialized;
    private initPromise;
    private db;
    private dbName;
    private dbVersion;
    private packManager;
    private blockMeshCache;
    private entityMeshCache;
    private optimizationDataCache;
    private meshCacheGeneration;
    private meshAssetGeneration;
    private disposed;
    private pureBlockEntityMap;
    private getShulkerBoxEntityMap;
    private hybridBlockConfig;
    constructor(options?: {
        autoRestore?: boolean;
        showUnknownBlocks?: boolean;
    });
    private initDatabase;
    private storeResourcePack;
    private getResourcePackFromCache;
    private cleanupExpiredResourcePacks;
    /** Wait for cached packs and their atlas to finish restoring. */
    ready(): Promise<void>;
    loadResourcePack(options: ResourcePackLoadOptions | Blob, loader?: ResourcePackLoader): Promise<void>;
    listCachedResourcePacks(): Promise<Array<{
        id: string;
        name: string;
        size: number;
        timestamp: number;
    }>>;
    loadMostRecentPack(): Promise<boolean>;
    loadCachedPack(packId: string): Promise<boolean>;
    deleteCachedPack(packId: string): Promise<boolean>;
    /**
     * Get the ResourcePackManager instance for direct access
     */
    get packs(): ResourcePackManager;
    /**
     * Load a resource pack from a URL
     */
    loadPackFromUrl(url: string, options?: PackFetchOptions): Promise<string>;
    /**
     * Load a resource pack from a Blob
     */
    loadPackFromBlob(blob: Blob, name?: string): Promise<string>;
    /**
     * Load a resource pack from a File (drag-drop, file input)
     */
    loadPackFromFile(file: File): Promise<string>;
    /**
     * Remove a resource pack
     */
    removePack(packId: string): Promise<void>;
    /**
     * Remove all resource packs
     */
    removeAllPacks(): Promise<void>;
    /**
     * Enable a resource pack
     */
    enablePack(packId: string): Promise<void>;
    /**
     * Disable a resource pack
     */
    disablePack(packId: string): Promise<void>;
    /**
     * Toggle a resource pack's enabled state
     */
    togglePack(packId: string): Promise<boolean>;
    /**
     * Set a pack's priority
     */
    setPackPriority(packId: string, priority: number): Promise<void>;
    /**
     * Move a pack up in priority
     */
    movePackUp(packId: string): Promise<void>;
    /**
     * Move a pack down in priority
     */
    movePackDown(packId: string): Promise<void>;
    /**
     * Reorder packs (for drag-drop UI)
     */
    reorderPacks(packIds: string[]): Promise<void>;
    /**
     * Get info for a specific pack
     */
    getPackInfo(packId: string): ResourcePackInfo | null;
    /**
     * Get all packs sorted by priority
     */
    getAllPacks(): ResourcePackInfo[];
    /**
     * Get only enabled packs
     */
    getEnabledPacks(): ResourcePackInfo[];
    /**
     * Get pack count
     */
    getPackCount(): number;
    /**
     * Get assets provided by a specific pack
     */
    getPackAssets(packId: string): Promise<PackAssetList>;
    /**
     * Get which pack provides a specific asset
     */
    getAssetSource(assetPath: string, type: "texture" | "blockstate" | "model"): string | null;
    /**
     * Get all asset conflicts
     */
    getAssetConflicts(): Promise<AssetConflict[]>;
    /**
     * Preview a texture from a specific pack
     */
    previewPackTexture(packId: string, texturePath: string): Promise<string | null>;
    /**
     * Subscribe to pack events
     */
    onPackEvent<T extends PackEventType>(event: T, callback: PackEventCallback<T>): void;
    /**
     * Unsubscribe from pack events
     */
    offPackEvent<T extends PackEventType>(event: T, callback: PackEventCallback<T>): void;
    /**
     * Subscribe to pack event once
     */
    oncePackEvent<T extends PackEventType>(event: T, callback: PackEventCallback<T>): void;
    /**
     * Begin a batch update (pauses auto-rebuild)
     */
    beginPackBatchUpdate(): void;
    /**
     * End a batch update (commits changes, triggers rebuild)
     */
    endPackBatchUpdate(): Promise<void>;
    /**
     * Set auto-rebuild mode
     */
    setPackAutoRebuild(enabled: boolean): void;
    /**
     * Manually trigger atlas rebuild
     */
    rebuildPackAtlas(): Promise<void>;
    /**
     * Save pack state to IndexedDB
     */
    savePackState(): Promise<void>;
    /**
     * Load pack state from IndexedDB
     */
    loadPackState(): Promise<boolean>;
    /**
     * Export pack configuration
     */
    exportPackConfig(): PackConfiguration;
    /**
     * Import pack configuration
     */
    importPackConfig(config: PackConfiguration): Promise<void>;
    /**
     * Get total pack cache size
     */
    getPackCacheSize(): Promise<number>;
    /**
     * Clear all pack cache
     */
    clearPackCache(): Promise<void>;
    /**
     * Check if a pack URL is cached
     */
    isPackCached(sourceUrl: string): Promise<boolean>;
    /**
     * Get memory usage statistics
     */
    getPackMemoryUsage(): MemoryStats;
    /**
     * Validate a pack without loading it
     */
    validatePack(blob: Blob): Promise<import("./types").PackValidationResult>;
    lastPackLoadedFromCache: boolean;
    /**
     * Get a block mesh with optional caching
     * @param blockString The block string (e.g., "minecraft:stone[variant=smooth]")
     * @param biome The biome for tinting (default: "plains")
     * @param useCache Whether to use cached meshes (default: true)
     * @param nbtData Optional NBT data for tile entities (e.g., sign text, chest contents)
     * @returns Promise<THREE.Object3D> The block mesh
     */
    getBlockMesh(blockString: string, biome?: string, useCache?: boolean, nbtData?: Record<string, any>): Promise<THREE.Object3D>;
    /**
     * Get an entity mesh with optional caching
     * @param entityType The entity type
     * @param useCache Whether to use cached meshes (default: true)
     * @returns Promise<THREE.Object3D> The entity mesh
     */
    getEntityMesh(entityType: string, useCache?: boolean): Promise<THREE.Object3D>;
    /**
     * Clear all mesh caches
     */
    clearMeshCaches(): void;
    private getMeshCacheGeneration;
    /**
     * Clear block mesh cache only
     */
    clearBlockMeshCache(): void;
    /**
     * Clear entity mesh cache only
     */
    clearEntityMeshCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        blockMeshCount: number;
        entityMeshCount: number;
    };
    /**
     * Check if a block mesh is cached
     */
    isBlockMeshCached(blockString: string, biome?: string): boolean;
    /**
     * Check if an entity mesh is cached
     */
    isEntityMeshCached(entityType: string): boolean;
    registerBlockEntity(blockId: string, entityType: string): void;
    registerHybridBlock(blockId: string, dynamicParts: HybridBlockDynamicPart[]): void;
    /** True when any animated texture is registered (drives continuous rendering). */
    hasAnimatedTextures(): boolean;
    /** Advance animations; returns true if anything changed and a redraw is needed. */
    updateAnimations(): boolean;
    parseBlockString(blockString: string): Block;
    private analyzeModelGeometry;
    private isModelACube;
    private isBlockCube;
    private hasBlockTransparency;
    private hasBlockCullableFaces;
    /**
     * Get optimization data for voxel rendering
     */
    getBlockOptimizationData(blockString: string, biome?: string, useCache?: boolean): Promise<BlockOptimizationData>;
    /**
     * Quick geometry info without full optimization data
     */
    getBlockGeometryInfo(blockString: string): Promise<BlockGeometryInfo>;
    buildTextureAtlas(): Promise<THREE.Texture>;
    getTextureAtlas(): THREE.Texture | null;
    getTextureUV(textureName: string): {
        u: number;
        v: number;
        width: number;
        height: number;
    } | null;
    getMaterial(blockType: string, options?: {
        useAtlas?: boolean;
    }): Promise<THREE.Material>;
    /**
     * Preload all block models to populate modelCache for texture atlas
     */
    preloadAllBlockModels(): Promise<void>;
    /**
     * Clear optimization cache
     */
    clearOptimizationCache(): void;
    private createFallbackMesh;
    getAssetLoader(): AssetLoader;
    getBlockMeshBuilder(): BlockMeshBuilder;
    getEntityRenderer(): EntityRenderer;
    dispose(): void;
}
//# sourceMappingURL=Cubane.d.ts.map