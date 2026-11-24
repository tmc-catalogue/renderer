import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { Block, BlockModel, OptimizedFace } from "./types";
export declare class BlockMeshBuilder {
    private assetLoader;
    private showUnknownBlocks;
    private useAtlas;
    constructor(assetLoader: AssetLoader, options?: {
        showUnknownBlocks?: boolean;
        useAtlas?: boolean;
    });
    createBlockMesh(model: BlockModel, transform?: {
        x?: number;
        y?: number;
        uvlock?: boolean;
        block?: Block;
    }, block?: Block, biome?: string): Promise<THREE.Object3D>;
    /** Full-cube liquid model: every face the still texture (tops and sides render
     * the same pattern; side motion comes from the record path's world-space scroll). */
    private fullCubeLiquidModel;
    createBlockMeshNoWater(model: BlockModel, transform?: {
        x?: number;
        y?: number;
        uvlock?: boolean;
        block?: Block;
    }, block?: Block, biome?: string): Promise<THREE.Object3D>;
    createWaterloggedBlockMesh(model: BlockModel, transform?: {
        x?: number;
        y?: number;
        uvlock?: boolean;
        block?: Block;
    }, block?: Block, biome?: string): Promise<THREE.Object3D>;
    private getFaceNormal;
    private createElementGeometries;
    private createIndexedElementGeometry;
    private createTempFaceGeometry;
    private createIndexedGeometryFromFaces;
    private shouldUseAtlas;
    private createFaceGeometry;
    /**
     * Apply atlas UV mapping to geometry
     * This transforms the existing face UVs to point to the correct region in the atlas
     */
    private applyAtlasUVMapping;
    /**
     * Enhanced UV coordinate mapping that preserves face-specific logic
     */
    private mapUVCoordinates;
    /** Minecraft projects omitted UVs from the element's bounds, at 16 pixels/block. */
    private withDefaultUV;
    /**
     * Create separated face data for optimization
     */
    createOptimizedFaceData(model: BlockModel, transform?: {
        x?: number;
        y?: number;
        uvlock?: boolean;
        block?: Block;
    }, block?: Block, biome?: string): Promise<{
        cullableFaces: Map<string, OptimizedFace[]>;
        nonCullableFaces: OptimizedFace[];
        hasTransparency: boolean;
    }>;
    /**
     * Extract individual faces from an element
     */
    private extractElementFaces;
    /**
     * Determine if a face can be batched efficiently
     */
    private canFaceBeBatched;
    /**
     * Check if UV coordinates are standard for the face
     */
    private isStandardUV;
    private applyElementTransforms;
    private getMaterialKey;
    private createFaceMaterial;
    private mergeGeometries;
    private isLiquidBlock;
    private isWaterBlock;
    private static readonly ALWAYS_WATERLOGGED;
    private isWaterlogged;
    private isLavaBlock;
    private applyUVRotation;
    private createPlaceholderCube;
}
//# sourceMappingURL=BlockMeshBuilder.d.ts.map