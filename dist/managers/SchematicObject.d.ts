import * as THREE from "three";
import { SchematicWrapper, DefinitionRegionWrapper, SortStrategyWrapper } from "../nucleationExports";
import { EventEmitter } from "events";
import { SchematicRenderer } from "../SchematicRenderer";
import type { MeshBuildingMode } from "../SchematicRendererOptions";
import type { BlockData } from "../types";
import type { ExportOptions, ExportResult } from "../types/export";
import { EditableRegionHighlight } from "./highlight/EditableRegionHighlight";
export declare class SchematicObject extends EventEmitter {
    private static readonly builderQueues;
    name: string;
    schematicWrapper: SchematicWrapper;
    private schematicRenderer;
    private meshes;
    private bubbleMesh;
    get hasAnimatedParticles(): boolean;
    private surfaceIndex;
    private surfaceTemplates;
    private surfaceMaterials;
    private endPortalMaterial?;
    private surfaceClip;
    private animatedSurfaces;
    private surfaceViewBox;
    private editQueue;
    private materialStates;
    private materialCopies;
    private ownedMaterialCopies;
    private hasBuiltMeshes;
    private visibilityBuildPending;
    private disposed;
    get hasAnimatedSurfaces(): boolean;
    hasSurfacesInView(frustum: THREE.Frustum): boolean;
    hasParticlesInView(frustum: THREE.Frustum): boolean;
    private worldMeshBuilder;
    private eventEmitter;
    private sceneManager;
    private chunkMeshes;
    private chunkDimensions;
    id: string;
    group: THREE.Group;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
    opacity: number;
    visible: boolean;
    meshBoundingBox: [number[], number[]];
    renderingBounds: {
        min: THREE.Vector3;
        max: THREE.Vector3;
        helper?: THREE.Box3Helper;
        enabled?: boolean;
    };
    bounds: {
        minX: number;
        minY: number;
        minZ: number;
        maxX: number;
        maxY: number;
        maxZ: number;
    };
    private meshesReady;
    private _cachedDimensions;
    private blockEntitiesMap;
    constructor(schematicRenderer: SchematicRenderer, name: string, schematicWrapper: SchematicWrapper, properties?: Partial<{
        position: THREE.Vector3 | number[];
        rotation: THREE.Euler | number[];
        scale: THREE.Vector3 | number[] | number;
        opacity: number;
        visible: boolean;
        meshBoundingBox?: [number[], number[]];
        renderingBounds?: {
            min: THREE.Vector3 | number[];
            max: THREE.Vector3 | number[];
        };
    }>);
    /**
     * Set up manual property watchers instead of using reactive proxy
     * This avoids interference with Three.js internal matrix properties
     */
    private _propertyWatcherTimer;
    private setupPropertyWatchers;
    /**
     * Get schematic dimensions (allocated space).
     * Returns [width, height, length] tuple.
     */
    getDimensions(): [number, number, number];
    /**
     * Get tight dimensions (actual block content, not pre-allocated space)
     * Returns [width, height, length] or [0, 0, 0] if no blocks exist
     */
    getTightDimensions(): [number, number, number];
    /**
     * Get tight bounding box min coordinates [x, y, z]
     * Returns null if no non-air blocks have been placed
     */
    getTightBoundsMin(): [number, number, number] | null;
    /**
     * Get tight bounding box max coordinates [x, y, z]
     * Returns null if no non-air blocks have been placed
     */
    getTightBoundsMax(): [number, number, number] | null;
    /**
     * Display detailed performance monitoring results
     */
    private displayPerformanceResults;
    private emitPropertyChanged;
    private updateTransform;
    syncTransformFromGroup(): void;
    private applyPropertiesToObjects;
    /**
     * Export the schematic using the new modular export system
     *
     * @param options Export options including format, quality, and callbacks
     * @returns Promise resolving to the export result
     *
     * @example
     * // Basic GLB export (recommended)
     * await schematic.export({ format: 'glb' });
     *
     * @example
     * // Export with options
     * await schematic.export({
     *   format: 'gltf',
     *   quality: 'high',
     *   normalMode: 'flip',
     *   filename: 'my_schematic',
     *   onProgress: (p) => console.log(`${p.progress * 100}%: ${p.message}`)
     * });
     */
    export(options?: ExportOptions): Promise<ExportResult>;
    /**
     * Export as GLB (binary GLTF) - recommended for most use cases
     * @param filename Optional filename (without extension)
     */
    exportAsGLB(filename?: string): Promise<ExportResult>;
    /**
     * Exports the schematic as a GLTF file
     * @deprecated Use export() or exportAsGLB() instead for better normal handling
     * @param options Export options
     * @returns Promise that resolves when export is complete
     */
    exportAsGLTF(options?: {
        filename?: string;
        binary?: boolean;
        includeCustomExtensions?: boolean;
        maxTextureSize?: number;
        embedImages?: boolean;
        animations?: THREE.AnimationClip[];
    }): Promise<void>;
    private buildMeshes;
    /** Workers and palette tables belong to a renderer, not a schematic. Keep
     * different palettes from changing the worker's active template mid-build. */
    private withBuilder;
    private reportBuildProgress;
    buildSchematicMeshes(schematicObject: SchematicObject, chunkDimensions?: any, buildMode?: MeshBuildingMode): Promise<{
        meshes: any[];
        chunkMap: Map<string, any[]>;
    }>;
    buildSchematicMeshesImmediate(schematicObject: SchematicObject, chunkDimensions?: any): Promise<{
        meshes: THREE.Object3D[];
        chunkMap: Map<string, THREE.Object3D[]>;
    }>;
    /**
     * Build, for every chunk, a flat list of its neighbours' boundary blocks so the
     * mesher can cull faces that sit on a chunk seam. Runs in a single pass over all
     * blocks (extract each chunk's 6 boundary planes) plus a cheap assembly pass, so
     * cost is linear in block count — and it reduces output geometry, which usually
     * makes large schematics render faster overall.
     *
     * Coordinates are world-space; a chunk (cx,cy,cz) spans [cx*W .. cx*W+W-1] etc.
     * Returns a map of "cx,cy,cz" -> Int32Array of [x, y, z, paletteIndex, …].
     */
    private computeChunkAprons;
    buildSchematicMeshesIncremental(schematicObject: SchematicObject, chunkDimensions?: any): Promise<{
        meshes: THREE.Object3D[];
        chunkMap: Map<string, THREE.Object3D[]>;
    }>;
    /**
    /**
     * Clip a list of chunks against renderingBounds before they're handed to
     * the batched worker. `processChunksBatched` doesn't accept bounds, so we
     * cull whole chunks that fall outside the slice and rewrite the block
     * Int32Arrays of chunks that overlap.
     */
    private applyBoundsToChunks;
    /**
     * High-performance batched build mode
     *
     * Processes all chunks through a single worker that accumulates geometry,
     * then returns just a few merged meshes (one per category: solid, transparent, etc.)
     *
     * Benefits:
     * - Creates only 2-3 THREE.Mesh objects instead of hundreds
     * - Drastically reduces main thread work
     * - Best for large schematics where mesh count is the bottleneck
     */
    private _gpuMeshBuilder;
    private getGpuMeshBuilder;
    /**
     * GPU compute build: extract the full block grid once, upload with the palette
     * templates, two-pass compute (count -> exact alloc -> emit), read back per-category
     * BufferGeometries. Hash-compatible with the batched path's oracle bookkeeping.
     */
    buildSchematicMeshesGpu(schematicObject: any): Promise<{
        meshes: any[];
        chunkMap: Map<string, any[]>;
    }>;
    /**
     * GPU-pull build: same grid extraction as the GPU path, but emits the 8B/triangle
     * record stream and renders it directly via WebGL2 vertex pulling (gl_VertexID) —
     * zero vertex-data readback. ~10x less data than the vertex path.
     */
    buildSchematicMeshesGpuPull(schematicObject: any): Promise<{
        meshes: any[];
        chunkMap: Map<string, any[]>;
    }>;
    /** Dispose cached surface resources even when clipping left no attached meshes. */
    disposeSurfaceResources(): void;
    private prepareSurfaceStates;
    private buildSurfaceSections;
    private buildTransparentSurfaces;
    private refreshSurfaceCells;
    private isSurfaceOnlyState;
    private touchesFluid;
    private refreshFluidSurface;
    /** One shared surface pass for both the GPU-pull and batched CPU paths. */
    private buildFluidSurface;
    /** Shared front half of the GPU build paths: palette precompute + grid extraction. */
    private extractGpuGrid;
    buildSchematicMeshesBatched(schematicObject: SchematicObject, chunkDimensions?: any): Promise<{
        meshes: THREE.Object3D[];
        chunkMap: Map<string, THREE.Object3D[]>;
    }>;
    buildSchematicMeshesInstanced(schematicObject: SchematicObject): Promise<{
        meshes: THREE.Object3D[];
        chunkMap: Map<string, THREE.Object3D[]>;
    }>;
    /**
     * Creates or updates the rendering bounds helper visualization
     */
    private createRenderingBoundsHelper;
    /**
     * Sets the rendering bounds for this schematic
     * @param min Minimum coordinates for rendering
     * @param max Maximum coordinates for rendering
     * @param showHelper Whether to show a visual helper for the bounds
     */
    setRenderingBounds(min: THREE.Vector3 | number[], max: THREE.Vector3 | number[], showHelper?: boolean): void;
    /**
     * Updates rendering bounds without triggering rebuild - just emits change event
     */
    private updateRenderingBounds;
    /**
     * Shows or hides the rendering bounds helper
     * @param visible Whether the helper should be visible
     */
    showRenderingBoundsHelper(visible: boolean): void;
    /**
     * Resets the rendering bounds to include the full schematic
     */
    resetRenderingBounds(): void;
    getMeshes(): Promise<THREE.Object3D[]>;
    getChunkObjectsAt(chunkX: number, chunkY: number, chunkZ: number): THREE.Object3D[] | null;
    setChunkObjectsAt(chunkX: number, chunkY: number, chunkZ: number, objects: THREE.Object3D[]): void;
    getChunkMeshAt(chunkX: number, chunkY: number, chunkZ: number): THREE.Mesh[] | null;
    setChunkMeshAt(chunkX: number, chunkY: number, chunkZ: number, meshes: THREE.Mesh[]): void;
    private updateMeshMaterials;
    private updateMeshVisibility;
    updateMesh(): Promise<void>;
    private updateMeshNow;
    /** Release meshes and GPU-owned tables, including detached progressive batches. */
    private clearBuiltMeshes;
    /** Stop future staging/edit work immediately, then release the settled build. */
    dispose(): Promise<void>;
    rebuildMesh(): Promise<void>;
    private rebuildMeshNow;
    getSchematicWrapper(): SchematicWrapper;
    getRegions(): EditableRegionHighlight[];
    getRegion(name: string): EditableRegionHighlight | undefined;
    createRegion(name: string, min: {
        x: number;
        y: number;
        z: number;
    }, maxOrOptions?: {
        x: number;
        y: number;
        z: number;
    } | {
        color?: number;
        opacity?: number;
    }, options?: {
        color?: number;
        opacity?: number;
    }): EditableRegionHighlight;
    /**
     * Track whether definition regions are currently visible for this schematic
     */
    private _definitionRegionsVisible;
    /**
     * Whether definition regions from schematic metadata are currently visible
     */
    get definitionRegionsVisible(): boolean;
    /**
     * Load definition regions from this schematic's metadata.
     * Definition regions are stored in NucleationDefinitions metadata,
     * typically created via CircuitBuilder, Insign, or direct API calls.
     *
     * @param autoShow - Whether to immediately show the regions (default: true based on renderer options)
     * @returns Array of created region names
     */
    loadDefinitionRegions(autoShow?: boolean): string[];
    /**
     * Show all definition regions for this schematic
     */
    showDefinitionRegions(): void;
    /**
     * Hide all definition regions for this schematic
     */
    hideDefinitionRegions(): void;
    /**
     * Toggle visibility of all definition regions for this schematic
     * @returns The new visibility state
     */
    toggleDefinitionRegions(): boolean;
    /**
     * Check if this schematic has any definition regions loaded
     */
    hasDefinitionRegions(): boolean;
    /**
     * Get the names of all definition regions for this schematic
     */
    getDefinitionRegionNames(): string[];
    /**
     * Get a definition region by its original name (from schematic metadata).
     * Returns the EditableRegionHighlight if loaded, or undefined.
     */
    getDefinitionRegion(name: string): EditableRegionHighlight | undefined;
    /**
     * Remove all loaded definition regions for this schematic
     */
    removeDefinitionRegions(): void;
    /**
     * Creates a callable JavaScript function from this schematic using region-based IO.
     * This allows you to treat the schematic as a black-box function in JS.
     *
     * @param inputs List of input definitions
     * @param outputs List of output definitions
     * @returns A callable object to run the circuit
     */
    createCircuitFunction(inputs: Array<{
        name: string;
        bits: number;
        region: {
            min: {
                x: number;
                y: number;
                z: number;
            };
            max: {
                x: number;
                y: number;
                z: number;
            };
        } | string | DefinitionRegionWrapper;
        signed?: boolean;
        mode?: "binary" | "signal";
        blockFilter?: string | string[];
        sort?: string | SortStrategyWrapper;
    }>, outputs: Array<{
        name: string;
        bits: number;
        region: {
            min: {
                x: number;
                y: number;
                z: number;
            };
            max: {
                x: number;
                y: number;
                z: number;
            };
        } | string | DefinitionRegionWrapper;
        signed?: boolean;
        mode?: "binary" | "signal";
        blockFilter?: string | string[];
        sort?: string | SortStrategyWrapper;
    }>): {
        run: (inputValues: Record<string, number | boolean>, maxTicks?: number, mode?: "stable" | "fixed") => any;
        reset: () => void;
        sync: () => Promise<void>;
        executor: import("nucleation").TypedCircuitExecutorWrapper;
    };
    private getPalettes;
    getBlockEntitiesMap(): Map<string, any>;
    setBlockNoRebuild(position: THREE.Vector3 | number[], blockType: string): Promise<void>;
    setBlockWithNbt(position: THREE.Vector3 | number[], blockType: string, nbtData: Record<string, string>): Promise<void>;
    /**
     * Compiles Insign annotations from sign blocks in the schematic
     * @returns Raw Insign data (DslMap) or null if compilation fails
     */
    compileInsign(): any;
    private enqueueEdit;
    setBlock(position: THREE.Vector3 | number[], blockType: string): Promise<void>;
    setBlocks(blocks: [THREE.Vector3 | number[], string][]): Promise<void>;
    copyRegionFromSchematic(sourceSchematicName: string, sourceMin?: THREE.Vector3 | number[], sourceMax?: THREE.Vector3 | number[], targetPosition?: THREE.Vector3 | number[], excludeBlocks?: string[], rebuild?: boolean): Promise<void>;
    /** Set when the current build came from the GPU path (enables hide-and-rebuild;
     *  the grid itself is NOT retained — hide re-extracts it, saving sx*sy*sz*4 bytes) */
    gpuBuilt: boolean;
    /** Schematic-space cells hidden via the inspector ("x,y,z"); applied on GPU rebuilds */
    hiddenCells: Set<string>;
    /** Surface-only inspector edits replace their affected sections in every build mode. */
    hideBlockAndRebuild(x: number, y: number, z: number): Promise<boolean>;
    unhideAllBlocks(): Promise<boolean>;
    private rebuildAfterEdit;
    getBlock(position: THREE.Vector3 | number[]): string | undefined;
    debugBlock(position: THREE.Vector3 | {
        x: number;
        y: number;
        z: number;
    }): void;
    replaceBlock(replaceBlock: string, newBlock: string): Promise<void>;
    addCube(position: THREE.Vector3 | number[], size: THREE.Vector3 | number[], blockType: string): Promise<SchematicObject>;
    rebuildChunkAtPosition(position: THREE.Vector3): Promise<void>;
    rebuildAllChunks(): void;
    private getChunkCoordinates;
    rebuildChunk(chunkX: number, chunkY: number, chunkZ: number): Promise<void>;
    private readChunkApron;
    private rebuildChunkNow;
    private removeChunkObjects;
    containsPosition(position: THREE.Vector3): boolean;
    getSchematicCenter(): THREE.Vector3;
    /**
     * Get the world-space bounding box of the schematic's actual block content
     */
    getTightWorldBox(): THREE.Box3;
    centerInScene(): void;
    centerInScenePlane(): void;
    setPosition(position: THREE.Vector3 | number[]): void;
    setRotation(rotation: THREE.Euler | number[]): void;
    setScale(scale: THREE.Vector3 | number[]): void;
    getWorldPosition(): THREE.Vector3;
    getBoundingBox(): [number[], number[]];
    getAllBlocks(filter?: (block: BlockData) => boolean): BlockData[];
    /**
     * Creates an object with properties and methods for easily manipulating rendering bounds
     * Useful for console manipulation and testing
     * @returns Settings object with properties and methods
     */
    createBoundsControls(): any;
}
//# sourceMappingURL=SchematicObject.d.ts.map