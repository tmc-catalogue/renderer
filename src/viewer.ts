// viewer.ts — slim, embeddable viewer API for external apps (e.g. an Astro site).
// Wraps SchematicRenderer with the project's best-practice defaults: gpu-pull
// (WebGPU compute mesher + WebGL2 vertex pulling) when available, batched CPU
// fallback otherwise; gunzip + boss-class JS-NBT handling for big files; status
// callbacks for UI; one-call URL loading.
//
//	const viewer = await createSchematicViewer(container, { vanillaPackUrl: "/pack.zip" });
//	await viewer.load("https://example.com/build.litematic");
//	viewer.dispose();
import * as THREE from "three";
import { SchematicRenderer } from "./SchematicRenderer";

export type ViewerMode = "auto" | "gpu" | "cpu";
export type ViewerControls = "orbit" | "shulkr" | "fps";

export interface SchematicViewerOptions {
	/** Build mode. "auto" (default): gpu-pull on WebGPU, batched CPU otherwise. */
	mode?: ViewerMode;
	/** Camera controls flavor (default "shulkr" — smooth orbit + WASD). */
	controls?: ViewerControls;
	/** Optional URL of a vanilla resource pack zip; without it blocks use placeholder textures. */
	vanillaPackUrl?: string;
	/** Scene background color (default 0x0f1117). */
	background?: string | number;
	onStatus?: (status: { phase: string; message?: string }) => void;
	onError?: (error: unknown) => void;
	/** Passthrough of renderer options (see SchematicRendererOptions). */
	rendererOptions?: Record<string, unknown>;
}

const hasWebGPU = (): boolean => typeof navigator !== "undefined" && "gpu" in navigator;

export class SchematicViewer {
	private renderer: SchematicRenderer | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private ro: ResizeObserver | null = null;
	private mode: string;
	private currentUrl: string | null = null;
	private loadGen = 0;
	private loadChain: Promise<void> = Promise.resolve();

	constructor(
		private container: HTMLElement,
		private options: SchematicViewerOptions = {}
	) {
		this.mode = this.resolveMode(options.mode);
	}

	private resolveMode(mode?: ViewerMode): string {
		if (mode === "gpu") return "gpu-pull";
		if (mode === "cpu") return "batched";
		return hasWebGPU() ? "gpu-pull" : "batched";
	}

	/** Create the canvas + renderer. Resolves when ready to load. */
	async init(): Promise<SchematicViewer> {
		if (this.renderer) return this;
		const canvas = document.createElement("canvas");
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		canvas.style.display = "block";
		this.container.appendChild(canvas);
		this.canvas = canvas;

		const defaultPacks: Record<string, () => Promise<Blob>> = {};
		const packUrl = this.options.vanillaPackUrl;
		if (packUrl) {
			defaultPacks.vanillaPack = async () => {
				// cache: "no-cache" — revalidate with the server's etag on every boot.
				// The default pack is hash-compared against the stored blob (see
				// ResourcePackManager), but that comparison is useless if fetch()
				// serves a stale pack.zip from the browser HTTP cache (max-age).
				const res = await fetch(packUrl, { cache: "no-cache" });
				if (!res.ok) throw new Error(`vanillaPack fetch failed: ${res.status}`);
				return await res.blob();
			};
		}

		const renderer: any = new SchematicRenderer(
			canvas,
			{},
			defaultPacks as any,
			{
				meshBuildingMode: this.mode as any,
				enableProgressBar: false,
				singleSchematicMode: true, // loadSchematic auto-removes the previous build
				enableDragAndDrop: false, // the page provides its own drop handler
				wasmMeshBuilderOptions: { enabled: true, greedyMeshingEnabled: false },
				...(this.options.rendererOptions || {}),
			} as any
		);
		this.renderer = renderer as any;
		// controls flavor (consumer-reported: this option was accepted but never
		// wired — enableShulkrControls had zero call sites, so every consumer got
		// plain orbit regardless of the option):
		//   "shulkr" (default) = smooth orbit + WASD via the ShulkrControls layer
		//   "orbit"             = plain orbit only
		//   "fps"               = fly controls with pointer-lock mouse look
		const flavor: ViewerControls = this.options.controls ?? "shulkr";
		try {
			const cm: any = renderer.cameraManager;
			if (flavor === "fps") {
				cm.switchControls("fly");
				cm.initializeFlyControls();
			} else {
				cm.switchControls("orbit");
				if (flavor === "shulkr") cm.enableShulkrControls();
				else cm.disableShulkrControls?.();
			}
		} catch {
			/* presets optional */
		}
		// damping config on the ACTIVE control; the app tick (CameraManager.update)
		// drives controls.update(dt) — NO extra RAF loops here (stacked
		// change-listener chains caused the motion lag)
		try {
			const cm2: any = renderer.cameraManager;
			const ocx = cm2.controls.get(cm2.activeControlKey);
			if (ocx && "enableDamping" in ocx) {
				ocx.enableDamping = true;
				(ocx as any).__baseDamping = 0.12;
				ocx.dampingFactor = 0.12;
				ocx.rotateSpeed = 0.7;
				(ocx as any).zoomToCursor = true;
				(ocx as any).panSpeed = 0.6;
			}
		} catch {
			/* damping optional */
		}
		if (this.options.background !== undefined) {
			renderer.sceneManager.scene.background = new THREE.Color(this.options.background as any);
		}
		this.ro = new ResizeObserver(() => {
			try {
				(this.renderer as any)?.renderManager?.onResize?.();
			} catch {
				/* optional */
			}
		});
		this.ro.observe(this.container);
		this.options.onStatus?.({ phase: "ready", message: `mode: ${this.mode}` });
		return this;
	}

