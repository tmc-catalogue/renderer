import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { TextureAnimationMetadata } from "./types";
/**
 * Animation metadata structure that matches Minecraft's mcmeta format
 */
/**
 * Extended class to handle animated textures
 */
export declare class AnimatedTextureManager {
    private assetLoader;
    private animatedTextures;
    private generation;
    private pendingImages;
    constructor(assetLoader: AssetLoader);
    /** True when at least one animated texture is registered (drives continuous rendering). */
    hasActiveTextures(): boolean;
    /** Stop old animations and return their textures to the owner's disposal pass. */
    clear(): THREE.Texture[];
    /**
     * Check if a texture has animation metadata
     */
    isAnimated(texturePath: string): Promise<boolean>;
    /**
     * Load animation metadata for a texture
     */
    loadAnimationMetadata(texturePath: string): Promise<TextureAnimationMetadata | null>;
    /**
     * Create an animated texture
     */
    createAnimatedTexture(texturePath: string): Promise<THREE.Texture | null>;
    /**
     * Update all animated textures. Returns `true` if any texture advanced a frame
     * this call (i.e. the scene now needs a redraw). Returning a dirty flag lets the
     * render loop stay event-driven — it redraws only when a frame actually flips
     * (~10fps for water) instead of every vsync.
     */
    update(): boolean;
}
//# sourceMappingURL=AnimatedTextureManager.d.ts.map