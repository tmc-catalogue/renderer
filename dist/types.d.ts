import { Mesh, BufferGeometry, Material, Vector3 } from "three";
export interface BlockStateModelHolder {
    model: string;
    x?: number;
    y?: number;
    uvlock?: boolean;
    weight?: number;
}
type BlockStateDefinitionModel = BlockStateModelHolder | (BlockStateModelHolder & {
    weight?: number;
})[];
export interface MeshData {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
    materialIds: Uint8Array;
}
export interface ChunkMeshRequest {
    chunkX: number;
    chunkY: number;
    chunkZ: number;
    schematicId: string;
    width: number;
    height: number;
    depth: number;
    blocks: BlockData[];
    renderingBounds?: {
        min: [number, number, number];
        max: [number, number, number];
    };
    defs: [string, BakedBlockDef][];
}
export interface BakedFace {
    pos: number[];
    uv: number[];
    normal: [number, number, number];
    texKey: string;
}
export interface BlockData {
    name: string;
    stateKey: string;
    x: number;
    y: number;
    z: number;
    chunk_x?: number;
    chunk_y?: number;
    chunk_z?: number;
    properties?: Record<string, string>;
}
export interface ChunkData {
    chunk_x: number;
    chunk_y: number;
    chunk_z: number;
    blocks: BlockData[];
}
export interface BakedBlockDef {
    faces: BakedFace[];
    bbox: [number, number, number, number, number, number];
}
export type BlockStateDefinitionVariant<T> = {
    [variant: string]: T;
};
export interface BlockStateDefinition {
    variants?: BlockStateDefinitionVariant<BlockStateDefinitionModel>;
    multipart?: {
        apply: BlockStateDefinitionModel;
        when?: {
            OR?: BlockStateDefinitionVariant<string>[];
        } & BlockStateDefinitionVariant<string>;
    }[];
}
export type Block = {
    name: string;
    properties: Record<string, string>;
};
export type Vector = [number, number, number];
export declare const POSSIBLE_FACES: readonly ["south", "north", "east", "west", "up", "down"];
export type Faces = (typeof POSSIBLE_FACES)[number] | "bottom";
export interface BlockModel {
    parent?: string;
    ambientocclusion?: boolean;
    display?: {
        Position?: {
            rotation?: Vector;
            translation?: Vector;
            scale?: Vector;
        };
    };
    textures?: {
        particle?: string;
        [texture: string]: string | undefined;
    };
    elements: {
        name: string;
        from?: Vector;
        to?: Vector;
        rotation?: {
            origin?: Vector;
            axis?: "x" | "y" | "z";
            angle?: number;
            rescale?: boolean;
        };
        shade?: boolean;
        faces?: {
            [face in Faces]: {
                uv?: [number, number, number, number];
                texture?: string;
                cullface?: Faces;
                rotation?: number;
                tintindex?: number;
            };
        };
    }[];
}
export interface BlockModelData {
    name: string;
    models: {
        options: {
            holder: BlockStateModelHolder;
            weight: number;
        }[];
    }[];
}
export interface BlockModelOption {
    name: string;
    holders: BlockStateModelHolder[];
}
export interface ChunkMeshes {
    solid: Mesh | null;
    cutout: Mesh | null;
    water: Mesh | null;
    redstone: Mesh | null;
    transparent: Mesh | null;
    emissive: Mesh | null;
}
export interface ProcessedBlockGeometry {
    geometry: BufferGeometry;
    material: Material;
}
export interface PaletteBlockGeometry {
    geometries: ProcessedBlockGeometry[];
    blockName: string;
}
export interface PaletteGeometryCache {
    geometries: PaletteBlockGeometry[];
    isReady: boolean;
}
export interface PaletteMaterialGroup {
    material: Material;
    baseGeometry: BufferGeometry;
    positions: Vector3[];
    materialIndex: number;
}
export interface PaletteBlockData {
    blockName: string;
    materialGroups: PaletteMaterialGroup[];
    category: keyof ChunkMeshes;
}
export interface PaletteCache {
    palette: any[];
    blockData: PaletteBlockData[];
    globalMaterials: Material[];
    isReady: boolean;
    /** Raw descriptors the wasm/GPU meshers consume (index/category/occlusionFlags/geometries). */
    paletteGeometryData?: any[];
}
export interface ChunkGeometryData {
    category: string;
    positions: Int16Array | Float32Array;
    normals: Int8Array | Float32Array;
    uvs: Float32Array;
    indices: Uint16Array | Uint32Array;
    groups: {
        start: number;
        count: number;
        materialIndex: number;
    }[];
}
export {};
//# sourceMappingURL=types.d.ts.map