import * as THREE from "three";
import { CameraManager } from "./managers/CameraManager";
import { SceneManager } from "./managers/SceneManager";
import { RenderManager } from "./managers/RenderManager";
import { DragAndDropManager } from "./managers/DragAndDropManager";
import { InteractionManager } from "./managers/InteractionManager";
import { HighlightManager } from "./managers/HighlightManager";
import { SchematicManager } from "./managers/SchematicManager";
import { WorldMeshBuilder } from "./WorldMeshBuilder";
import { EventEmitter } from "events";
import { DefaultPackCallback } from "./managers/ResourcePackManager";
import { ResourcePackManagerProxy } from "./managers/ResourcePackManagerProxy";
import { SidebarManager } from "./ui/sidebar/SidebarManager";
import { SlicerOverlay, type SlicerOverlayOptions } from "./ui/SlicerOverlay";
import { ResourcePackNotice } from "./ui/ResourcePackNotice";
import type { SidebarTabId } from "./ui/sidebar/types";
import { GizmoManager } from "./managers/GizmoManager";
import { SchematicRendererOptions } from "./SchematicRendererOptions";
import { UIManager } from "./managers/UIManager";
import { SimulationManager } from "./managers/SimulationManager";
import { BlockInteractionHandler } from "./managers/highlight/BlockInteractionHandler";
import { InsignManager } from "./managers/InsignManager";
import { InsignIoManager } from "./managers/InsignIoManager";
import { OverlayManager } from "./managers/OverlayManager";
import { Cubane } from "./cubane";
import { KeyboardControls } from "./managers/KeyboardControls";
import { InspectorManager } from "./managers/InspectorManager";
import { RegionManager } from "./managers/RegionManager";
import { RegionInteractionHandler } from "./managers/highlight/RegionInteractionHandler";
export declare class SchematicRenderer {
    private resourcePacksInitialized;
    canvas: HTMLCanvasElement;
    timer: THREE.Timer;
    options: SchematicRendererOptions;
    eventEmitter: EventEmitter;
    cameraManager: CameraManager;
    sceneManager: SceneManager;
    uiManager: UIManager | undefined;
    renderManager: RenderManager | undefined;
    interactionManager: InteractionManager | undefined;
    dragAndDropManager?: DragAndDropManager;
    highlightManager: HighlightManager | undefined;
    schematicManager: SchematicManager | undefined;
    worldMeshBuilder: WorldMeshBuilder | undefined;
    gizmoManager: GizmoManager | undefined;
    simulationManager: SimulationManager | undefined;
    blockInteractionHandler: BlockInteractionHandler | undefined;
    insignManager: InsignManager | undefined;
    insignIoManager: InsignIoManager | undefined;
    regionManager: RegionManager | undefined;
    regionInteractionHandler: RegionInteractionHandler | undefined;
    overlayManager: OverlayManager | undefined;
    keyboardControls: KeyboardControls | undefined;
    inspectorManager: InspectorManager | undefined;
    materialMap: Map<string, THREE.Material>;
    timings: Map<string, number>;
    fps: number;
    private resourcePackManager;
    private packUnsubscribers;
    packs: ResourcePackManagerProxy;
    /** Unified sidebar UI manager */
    sidebar: SidebarManager | undefined;
    slicerOverlay: SlicerOverlay | undefined;
    resourcePackNotice: ResourcePackNotice | undefined;
    cubane: Cubane;
    state: {
        cameraPosition: THREE.Vector3;
    };
    private static isNucleationInitialized;
    constructor(canvas: HTMLCanvasElement, schematicData?: {
        [key: string]: () => Promise<ArrayBuffer>;
    }, defaultResourcePacks?: Record<string, DefaultPackCallback>, options?: SchematicRendererOptions);
    updateCameraPosition(): void;
    /**
     * Sets whether auto-orbit is enabled
     * @param enabled True to enable auto-orbit, false to disable
     */
    setAutoOrbit(enabled: boolean): void;
    /**
     * Sets the duration of a full auto-orbit rotation
     * @param duration Duration in seconds
     */
    setAutoOrbitDuration(duration: number): void;
    /**
     * Toggles the auto-orbit feature
     * @returns The new state of auto-orbit (true = enabled, false = disabled)
     */
    toggleAutoOrbit(): boolean;
    /**
     * Enable or create the inspector GUI
     * Can be called at any time to show the debug panel
     */
    enableInspector(): InspectorManager;
    /**
     * Disable/hide the inspector GUI
     */
    disableInspector(): void;
    /**
     * Toggle the inspector GUI visibility
     * Creates the inspector if it doesn't exist
     */
    toggleInspector(): boolean;
    private initialize;
    private initializeInteractionComponents;
    /**
     * Set up callbacks for resource pack events
     */
    private setupResourcePackCallbacks;
    /** Refresh meshes after the owning asset pipeline has rebuilt its atlas. */
    refreshResourceAssets(): Promise<void>;
    /**
     * Rebuild all loaded schematics (e.g., after resource pack changes)
     */
    rebuildAllSchematics(): Promise<void>;
    /**
     * Show or hide the in-viewport "no resource pack loaded" notice based on how
     * many packs are currently loaded. Safe to call any time; a no-op when the
     * notice is disabled (`resourcePackOptions.showMissingPackNotice: false`) or
     * the user has dismissed it.
     */
    updateMissingPackNotice(): void;
    private initializeResourcePacks;
    private lastFrameTime;
    private lastInputAt;
    private targetFPS;
    private idleFPS;
    private readonly animatedPollFps;
    private lastSurfaceFrame;
    private enableAnimatedTextures;
    private particleFrustum;
    private particleProjection;
    private frameInterval;
    private loop;
    private isDisposed;
    private isSuspended;
    private frameCount;
    private lastDebugTime;
    private throttledFrames;
    private lastCameraPosition;
    private lastCameraQuaternion;
    private pointerEventBound;
    private wakeUpHandler;
    private pointerDownHandler;
    private pointerReleaseHandler;
    private needsRender;
    private continuousReasons;
    /**
     * Bind pointer events to canvas for immediate wake-up from idle mode
     */
    private bindPointerEvents;
    /**
     * Unbind pointer events
     */
    private unbindPointerEvents;
    /**
     * Mark the scene dirty so the next scheduled frame renders. If the render loop
     * has stopped (fully idle), this restarts it. Call after any change that should
     * be visible: camera/controls moves, schematic load/rebuild, resize, hover, etc.
     */
    invalidate(): void;
    /**
     * Pause the render loop without tearing anything down — the scene, GPU resources,
     * workers, and assets all stay in memory. Use this when the viewport scrolls
     * off-screen or during SPA navigation (e.g. `wire:navigate`) when the canvas is
     * kept alive (Livewire `@persist`, Turbo permanent). Cheap and instantly
     * reversible with `resume()`. To free resources entirely, use `dispose()`.
     */
    suspend(): void;
    /** Resume a suspended render loop and request a redraw. */
    resume(): void;
    /** Whether the render loop is currently paused (see `suspend`). */
    get suspended(): boolean;
    /**
     * Keep rendering continuously while `reason` is active. Used for things that
     * animate every frame (animated textures, auto-orbit, camera-path tweens, video
     * recording, redstone simulation). Call with `active=false` to release.
     */
    setContinuous(reason: string, active: boolean): void;
    private get continuous();
    private animate;
    /**
     * Gets the rendering bounds for a schematic
     * @param schematicId ID of the schematic
     * @param asArrays If true, returns min/max as arrays instead of Vector3s
     * @returns The rendering bounds or null if schematic not found
     */
    getRenderingBounds(schematicId: string, asArrays?: boolean): {
        min: THREE.Vector3 | number[];
        max: THREE.Vector3 | number[];
    } | null;
    /**
     * Sets the rendering bounds for a schematic and enables them
     * @param schematicId ID of the schematic
     * @param min Minimum coordinates (Vector3 or array [x,y,z])
     * @param max Maximum coordinates (Vector3 or array [x,y,z])
     * @param showHelper Whether to show a visual helper for the bounds
     */
    setRenderingBounds(schematicId: string, min: THREE.Vector3 | number[], max: THREE.Vector3 | number[], showHelper?: boolean): void;
    /**
     * Sets a specific axis of the rendering bounds
     * @param schematicId ID of the schematic
     * @param axis The axis to set ('x', 'y', or 'z')
     * @param minValue Minimum value for the axis
     * @param maxValue Maximum value for the axis
     */
    setRenderingBoundsAxis(schematicId: string, axis: "x" | "y" | "z", minValue: number, maxValue: number): void;
    /**
     * Resets the rendering bounds to include the full schematic or disables them
     * @param schematicId ID of the schematic
     * @param disable Whether to disable the rendering bounds (default: true)
     */
    resetRenderingBounds(schematicId: string, disable?: boolean): void;
    /**
     * Shows or hides the rendering bounds helper
     * @param schematicId ID of the schematic
     * @param visible Whether the helper should be visible
     */
    showRenderingBoundsHelper(schematicId: string, visible: boolean): void;
    /**
     * Gets the dimensions of a schematic
     * @param schematicId ID of the schematic
     * @returns The dimensions as an array [width, height, depth] or null if schematic not found
     */
    getSchematicDimensions(schematicId: string): Int32Array | number[] | null;
    /**
     * Gets all currently loaded schematics
     * @returns Array of schematic IDs
     */
    getLoadedSchematics(): string[];
    /**
     * Creates console-friendly settings for working with rendering bounds
     * Delegates to the SchematicObject's createBoundsControls method
     * @param schematicId ID of the schematic
     * @returns Functions for easy console usage
     */
    createBoundsControls(schematicId: string): any;
    /**
     * Show the floating slicer overlay (rendering-bounds controls).
     * Lazily constructs the overlay if it hasn't been created yet.
     */
    showSlicerOverlay(options?: SlicerOverlayOptions): SlicerOverlay;
    /** Hide the floating slicer overlay (no-op if it hasn't been created). */
    hideSlicerOverlay(): void;
    /** Toggle the floating slicer overlay, constructing it on first call. */
    toggleSlicerOverlay(): void;
    /**
     * Provides direct access to a schematic's bounds for easy manipulation
     * @param schematicId ID of the schematic
     * @returns The schematic's reactive bounds object or null if not found
     */
    getBounds(schematicId: string): any;
    getResourcePacks(): Promise<Array<{
        name: string;
        enabled: boolean;
        order: number;
    }>>;
    addResourcePack(file: File): Promise<void>;
    toggleResourcePackEnabled(name: string, enabled: boolean): Promise<void>;
    removeResourcePack(name: string): Promise<void>;
    /**
     * Shows the performance dashboard via the sidebar
     */
    showPerformanceDashboard(): void;
    /**
     * Hides the sidebar (hides performance dashboard if active)
     */
    hidePerformanceDashboard(): void;
    /**
     * Toggles the performance dashboard via the sidebar
     */
    togglePerformanceDashboard(): void;
    /**
     * Set SSAO preset for a specific camera mode
     * @param mode Camera mode ('perspective' or 'isometric')
     * @param params SSAO parameters
     */
    setSSAOPreset(mode: "perspective" | "isometric", params: {
        aoRadius?: number;
        distanceFalloff?: number;
        intensity?: number;
    }): void;
    /**
     * Get current SSAO presets
     */
    getSSAOPresets(): {
        perspective: {
            aoRadius: number;
            distanceFalloff: number;
            intensity: number;
        };
        isometric: {
            aoRadius: number;
            distanceFalloff: number;
            intensity: number;
        };
    } | null;
    /**
     * Set SSAO parameters for the current camera mode
     * @param params SSAO parameters
     */
    setSSAOParameters(params: {
        aoRadius?: number;
        distanceFalloff?: number;
        intensity?: number;
        qualityMode?: "Performance" | "Low" | "Medium" | "High" | "Ultra";
    }): void;
    /**
     * Set custom isometric viewing angles
     * @param pitchDegrees Vertical angle in degrees (0-90, default ~35.264 for true isometric)
     * @param yawDegrees Horizontal rotation in degrees (default 45)
     * @param refocus Whether to refocus on schematics after changing angles (default true)
     */
    setIsometricAngles(pitchDegrees: number, yawDegrees?: number, refocus?: boolean): void;
    /**
     * Reset isometric angles to true isometric view
     * @param refocus Whether to refocus on schematics (default true)
     */
    resetIsometricAngles(refocus?: boolean): void;
    /**
     * Get current isometric viewing angles
     * @returns Object with pitch and yaw in degrees, or null if not in isometric mode
     */
    getIsometricAngles(): {
        pitch: number;
        yaw: number;
    } | null;
    /**
     * Initializes simulation for the first schematic
     */
    initializeSimulation(): Promise<boolean>;
    /**
     * Manually ticks the simulation
     * @param numTicks Number of ticks to advance (default: 1)
     */
    tickSimulation(numTicks?: number): void;
    /**
     * Syncs simulation state back to schematic and rebuilds meshes
     */
    syncSimulation(): Promise<void>;
    /**
     * Starts auto-ticking the simulation
     */
    startAutoTick(): void;
    /**
     * Stops auto-ticking the simulation
     */
    stopAutoTick(): void;
    /**
     * Resets the simulation
     */
    resetSimulation(): Promise<boolean>;
    /**
     * Gets the current simulation state
     */
    getSimulationState(): import(".").SimulationState | undefined;
    /**
     * Rebuilds all chunks in all schematics
     */
    private rebuildAllChunks;
    /**
     * Take a screenshot of the current view
     * @param options Screenshot options (width, height, quality, format)
     * @returns Promise<Blob> The screenshot as a Blob
     */
    takeScreenshot(options?: {
        width?: number;
        height?: number;
        quality?: number;
        format?: "image/png" | "image/jpeg" | "image/webp";
        transparent?: boolean;
    }): Promise<Blob>;
    /**
     * Take a screenshot and automatically download it
     * @param filename Filename (without extension)
     * @param options Screenshot options
     */
    downloadScreenshot(filename?: string, options?: {
        width?: number;
        height?: number;
        quality?: number;
        format?: "image/png" | "image/jpeg";
    }): Promise<void>;
    /**
     * Start video recording along the camera path
     * @param duration Duration in seconds
     * @param options Recording options
     */
    startRecording(duration: number, options?: {
        width?: number;
        height?: number;
        frameRate?: number;
        quality?: number;
        onProgress?: (progress: number) => void;
        onComplete?: (blob: Blob) => void;
    }): Promise<void>;
    /**
     * Stop the current recording
     */
    stopRecording(): void;
    /**
     * Check if currently recording
     */
    isRecording(): boolean;
    /**
     * Set the background color (for non-HDRI backgrounds)
     * @param color Color as hex string (e.g., "#87ceeb") or number (e.g., 0x87ceeb)
     */
    setBackgroundColor(color: string | number): void;
    /**
     * Set camera mode (perspective, isometric, or first-person)
     * @param mode Camera mode
     */
    setCameraMode(mode: "perspective" | "isometric" | "perspective_fpv"): void;
    /**
     * Get current camera mode
     */
    getCameraMode(): string;
    /**
     * Enable or disable SSAO (ambient occlusion)
     * @param enabled Whether SSAO should be enabled
     */
    setSSAOEnabled(enabled: boolean): void;
    /**
     * Check if SSAO is enabled
     */
    isSSAOEnabled(): boolean;
    /**
     * Enable or disable the grid helper
     * @param visible Whether the grid should be visible
     */
    setGridVisible(visible: boolean): void;
    /**
     * Enable or disable the axes helper
     * @param visible Whether the axes should be visible
     */
    setAxesVisible(visible: boolean): void;
    /**
     * Show or hide the camera path visualization
     * @param visible Whether the path should be visible
     * @param pathName Name of the path (default: "circularPath")
     */
    setCameraPathVisible(visible: boolean, pathName?: string): void;
    /**
     * Fit the camera path to frame all loaded schematics
     * @param pathName Name of the path (default: "circularPath")
     */
    fitCameraPath(pathName?: string): void;
    /**
     * Animate the camera along a path (for previews or recordings)
     * @param options Animation options
     */
    animateCameraAlongPath(options?: {
        pathName?: string;
        totalFrames?: number;
        targetFps?: number;
        onUpdate?: (progress: number) => void;
        onComplete?: () => void;
    }): Promise<void>;
    /**
     * Show the sidebar with the specified tab (or current tab if none)
     */
    showSidebar(tab?: SidebarTabId): void;
    /**
     * Hide/collapse the sidebar
     */
    hideSidebar(): void;
    /**
     * Toggle the sidebar visibility
     */
    toggleSidebar(): void;
    /**
     * Switch to a specific sidebar tab
     */
    showSidebarTab(tab: SidebarTabId): void;
    /**
     * Enable keyboard shortcuts
     */
    enableKeyboardShortcuts(): void;
    /**
     * Disable keyboard shortcuts
     */
    disableKeyboardShortcuts(): void;
    /**
     * Get the current sidebar state
     */
    getSidebarState(): {
        visible: boolean;
        collapsed: boolean;
        activeTab: SidebarTabId | null;
    };
    dispose(): void;
}
//# sourceMappingURL=SchematicRenderer.d.ts.map