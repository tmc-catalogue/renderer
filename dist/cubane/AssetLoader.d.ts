import * as THREE from "three";
import { BlockModel, BlockStateDefinition } from "./types";
import { ResourcePackManager } from "./ResourcePackManager";
export declare class AssetLoader {
    private resourcePacks;
    private resourcePackOrder;
    private animatedTextureManager;
    private tintManager;
    private packManager;
    private usePackManager;
    private stringCache;
    private blockStateCache;
    private modelCache;
    private textureCache;
    private materialCache;
    private resourceGeneration;
    private fluidFramesLoad;
    private textureLoader;
    private textureAtlas;
    private textureUVMap;
    private static readonly ATLAS_FORMAT_VERSION;
    private resourcePackHash;
    private cacheEnabled;
    constructor(enableCache?: boolean);
    /**
     * Connect to a ResourcePackManager for managed pack loading
     */
    setPackManager(manager: ResourcePackManager): void;
    /**
     * Rebuild atlas from ResourcePackManager's packs
     */
    private rebuildFromPackManager;
    /** Release all assets derived from the previous pack stack. */
    private invalidatePackAssets;
    /**
     * Hash a string using SHA-256
     */
    private hashString;
    /**
     * Get packs in priority order for iteration (highest priority first for overrides)
     * Supports both ResourcePackManager and legacy direct loading
     */
    private getOrderedPacks;
    /**
     * Calculate hash of resource pack for cache invalidation
     */
    private calculateResourcePackHash;
    /**
     * Load a resource pack from a blob
     */
    loadResourcePack(blob: Blob): Promise<void>;
    private findEOCD;
    /**
     * Get a string resource (JSON files, etc.)
     */
    getResourceString(path: string, silent?: boolean): Promise<string | undefined>;
    /**
     * Get a binary resource (textures, etc.)
     */
    getResourceBlob(path: string): Promise<Blob | undefined>;
    /**
     * Get a block state definition
     */
    getBlockState(blockId: string): Promise<BlockStateDefinition>;
    getModel(modelPath: string): Promise<BlockModel>;
    private loadAndMergeModel;
    /**
     * Resolve a texture reference in a model
     */
    resolveTexture(textureRef: string | {
        sprite?: string;
    } | unknown, model: BlockModel): string;
    /** Advance animated textures; returns true if any frame flipped (needs redraw). */
    updateAnimations(): boolean;
    getTexture(texturePath: string): Promise<THREE.Texture>;
    private createTextureFromBlob;
    getTint(blockId: string, properties: Record<string, string>, biome?: string, position?: THREE.Vector3): THREE.Color;
    /** True when any animated texture is registered (drives continuous rendering). */
    hasAnimatedTextures(): boolean;
    private colormapLoad;
    private colormapGeneration;
    private invalidateColormaps;
    /**
     * Load Minecraft's grass/foliage colormaps from the active resource pack and
     * hand them to the TintManager so biome tints come from real colormap pixels.
     * If the pack ships no colormaps the TintManager falls back to sane defaults.
     * Guarded so it only decodes once per atlas (re)build.
     */
    loadColormaps(): Promise<void>;
    private loadColormapImageData;
    /**
     * Decode a resource-pack texture to raw RGBA pixels (top-left origin).
     * Used by the sign renderer to read the sign-board and font textures so it can
     * composite glyphs into an upscaled copy. `texturePath` is relative to
     * `textures/` and without the `.png` extension (e.g. "entity/signs/oak",
     * "font/ascii").
     */
    getTexturePixels(texturePath: string): Promise<ImageData | null>;
    /**
     * Analyze PNG texture transparency by examining alpha channel data
     */
    analyzeTextureTransparency(texture: THREE.Texture): {
        hasTransparency: boolean;
        transparencyType: "opaque" | "cutout" | "blend";
        averageAlpha: number;
        visibleAlpha: number;
        opaquePixelCount: number;
        transparentPixelCount: number;
        semiTransparentPixelCount: number;
    };
    getSharedAtlasTexture(): THREE.Texture | null;
    getMaterial(texturePath: string, options?: {
        transparent?: boolean;
        lightEmission?: number;
        tint?: THREE.Color;
        isLiquid?: boolean;
        isWater?: boolean;
        isLava?: boolean;
        isFlowing?: boolean;
        faceDirection?: string;
        forceAnimation?: boolean;
        alphaTest?: number;
        opacity?: number;
        biome?: string;
        useAtlas?: boolean;
    }): Promise<THREE.Material>;
    /**
     * Build a per-tile mip chain for the atlas and configure the texture to use it.
     *
     * NearestFilter without mipmaps aliased every distant face into moiré arcs
     * ("circular black lines" that grow with distance). Letting the GL generate
     * mips would bleed adjacent tiles into each other, so every level is drawn
     * tile-by-tile from the uvMap rects — tiles stay isolated down to 1px cells.
     */
    private configureAtlasMips;
    private invalidateFluidFrames;
    private releaseFluidFrames;
    /** Decode once per pack generation, sharing concurrent callers even on atlas cache hits. */
    private loadFluidFrames;
    buildTextureAtlas(): Promise<THREE.Texture>;
    /**
     * Cache management methods
     */
    enableCache(): void;
    disableCache(): void;
    clearAtlasCache(): Promise<void>;
    getCacheInfo(): Promise<{
        key: string;
        size: string;
        age: string;
        textureCount: number;
        storage: string;
    }[]>;
    invalidateCache(): void;
    /**
     * Force rebuild atlas (ignores cache)
     */
    rebuildTextureAtlas(): Promise<THREE.Texture>;
    /**
     * List all blockstate files in the resource pack
     */
    listBlockstates(): Promise<string[]>;
    getTextureAtlas(): THREE.Texture | null;
    getTextureUV(path: string): {
        u: number;
        v: number;
        width: number;
        height: number;
    } | null;
    getEntityTexture(entityName: string): Promise<THREE.Texture>;
    private createMissingTexture;
    /**
     * Clean up resources
     */
    dispose(): void;
}
//# sourceMappingURL=AssetLoader.d.ts.map