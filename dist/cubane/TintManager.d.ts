import * as THREE from "three";
export declare class TintManager {
    private tintableBlocks;
    private grassColormap;
    private foliageColormap;
    private dryFoliageColormap;
    constructor();
    isTintable(blockId: string): boolean;
    getTintType(blockId: string): string | null;
    getTint(blockId: string, properties: Record<string, string>, biome?: string, _position?: THREE.Vector3): THREE.Color;
    private getRedstoneTint;
    /**
     * Supply the decoded grass/foliage colormaps (or null to clear). Called by the
     * AssetLoader once textures are available.
     */
    setColormaps(grass: ImageData | null, foliage: ImageData | null, dryFoliage?: ImageData | null): void;
    /**
     * Sample a Minecraft colormap at the biome's climate point. The colormaps are
     * a triangular gradient indexed by adjusted temperature/downfall. Returns the
     * fallback colour when no colormap is loaded.
     */
    private sampleColormap;
    private getFoliageTint;
    private getWaterTint;
    private getStemTint;
}
//# sourceMappingURL=TintManager.d.ts.map