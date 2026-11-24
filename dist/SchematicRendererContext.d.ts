import * as THREE from "three";
import { Cubane } from "./cubane/Cubane";
import { ResourcePackManager, DefaultPackCallback } from "./managers/ResourcePackManager";
export interface SchematicRendererContextOptions {
    /** Render unknown blocks as a purple placeholder (defaults to false). */
    showUnknownBlocks?: boolean;
    /** Passed through to the internal ResourcePackManager. */
    resourcePackOptions?: any;
    /**
     * Render every attached view through ONE shared WebGL context (render-and-blit)
     * instead of one context per renderer. Bypasses the browser's ~8–16 context
     * limit so you can show many viewports. Off by default.
     */
    sharedRenderer?: boolean;
}
/**
 * Shared resource pipeline for running multiple {@link SchematicRenderer}
 * instances on one page.
 *
 * A context owns a single {@link Cubane} (asset loader + texture atlas + models)
 * with resource packs already loaded. Pass it to several renderers via
 * `options.context` and they all mesh against the *same* atlas — the pack is
 * parsed and the atlas is built once instead of once per renderer.
 *
 * ```ts
 * const ctx = await SchematicRendererContext.create({
 *   vanillaPack: async () => fetchPackBlob(),
 * });
 * const before = new SchematicRenderer(beforeCanvas, {}, {}, { context: ctx });
 * const after  = new SchematicRenderer(afterCanvas,  {}, {}, { context: ctx });
 * ```
 *
 * When no context is supplied, a `SchematicRenderer` creates its own private
 * pipeline exactly as before (fully backward compatible).
 */
export declare class SchematicRendererContext {
    /** The shared asset pipeline (atlas, models, textures). */
    readonly cubane: Cubane;
    /** The pack manager used to load the shared packs. */
    readonly resourcePackManager: ResourcePackManager;
    private readonly renderers;
    private sharedWorkers;
    readonly sharedFreeWorkers: Worker[];
    readonly sharedWorkerQueue: ((worker: Worker) => void)[];
    /**
     * Get (or lazily create) the shared mesh-builder worker pool. WASM is compiled
     * once per worker here instead of once per renderer.
     */
    getSharedWorkers(maxWorkers: number, useWasm: boolean): Worker[];
    private readonly useSharedRenderer;
    private sharedGLRenderer;
    private constructor();
    /**
     * The shared WebGL renderer for render-and-blit, or null when not enabled.
     * Created lazily on an offscreen canvas; views render into it then blit the
     * result onto their own 2D canvas. `preserveDrawingBuffer` is required so the
     * drawn frame can be copied via drawImage.
     */
    getSharedGLRenderer(): THREE.WebGLRenderer | null;
    /**
     * Create a ready-to-use shared context: builds a Cubane, loads the given
     * resource packs, and builds the atlas once. Await this before constructing
     * the renderers that will share it.
     */
    static create(defaultResourcePacks?: Record<string, DefaultPackCallback>, options?: SchematicRendererContextOptions): Promise<SchematicRendererContext>;
    /** Register a renderer so pack changes can invalidate it. */
    attachRenderer(renderer: {
        invalidate(): void;
        refreshResourceAssets?(): Promise<void>;
    }): void;
    /** Unregister a renderer (call on the renderer's dispose). */
    detachRenderer(renderer: {
        invalidate(): void;
    }): void;
    /** Number of renderers currently sharing this context. */
    get rendererCount(): number;
    /** Mark every attached renderer dirty (e.g. after a shared pack/atlas change). */
    invalidateAll(): void;
    /**
     * Global registry of live contexts keyed by id. Stored on `globalThis` so it
     * survives SPA navigations (Livewire `wire:navigate`, Turbo, htmx boost) that keep
     * the JS VM alive — the heavy pipeline (atlas, WASM, worker pool, GL context) is
     * reused across page views instead of rebuilt on every navigation.
     */
    private static get registry();
    /**
     * Get a shared context by `key`, creating it once via `factory` and caching it on
     * the global registry. Subsequent calls with the same key — including after an SPA
     * navigation — return the existing context without rebuilding anything. Increments
     * a reference count; pair each `acquire` with a {@link release}.
     *
     * ```ts
     * const ctx = await SchematicRendererContext.acquire("viewer", () =>
     *   SchematicRendererContext.create(packs, { sharedRenderer: true })
     * );
     * ```
     */
    static acquire(key: string, factory: () => Promise<SchematicRendererContext>): Promise<SchematicRendererContext>;
    /** The live context for `key`, if one has finished building. */
    static peek(key: string): SchematicRendererContext | undefined;
    /**
     * Drop one reference taken via {@link acquire}. By default the context is kept warm
     * even at zero references — the whole point is to survive navigation — so the next
     * view reuses it instantly. Pass `{ dispose: true }` to tear it down and free its
     * resources once the last reference is released (e.g. when the user leaves the app).
     */
    static release(key: string, options?: {
        dispose?: boolean;
    }): void;
    /** Dispose the shared pipeline. Call once all renderers have detached. */
    dispose(): void;
}
//# sourceMappingURL=SchematicRendererContext.d.ts.map