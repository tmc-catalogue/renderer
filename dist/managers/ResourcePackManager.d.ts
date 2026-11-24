import { ResourcePackInfo, PackFetchOptions, PackValidationResult, PackConfig, AssetConflict, PackMemoryUsage, PackEventType, PackEventHandler, ResourcePackOptions } from "../types/resourcePack";
export type DefaultPackCallback = () => Promise<Blob>;
/**
 * Enhanced Resource Pack Manager with full Cubane-style API
 */
export declare class ResourcePackManager {
    private db;
    initPromise: Promise<void>;
    private packs;
    private eventHandlers;
    private onceHandlers;
    private batchMode;
    private pendingChanges;
    private autoRebuild;
    private options;
    private downloadCache;
    private onAtlasRebuild?;
    constructor(options?: ResourcePackOptions);
    /**
     * Set the atlas rebuild callback
     */
    setAtlasRebuildCallback(callback: () => Promise<void>): void;
    private initDB;
    private loadPacksFromDB;
    private ensureDbInitialized;
    private savePack;
    private deletePack;
    /**
     * Subscribe to a pack event
     */
    onPackEvent<T extends PackEventType>(event: T, handler: PackEventHandler<T>): void;
    /**
     * Alias for onPackEvent for convenience
     */
    on<T extends PackEventType>(event: T, handler: PackEventHandler<T>): void;
    /**
     * Unsubscribe from a pack event
     */
    offPackEvent<T extends PackEventType>(event: T, handler: PackEventHandler<T>): void;
    /**
     * Subscribe to a pack event once
     */
    oncePackEvent<T extends PackEventType>(event: T, handler: PackEventHandler<T>): void;
    private emit;
    /**
     * Load a resource pack from URL
     */
    loadPackFromUrl(url: string, options?: PackFetchOptions): Promise<string>;
    /**
     * Load a resource pack from Blob
     */
    loadPackFromBlob(blob: Blob, name?: string, options?: PackFetchOptions & {
        sourceUrl?: string;
    }): Promise<string>;
    /**
     * Load a resource pack from File
     */
    loadPackFromFile(file: File): Promise<string>;
    /**
     * Legacy method for backward compatibility
     */
    uploadPack(file: File): Promise<string>;
    private parsePackBlob;
    /**
     * Remove a pack by ID
     */
    removePack(packId: string): Promise<void>;
    /**
     * Remove all packs
     */
    removeAllPacks(): Promise<void>;
    /**
     * Enable a pack
     */
    enablePack(packId: string): Promise<void>;
    /**
     * Disable a pack
     */
    disablePack(packId: string): Promise<void>;
    /**
     * Toggle pack enabled state
     */
    togglePack(packId: string): Promise<boolean>;
    /**
     * Legacy method for backward compatibility
     */
    togglePackEnabled(name: string, enabled: boolean): Promise<void>;
    /**
     * Set pack priority
     */
    setPackPriority(packId: string, priority: number): Promise<void>;
    /**
     * Move pack up in priority
     */
    movePackUp(packId: string): Promise<void>;
    /**
     * Move pack down in priority
     */
    movePackDown(packId: string): Promise<void>;
    /**
     * Reorder all packs by ID array
     */
    reorderPacks(packIds: string[]): Promise<void>;
    /**
     * Legacy method for backward compatibility
     */
    reorderPack(name: string, newOrder: number): Promise<void>;
    /**
     * Get pack info by ID
     */
    getPackInfo(packId: string): ResourcePackInfo | null;
    /**
     * Get all packs (sorted by priority)
     */
    getAllPacks(): ResourcePackInfo[];
    /**
     * Get enabled packs only
     */
    getEnabledPacks(): ResourcePackInfo[];
    /**
     * Get enabled packs with their blob data (for loading into Cubane)
     */
    getEnabledPacksWithBlobs(): Array<ResourcePackInfo & {
        blob: Blob;
    }>;
    /**
     * Get pack count
     */
    getPackCount(): number;
    /**
     * Legacy method for backward compatibility
     */
    listPacks(): Promise<{
        name: string;
        enabled: boolean;
        order: number;
    }[]>;
    /**
     * Get assets in a pack
     */
    getPackAssets(packId: string): Promise<{
        textures: string[];
        blockstates: string[];
        models: string[];
    }>;
    /**
     * Get asset conflicts between packs
     */
    getAssetConflicts(): Promise<AssetConflict[]>;
    /**
     * Find which pack provides an asset
     */
    getAssetSource(path: string, type: "texture" | "blockstate" | "model"): Promise<string | null>;
    /**
     * Preview a texture from a specific pack
     */
    previewPackTexture(packId: string, texturePath: string): Promise<string | null>;
    /**
     * Begin batch update mode (defers rebuilds)
     */
    beginPackBatchUpdate(): void;
    /**
     * End batch update mode and trigger rebuild if needed
     */
    endPackBatchUpdate(): Promise<void>;
    /**
     * Set auto-rebuild mode
     */
    setPackAutoRebuild(enabled: boolean): void;
    /**
     * Manually trigger atlas rebuild
     */
    private _rebuildDebounce;
    private _rebuildChain;
    private _lastRebuildKey;
    private _rebuildKey;
    rebuildPackAtlas(): Promise<void>;
    private _doRebuildPackAtlas;
    private triggerRebuild;
    /**
     * Save pack state to IndexedDB (already automatic)
     */
    savePackState(): Promise<void>;
    /**
     * Load pack state from IndexedDB
     */
    loadPackState(): Promise<boolean>;
    /**
     * Export pack configuration
     */
    exportPackConfig(): PackConfig;
    /**
     * Import pack configuration
     */
    importPackConfig(config: PackConfig): Promise<void>;
    /**
     * Check if a URL is cached
     */
    isPackCached(url: string): Promise<boolean>;
    /**
     * Get total cache size in bytes
     */
    getPackCacheSize(): Promise<number>;
    /**
     * Clear all cache
     */
    clearPackCache(): Promise<void>;
    /**
     * Get memory usage statistics
     */
    getPackMemoryUsage(): PackMemoryUsage;
    private getCachedDownload;
    private cacheDownload;
    /**
     * Validate a pack without loading it
     */
    validatePack(blob: Blob): Promise<PackValidationResult>;
    /**
     * Get resource pack blobs for loading into Cubane (legacy compatibility)
     */
    getResourcePackBlobs(defaultPacks?: Record<string, DefaultPackCallback>): Promise<Blob[]>;
    /**
     * Clear all packs (legacy compatibility)
     */
    clearPacks(): Promise<void>;
    private getNextPriority;
    private getSortedPacks;
    private getSortedPackIds;
    private getPackByName;
    private packToInfo;
    /**
     * Get options
     */
    getOptions(): ResourcePackOptions;
    /**
     * Clean up resources
     */
    dispose(): void;
}
//# sourceMappingURL=ResourcePackManager.d.ts.map