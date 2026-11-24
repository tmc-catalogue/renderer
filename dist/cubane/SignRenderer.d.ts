import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
export declare class SignRenderer {
    private assetLoader;
    private fontData;
    private fontPromise;
    private basePixelCache;
    private textureCache;
    private cacheGeneration;
    private disposed;
    constructor(assetLoader: AssetLoader);
    /** Sign pixels, fonts and baked canvases all depend on the active resource pack. */
    clearCache(): void;
    dispose(): void;
    /** Whether a block id (e.g. "minecraft:oak_wall_sign") is any kind of sign. */
    isSign(blockName: string): boolean;
    /**
     * Build a full sign mesh (geometry + baked-text material) for a block.
     * Returns null if the block isn't a sign or the textures can't be loaded.
     */
    buildSignMesh(blockName: string, properties: Record<string, string>, nbtData?: Record<string, any>): Promise<THREE.Object3D | null>;
    private buildSignMeshForPack;
    private buildModernSign;
    private detectSign;
    /**
     * Y rotation for a wall sign's board. A wall sign mounts on the block opposite its
     * `facing`, so the board sits on that face (a half-turn from the entity model's
     * default orientation in this renderer): north→0, south→180°, east→90°, west→-90°.
     */
    private facingRotationRad;
    /** `rotation` 0-15, each step = 22.5° clockwise from south. */
    private standingRotationRad;
    private buildParts;
    private buildGeometry;
    private emitCube;
    /**
     * Box-unwrap UVs for one cube face (Minecraft layout). Normalized with a
     * top-left origin; the sign texture is created with `flipY = false` so these
     * map 1:1 onto the canvas pixels.
     */
    private cubeFaceUVs;
    private extractSignText;
    /** A raw NBT message → the literal string we hand to `parse_text_component`. */
    private messageToString;
    private getSignTexture;
    private getBasePixels;
    private imageDataToCanvas;
    private makeCanvas;
    private ensureFont;
    private compositeSignWithText;
    private renderSegments;
    private blitGlyph;
    private segmentsWidth;
    /** Latin-1 bytes (the ascii font sheet is indexed 0-255). */
    private toBytes;
    private parseTextComponent;
    private parseJsonValue;
    private textColorRgb;
}
//# sourceMappingURL=SignRenderer.d.ts.map