	/** Fetch (and gunzip if needed) a schematic URL and build it.
	 * Loads are SERIALIZED and latest-wins: the page's default autoload can still be
	 * mid-flight when the user drag-drops — unserialized, the slower default finished
	 * last and silently replaced the dropped file. */
	async load(url: string, name?: string): Promise<void> {
		const gen = ++this.loadGen;
		const prev = this.loadChain;
		const run = (async () => {
			await prev.catch(() => {
				/* previous load's errors are already reported */
			});
			if (gen !== this.loadGen) return; // a newer load superseded this one
			await this.doLoad(url, name);
		})();
		this.loadChain = run;
		return run;
	}

	private async doLoad(url: string, name?: string): Promise<void> {
		if (!this.renderer) await this.init();
		this.currentUrl = url;
		const displayName =
			name || new URL(url, location.href).pathname.split("/").pop() || "schematic";
		try {
			this.options.onStatus?.({ phase: "fetching", message: displayName });
			const res = await fetch(url);
			if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
			let buffer = await res.arrayBuffer();
			this.options.onStatus?.({ phase: "building", message: `${this.mode}` });
			// the constructor's async initialize() may still be mid-flight regardless of
			// the onRendererInitialized callback timing — wait for the manager to exist
			const r = this.renderer as any;
			for (let i = 0; i < 120 && !(r && r.schematicManager); i++) {
				await new Promise((res) => setTimeout(res, 500));
			}
			if (!r || !r.schematicManager) {
				throw new Error("renderer initialization did not complete (schematicManager missing)");
			}
			// NOTE: do NOT removeAllSchematics here — loadSchematics replaces the
			// current schematic itself in singleSchematicMode; a second, racing remove
			// disposed the in-flight build and the next render came up black
			await r.schematicManager.loadSchematics({
				[displayName]: () => Promise.resolve(buffer),
			});
			// reframe on the replaced build (single mode swaps the schematic out; the
			// old framing leaves a tiny build as an invisible speck) + force a present
			try {
				(r as any).cameraManager?.focusOnSchematics({ animationDuration: 0 });
			} catch {
				/* framing optional */
			}
			try {
				(r as any).renderManager?.render();
			} catch {
				/* */
			}
			this.options.onStatus?.({ phase: "done", message: displayName });
		} catch (err) {
			this.options.onError?.(err);
			this.options.onStatus?.({ phase: "error", message: String(err) });
			throw err;
		}
	}

	/** Switch build mode (rebuilds the current schematic). */
	async setMode(mode: ViewerMode): Promise<void> {
		const next: string = this.resolveMode(mode);
		if (next === this.mode || !this.currentUrl) return;
		this.mode = next;
		if (this.renderer) {
			(this.renderer as any).options.meshBuildingMode = next;
			await (this.renderer as any).schematicManager.removeAllSchematics();
		}
		await this.load(this.currentUrl);
	}

	get activeMode(): string {
		return this.mode;
	}
	get raw(): SchematicRenderer | null {
		return this.renderer;
	}

	dispose(): void {
		this.ro?.disconnect();
		try {
			this.renderer?.dispose?.();
		} catch {
			/* best effort */
		}
		this.canvas?.parentElement?.removeChild(this.canvas);
		this.renderer = null;
		this.canvas = null;
	}
}

export function createSchematicViewer(
	container: HTMLElement,
	options?: SchematicViewerOptions
): SchematicViewer {
	return new SchematicViewer(container, options);
}
