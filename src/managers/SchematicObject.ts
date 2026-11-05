// managers/SchematicObject.ts
import * as THREE from "three";
import {
	SchematicWrapper,
	IoTypeWrapper,
	LayoutFunctionWrapper,
	ExecutionModeWrapper,
	BlockPosition,
	DefinitionRegionWrapper,
	CircuitBuilderWrapper,
	SortStrategyWrapper,
} from "../nucleationExports";
import { WorldMeshBuilder } from "../WorldMeshBuilder";
import { EventEmitter } from "events";
import { SceneManager } from "./SceneManager";
// Removed unused imports since we're no longer using reactive proxy
import { SchematicRenderer } from "../SchematicRenderer";
import type { MeshBuildingMode } from "../SchematicRendererOptions";
import type { BlockData } from "../types";
import { performanceMonitor } from "../performance/PerformanceMonitor";
import { SchematicExporter } from "../export/SchematicExporter";
import type { ExportOptions, ExportFormat, ExportResult } from "../types/export";
import {
	isSurfaceBlock,
	isGlass,
	surfaceFaces,
	makeGlassMaterial,
	buildGlassMeshes,
	type SurfaceFace,
} from "../meshing/ConnectedGlass";
import {
	SurfaceIndex,
	readSurfaceIndex,
	affectedSurfaceSections,
	surfaceCellVisible,
} from "../meshing/SurfaceIndex";
import { buildEndPortalMesh, makeEndPortalMaterial } from "../meshing/EndPortal";
import { fluidPaletteStates } from "../meshing/FluidStateLookup";

// Define chunk data interface to fix TypeScript errors

import { EditableRegionHighlight } from "./highlight/EditableRegionHighlight";

export class SchematicObject extends EventEmitter {
	// ... existing imports and properties ...
	public name: string;
	public schematicWrapper: SchematicWrapper;
	private schematicRenderer: SchematicRenderer;
	private meshes: THREE.Mesh[] = [];
	private bubbleMesh: THREE.Mesh | null = null;

	public get hasAnimatedParticles(): boolean {
		return this.visible && !!this.bubbleMesh?.visible && this.bubbleMesh.parent === this.group;
	}

	private surfaceIndex = new SurfaceIndex();
	private surfaceTemplates = new Map<string, SurfaceFace[]>();
	private surfaceMaterials = new Map<string, THREE.Material>();
	private endPortalMaterial?: THREE.ShaderMaterial;
	private surfaceClip = { value: new THREE.Vector2(0, 1e9) };
	private animatedSurfaces: THREE.Mesh[] = [];
	private surfaceViewBox = new THREE.Box3();
	private editQueue: Promise<void> = Promise.resolve();

	public get hasAnimatedSurfaces(): boolean {
		return (
			this.visible &&
			this.group.visible &&
			this.animatedSurfaces.some((mesh) => mesh.visible && mesh.parent === this.group)
		);
	}

	public hasSurfacesInView(frustum: THREE.Frustum): boolean {
		if (!this.hasAnimatedSurfaces) return false;
		this.group.updateWorldMatrix(true, false);
		for (const mesh of this.animatedSurfaces) {
			if (!mesh.visible || mesh.parent !== this.group) continue;
			const material = mesh.material as THREE.ShaderMaterial;
			if (material.opacity <= 0) continue;
			const clip = material.uniforms.uLayerClip.value as THREE.Vector2;
			if (clip.x > 0.5 && mesh.userData.minCellY > clip.y) continue;
			mesh.updateWorldMatrix(false, false);
			this.surfaceViewBox.copy(mesh.geometry.boundingBox!);
			if (clip.x > 0.5)
				this.surfaceViewBox.max.y = Math.min(this.surfaceViewBox.max.y, Math.floor(clip.y) + 0.25);
			this.surfaceViewBox.applyMatrix4(mesh.matrixWorld);
			if (frustum.intersectsBox(this.surfaceViewBox)) return true;
		}
		return false;
	}

	public hasParticlesInView(frustum: THREE.Frustum): boolean {
		return this.hasAnimatedParticles && frustum.intersectsObject(this.bubbleMesh!);
	}

	private worldMeshBuilder: WorldMeshBuilder;
	private eventEmitter: EventEmitter;
	private sceneManager: SceneManager;
	private chunkMeshes: Map<string, THREE.Object3D[]> = new Map();
	private chunkDimensions: any = {
		chunkWidth: 16,
		chunkHeight: 16,
		chunkLength: 16,
	};

	public id: string;
	public group: THREE.Group;

	// Public properties without underscores
	public position: THREE.Vector3;
	public rotation: THREE.Euler;
	public scale: THREE.Vector3;
	public opacity: number;
	public visible: boolean;

	public meshBoundingBox: [number[], number[]];
	public renderingBounds: {
		min: THREE.Vector3;
		max: THREE.Vector3;
		helper?: THREE.Box3Helper;
		enabled?: boolean;
	};

	// Reactive bounds for direct manipulation
	public bounds: {
		minX: number;
		minY: number;
		minZ: number;
		maxX: number;
		maxY: number;
		maxZ: number;
	};

	private meshesReady: Promise<void>;

	// Cache for dimensions to avoid repeated calls
	private _cachedDimensions: [number, number, number] | null = null;
	private blockEntitiesMap: Map<string, any> | null = null;

	constructor(
		schematicRenderer: SchematicRenderer,
		name: string,
		schematicWrapper: SchematicWrapper,
		properties?: Partial<{
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
		}>
	) {
		super();

		this.id = name;
		this.name = name;
		this.schematicWrapper = schematicWrapper;

		this.schematicRenderer = schematicRenderer;
		if (!this.schematicRenderer) {
			throw new Error("SchematicRenderer is required.");
		}
		if (!this.schematicRenderer.worldMeshBuilder) {
			throw new Error("WorldMeshBuilder is required.");
		}
		this.worldMeshBuilder = schematicRenderer.worldMeshBuilder as WorldMeshBuilder;
		this.eventEmitter = schematicRenderer.eventEmitter;
		this.sceneManager = schematicRenderer.sceneManager;

		// Initialize properties with default values
		this.position = new THREE.Vector3();
		this.rotation = new THREE.Euler();
		this.scale = new THREE.Vector3(1, 1, 1);
		this.opacity = 1.0;
		this.visible = properties?.visible ?? true;

		// Set initial properties if provided, avoiding Three.js object conflicts
		if (properties) {
			// Handle Three.js objects carefully
			if (properties.position) {
				if (Array.isArray(properties.position)) {
					this.position.set(properties.position[0], properties.position[1], properties.position[2]);
				} else {
					this.position.copy(properties.position);
				}
			}
			if (properties.rotation) {
				if (Array.isArray(properties.rotation)) {
					this.rotation.set(properties.rotation[0], properties.rotation[1], properties.rotation[2]);
				} else {
					this.rotation.copy(properties.rotation);
				}
			}
			if (properties.scale) {
				if (Array.isArray(properties.scale)) {
					this.scale.set(properties.scale[0], properties.scale[1], properties.scale[2]);
				} else if (typeof properties.scale === "number") {
					this.scale.setScalar(properties.scale);
				} else {
					this.scale.copy(properties.scale);
				}
			}
			if (properties.opacity !== undefined) {
				this.opacity = properties.opacity;
			}
			if (properties.visible !== undefined) {
				this.visible = properties.visible;
			}
		}
		if (this.schematicRenderer.options.chunkSideLength) {
			this.chunkDimensions = {
				chunkWidth: this.schematicRenderer.options.chunkSideLength,
				chunkHeight: this.schematicRenderer.options.chunkSideLength,
				chunkLength: this.schematicRenderer.options.chunkSideLength,
			};
		}

		const schematicDimensions = this.getDimensions();
		const tightDimensions = this.getTightDimensions();

		// Use tight bounds for centering if available, otherwise fall back to allocated dimensions
		const centeringDimensions =
			tightDimensions[0] > 0 && tightDimensions[1] > 0 && tightDimensions[2] > 0
				? tightDimensions
				: schematicDimensions;
		this.position = new THREE.Vector3(
			-centeringDimensions[0] / 2 + 0.5, // Center the schematic
			0.5,
			-centeringDimensions[2] / 2 + 0.5 // Center the schematic
		);

		if (properties?.meshBoundingBox) {
			this.meshBoundingBox = properties.meshBoundingBox;
		} else {
			this.meshBoundingBox = [
				this.position.toArray(),
				this.position
					.clone()
					.add(
						new THREE.Vector3(
							schematicDimensions[0],
							schematicDimensions[1],
							schematicDimensions[2]
						)
					)
					.toArray(),
			];
		}

		// Initialize rendering bounds to the full schematic dimensions
		// But they are disabled by default (they won't be used for culling unless explicitly enabled)
		this.renderingBounds = {
			min: new THREE.Vector3(0, 0, 0),
			max: new THREE.Vector3(
				schematicDimensions[0],
				schematicDimensions[1],
				schematicDimensions[2]
			),
			enabled: false, // Disabled by default
		};

		// Apply custom rendering bounds if provided
		if (properties?.renderingBounds) {
			if (Array.isArray(properties.renderingBounds.min)) {
				this.renderingBounds.min = new THREE.Vector3(
					properties.renderingBounds.min[0],
					properties.renderingBounds.min[1],
					properties.renderingBounds.min[2]
				);
			} else if (properties.renderingBounds.min instanceof THREE.Vector3) {
				this.renderingBounds.min = properties.renderingBounds.min.clone();
			}

			if (Array.isArray(properties.renderingBounds.max)) {
				this.renderingBounds.max = new THREE.Vector3(
					properties.renderingBounds.max[0],
					properties.renderingBounds.max[1],
					properties.renderingBounds.max[2]
				);
			} else if (properties.renderingBounds.max instanceof THREE.Vector3) {
				this.renderingBounds.max = properties.renderingBounds.max.clone();
			}
		}

		// Initialize the reactive bounds property with safe implementation
		const self = this;
		this.bounds = {
			get minX() {
				return self.renderingBounds.min.x;
			},
			set minX(value: number) {
				self.renderingBounds.min.x = value;
				self.updateRenderingBounds();
			},
			get maxX() {
				return self.renderingBounds.max.x;
			},
			set maxX(value: number) {
				self.renderingBounds.max.x = value;
				self.updateRenderingBounds();
			},
			get minY() {
				return self.renderingBounds.min.y;
			},
			set minY(value: number) {
				self.renderingBounds.min.y = value;
				self.updateRenderingBounds();
			},
			get maxY() {
				return self.renderingBounds.max.y;
			},
			set maxY(value: number) {
				self.renderingBounds.max.y = value;
				self.updateRenderingBounds();
			},
			get minZ() {
				return self.renderingBounds.min.z;
			},
			set minZ(value: number) {
				self.renderingBounds.min.z = value;
				self.updateRenderingBounds();
			},
			get maxZ() {
				return self.renderingBounds.max.z;
			},
			set maxZ(value: number) {
				self.renderingBounds.max.z = value;
				self.updateRenderingBounds();
			},
			get enabled() {
				return self.renderingBounds.enabled || false;
			},
			set enabled(value: boolean) {
				self.renderingBounds.enabled = value;
				self.updateRenderingBounds();
				self.showRenderingBoundsHelper(value);
			},
			// Reset to full dimensions
			reset() {
				const dimensions = self.getDimensions();
				self.setRenderingBounds(
					new THREE.Vector3(0, 0, 0),
					new THREE.Vector3(dimensions[0], dimensions[1], dimensions[2])
				);
				return "Reset to full dimensions";
			},
			// Toggle helper visibility
			showHelper(visible = true) {
				self.showRenderingBoundsHelper(visible);
				return `Helper ${visible ? "shown" : "hidden"}`;
			},
			// Apply bounds changes (triggers rebuild)
			apply() {
				self.rebuildMesh();
				return "Bounds applied and mesh rebuilt";
			},
		} as any;

		this.group = new THREE.Group();
		this.group.name = name;

		// Build meshes and other initialization
		this.updateTransform();
		this.sceneManager.add(this.group);
		this.group.visible = this.visible;

		if (this.visible) {
			this.meshesReady = this.buildMeshes();
		} else {
			this.meshesReady = Promise.resolve();
		}

		// Instead of proxying the entire object, set up manual property watchers
		// This avoids interfering with Three.js internal matrix properties
		this.setupPropertyWatchers();
	}

	/**
	 * Set up manual property watchers instead of using reactive proxy
	 * This avoids interference with Three.js internal matrix properties
	 */
	// Timer is assigned in setupPropertyWatchers and used internally
	// @ts-expect-error Timer is assigned and used internally for change detection
	private _propertyWatcherTimer: ReturnType<typeof setTimeout> | null = null;

	private setupPropertyWatchers(): void {
		// Store original values for comparison
		let lastPosition = this.position.clone();
		let lastRotation = this.rotation.clone();
		let lastScale = this.scale.clone();
		let lastOpacity = this.opacity;
		let lastVisible = this.visible;

		// Set up property change detection
		const checkForChanges = () => {
			// Check position
			if (!this.position.equals(lastPosition)) {
				lastPosition = this.position.clone();
				this.updateTransform();
				this.emitPropertyChanged("position", this.position);
			}

			// Check rotation
			if (!this.rotation.equals(lastRotation)) {
				lastRotation = this.rotation.clone();
				this.updateTransform();
				this.emitPropertyChanged("rotation", this.rotation);
			}

			// Check scale
			if (!this.scale.equals(lastScale)) {
				lastScale = this.scale.clone();
				this.updateTransform();
				this.emitPropertyChanged("scale", this.scale);
			}

			// Check opacity
			if (this.opacity !== lastOpacity) {
				lastOpacity = this.opacity;
				this.updateMeshMaterials("opacity");
				this.emitPropertyChanged("opacity", this.opacity);
			}

			// Check visibility
			if (this.visible !== lastVisible) {
				lastVisible = this.visible;
				this.updateMeshVisibility();
				this.emitPropertyChanged("visible", this.visible);
			}

			// Continue checking periodically - use longer interval (250ms) to reduce overhead
			this._propertyWatcherTimer = setTimeout(checkForChanges, 250);
		};

		// Start the change detection loop
		this._propertyWatcherTimer = setTimeout(checkForChanges, 250);
	}

	/**
	 * Get schematic dimensions (allocated space).
	 * Returns [width, height, length] tuple.
	 */
	public getDimensions(): [number, number, number] {
		if (!this._cachedDimensions) {
			const dimensions = this.schematicWrapper.get_dimensions();
			this._cachedDimensions = [dimensions[0], dimensions[1], dimensions[2]];
		}
		return this._cachedDimensions;
	}

	/**
	 * Get tight dimensions (actual block content, not pre-allocated space)
	 * Returns [width, height, length] or [0, 0, 0] if no blocks exist
	 */
	public getTightDimensions(): [number, number, number] {
		const dimensions = this.schematicWrapper.get_tight_dimensions();
		return [dimensions[0], dimensions[1], dimensions[2]];
	}

	/**
	 * Get tight bounding box min coordinates [x, y, z]
	 * Returns null if no non-air blocks have been placed
	 */
	public getTightBoundsMin(): [number, number, number] | null {
		const min = this.schematicWrapper.get_tight_bounds_min();
		if (!min) return null;
		return [min[0], min[1], min[2]];
	}

	/**
	 * Get tight bounding box max coordinates [x, y, z]
	 * Returns null if no non-air blocks have been placed
	 */
	public getTightBoundsMax(): [number, number, number] | null {
		const max = this.schematicWrapper.get_tight_bounds_max();
		if (!max) return null;
		return [max[0], max[1], max[2]];
	}

	/**
	 * Display detailed performance monitoring results
	 */
	private displayPerformanceResults(sessionData: any): void {
		if (!sessionData) {
			console.warn("displayPerformanceResults called with no data!");
			return;
		}

		// Debug log to check data presence

		// Aggregate metrics from chunk processing data
		let blockCount = 0;
		let meshCount = 0;
		if (sessionData.chunkProcessingData) {
			sessionData.chunkProcessingData.forEach((d: any) => {
				blockCount += d.blockCount || 0;
				meshCount += d.meshCount || 0;
			});
		}

		if (sessionData.breakdown && sessionData.breakdown.length > 0) {
			console.warn("Detailed Breakdown:");
			sessionData.breakdown.forEach((op: any) => {
				console.warn(
					`  - ${op.operationId}: ${op.duration !== undefined ? op.duration.toFixed(2) : "0.00"}ms`
				);
			});
		} else {
			console.warn("No breakdown data available.");
			if (sessionData.timingData) {
				console.log("Raw timing data:", JSON.stringify(sessionData.timingData));
			}
		}
	}

	private emitPropertyChanged(property: string, value: any) {
		this.eventEmitter.emit("schematicPropertyChanged", {
			schematic: this,
			property,
			value,
		});
	}

	private updateTransform(): void {
		this.group.position.copy(this.position);
		this.group.rotation.copy(this.rotation);
		this.group.scale.copy(this.scale);
	}

	public syncTransformFromGroup() {
		this.position.copy(this.group.position);
		this.rotation.copy(this.group.rotation);
		this.scale.copy(this.group.scale);

		// Emit event
		this.emitPropertyChanged("transform", {
			position: this.position,
			rotation: this.rotation,
			scale: this.scale,
		});
	}

	private applyPropertiesToObjects(objects: THREE.Object3D[]) {
		// Determine if the SCHEMATIC ITSELF needs to be faded
		const schematicWantsFade = this.opacity < 1.0;

		objects.forEach((obj) => {
			const surface = !!obj.userData.surfaceMesh;
			// Surface sections may be rebuilt while hidden; group visibility owns hiding.
			obj.visible = surface || this.visible;

			if (this.visible || surface) {
				obj.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						child.castShadow = true;
						child.receiveShadow = true;
						child.frustumCulled = true;

						const materials = Array.isArray(child.material) ? child.material : [child.material];

						materials.forEach((mat) => {
							if (mat) {
								// If the schematic is being faded, apply its opacity.
								// Otherwise, let the material keep its original opacity.
								if (surface) {
									mat.opacity = this.opacity;
									const transparent = schematicWantsFade || !!mat.userData.surfaceTransparent;
									if (mat.transparent !== transparent) {
										mat.transparent = transparent;
										mat.needsUpdate = true;
									}
								} else if (schematicWantsFade) {
									mat.opacity = this.opacity;
								}
								if (mat instanceof THREE.ShaderMaterial && mat.userData.fluidAlpha !== undefined) {
									mat.uniforms.uAlpha.value = mat.userData.fluidAlpha * this.opacity;
								}

								// CRITICAL FIX: Only set transparent = true if the schematic
								// is being faded. NEVER set it to false, because that would
								// override materials that are inherently transparent (like glass).
								if (schematicWantsFade) {
									mat.transparent = true;
								}
							}
						});
					}
				});
			}
		});
	}

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
	public async export(options: ExportOptions = {}): Promise<ExportResult> {
		// Wait for meshes to be ready
		await this.meshesReady;

		const exporter = new SchematicExporter();

		// Set up progress callback to use UI manager if available
		const originalProgress = options.onProgress;
		if (this.schematicRenderer.options.enableProgressBar && this.schematicRenderer.uiManager) {
			this.schematicRenderer.uiManager.showProgressBar(`Exporting ${this.name}`);

			exporter.on("exportProgress", (progress) => {
				this.schematicRenderer.uiManager?.updateProgress(progress.progress, progress.message);
				originalProgress?.(progress);
			});

			exporter.on("exportComplete", () => {
				setTimeout(() => {
					this.schematicRenderer.uiManager?.hideProgressBar();
				}, 1000);
			});

			exporter.on("exportError", () => {
				this.schematicRenderer.uiManager?.hideProgressBar();
			});
		}

		// Merge default options
		const exportOptions: ExportOptions = {
			filename: options.filename || `${this.name}_schematic`,
			format: options.format || "glb",
			quality: options.quality || "high",
			normalMode: options.normalMode || "double-sided", // Default to double-sided for max compatibility
			...options,
		};

		try {
			const result = await exporter.export(this.group, exportOptions);

			// Auto-download if no onComplete callback is provided
			if (!options.onComplete) {
				exporter.download(result);
				// Clean up URL after a delay
				setTimeout(() => exporter.revokeUrl(result), 5000);
			}

			console.log(`Successfully exported schematic "${this.name}" as ${result.filename}`);
			return result;
		} catch (error) {
			console.error("Error exporting schematic:", error);
			throw error;
		}
	}

	/**
	 * Export as GLB (binary GLTF) - recommended for most use cases
	 * @param filename Optional filename (without extension)
	 */
	public async exportAsGLB(filename?: string): Promise<ExportResult> {
		return this.export({
			format: "glb",
			filename: filename || this.name,
		});
	}

	/**
	 * Exports the schematic as a GLTF file
	 * @deprecated Use export() or exportAsGLB() instead for better normal handling
	 * @param options Export options
	 * @returns Promise that resolves when export is complete
	 */
	public async exportAsGLTF(
		options: {
			filename?: string;
			binary?: boolean;
			includeCustomExtensions?: boolean;
			maxTextureSize?: number;
			embedImages?: boolean;
			animations?: THREE.AnimationClip[];
		} = {}
	): Promise<void> {
		// Map old API to new export system
		const format: ExportFormat = options.binary ? "glb" : "gltf";

		await this.export({
			filename: options.filename || `${this.name}_schematic`,
			format,
			includeCustomExtensions: options.includeCustomExtensions,
			maxTextureSize: options.maxTextureSize,
			embedTextures: options.embedImages,
			animations: options.animations,
		});
	}

	private async buildMeshes(): Promise<void> {
		if (!this.visible) {
			return;
		}

		const { meshes, chunkMap } = await this.buildSchematicMeshes(this, this.chunkDimensions);
		this.chunkMeshes = chunkMap;

		// Sign block entities are rendered in a mode-independent pass (the batched/
		// instanced build paths don't process block entities, and signs need both their
		// per-instance NBT text and blockstate facing/rotation).
		try {
			const signMeshes = await this.worldMeshBuilder.buildSignMeshes(this);
			meshes.push(...(signMeshes as THREE.Mesh[]));
		} catch (e) {
			console.warn("[SchematicObject] sign build failed", e);
		}

		// Apply properties to all objects
		this.applyPropertiesToObjects(meshes);

		// Add to group. GPU record meshes stage in time-boxed batches: each batch renders
		// once before the next adds, spreading the record-texture GPU uploads (the boss's
		// 2.4GB otherwise lands as one multi-second lump) and presenting progressively.
		const gpuMeshes = meshes.filter((m) => (m as any).userData?.gpuBuilt);
		const rest = meshes.filter((m) => !(m as any).userData?.gpuBuilt);
		rest.forEach((obj) => this.group.add(obj));
		if (gpuMeshes.length > 6) {
			let i = 0;
			const step = () => {
				const t0 = performance.now();
				while (i < gpuMeshes.length && performance.now() - t0 < 8) this.group.add(gpuMeshes[i++]);
				try {
					this.schematicRenderer.renderManager?.render();
				} catch {
					/* rendering is best-effort during staging */
				}
				if (i < gpuMeshes.length) setTimeout(step, 0);
			};
			step();
		} else {
			gpuMeshes.forEach((obj) => this.group.add(obj));
		}

		this.updateTransform(); // This will apply position, rotation, and scale to the group
		this.group.visible = this.visible;
		this.meshes = meshes as THREE.Mesh[]; // Keep for backward compatibility
		this.animatedSurfaces = this.meshes.filter((mesh) => mesh.userData.animatedSurface);

		this.group.updateMatrixWorld(true);
		this.group.updateWorldMatrix(true, true);

		// Create initial visualizer for rendering bounds
		if (this.sceneManager.schematicRenderer.options.showRenderingBoundsHelper) {
			this.createRenderingBoundsHelper();
		}

		this.sceneManager.schematicRenderer.options.callbacks?.onSchematicRendered?.(this.name);
	}

	// Track chunk building progress
	private reportBuildProgress(
		message: string,
		progress: number,
		totalChunks?: number,
		completedChunks?: number
	) {
		// Only show progress if enabled and UI manager exists
		if (this.schematicRenderer.options.enableProgressBar && this.schematicRenderer.uiManager) {
			// Format detailed progress message if chunks are provided
			let progressMessage = message;
			if (totalChunks !== undefined && completedChunks !== undefined) {
				progressMessage = `${message} (${completedChunks}/${totalChunks} chunks)`;
			}

			// Show progress bar if not already visible
			if (!this.schematicRenderer.uiManager.isProgressBarVisible()) {
				this.schematicRenderer.uiManager.showProgressBar("Building Schematic");
			}

			// Update progress
			this.schematicRenderer.uiManager.updateProgress(progress, progressMessage);

			// Hide when complete
			if (progress >= 1) {
				this.schematicRenderer.uiManager.hideProgressBar();
			}
		}
	}

	public async buildSchematicMeshes(
		schematicObject: SchematicObject,
		chunkDimensions: any = {
			chunkWidth: 16,
			chunkHeight: 16,
			chunkLength: 16,
		},
		buildMode: MeshBuildingMode = this.schematicRenderer.options.meshBuildingMode || "incremental"
	) {
		// Start performance monitoring session
		const sessionId = performanceMonitor.startSession(this.id, buildMode);
		if (this.schematicRenderer.renderManager?.renderer) {
			performanceMonitor.setRenderer(this.schematicRenderer.renderManager.renderer);
		}

		performanceMonitor.startOperation(`schematic-build-${buildMode}`, {
			schematicId: this.id,
			schematicName: this.name,
			buildMode: buildMode,
			chunkDimensions: chunkDimensions,
		});
		performanceMonitor.takeMemorySnapshot(`schematic-build-${buildMode}-start`);

		// Track initial memory state
		const initialMemory = (performance as any).memory
			? (performance as any).memory.usedJSHeapSize
			: 0;

		try {
			let result;
			switch (buildMode) {
				case "immediate":
					result = await this.buildSchematicMeshesImmediate(schematicObject, chunkDimensions);
					break;
				case "incremental":
					result = await this.buildSchematicMeshesIncremental(schematicObject, chunkDimensions);
					break;
				case "instanced":
					result = await this.buildSchematicMeshesInstanced(schematicObject);
					break;
				case "batched":
					// New high-performance batch mode - merges all chunks into a few meshes
					result = await this.buildSchematicMeshesBatched(schematicObject, chunkDimensions);
					break;
				case "gpu":
				case "gpu-pull":
					// WebGPU compute mesher (oracle-validated); falls back to batched on any failure.
					// gpu-pull renders directly from the 8B/tri record stream (no vertex readback).
					try {
						if (await this.getGpuMeshBuilder()) {
							result =
								buildMode === "gpu-pull"
									? await this.buildSchematicMeshesGpuPull(schematicObject)
									: await this.buildSchematicMeshesGpu(schematicObject);
							break;
						}
						console.warn("[BuildMode] WebGPU unavailable — falling back to batched");
					} catch (gpuErr) {
						console.warn("[BuildMode] GPU path failed, falling back to batched:", gpuErr);
					}
					result = await this.buildSchematicMeshesBatched(schematicObject, chunkDimensions);
					break;
				default:
					throw new Error(
						`Invalid build mode: ${buildMode}. Use 'immediate', 'incremental', 'instanced', or 'batched'.`
					);
			}

			try {
				result.meshes.push(...(await this.buildTransparentSurfaces(schematicObject)));
			} catch (error) {
				// Keep the main mesh usable and discard incomplete caches before a retry.
				this.disposeSurfaceResources();
				console.warn("[SchematicObject] transparent surface build failed", error);
			}

			// Track final memory state and record detailed metrics
			const finalMemory = (performance as any).memory
				? (performance as any).memory.usedJSHeapSize
				: 0;
			const memoryDelta = finalMemory - initialMemory;
			// Record detailed chunk processing data
			performanceMonitor.recordChunkProcessing({
				chunkId: `${this.id}-complete`,
				chunkCoords: [0, 0, 0],
				processingTime:
					performance.now() - (performanceMonitor as any).getCurrentOperationStartTime?.() || 0,
				blockCount: result.meshes.length,
				meshCount: result.meshes.length,
				memoryUsed: memoryDelta,
				totalVertices: result.meshes.length * 100, // Estimate
				totalIndices: result.meshes.length * 150, // Estimate
				materialGroups: result.meshes.length,
				blockTypes: ["schematic-complete"], // Summary
				renderingPhases: [],
				blockTypeTimings: new Map(),
				geometryStats: {
					facesCulled: 0,
					facesGenerated: result.meshes.length,
					cullingEfficiency: 0,
					averageVerticesPerBlock: 100,
					textureAtlasUsage: [],
				},
				memoryBreakdown: {
					vertexBuffers: memoryDelta * 0.4,
					indexBuffers: memoryDelta * 0.3,
					materials: memoryDelta * 0.1,
					textures: memoryDelta * 0.1,
					other: memoryDelta * 0.1,
				},
			});

			performanceMonitor.takeMemorySnapshot(`schematic-build-${buildMode}-end`);

			// Ensure main operation is closed BEFORE ending session
			performanceMonitor.endOperation(`schematic-build-${buildMode}`);

			// End performance monitoring session and display results
			const sessionData = performanceMonitor.endSession(sessionId);
			if (sessionData) {
				// Gate the console breakdown behind an explicit debug flag — rebuilds
				// fire frequently (e.g. slicer scrubbing) and the table is noisy.
				if (this.schematicRenderer.options.debugOptions?.logBuildPerformance) {
					this.displayPerformanceResults(sessionData);
				}

				// Dispatch event for UI components to react
				if (typeof window !== "undefined") {
					window.dispatchEvent(
						new CustomEvent("schematicRenderComplete", {
							detail: sessionData,
						})
					);
				}
			}

			return result;
		} catch (error) {
			performanceMonitor.endOperation(`schematic-build-${buildMode}`); // Ensure closed on error too
			throw error;
		}
	}

	// TRUE lazy loading - minimal memory footprint

	public async buildSchematicMeshesImmediate(
		schematicObject: SchematicObject,
		chunkDimensions: any = {
			chunkWidth: 16,
			chunkHeight: 16,
			chunkLength: 16,
		}
	): Promise<{
		meshes: THREE.Object3D[];
		chunkMap: Map<string, THREE.Object3D[]>;
	}> {
		const overallStartTime = performance.now();
		const schematic = schematicObject.schematicWrapper;

		// STEP 1: Initialize pipeline
		this.reportBuildProgress("Initializing pipeline...", 0.05);

		const palettes = this.getPalettes(schematic);
		performanceMonitor.startOperation("Palette Precomputation");
		await this.worldMeshBuilder.precomputePaletteGeometries(palettes.default);
		performanceMonitor.endOperation("Palette Precomputation");

		this.reportBuildProgress("Creating chunk iterator...", 0.1);

		performanceMonitor.startOperation("Chunk Iterator Creation");
		const iterator = schematic.create_lazy_chunk_iterator(
			chunkDimensions.chunkWidth,
			chunkDimensions.chunkHeight,
			chunkDimensions.chunkLength,
			"bottom_up",
			0,
			0,
			0
		);
		performanceMonitor.endOperation("Chunk Iterator Creation");

		const totalChunks = iterator.total_chunks();

		if (totalChunks === 0) {
			this.reportBuildProgress("Schematic build complete (no chunks)", 1.0, 0, 0);
			return { meshes: [], chunkMap: new Map() };
		}

		const chunkMap: Map<string, THREE.Object3D[]> = new Map();
		const renderingBounds = schematicObject.renderingBounds?.enabled
			? schematicObject.renderingBounds
			: undefined;

		let processedChunkCount = 0;
		let totalMeshCount = 0;
		const progressUpdateInterval = Math.max(1, Math.floor(totalChunks / 20));

		this.reportBuildProgress("Processing chunks with minimal memory...", 0.15, totalChunks, 0);

		performanceMonitor.startOperation("Process All Chunks");

		// Parallel Processing Logic
		const CONCURRENCY_LIMIT = navigator.hardwareConcurrency || 4;
		const activePromises: Promise<void>[] = [];

		// Helper to dispatch a chunk task
		const processChunk = async (chunkData: any) => {
			const { chunk_x, chunk_y, chunk_z, blocks } = chunkData;

			// Bounds culling
			if (renderingBounds?.enabled) {
				const chunkMinX = chunk_x * chunkDimensions.chunkWidth;
				const chunkMinY = chunk_y * chunkDimensions.chunkHeight;
				const chunkMinZ = chunk_z * chunkDimensions.chunkLength;
				const chunkMaxX = chunkMinX + chunkDimensions.chunkWidth;
				const chunkMaxY = chunkMinY + chunkDimensions.chunkHeight;
				const chunkMaxZ = chunkMinZ + chunkDimensions.chunkLength;

				if (
					chunkMaxX < renderingBounds.min.x ||
					chunkMinX > renderingBounds.max.x ||
					chunkMaxY < renderingBounds.min.y ||
					chunkMinY > renderingBounds.max.y ||
					chunkMaxZ < renderingBounds.min.z ||
					chunkMinZ > renderingBounds.max.z
				) {
					processedChunkCount++;
					if (processedChunkCount % progressUpdateInterval === 0) {
						this.reportBuildProgress(
							"Processing chunks (bounds culled)...",
							0.15 + (processedChunkCount / totalChunks) * 0.8,
							totalChunks,
							processedChunkCount
						);
					}
					return;
				}
			}

			// Process chunk
			const chunkMeshes = await this.worldMeshBuilder.getChunkMesh(
				{
					blocks: blocks,
					chunk_x,
					chunk_y,
					chunk_z,
				},
				schematicObject,
				renderingBounds
			);

			processedChunkCount++;

			if (chunkMeshes && chunkMeshes.length > 0) {
				// Store chunk reference for management
				const chunkKey = `${chunk_x},${chunk_y},${chunk_z}`;
				chunkMap.set(chunkKey, chunkMeshes);

				// Apply properties and add to scene
				this.applyPropertiesToObjects(chunkMeshes);
				chunkMeshes.forEach((mesh) => {
					this.group.add(mesh);
				});
				// On-demand rendering: newly-added chunk geometry must trigger a draw.
				this.schematicRenderer.invalidate();

				totalMeshCount += chunkMeshes.length;
			}

			// Update progress occasionally
			if (processedChunkCount % progressUpdateInterval === 0) {
				this.reportBuildProgress(
					"Processing chunks...",
					0.15 + (processedChunkCount / totalChunks) * 0.8,
					totalChunks,
					processedChunkCount
				);
			}
		};

		// Iterate and dispatch tasks
		while (iterator.has_next()) {
			const chunkData = iterator.next();
			if (!chunkData) break;

			// Wait if concurrency limit reached
			if (activePromises.length >= CONCURRENCY_LIMIT) {
				await Promise.race(activePromises);
			}

			// Start new task
			const promise = processChunk(chunkData).then(() => {
				// Remove self from active promises
				const idx = activePromises.indexOf(promise);
				if (idx > -1) activePromises.splice(idx, 1);
			});
			activePromises.push(promise);
		}

		// Wait for remaining tasks
		await Promise.all(activePromises);

		performanceMonitor.endOperation("Process All Chunks");

		this.reportBuildProgress("Finalizing scene...", 0.95, totalChunks, processedChunkCount);

		this.group.updateMatrixWorld(true);

		const totalTime = performance.now() - overallStartTime;

		// Return meshes from scene graph (not from accumulator!)
		const finalMeshes = Array.from(this.group.children);

		// Dispatch completion event
		if (typeof window !== "undefined") {
			window.dispatchEvent(
				new CustomEvent("schematicRenderComplete", {
					detail: {
						schematicId: this.id,
						schematicName: this.name,
						totalChunks: totalChunks,
						processedChunks: processedChunkCount,
						buildTimeMs: totalTime,
						meshCount: totalMeshCount,
						optimized: true,
						immediate: true,
						trueLazy: true, // Flag for true lazy loading
					},
				})
			);
		}

		// Log final stats
		const renderer = this.schematicRenderer.renderManager?.renderer;
		if (renderer && renderer.info) {
			console.log(
				`FINAL TRUE LAZY STATS - Draw Calls: ${renderer.info.render.calls}, Tris: ${renderer.info.render.triangles}`
			);
			console.log(
				`Memory - Geometries: ${renderer.info.memory.geometries}, Textures: ${renderer.info.memory.textures}`
			);
		}

		const paletteStats = this.worldMeshBuilder.getPaletteStats();
		console.log(
			`Palette Cache - ${paletteStats.paletteSize} block types, ${(
				paletteStats.memoryEstimate /
				1024 /
				1024
			).toFixed(1)}MB`
		);

		this.reportBuildProgress("TRUE lazy build complete", 1.0, totalChunks, processedChunkCount);

		setTimeout(() => {
			if (this.schematicRenderer.uiManager) {
				this.schematicRenderer.uiManager.hideProgressBar();
			}
		}, 500);

		return { meshes: finalMeshes, chunkMap };
	}

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
	private computeChunkAprons(
		allChunks: Array<{ chunk_x: number; chunk_y: number; chunk_z: number; blocks: any }>,
		dims: { chunkWidth: number; chunkHeight: number; chunkLength: number }
	): Map<string, Int32Array> {
		const W = dims.chunkWidth;
		const H = dims.chunkHeight;
		const L = dims.chunkLength;
		const key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;

		const forEachBlock = (
			blocks: any,
			cb: (x: number, y: number, z: number, idx: number) => void
		) => {
			if (blocks instanceof Int32Array) {
				for (let i = 0; i < blocks.length; i += 4) {
					cb(blocks[i], blocks[i + 1], blocks[i + 2], blocks[i + 3]);
				}
			} else if (Array.isArray(blocks)) {
				for (const b of blocks) cb(b[0], b[1], b[2], b[3]);
			}
		};

		type Faces = {
			negX: number[];
			posX: number[];
			negY: number[];
			posY: number[];
			negZ: number[];
			posZ: number[];
		};

		// Pass 1: extract each chunk's six boundary planes.
		const facesByKey = new Map<string, Faces>();
		for (const c of allChunks) {
			const planeNegX = c.chunk_x * W;
			const planePosX = c.chunk_x * W + W - 1;
			const planeNegY = c.chunk_y * H;
			const planePosY = c.chunk_y * H + H - 1;
			const planeNegZ = c.chunk_z * L;
			const planePosZ = c.chunk_z * L + L - 1;
			const f: Faces = { negX: [], posX: [], negY: [], posY: [], negZ: [], posZ: [] };
			forEachBlock(c.blocks, (x, y, z, idx) => {
				if (x === planeNegX) f.negX.push(x, y, z, idx);
				if (x === planePosX) f.posX.push(x, y, z, idx);
				if (y === planeNegY) f.negY.push(x, y, z, idx);
				if (y === planePosY) f.posY.push(x, y, z, idx);
				if (z === planeNegZ) f.negZ.push(x, y, z, idx);
				if (z === planePosZ) f.posZ.push(x, y, z, idx);
			});
			facesByKey.set(key(c.chunk_x, c.chunk_y, c.chunk_z), f);
		}

		// Pass 2: each chunk's apron is the union of its neighbours' facing planes.
		const aprons = new Map<string, Int32Array>();
		for (const c of allChunks) {
			const cx = c.chunk_x;
			const cy = c.chunk_y;
			const cz = c.chunk_z;
			const parts: number[][] = [];
			const add = (k: string, pick: (f: Faces) => number[]) => {
				const f = facesByKey.get(k);
				if (f) parts.push(pick(f));
			};
			add(key(cx + 1, cy, cz), (f) => f.negX);
			add(key(cx - 1, cy, cz), (f) => f.posX);
			add(key(cx, cy + 1, cz), (f) => f.negY);
			add(key(cx, cy - 1, cz), (f) => f.posY);
			add(key(cx, cy, cz + 1), (f) => f.negZ);
			add(key(cx, cy, cz - 1), (f) => f.posZ);

			let total = 0;
			for (const p of parts) total += p.length;
			if (total === 0) continue;

			const apron = new Int32Array(total);
			let offset = 0;
			for (const p of parts) {
				apron.set(p, offset);
				offset += p.length;
			}
			aprons.set(key(cx, cy, cz), apron);
		}

		return aprons;
	}

	// Also fix the incremental version
	public async buildSchematicMeshesIncremental(
		schematicObject: SchematicObject,
		chunkDimensions: any = {
			chunkWidth: 16,
			chunkHeight: 16,
			chunkLength: 16,
		}
	): Promise<{
		meshes: THREE.Object3D[];
		chunkMap: Map<string, THREE.Object3D[]>;
	}> {
		const overallStartTime = performance.now();
		const renderer = this.schematicRenderer.renderManager?.renderer;
		const schematic = schematicObject.schematicWrapper;

		// Initialize pipeline
		const palettes = this.getPalettes(schematic);
		await this.worldMeshBuilder.precomputePaletteGeometries(palettes.default);

		// CRITICAL: Wait for JSZip's async postMessage queue to drain
		// JSZip uses setImmediate (via postMessage) which continues after await returns
		await new Promise((resolve) => setTimeout(resolve, 100));

		const iterator = schematic.create_lazy_chunk_iterator(
			chunkDimensions.chunkWidth,
			chunkDimensions.chunkHeight,
			chunkDimensions.chunkLength,
			"bottom_up",
			0,
			0,
			0
		);

		const totalChunks = iterator.total_chunks();

		if (totalChunks === 0) {
			this.reportBuildProgress("Schematic build complete (no chunks)", 1.0, 0, 0);
			return { meshes: [], chunkMap: new Map() };
		}

		const chunkMap: Map<string, THREE.Object3D[]> = new Map();
		let totalMeshCount = 0;

		this.reportBuildProgress("Processing optimized chunks...", 0, totalChunks, 0);

		const renderingBounds = schematicObject.renderingBounds?.enabled
			? schematicObject.renderingBounds
			: undefined;

		let processedChunkCount = 0;

		performanceMonitor.startOperation("schematic-build-incremental");
		performanceMonitor.startOperation("Process All Chunks");

		return new Promise(async (resolvePromise, rejectPromise) => {
			try {
				// PERFORMANCE FIX: Batch all worker calls to avoid per-await event loop overhead
				// Collect all chunk data first
				const allChunks: Array<{ chunk_x: number; chunk_y: number; chunk_z: number; blocks: any }> =
					[];

				while (iterator.has_next()) {
					const chunkData = iterator.next();
					if (!chunkData) break;

					const { chunk_x, chunk_y, chunk_z, blocks } = chunkData;

					// Bounds culling
					if (renderingBounds?.enabled) {
						const chunkMinX = chunk_x * chunkDimensions.chunkWidth;
						const chunkMinY = chunk_y * chunkDimensions.chunkHeight;
						const chunkMinZ = chunk_z * chunkDimensions.chunkLength;
						const chunkMaxX = chunkMinX + chunkDimensions.chunkWidth;
						const chunkMaxY = chunkMinY + chunkDimensions.chunkHeight;
						const chunkMaxZ = chunkMinZ + chunkDimensions.chunkLength;

						if (
							chunkMaxX < renderingBounds.min.x ||
							chunkMinX > renderingBounds.max.x ||
							chunkMaxY < renderingBounds.min.y ||
							chunkMinY > renderingBounds.max.y ||
							chunkMaxZ < renderingBounds.min.z ||
							chunkMinZ > renderingBounds.max.z
						) {
							continue; // Skip culled chunks
						}
					}

					allChunks.push({ chunk_x, chunk_y, chunk_z, blocks });
				}

				// Build a 1-voxel "apron" of each chunk's neighbours so faces on chunk
				// seams cull against the adjacent chunk (otherwise internal faces — most
				// visibly water — show along every boundary).
				const chunkAprons = this.computeChunkAprons(allChunks, chunkDimensions);

				// Process in batches to avoid overwhelming the worker pool
				const BATCH_SIZE = 8; // Match worker count
				const totalChunksToProcess = allChunks.length;

				for (let batchStart = 0; batchStart < totalChunksToProcess; batchStart += BATCH_SIZE) {
					const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunksToProcess);
					const batch = allChunks.slice(batchStart, batchEnd);

					// Send all chunks in this batch to workers simultaneously
					const batchPromises = batch.map(({ chunk_x, chunk_y, chunk_z, blocks }) =>
						this.worldMeshBuilder
							.getChunkMesh(
								{
									blocks,
									chunk_x,
									chunk_y,
									chunk_z,
									apronBlocks: chunkAprons.get(`${chunk_x},${chunk_y},${chunk_z}`),
								},
								schematicObject,
								renderingBounds
							)
							.then((meshes) => ({ chunk_x, chunk_y, chunk_z, meshes }))
					);

					// Await entire batch at once - single yield point!
					const batchResults = await Promise.all(batchPromises);

					// Add all batch results to scene
					for (const { chunk_x, chunk_y, chunk_z, meshes } of batchResults) {
						processedChunkCount++;

						if (meshes && meshes.length > 0) {
							const chunkKey = `${chunk_x},${chunk_y},${chunk_z}`;
							chunkMap.set(chunkKey, meshes);

							this.applyPropertiesToObjects(meshes);
							meshes.forEach((mesh) => this.group.add(mesh));
							totalMeshCount += meshes.length;
							// On-demand rendering: trigger a draw for the new chunks.
							this.schematicRenderer.invalidate();
						}
					}

					// Log progress every batch
					console.log(
						`[SceneAdd] batch=${Math.floor(batchStart / BATCH_SIZE) + 1} processed=${processedChunkCount}/${totalChunksToProcess} children=${this.group.children.length}`
					);

					this.reportBuildProgress(
						"Processing chunks...",
						processedChunkCount / totalChunksToProcess,
						totalChunksToProcess,
						processedChunkCount
					);
				}

				// Final render
				if (this.schematicRenderer.renderManager && renderer) {
					const renderStartTime = performance.now();
					this.schematicRenderer.renderManager.render();
					const renderTime = performance.now() - renderStartTime;
					console.log(
						`[RenderTiming] FINAL meshes=${this.group.children.length} renderMs=${renderTime.toFixed(0)}`
					);
				}

				// Complete
				performanceMonitor.endOperation("Process All Chunks");
				this.group.updateMatrixWorld(true);

				const finalMeshes = Array.from(this.group.children);

				if (typeof window !== "undefined") {
					window.dispatchEvent(
						new CustomEvent("schematicRenderComplete", {
							detail: {
								schematicId: this.id,
								schematicName: this.name,
								totalChunks: totalChunks,
								processedChunks: processedChunkCount,
								buildTimeMs: performance.now() - overallStartTime,
								meshCount: totalMeshCount,
								optimized: true,
								incremental: true,
								batchedWorkers: true,
							},
						})
					);
				}

				this.reportBuildProgress("Build complete", 1.0, totalChunks, processedChunkCount);
				performanceMonitor.endOperation("schematic-build-incremental");

				setTimeout(() => {
					if (this.schematicRenderer.uiManager) {
						this.schematicRenderer.uiManager.hideProgressBar();
					}
				}, 800);

				resolvePromise({ meshes: finalMeshes, chunkMap });
			} catch (error) {
				performanceMonitor.endOperation("Process All Chunks");
				performanceMonitor.endOperation("schematic-build-incremental");
				console.error(`[SchematicObject] Error during batched processing:`, error);
				rejectPromise(error);
			}
		});
	}

	/**
	/**
	 * Clip a list of chunks against renderingBounds before they're handed to
	 * the batched worker. `processChunksBatched` doesn't accept bounds, so we
	 * cull whole chunks that fall outside the slice and rewrite the block
	 * Int32Arrays of chunks that overlap.
	 */
	private applyBoundsToChunks(
		chunks: Array<{ blocks: Int32Array; chunk_x: number; chunk_y: number; chunk_z: number }>,
		bounds: { min: THREE.Vector3; max: THREE.Vector3 },
		chunkDimensions: { chunkWidth: number; chunkHeight: number; chunkLength: number }
	): Array<{ blocks: Int32Array; chunk_x: number; chunk_y: number; chunk_z: number }> {
		const out: Array<{ blocks: Int32Array; chunk_x: number; chunk_y: number; chunk_z: number }> =
			[];
		const minX = bounds.min.x;
		const minY = bounds.min.y;
		const minZ = bounds.min.z;
		const maxX = bounds.max.x;
		const maxY = bounds.max.y;
		const maxZ = bounds.max.z;

		for (const c of chunks) {
			const chunkMinX = c.chunk_x * chunkDimensions.chunkWidth;
			const chunkMinY = c.chunk_y * chunkDimensions.chunkHeight;
			const chunkMinZ = c.chunk_z * chunkDimensions.chunkLength;
			const chunkMaxX = chunkMinX + chunkDimensions.chunkWidth;
			const chunkMaxY = chunkMinY + chunkDimensions.chunkHeight;
			const chunkMaxZ = chunkMinZ + chunkDimensions.chunkLength;

			// Whole chunk outside bounds — drop it.
			if (
				chunkMaxX <= minX ||
				chunkMinX >= maxX ||
				chunkMaxY <= minY ||
				chunkMinY >= maxY ||
				chunkMaxZ <= minZ ||
				chunkMinZ >= maxZ
			) {
				continue;
			}

			// Whole chunk inside bounds — keep as-is, no per-block filter.
			if (
				chunkMinX >= minX &&
				chunkMaxX <= maxX &&
				chunkMinY >= minY &&
				chunkMaxY <= maxY &&
				chunkMinZ >= minZ &&
				chunkMaxZ <= maxZ
			) {
				out.push(c);
				continue;
			}

			// Partial overlap — filter the block list.
			const blocks = c.blocks;
			const filtered: number[] = [];
			for (let i = 0; i < blocks.length; i += 4) {
				const x = blocks[i];
				const y = blocks[i + 1];
				const z = blocks[i + 2];
				if (x >= minX && x < maxX && y >= minY && y < maxY && z >= minZ && z < maxZ) {
					filtered.push(x, y, z, blocks[i + 3]);
				}
			}
			if (filtered.length > 0) {
				out.push({
					blocks: new Int32Array(filtered),
					chunk_x: c.chunk_x,
					chunk_y: c.chunk_y,
					chunk_z: c.chunk_z,
				});
			}
		}
		return out;
	}

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
	private _gpuMeshBuilder: any = null;

	private async getGpuMeshBuilder(): Promise<any> {
		if (this._gpuMeshBuilder) return this._gpuMeshBuilder.available ? this._gpuMeshBuilder : null;
		const { GpuMeshBuilder } = await import("../meshing/GpuMeshBuilder");
		this._gpuMeshBuilder = new GpuMeshBuilder();
		return (await this._gpuMeshBuilder.init()) ? this._gpuMeshBuilder : null;
	}

	/**
	 * GPU compute build: extract the full block grid once, upload with the palette
	 * templates, two-pass compute (count -> exact alloc -> emit), read back per-category
	 * BufferGeometries. Hash-compatible with the batched path's oracle bookkeeping.
	 */
	public async buildSchematicMeshesGpu(
		schematicObject: any
	): Promise<{ meshes: any[]; chunkMap: Map<string, any[]> }> {
		const t0 = performance.now();
		const schematic = schematicObject.schematicWrapper;
		const dimsArr = schematic.get_dimensions();
		const sx = dimsArr[0],
			sy = dimsArr[1],
			sz = dimsArr[2];

		// STEP 1 (same as other modes): palette precompute populates paletteCache
		const palettes = this.getPalettes(schematic);
		await this.worldMeshBuilder.precomputePaletteGeometries(palettes.default);

		// full grid extraction via the same 16³ lazy iterator the other modes use.
		// Air is skipped BY NAME (palette index 0 is air in our files, but don't assume).
		const airIdx = new Set<number>();
		(palettes.default || []).forEach((e: any, i: number) => {
			if (e?.name === "minecraft:air" || e?.Name === "minecraft:air") airIdx.add(i);
		});
		if (airIdx.size === 0) airIdx.add(0); // litematica convention fallback
		const iterator = schematic.create_lazy_chunk_iterator(16, 16, 16, "bottom_up", 0, 0, 0);
		const grid = new Uint32Array(sx * sy * sz); // 0 = air; raw palette idx (desc is 1-based with dummy 0)
		let written = 0;
		while (iterator.has_next()) {
			const cd = iterator.next();
			if (!cd || !cd.blocks) continue;
			if (cd.blocks instanceof Int32Array || cd.blocks instanceof Uint32Array) {
				// flat [x, y, z, paletteIdx, …]
				const b = cd.blocks;
				for (let i = 0; i + 3 < b.length; i += 4) {
					if (airIdx.has(b[i + 3])) continue;
					grid[(b[i + 1] * sz + b[i + 2]) * sx + b[i]] = b[i + 3];
					written++;
				}
			} else {
				for (const b of cd.blocks) {
					if (airIdx.has(b[3])) continue;
					grid[(b[1] * sz + b[2]) * sx + b[0]] = b[3];
					written++;
				}
			}
		}
		console.log(
			`[GpuBuild] grid ${written.toLocaleString()} non-air blocks written; dims=${dimsArr.join(",")}`
		);

		// inspector support: apply hidden cells; grid is re-extracted on rebuild (not retained)
		this.applyHiddenCells(grid, sx, sy, sz);
		this.gpuBuilt = true;

		const tGrid = performance.now() - t0;

		const wmb: any = this.worldMeshBuilder;
		const paletteData = wmb.paletteCache?.paletteGeometryData;
		if (!paletteData || !Array.isArray(paletteData)) {
			console.warn(
				"[GpuBuild] paletteGeometryData unavailable (stale cache path) — falling back to batched"
			);
			return await this.buildSchematicMeshesBatched(schematicObject, {
				chunkWidth: 16,
				chunkHeight: 16,
				chunkLength: 16,
			});
		}
		const materials = wmb.paletteCache?.globalMaterials || [];
		const builder = await this.getGpuMeshBuilder();
		const meshes = await builder.buildMeshes(grid, sx, sy, sz, paletteData, () => materials);
		for (const m of meshes) {
			this.applyPropertiesToObjects([m]);
			// static meshes: freeze matrix updates (parent transforms still move them)
			m.matrixAutoUpdate = false;
			m.updateMatrix();
			this.group.add(m);
		}
		this.schematicRenderer.invalidate?.();
		console.log(
			`[GpuBuild] grid ${tGrid.toFixed(0)}ms + compute total ${(performance.now() - t0).toFixed(0)}ms, ${meshes.length} meshes`
		);
		return { meshes, chunkMap: new Map() };
	}

	/**
	 * GPU-pull build: same grid extraction as the GPU path, but emits the 8B/triangle
	 * record stream and renders it directly via WebGL2 vertex pulling (gl_VertexID) —
	 * zero vertex-data readback. ~10x less data than the vertex path.
	 */

	public async buildSchematicMeshesGpuPull(
		schematicObject: any
	): Promise<{ meshes: any[]; chunkMap: Map<string, any[]> }> {
		// reuse the GPU path's extraction up to the build, then swap the builder call
		const gpuResult = await this.extractGpuGrid(schematicObject, true);
		const { builder, paletteData, materials, grid, sx, sy, sz } = gpuResult;
		const { withoutFluidGeometry } = await import("../meshing/FluidGeometry");
		let entityCells = gpuResult.entityCells;
		const { meshes } = await builder.buildRecordMeshes(
			grid,
			sx,
			sy,
			sz,
			withoutFluidGeometry(paletteData),
			() => materials
		);
		meshes.push(...(await this.buildFluidSurface(schematicObject)));
		// ===== entity fallback — astra-written bake normalization (no runtime matrices) =====
		// 1) bake every GLTF part's transform into cloned geometry
		// 2) normalize the combined bbox to the cell (x/z centered at 0.5, y from 0)
		// 3) instance = T(pos)·T(.5)·RY·T(-.5) with DIRECT matrix coefficients
		// 4) doubles: base/lid pre-stretched 30/14 at bake; latch unchanged (normalization centers it)
		// 5) liquid materials: atlas sub-rect stays (frame 0); manual strip clamp
		//    only for non-atlas materials
		if (entityCells.length > 0) {
			const cubane = (this.worldMeshBuilder as any).cubane;
			const schematic = schematicObject.schematicWrapper;
			const al: any = cubane.assetLoader;
			// +π vs the naive table: user-verified chests faced exactly opposite the
			// expected direction (top ones should face south, bottom east) — the
			// chest model's "north" texture faces +Z, so every facing rotates 180°
			const ROT_Y2: Record<string, number> = {
				north: Math.PI,
				east: Math.PI / 2,
				south: 0,
				west: -Math.PI / 2,
			};
			const FV: Record<string, [number, number]> = {
				north: [0, -1],
				east: [1, 0],
				south: [0, 1],
				west: [-1, 0],
			};
			const propsAt2 = (x: number, y: number, z: number) => {
				try {
					const bp = schematic.get_block_with_properties?.(x, y, z);
					// METHOD CALL ONLY (fable): detaching `properties` off a wasm-bindgen
					// object calls it with this===undefined → TypeError reading
					// __wbg_ptr → silently {} → bare state names → wire rendered nothing
					return bp?.properties?.() ?? bp?.properties ?? {};
				} catch {
					return {};
				}
			};
			const isChest2 = (b: string) =>
				/^minecraft:(?:(?:trapped_|ender_)?chest|(?:waxed_)?(?:(?:exposed|weathered|oxidized)_)?copper_chest)(\[|;|$)/.test(
					b
				);
			// CHESTS: per-cell template system (ChestModels.ts, approved design) —
			// each cell renders its own (facing,type) half; no pairing/midpoint path
			const chestSynth: Array<{
				state: unknown;
				chest: true;
				positions: Array<{ x: number; y: number; z: number }>;
			}> = [];
			const nonChestCells: typeof entityCells = [];
			for (const c of entityCells) {
				if (!isChest2(c.block)) {
					nonChestCells.push(c);
					continue;
				}
				// c.block is already the FULL state (extractGpuGrid enriches entityCells
				// with properties) — use it verbatim; rebuild-from-props raced the wrapper
				chestSynth.push({ state: c.block, chest: true, positions: [{ x: c.x, y: c.y, z: c.z }] });
			}
			if (chestSynth.length > 0) {
				try {
					const { buildChestInstancedMeshes } = await import("../meshing/ChestModels");
					const { meshes: chestMeshes } = await buildChestInstancedMeshes(
						chestSynth,
						al,
						sx,
						sy,
						sz
					);
					for (const cm of chestMeshes) {
						cm.userData.gpuBuilt = false;
						meshes.push(cm as any);
					}
					console.log(
						`[ChestModels] ${chestSynth.length} chest cells -> ${chestMeshes.length} instanced meshes`
					);
				} catch (e) {
					console.warn("[ChestModels] chest render failed:", e);
				}
			}
			// These templates already carry block-local transforms. Preserve their poses
			// and per-element materials instead of recentering or applying facing twice.
			const special = new Map<string, typeof entityCells>();
			for (let i = nonChestCells.length - 1; i >= 0; i--) {
				const cell = nonChestCells[i];
				if (!/copper_golem_statue|firefly_bush|(?:potted_)?open_eyeblossom/.test(cell.block))
					continue;
				const cells = special.get(cell.block) ?? [];
				cells.push(cell);
				special.set(cell.block, cells);
				nonChestCells.splice(i, 1);
			}
			for (const [state, cells] of special) {
				const proto = await cubane.getBlockMesh(state, "plains", true);
				proto.updateWorldMatrix(true, true);
				proto.traverse((part: THREE.Object3D) => {
					if (!(part instanceof THREE.Mesh)) return;
					const materialList = Array.isArray(part.material) ? part.material : [part.material];
					if (materialList.some((m: THREE.Material) => m.userData.isWater)) return;
					const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
					const instances = new THREE.InstancedMesh(geometry, part.material, cells.length);
					const matrix = new THREE.Matrix4();
					cells.forEach((cell, i) =>
						instances.setMatrixAt(i, matrix.makeTranslation(cell.x, cell.y, cell.z))
					);
					instances.instanceMatrix.needsUpdate = true;
					instances.computeBoundingSphere();
					meshes.push(instances);
				});
			}

			const byPos = new Map<string, any>();
			for (const c of nonChestCells) if (isChest2(c.block)) byPos.set(`${c.x},${c.y},${c.z}`, c);
			const consumed2 = new Set<string>();
			const buckets = new Map<
				string,
				{
					state: string;
					double: boolean;
					facing: string;
					chest: boolean;
					positions: Array<{ x: number; y: number; z: number }>;
				}
			>();
			for (const c of nonChestCells) {
				const key = `${c.x},${c.y},${c.z}`;
				if (consumed2.has(key)) continue;
				// propsAt2 has been observed returning {} DURING the pull build (the
				// wrapper's get_block_with_properties comes up empty moments after the
				// identical extractGpuGrid enrichment succeeded) — which strips
				// c.block's own [props] and hands getBlockMesh a BARE name → multipart
				// matches nothing → redstone_wire renders nothing. Prefer the state
				// extractGpuGrid already enriched; live lookup is only a fallback.
				const props = c.block.includes("[")
					? Object.fromEntries(
							c.block
								.split("[")[1]
								.replace("]", "")
								.split(",")
								.filter(Boolean)
								.map((kv) => [kv.split("=")[0], kv.split("=")[1]])
						)
					: propsAt2(c.x, c.y, c.z);
				const chest = isChest2(c.block);
				const facing = props.facing ?? "north";
				let partner: any = null;
				if (chest && (props.type === "left" || props.type === "right") && FV[facing]) {
					const other = props.type === "left" ? "right" : "left";
					for (const [dx, dz] of [
						[-FV[facing][1], FV[facing][0]],
						[FV[facing][1], -FV[facing][0]],
					]) {
						const cand = byPos.get(`${c.x + dx},${c.y},${c.z + dz}`);
						if (cand && !consumed2.has(`${c.x + dx},${c.y},${c.z + dz}`)) {
							const cp = propsAt2(c.x + dx, c.y, c.z + dz);
							if (cp.type === other && cp.facing === facing) {
								partner = cand;
								break;
							}
						}
					}
				}
				consumed2.add(key);
				if (partner) {
					consumed2.add(`${partner.x},${partner.y},${partner.z}`);
				}
				const pk = Object.keys(props)
					.filter((k) => k !== "power") // fable: power is tint-only — bucketing on it forks protos 16x
					.sort()
					.map((k) => `${k}=${props[k]}`)
					.join(",");
				const state = c.block.split(/[;[]/, 1)[0] + (pk ? `[${pk}]` : "");
				if (!pk)
					console.warn(
						`[proto] empty props for ${c.block} @ ${c.x},${c.y},${c.z} — getBlockMesh will get a bare name`
					);
				const bk = `${partner ? "double" : "single"}:${state}`;
				if (!buckets.has(bk))
					buckets.set(bk, { state, double: !!partner, facing, chest, positions: [] });
				buckets.get(bk)!.positions.push({
					x: partner ? (c.x + partner.x) / 2 : c.x,
					y: c.y,
					z: partner ? (c.z + partner.z) / 2 : c.z,
				});
			}
			for (const bucket of buckets.values()) {
				// `type=left/right` (double halves) have no blockstate model — getBlockMesh
				// returned null for double buckets and their cells vanished entirely.
				// Build the proto as a SINGLE; the geometry is stretched to double width
				// at bake time below.
				const protoState = bucket.state.replace(/type=(left|right)/, "type=single");
				// getBlockMesh can throw during the early build (texture loads race the
				// atlas) — a silent catch here made redstone_wire cells VANISH (the
				// "wire outlines but never renders" bug). Retry with backoff + logging.
				let proto: any = null;
				for (let att = 0; att < 4 && !proto; att++) {
					if (att > 0) await new Promise((res) => setTimeout(res, 600 * att));
					try {
						proto = await cubane.getBlockMesh(protoState, "plains", true);
					} catch (e) {
						console.warn(`[proto] getBlockMesh attempt ${att + 1} failed for ${protoState}:`, e);
					}
				}
				if (!proto) {
					// some registries reject the type property entirely — try bare
					for (let att = 0; att < 3 && !proto; att++) {
						try {
							proto = await cubane.getBlockMesh(bucket.state.split("[")[0], "plains", true);
						} catch (e) {
							console.warn(`[proto] bare retry failed for ${bucket.state}:`, e);
						}
					}
				}
				if (!proto) {
					console.warn(
						`[proto] no mesh for ${bucket.state} (${bucket.positions.length} cells unrendered)`
					);
					continue;
				}
				proto.updateWorldMatrix(true, true);
				const inv = proto.matrixWorld.clone().invert();
				const parts: Array<{ g: THREE.BufferGeometry; m: any; latch: boolean }> = [];
				const bounds = new THREE.Box3();
				proto.traverse((o: any) => {
					if (!o.isMesh || !o.geometry?.getAttribute?.("position")) return;
					const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
					const g = o.geometry.clone();
					g.applyMatrix4(rel);
					g.computeBoundingBox();
					if (!g.boundingBox || g.boundingBox.isEmpty()) {
						g.dispose();
						return;
					}
					bounds.union(g.boundingBox);
					let latch = false;
					for (let n: any = o; n && n !== proto; n = n.parent) {
						if (/latch|clasp|knob|lock/i.test(n.name ?? "")) {
							latch = true;
							break;
						}
					}
					parts.push({ g, m: Array.isArray(o.material) ? o.material[0] : o.material, latch });
				});
				if (!parts.length || bounds.isEmpty()) continue;
				const center = bounds.getCenter(new THREE.Vector3());
				const width = bounds.max.x - bounds.min.x;
				if (bucket.chest && !parts.some((p) => p.latch)) {
					for (const p of parts) {
						const b2 = p.g.boundingBox!;
						const pw = b2.max.x - b2.min.x;
						const pcx = (b2.min.x + b2.max.x) / 2;
						p.latch = pw < width * 0.4 && Math.abs(pcx - center.x) < width * 0.1;
					}
				}
				// CENTER convention: rendered cell c spans [c−0.5, c+0.5] (cubane geometry
				// is already centered on the integer point) — recentre X/Z to the cell
				// CENTER (0) and drop the floor half a block below it
				const corr = new THREE.Vector3(-center.x, -bounds.min.y - 0.5, -center.z);
				const st = 30 / 14;
				const dbl = new THREE.Matrix4().set(
					st,
					0,
					0,
					0.5 * (1 - st),
					0,
					1,
					0,
					0,
					0,
					0,
					1,
					0,
					0,
					0,
					0,
					1
				);
				const ang = ROT_Y2[bucket.facing] ?? 0;
				const cos = Math.cos(ang),
					sin = Math.sin(ang);
				const im = new THREE.Matrix4();
				for (const part of parts) {
					const partMaterials = Array.isArray(part.m) ? part.m : [part.m];
					if (partMaterials.some((material: THREE.Material) => material.userData?.isWater)) {
						part.g.dispose();
						continue; // waterlogged entities get water from the shared fluid surface
					}
					part.g.translate(corr.x, corr.y, corr.z);
					let g = part.g;
					if (bucket.double && !part.latch) {
						g = part.g.clone();
						g.applyMatrix4(dbl);
					}
					g.computeBoundingBox();
					g.computeBoundingSphere();
					let mat = part.m;
					// ANY material in the array counts (top faces often ride [1]+), and
					// missing texturePath metadata must not leak the atlas through
					const matsArr = Array.isArray(part.m) ? part.m : [part.m];
					const tp =
						matsArr.map((mm: any) => mm?.userData?.texturePath || "").join("|") +
						"|" +
						bucket.state;
					const liq = /water|lava/i.exec(tp)?.[0]?.toLowerCase();
					if (liq) {
						// BYPASS LIQUIDS: swap the shared atlas map for a CLONED strip
						// texture and frame-cycle it via texture offset — animated and
						// tinted to match the record path (which animates in-shader).
						// Scene lighting is bypassed (emissive) so brightness matches the
						// unlit record-path liquids from every angle.
						mat = mat.clone();
						mat.map = null;
						try {
							const texPath = String(matsArr[0]?.userData?.texturePath || `block/${liq}_still`);
							const tex = await al.getTexture(texPath);
							const img = tex?.image;
							const iw = img?.width ?? img?.[0]?.width;
							const ih = img?.height ?? img?.[0]?.height;
							const frames = iw && ih && ih > iw ? Math.max(1, Math.round(ih / iw)) : 1;
							// geometry V spans one frame inside the atlas (atlasUV);
							// rescale the strip so that span lands on frame 0's rows
							const auv = matsArr[0]?.userData?.atlasUV;
							const hSpan = auv?.height || 1 / frames;
							const v0GL = auv ? 1 - auv.v - hSpan : 0;
							const strip = tex.clone();
							strip.needsUpdate = true;
							const r = 1 / (frames * hSpan);
							strip.repeat.set(1, r);
							strip.offset.set(0, 1 - 1 / frames - v0GL * r);
							mat.map = strip;
							// raw strips are untinted grayscale masks (water) — tint to
							// match the pack-time atlas tint; lava keeps its colors
							mat.emissive = new THREE.Color(liq === "water" ? 0x2f58ab : 0xffffff);
							mat.emissiveMap = strip;
							mat.emissiveIntensity = 1.0;
							mat.color = new THREE.Color(0x000000);
							// depth-write like the record-path water: only the front
							// shell blends — no alpha compounding through stacked shells
							mat.depthWrite = true;
							mat.needsUpdate = true;
							if (frames > 1) {
								const t0 = performance.now();
								(part as any).__animStrip = () => {
									const k = Math.floor(((performance.now() - t0) / 1000) * 5) % frames;
									strip.offset.y = 1 - 1 / frames - v0GL * r - k / frames;
								};
							}
						} catch {
							/* keep null = flat color */
						}
					}
					const inst = new THREE.InstancedMesh(g, mat, bucket.positions.length);
					inst.frustumCulled = true;
					// liquid strip animation (offset cycling set up above)
					if ((part as any).__animStrip) inst.onBeforeRender = () => (part as any).__animStrip();
					for (let i = 0; i < bucket.positions.length; i++) {
						const p = bucket.positions[i];
						// geometry is centered at origin after corr — rotate about the
						// cell center and place at the integer point (CENTER convention)
						im.set(cos, 0, sin, p.x, 0, 1, 0, p.y, -sin, 0, cos, p.z, 0, 0, 0, 1);
						inst.setMatrixAt(i, im);
					}
					inst.instanceMatrix.needsUpdate = true;
					// bounds: the baked geometry lives in unit-cell space, so any
					// geometry-sphere fallback culls wrongly with view direction (the
					// "look up = gone, look down = back" bug). Compute the INSTANCE
					// sphere; if unavailable, cover the whole grid so these few meshes
					// are never frustum-culled.
					try {
						(inst as any).computeBoundingSphere?.();
						if (!(inst as any).boundingSphere) {
							(inst as any).boundingSphere = new THREE.Sphere(
								new THREE.Vector3(sx / 2, sy / 2, sz / 2),
								Math.hypot(sx, sy, sz)
							);
						}
					} catch {
						(inst as any).frustumCulled = false;
					}
					inst.userData.gpuBuilt = false;
					meshes.push(inst as any);
				}
			}
		}
		this.schematicRenderer.invalidate?.();
		return { meshes, chunkMap: new Map() };
	}

	/** Dispose cached surface resources even when clipping left no attached meshes. */
	public disposeSurfaceResources(): void {
		for (const material of this.surfaceMaterials.values()) material.dispose();
		this.endPortalMaterial?.dispose();
		this.endPortalMaterial = undefined;
		this.surfaceMaterials.clear();
		this.surfaceTemplates.clear();
		this.animatedSurfaces = [];
		this.surfaceIndex = new SurfaceIndex();
	}

	private async prepareSurfaceStates(states: Iterable<string>): Promise<void> {
		const cubane = this.schematicRenderer.cubane;
		const loader = cubane.getAssetLoader();
		for (const state of new Set(states)) {
			if (state === "minecraft:end_portal") {
				if (!this.endPortalMaterial) {
					const [sky, portal] = await Promise.all([
						loader.getTexture("environment/end_sky"),
						loader.getTexture("entity/end_portal"),
					]);
					this.endPortalMaterial = makeEndPortalMaterial(sky, portal, this.surfaceClip);
				}
				continue;
			}
			if (!isSurfaceBlock(state) || this.surfaceTemplates.has(state)) continue;
			const root = await cubane.getBlockMesh(state, "plains", true);
			if (!root) continue;
			const parts = this.worldMeshBuilder.extractAllMeshData(root);
			const faces = surfaceFaces(parts);
			parts.forEach(({ geometry }) => geometry.dispose());
			this.surfaceTemplates.set(state, faces);
			for (const face of faces) {
				if (!face.texture || this.surfaceMaterials.has(face.texture)) continue;
				const source = await loader.getMaterial(face.texture, { useAtlas: false });
				const map = (source as THREE.MeshStandardMaterial).map;
				if (map)
					this.surfaceMaterials.set(
						face.texture,
						makeGlassMaterial(
							map,
							isGlass(state) && !face.texture.endsWith("_top"),
							this.surfaceClip
						)
					);
			}
		}
	}

	private async buildSurfaceSections(keys: Iterable<string>): Promise<THREE.Mesh[]> {
		const meshes: THREE.Mesh[] = [];
		let deadline = performance.now() + 8;
		for (const key of keys) {
			const cells = this.surfaceIndex.sections.get(key);
			if (!cells) continue;
			const built = buildGlassMeshes(
				this.surfaceIndex.getBlock,
				cells.values(),
				this.surfaceTemplates,
				this.surfaceMaterials
			);
			if (this.endPortalMaterial) {
				const end = buildEndPortalMesh(
					cells.values(),
					this.endPortalMaterial,
					!!this.schematicRenderer.options.enableAnimatedTextures
				);
				if (end) built.push(end);
			}
			for (const mesh of built) mesh.userData.surfaceSection = key;
			meshes.push(...built);
			if (performance.now() >= deadline) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				deadline = performance.now() + 8;
			}
		}
		return meshes;
	}

	private async buildTransparentSurfaces(schematicObject: SchematicObject): Promise<THREE.Mesh[]> {
		this.disposeSurfaceResources();
		const states = fluidPaletteStates(this.getPalettes(schematicObject.schematicWrapper).default);
		this.surfaceIndex = await readSurfaceIndex(schematicObject.schematicWrapper, states, {
			bounds: schematicObject.renderingBounds,
			hiddenCells: this.hiddenCells,
		});
		const used = new Set<string>();
		for (const section of this.surfaceIndex.sections.values())
			for (const cell of section.values()) used.add(cell.state);
		await this.prepareSurfaceStates(used);
		return this.buildSurfaceSections(this.surfaceIndex.sections.keys());
	}

	private async refreshSurfaceCells(positions: THREE.Vector3[]): Promise<void> {
		const states: string[] = [];
		for (const { x, y, z } of positions) {
			const state = surfaceCellVisible(x, y, z, {
				bounds: this.renderingBounds,
				hiddenCells: this.hiddenCells,
			})
				? this.schematicWrapper.get_block_string(x, y, z) || ""
				: "";
			this.surfaceIndex.set(x, y, z, state);
			states.push(state);
		}
		await this.prepareSurfaceStates(states);
		const sections = affectedSurfaceSections(positions);
		const replacements = await this.buildSurfaceSections(sections);
		this.meshes = this.meshes.filter((mesh) => {
			if (!mesh.userData.surfaceMesh || !sections.has(mesh.userData.surfaceSection)) return true;
			this.group.remove(mesh);
			mesh.geometry.dispose(); // Cached materials are shared by unaffected sections.
			return false;
		});
		this.applyPropertiesToObjects(replacements);
		for (const mesh of replacements) this.group.add(mesh);
		this.meshes.push(...replacements);
		this.animatedSurfaces = this.meshes.filter((mesh) => mesh.userData.animatedSurface);
		this.group.updateMatrixWorld(true);
		this.schematicRenderer.invalidate();
	}

	private isSurfaceOnlyState(state: string): boolean {
		return (
			!state ||
			/^(?:minecraft:)?(?:air|cave_air|void_air)$/.test(state) ||
			(isSurfaceBlock(state) && !state.includes("waterlogged=true"))
		);
	}

	/** One shared surface pass for both the GPU-pull and batched CPU paths. */
	private async buildFluidSurface(schematicObject: SchematicObject): Promise<THREE.Mesh[]> {
		this.bubbleMesh = null;
		try {
			const { buildFluidMeshes, setFluidTextures, hasFluid } =
				await import("../meshing/WaterMesher");
			const { fluidPaletteStates, createFluidStateLookup } =
				await import("../meshing/FluidStateLookup");
			const palette = this.getPalettes(schematicObject.schematicWrapper).default;
			const states = fluidPaletteStates(palette);
			if (!states.some(hasFluid)) return [];
			const [sx, sy, sz] = schematicObject.schematicWrapper.get_dimensions();
			try {
				// the frame array registry is a module export, not a global — hand it
				// to the fluid material factory explicitly
				const { liquidFrameTextures } = await import("../meshing/RecordRenderer");
				setFluidTextures(liquidFrameTextures);
			} catch {
				/* tryBind falls back lazily */
			}
			const getBlock = createFluidStateLookup(
				schematicObject.schematicWrapper,
				states,
				sx,
				sy,
				sz,
				{
					bounds: schematicObject.renderingBounds,
					hiddenCells: this.hiddenCells,
				}
			);
			const fluid = buildFluidMeshes(getBlock, sx, sy, sz);
			for (const fm of fluid.meshes) {
				fm.userData.fluidMesh = true;
			}
			if (fluid.bubbleCells.length) {
				const { buildBubbleMesh } = await import("../meshing/BubbleColumns");
				const texture = await this.schematicRenderer.cubane
					.getAssetLoader()
					.getTexture("particle/bubble");
				this.bubbleMesh = buildBubbleMesh(fluid.bubbleCells, texture);
				if (this.bubbleMesh) fluid.meshes.push(this.bubbleMesh);
			}
			console.log(
				`[FluidMesh] ${fluid.cells.toLocaleString()} fluid cells → ${fluid.meshes.length} meshes in ${fluid.ms.toFixed(0)}ms`
			);
			return fluid.meshes;
		} catch (e) {
			console.warn("[FluidMesh] failed, fluids will not render:", e);
			return [];
		}
	}

	/** Shared front half of the GPU build paths: palette precompute + grid extraction. */
	private async extractGpuGrid(
		schematicObject: any,
		fluidSurface = false
	): Promise<{
		builder: any;
		paletteData: any[];
		materials: any[];
		grid: Uint32Array;
		sx: number;
		sy: number;
		sz: number;
		entityCells: Array<{ x: number; y: number; z: number; block: string; axis?: [number, number] }>;
	}> {
		const schematic = schematicObject.schematicWrapper;
		const dimsArr = schematic.get_dimensions();
		const sx = dimsArr[0],
			sy = dimsArr[1],
			sz = dimsArr[2];
		const palettes = this.getPalettes(schematic);
		await this.worldMeshBuilder.precomputePaletteGeometries(palettes.default, fluidSurface);
		const airIdx = new Set<number>();
		(palettes.default || []).forEach((e: any, i: number) => {
			if (e?.name === "minecraft:air" || e?.Name === "minecraft:air") airIdx.add(i);
		});
		if (airIdx.size === 0) airIdx.add(0);
		const iterator = schematic.create_lazy_chunk_iterator(16, 16, 16, "bottom_up", 0, 0, 0);
		const grid = new Uint32Array(sx * sy * sz);
		let written = 0;
		while (iterator.has_next()) {
			const cd = iterator.next();
			if (!cd || !cd.blocks) continue;
			if (cd.blocks instanceof Int32Array || cd.blocks instanceof Uint32Array) {
				const b = cd.blocks;
				for (let i = 0; i + 3 < b.length; i += 4) {
					if (airIdx.has(b[i + 3])) continue;
					grid[(b[i + 1] * sz + b[i + 2]) * sx + b[i]] = b[i + 3];
					written++;
				}
			} else {
				for (const b of cd.blocks) {
					if (airIdx.has(b[3])) continue;
					grid[(b[1] * sz + b[2]) * sx + b[0]] = b[3];
					written++;
				}
			}
		}
		this.applyHiddenCells(grid, sx, sy, sz);
		this.gpuBuilt = true;
		console.log(
			`[GpuBuild] grid ${written.toLocaleString()} non-air blocks; dims=${dimsArr.join(",")}`
		);
		const wmb: any = this.worldMeshBuilder;
		const paletteData = wmb.paletteCache?.paletteGeometryData;
		if (!paletteData || !Array.isArray(paletteData)) {
			throw new Error("[GpuBuild] paletteGeometryData unavailable (stale cache path)");
		}
		const materials = wmb.paletteCache?.globalMaterials || [];
		const builder = await this.getGpuMeshBuilder();
		// entity-rendered blocks (chests) bypass the record path: their GLTF textures
		// don't match the atlas layout, so pulled records render them black. Collect
		// their cells, zero them from the grid (no ghost boxes), and build them as
		// conventional meshes with their own materials in the pull build path.
		// water/lava REMOVED from the bypass: the record path now renders them
		// correctly (atlas tiles, animation, opaque stable color) — keeping a second
		// water renderer on raw un-normalized strip textures made bypass patches
		// adjacent to record patches visibly darker ("water changes color")
		const ENTITY_FAMILY =
			/minecraft:(trapped_chest|ender_chest|chest|(?:waxed_)?(?:(?:exposed|weathered|oxidized)_)?copper_chest|(?:waxed_)?(?:(?:exposed|weathered|oxidized)_)?copper_golem_statue|firefly_bush|(?:potted_)?open_eyeblossom|redstone_wire|kelp|kelp_plant|seagrass|tall_seagrass)(\[|\s|$)/;
		const entityPalette = new Set<number>();
		(palettes.default || []).forEach((e: any, i: number) => {
			if (ENTITY_FAMILY.test(e?.name || e?.Name || "")) entityPalette.add(i);
		});
		let entityCells: Array<{ x: number; y: number; z: number; block: string }> = [];
		if (entityPalette.size > 0) {
			for (let y = 0; y < sy; y++)
				for (let z = 0; z < sz; z++)
					for (let x = 0; x < sx; x++) {
						const gi = (y * sz + z) * sx + x;
						const p = grid[gi];
						if (p === 0 || !entityPalette.has(p)) continue;
						// FULL blockstate (astra): facing/connectivity/power select different
						// models & rotations — the bare name renders wrong shapes and no facing.
						// get_block returns name-only; get_block_with_properties carries state.
						let full = schematic.get_block?.(x, y, z) || (palettes.default as any)[p]?.name || "";
						try {
							const bp = schematic.get_block_with_properties?.(x, y, z);
							const props = bp?.properties?.() ?? bp?.properties;
							if (props && Object.keys(props).length) {
								full = `${full.split("[")[0]}[${Object.keys(props)
									.sort()
									.map((k) => `${k}=${props[k]}`)
									.join(",")}]`;
							}
						} catch {
							/* state optional */
						}
						entityCells.push({ x, y, z, block: full });
						grid[gi] = 0;
					}
		}
		// PURE FLUIDS leave the record grid too — they render as real sloped
		// geometry via WaterMesher (vanilla corner-height surface), not records
		const FLUID = /minecraft:(water|lava|bubble_column)(\[|\s|$)/;
		const fluidPalette = new Set<number>();
		(palettes.default || []).forEach((e: any, i: number) => {
			if (FLUID.test(e?.name || e?.Name || "")) fluidPalette.add(i);
		});
		if (fluidPalette.size > 0) {
			for (let y2 = 0; y2 < sy; y2++)
				for (let z2 = 0; z2 < sz; z2++)
					for (let x2 = 0; x2 < sx; x2++) {
						const gi2 = (y2 * sz + z2) * sx + x2;
						if (grid[gi2] !== 0 && fluidPalette.has(grid[gi2])) grid[gi2] = 0;
					}
		}
		return { builder, paletteData, materials, grid, sx, sy, sz, entityCells };
	}

	public async buildSchematicMeshesBatched(
		schematicObject: SchematicObject,
		chunkDimensions: any = {
			chunkWidth: 16,
			chunkHeight: 16,
			chunkLength: 16,
		}
	): Promise<{
		meshes: THREE.Object3D[];
		chunkMap: Map<string, THREE.Object3D[]>;
	}> {
		const overallStartTime = performance.now();
		const schematic = schematicObject.schematicWrapper;

		let __pt = performance.now();
		// STEP 1: Initialize pipeline
		this.reportBuildProgress("Initializing batched pipeline...", 0.05);

		const palettes = this.getPalettes(schematic);
		performanceMonitor.startOperation("Palette Precomputation");
		await this.worldMeshBuilder.precomputePaletteGeometries(palettes.default, true);
		performanceMonitor.endOperation("Palette Precomputation");

		console.log(`[PhaseTiming] palette+t0: ${(performance.now() - __pt).toFixed(0)}ms`);
		__pt = performance.now();
		// STEP 2: Create chunk iterator
		this.reportBuildProgress("Creating chunk iterator...", 0.1);

		performanceMonitor.startOperation("Chunk Iterator Creation");
		const iterator = schematic.create_lazy_chunk_iterator(
			chunkDimensions.chunkWidth,
			chunkDimensions.chunkHeight,
			chunkDimensions.chunkLength,
			"bottom_up",
			0,
			0,
			0
		);
		performanceMonitor.endOperation("Chunk Iterator Creation");

		const totalChunks = iterator.total_chunks();

		if (totalChunks === 0) {
			this.reportBuildProgress("Schematic build complete (no chunks)", 1.0, 0, 0);
			return { meshes: [], chunkMap: new Map() };
		}

		console.log(`[PhaseTiming] iterator: ${(performance.now() - __pt).toFixed(0)}ms`);
		__pt = performance.now();
		// STEP 3: Collect all chunk data
		this.reportBuildProgress("Collecting chunk data...", 0.15, totalChunks, 0);

		const allChunks: Array<{
			blocks: Int32Array;
			chunk_x: number;
			chunk_y: number;
			chunk_z: number;
		}> = [];

		while (iterator.has_next()) {
			const chunkData = iterator.next();
			if (!chunkData || chunkData.blocks.length === 0) continue;

			// Convert blocks to Int32Array
			const blocks = chunkData.blocks;
			let blocksArray: Int32Array;

			if (blocks instanceof Int32Array) {
				blocksArray = blocks;
			} else {
				blocksArray = new Int32Array(blocks.length * 4);
				for (let i = 0; i < blocks.length; i++) {
					const block = blocks[i];
					blocksArray[i * 4] = block[0];
					blocksArray[i * 4 + 1] = block[1];
					blocksArray[i * 4 + 2] = block[2];
					blocksArray[i * 4 + 3] = block[3];
				}
			}

			allChunks.push({
				blocks: blocksArray,
				chunk_x: chunkData.chunk_x,
				chunk_y: chunkData.chunk_y,
				chunk_z: chunkData.chunk_z,
			});
		}

		// Apply rendering bounds: drop whole chunks that don't intersect, and
		// filter individual blocks in chunks that overlap the slice. The
		// batched worker path doesn't accept renderingBounds, so we strip
		// the blocks here before they ever leave the main thread.
		const bounds = schematicObject.renderingBounds?.enabled
			? schematicObject.renderingBounds
			: undefined;
		const chunksToProcess: Array<{
			blocks: Int32Array;
			chunk_x: number;
			chunk_y: number;
			chunk_z: number;
			apronBlocks?: Int32Array;
		}> = bounds ? this.applyBoundsToChunks(allChunks, bounds, chunkDimensions) : allChunks;

		// Attach each chunk's neighbour "apron" so faces on chunk seams cull against
		// the adjacent chunk (computed from the bounds-filtered set so it matches what
		// actually renders). Built once, linear in block count.
		const chunkAprons = this.computeChunkAprons(chunksToProcess, chunkDimensions);
		for (const c of chunksToProcess) {
			c.apronBlocks = chunkAprons.get(`${c.chunk_x},${c.chunk_y},${c.chunk_z}`);
		}

		console.log(`[PhaseTiming] chunks+aprons: ${(performance.now() - __pt).toFixed(0)}ms`);
		__pt = performance.now();
		// STEP 4: Process all chunks in batch mode
		this.reportBuildProgress("Processing chunks in BATCH mode...", 0.2, totalChunks, 0);
		performanceMonitor.startOperation("Process All Chunks");

		let processedCount = 0;
		const batchedMeshes = await this.worldMeshBuilder.processChunksBatched(
			chunksToProcess,
			(processed, total) => {
				processedCount = processed;
				const progress = 0.2 + (processed / total) * 0.7;
				this.reportBuildProgress(`Batch processing chunks...`, progress, total, processed);
			}
		);

		batchedMeshes.push(...(await this.buildFluidSurface(schematicObject)));

		performanceMonitor.endOperation("Process All Chunks");

		console.log(`[PhaseTiming] wasm-batch: ${(performance.now() - __pt).toFixed(0)}ms`);
		__pt = performance.now();
		// STEP 5: Add meshes to scene
		this.reportBuildProgress(
			"Adding batched meshes to scene...",
			0.95,
			totalChunks,
			processedCount
		);

		// Add meshes progressively to avoid GPU upload freeze
		// Each mesh addition triggers GPU buffer upload, so we spread them out
		const MESHES_PER_FRAME = 2; // Add 2 meshes per frame
		for (let i = 0; i < batchedMeshes.length; i += MESHES_PER_FRAME) {
			const batch = batchedMeshes.slice(i, i + MESHES_PER_FRAME);
			for (const mesh of batch) {
				this.group.add(mesh);
			}

			// Force GPU upload by rendering, then yield
			if (this.schematicRenderer.renderManager) {
				this.schematicRenderer.renderManager.render();
			}

			// Let browser breathe - use RAF for real frame timing
			if (i + MESHES_PER_FRAME < batchedMeshes.length) {
				await new Promise<void>((r) => requestAnimationFrame(() => r()));
			}
		}

		this.group.updateMatrixWorld(true);

		const totalTime = performance.now() - overallStartTime;

		this.reportBuildProgress("Build complete!", 1.0, totalChunks, processedCount);

		// Dispatch completion event
		if (typeof window !== "undefined") {
			setTimeout(() => {
				window.dispatchEvent(
					new CustomEvent("schematicRenderComplete", {
						detail: {
							schematicId: this.id,
							schematicName: this.name,
							totalChunks,
							processedChunks: processedCount,
							buildTimeMs: totalTime,
							meshCount: batchedMeshes.length,
							optimized: true,
							batched: true,
						},
					})
				);
			}, 100);
		}

		console.log(`[PhaseTiming] scene-add: ${(performance.now() - __pt).toFixed(0)}ms`);
		return {
			meshes: batchedMeshes,
			chunkMap: new Map([["batched", batchedMeshes]]),
		};
	}

	public async buildSchematicMeshesInstanced(schematicObject: SchematicObject): Promise<{
		meshes: THREE.Object3D[];
		chunkMap: Map<string, THREE.Object3D[]>;
	}> {
		const overallStartTime = performance.now();

		// Initialize instanced rendering
		await this.worldMeshBuilder.precomputePaletteGeometries(
			this.getPalettes(this.schematicWrapper).default
		);

		this.worldMeshBuilder.enableInstancedRendering(this.group, true);

		// Render entire schematic using instanced rendering
		await this.worldMeshBuilder.renderSchematicInstanced(schematicObject);

		const totalTime = performance.now() - overallStartTime;

		// Return instanced meshes from scene graph
		const instancedMeshes = Array.from(this.group.children);

		// Dispatch completion event
		if (typeof window !== "undefined") {
			window.dispatchEvent(
				new CustomEvent("schematicRenderComplete", {
					detail: {
						schematicId: this.id,
						schematicName: this.name,
						buildTimeMs: totalTime,
						meshCount: instancedMeshes.length,
						optimized: true,
						instanced: true, // Flag for instanced rendering
					},
				})
			);
		}

		return { meshes: instancedMeshes, chunkMap: new Map() };
	}

	/**
	 * Creates or updates the rendering bounds helper visualization
	 */
	private createRenderingBoundsHelper(visible: boolean = true): void {
		// Update the visualizer if it exists
		if (this.renderingBounds.helper) {
			this.group.remove(this.renderingBounds.helper);
		}

		if (visible && this.renderingBounds.enabled) {
			// Create a box to represent the rendering bounds
			const box = new THREE.Box3(
				this.renderingBounds.min.clone().add(new THREE.Vector3(-0.5, -0.5, -0.5)),
				this.renderingBounds.max.clone().add(new THREE.Vector3(-0.5, -0.5, -0.5))
			);

			// Create a box helper to visualize the bounds
			const helper = new THREE.Box3Helper(box, new THREE.Color(0x00ff00));
			this.renderingBounds.helper = helper;
			this.group.add(helper);
		} else {
			this.renderingBounds.helper = undefined;
		}
	}

	/**
	 * Sets the rendering bounds for this schematic
	 * @param min Minimum coordinates for rendering
	 * @param max Maximum coordinates for rendering
	 * @param showHelper Whether to show a visual helper for the bounds
	 */
	public setRenderingBounds(
		min: THREE.Vector3 | number[],
		max: THREE.Vector3 | number[],
		showHelper: boolean = true
	): void {
		// Convert arrays to Vector3 if needed
		if (Array.isArray(min)) {
			min = new THREE.Vector3(min[0], min[1], min[2]);
		}
		if (Array.isArray(max)) {
			max = new THREE.Vector3(max[0], max[1], max[2]);
		}

		// Update the rendering bounds
		this.renderingBounds.min = min.clone();
		this.renderingBounds.max = max.clone();

		// Create/update the visualizer if requested
		this.createRenderingBoundsHelper(showHelper);

		// Rebuild mesh to apply the rendering bounds
		this.rebuildMesh();
	}

	/**
	 * Updates rendering bounds without triggering rebuild - just emits change event
	 */
	private updateRenderingBounds(): void {
		// Just emit change event, don't rebuild automatically
		this.emitPropertyChanged("renderingBounds", {
			min: this.renderingBounds.min.toArray(),
			max: this.renderingBounds.max.toArray(),
			enabled: this.renderingBounds.enabled,
		});
	}

	/**
	 * Shows or hides the rendering bounds helper
	 * @param visible Whether the helper should be visible
	 */
	public showRenderingBoundsHelper(visible: boolean): void {
		this.createRenderingBoundsHelper(visible);
	}

	/**
	 * Resets the rendering bounds to include the full schematic
	 */
	public resetRenderingBounds(): void {
		const dimensions = this.getDimensions();
		this.setRenderingBounds(
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(dimensions[0], dimensions[1], dimensions[2])
		);
	}

	public async getMeshes(): Promise<THREE.Object3D[]> {
		await this.meshesReady;
		return Array.from(this.group.children);
	}

	// Update chunk management methods to handle Object3D
	public getChunkObjectsAt(
		chunkX: number,
		chunkY: number,
		chunkZ: number
	): THREE.Object3D[] | null {
		const key = `${chunkX},${chunkY},${chunkZ}`;
		return this.chunkMeshes.get(key) || null;
	}

	public setChunkObjectsAt(
		chunkX: number,
		chunkY: number,
		chunkZ: number,
		objects: THREE.Object3D[]
	) {
		const key = `${chunkX},${chunkY},${chunkZ}`;
		this.chunkMeshes.set(key, objects);
	}

	// Keep the old method names for backward compatibility
	public getChunkMeshAt(chunkX: number, chunkY: number, chunkZ: number): THREE.Mesh[] | null {
		return this.getChunkObjectsAt(chunkX, chunkY, chunkZ) as THREE.Mesh[] | null;
	}

	public setChunkMeshAt(chunkX: number, chunkY: number, chunkZ: number, meshes: THREE.Mesh[]) {
		this.setChunkObjectsAt(chunkX, chunkY, chunkZ, meshes);
	}

	// Optimized material update method
	private updateMeshMaterials(property: "opacity") {
		const needsTransparency = this.opacity < 1.0;

		this.group.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				const materials = Array.isArray(child.material) ? child.material : [child.material];

				materials.forEach((mat) => {
					if (mat) {
						mat.opacity = this.opacity;
						if (mat instanceof THREE.ShaderMaterial && mat.userData.fluidAlpha !== undefined) {
							mat.uniforms.uAlpha.value = mat.userData.fluidAlpha * this.opacity;
							mat.transparent = needsTransparency || mat.userData.kind === "water";
						} else {
							mat.transparent = needsTransparency || !!mat.userData.surfaceTransparent;
						}
					}
				});
			}
		});
		// Emit event if necessary
		this.emitPropertyChanged("material", { property, value: this.opacity });
	}

	private updateMeshVisibility() {
		this.group.visible = this.visible;
		// Emit event if necessary
		this.emitPropertyChanged("visibility", this.visible);
	}

	public async updateMesh(): Promise<void> {
		return this.enqueueEdit(() => this.updateMeshNow());
	}

	private async updateMeshNow() {
		this.disposeSurfaceResources();
		// Remove old meshes from the scene
		this.meshes.forEach((mesh) => {
			this.group.remove(mesh);
			mesh.geometry.dispose();
			if (Array.isArray(mesh.material)) {
				mesh.material.forEach((material) => material.dispose());
			} else {
				mesh.material.dispose();
			}
		});

		// Clear chunk meshes
		this.chunkMeshes.clear();
		if (this.visible) {
			await this.buildMeshes();
		}
	}

	public async rebuildMesh(): Promise<void> {
		return this.enqueueEdit(() => this.rebuildMeshNow());
	}

	private async rebuildMeshNow() {
		this.disposeSurfaceResources();
		performanceMonitor.startOperation(`rebuildMesh-${this.name}`);

		// Show progress bar if enabled in renderer options
		const renderer = this.sceneManager?.schematicRenderer;
		if (renderer?.options.enableProgressBar && renderer.uiManager) {
			renderer.uiManager.showProgressBar(`Rebuilding ${this.name}`);
			renderer.uiManager.updateProgress(0.1, "Disposing old meshes...");
		}

		// Remove old meshes from the scene. GPU record meshes are NOT disposed: their
		// ShaderMaterials share compiled-program state and template tables with the
		// renderer session, and disposing them corrupted the NEXT build's draw state
		// (second load rendered black with the program never compiling). They are
		// small (records textures) and GC'd with the object graph.
		this.meshes.forEach((mesh) => {
			this.group.remove(mesh as THREE.Object3D);
			if ((mesh as any).userData?.gpuBuilt) return;
			mesh.geometry?.dispose();
			if (Array.isArray(mesh.material)) {
				mesh.material.forEach((material) => material?.dispose());
			} else {
				mesh.material?.dispose();
			}
		});

		// Also clear ALL children from the group, EXCEPT regions
		// Create a copy of children to iterate over safely
		const children = [...this.group.children];
		let removedCount = 0;

		for (const child of children) {
			// Skip regions - regions are parented to the schematic group and have names starting with "region_"
			// We check 'name' because 'id' is an internal three.js integer
			if (child.name && child.name.startsWith("region_")) {
				continue;
			}

			this.group.remove(child);
			removedCount++;
			if (child instanceof THREE.Mesh && !(child as any).userData?.gpuBuilt) {
				// gpuBuilt materials share compiled programs via three's program cache;
				// disposing one destroys the program out from under the NEXT build's
				// identical material (renders nothing, program never recompiles)
				child.geometry?.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((m) => m?.dispose());
				} else {
					child.material?.dispose();
				}
			}
		}

		// Clear chunk meshes and update progress
		this.chunkMeshes.clear();
		this.meshes = [];

		if (renderer?.options.enableProgressBar && renderer.uiManager) {
			renderer.uiManager.updateProgress(0.2, "Building new meshes...");
		}

		// Build new meshes if visible
		if (this.visible) {
			await this.buildMeshes();
		}

		// Hide progress bar when complete
		if (renderer?.options.enableProgressBar && renderer.uiManager) {
			renderer.uiManager.hideProgressBar();
		}

		performanceMonitor.endOperation(`rebuildMesh-${this.name}`);
	}

	public getSchematicWrapper(): SchematicWrapper {
		return this.schematicWrapper;
	}

	public getRegions(): EditableRegionHighlight[] {
		return this.schematicRenderer.regionManager?.getRegionsForSchematic(this.id) || [];
	}

	public getRegion(name: string): EditableRegionHighlight | undefined {
		// First try scoped name
		const scopedName = `${this.id}_${name}`;
		const region = this.schematicRenderer.regionManager?.getRegion(scopedName);
		if (region) return region;

		// Fallback to raw name if user created it manually without scoping
		return this.schematicRenderer.regionManager?.getRegion(name);
	}

	public createRegion(
		name: string,
		min: { x: number; y: number; z: number },
		maxOrOptions?: { x: number; y: number; z: number } | { color?: number; opacity?: number },
		options?: { color?: number; opacity?: number }
	): EditableRegionHighlight {
		const scopedName = `${this.id}_${name}`;

		let max: { x: number; y: number; z: number };
		let finalOptions = options;

		// Check if 3rd argument (maxOrOptions) is a point (has x, y, z)
		if (
			maxOrOptions &&
			typeof maxOrOptions === "object" &&
			"x" in maxOrOptions &&
			"y" in maxOrOptions &&
			"z" in maxOrOptions
		) {
			max = maxOrOptions as { x: number; y: number; z: number };
		} else {
			// It's options or undefined, so default max to min (single block region)
			max = min;
			// If it's defined (options), use it as options
			if (maxOrOptions) {
				finalOptions = maxOrOptions as { color?: number; opacity?: number };
			}
		}

		return this.schematicRenderer.regionManager!.createRegion(
			scopedName,
			min,
			max,
			this.id,
			finalOptions
		);
	}

	// ========================================================================
	// Definition Region Methods
	// ========================================================================

	/**
	 * Track whether definition regions are currently visible for this schematic
	 */
	private _definitionRegionsVisible: boolean = false;

	/**
	 * Whether definition regions from schematic metadata are currently visible
	 */
	public get definitionRegionsVisible(): boolean {
		return this._definitionRegionsVisible;
	}

	/**
	 * Load definition regions from this schematic's metadata.
	 * Definition regions are stored in NucleationDefinitions metadata,
	 * typically created via CircuitBuilder, Insign, or direct API calls.
	 *
	 * @param autoShow - Whether to immediately show the regions (default: true based on renderer options)
	 * @returns Array of created region names
	 */
	public loadDefinitionRegions(autoShow?: boolean): string[] {
		if (!this.schematicRenderer.regionManager) {
			console.warn(
				"[SchematicObject] RegionManager not available, cannot load definition regions."
			);
			return [];
		}

		const shouldShow =
			autoShow ?? this.schematicRenderer.options.definitionRegionOptions?.showOnLoad ?? true;
		const regionNames = this.schematicRenderer.regionManager.loadDefinitionRegionsFromSchematic(
			this.id,
			shouldShow
		);

		this._definitionRegionsVisible = shouldShow && regionNames.length > 0;

		return regionNames;
	}

	/**
	 * Show all definition regions for this schematic
	 */
	public showDefinitionRegions(): void {
		this.schematicRenderer.regionManager?.showDefinitionRegions(this.id);
		this._definitionRegionsVisible = true;
	}

	/**
	 * Hide all definition regions for this schematic
	 */
	public hideDefinitionRegions(): void {
		this.schematicRenderer.regionManager?.hideDefinitionRegions(this.id);
		this._definitionRegionsVisible = false;
	}

	/**
	 * Toggle visibility of all definition regions for this schematic
	 * @returns The new visibility state
	 */
	public toggleDefinitionRegions(): boolean {
		const isVisible =
			this.schematicRenderer.regionManager?.toggleDefinitionRegions(this.id) ?? false;
		this._definitionRegionsVisible = isVisible;
		return isVisible;
	}

	/**
	 * Check if this schematic has any definition regions loaded
	 */
	public hasDefinitionRegions(): boolean {
		return this.schematicRenderer.regionManager?.hasDefinitionRegions(this.id) ?? false;
	}

	/**
	 * Get the names of all definition regions for this schematic
	 */
	public getDefinitionRegionNames(): string[] {
		// First get regions from schematic wrapper metadata
		const metadataRegions = this.schematicWrapper.getDefinitionRegionNames();
		return Array.from(metadataRegions);
	}

	/**
	 * Get a definition region by its original name (from schematic metadata).
	 * Returns the EditableRegionHighlight if loaded, or undefined.
	 */
	public getDefinitionRegion(name: string): EditableRegionHighlight | undefined {
		const scopedName = `${this.id}_defRegion_${name}`;
		return this.schematicRenderer.regionManager?.getRegion(scopedName);
	}

	/**
	 * Remove all loaded definition regions for this schematic
	 */
	public removeDefinitionRegions(): void {
		this.schematicRenderer.regionManager?.removeDefinitionRegions(this.id);
		this._definitionRegionsVisible = false;
	}

	/**
	 * Creates a callable JavaScript function from this schematic using region-based IO.
	 * This allows you to treat the schematic as a black-box function in JS.
	 *
	 * @param inputs List of input definitions
	 * @param outputs List of output definitions
	 * @returns A callable object to run the circuit
	 */
	public createCircuitFunction(
		inputs: Array<{
			name: string;
			bits: number;
			region:
				| { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
				| string
				| DefinitionRegionWrapper;
			signed?: boolean;
			mode?: "binary" | "signal";
			blockFilter?: string | string[];
			sort?: string | SortStrategyWrapper;
		}>,
		outputs: Array<{
			name: string;
			bits: number;
			region:
				| { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
				| string
				| DefinitionRegionWrapper;
			signed?: boolean;
			mode?: "binary" | "signal";
			blockFilter?: string | string[];
			sort?: string | SortStrategyWrapper;
		}>
	) {
		// Dynamic import to avoid circular dependencies if any, and access the exported builders
		// We use the schematicWrapper instance we already have

		// 1. Build the Circuit using CircuitBuilderWrapper
		// This uses the new high-level API which handles layout building and executor creation
		let builder = new CircuitBuilderWrapper(this.schematicWrapper);

		// Helper to resolve region
		const resolveRegion = (
			region:
				| { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
				| string
				| DefinitionRegionWrapper,
			filters?: string | string[]
		) => {
			let defRegion: DefinitionRegionWrapper;

			if (region instanceof DefinitionRegionWrapper) {
				defRegion = region;
			} else if (typeof region === "string") {
				// Try using getRegion to handle scoping automatically
				const regionObj = this.getRegion(region);
				if (!regionObj) {
					throw new Error(`Region '${region}' not found in RegionManager`);
				}
				// Use the region's native conversion method, passing the schematic for filtering
				defRegion = regionObj.toDefinitionRegion(this.schematicWrapper);
			} else {
				// It's a simple bounds object
				defRegion = DefinitionRegionWrapper.fromBounds(
					new BlockPosition(region.min.x, region.min.y, region.min.z),
					new BlockPosition(region.max.x, region.max.y, region.max.z)
				);
			}

			// Apply additional filters from arguments if provided
			// Note: If the region itself already applied filters (in toDefinitionRegion),
			// these will be applied ON TOP (intersection or union depending on intent, here usually filtering further)
			// But actually, toDefinitionRegion returns the filtered points.
			// filterByBlock returns a subset. So applying another filterByBlock intersects.

			// However, the previous logic was: if filters provided, filter the box.
			// Now: if region has internal filters, it returns filtered points.
			// If we also provide filters here, we probably want to apply them too.

			if (filters) {
				const filterList = Array.isArray(filters) ? filters : [filters];
				if (filterList.length > 0) {
					// Apply first filter
					const filteredRegion = defRegion.filterByBlock(this.schematicWrapper, filterList[0]);

					// Apply subsequent filters and union results (OR logic)
					for (let i = 1; i < filterList.length; i++) {
						const nextFiltered = defRegion.filterByBlock(this.schematicWrapper, filterList[i]);
						filteredRegion.unionInto(nextFiltered);
						nextFiltered.free();
					}

					// If defRegion was created locally or returned new from toDefinitionRegion, we should free it
					if (!(region instanceof DefinitionRegionWrapper)) {
						defRegion.free();
					}

					defRegion = filteredRegion;
				}
			}

			return defRegion;
		};

		// Helper to resolve sort strategy
		const resolveSort = (sort?: string | SortStrategyWrapper): SortStrategyWrapper | undefined => {
			if (!sort) return undefined;
			if (sort instanceof SortStrategyWrapper) return sort;
			if (typeof sort === "string") {
				return SortStrategyWrapper.fromString(sort);
			}
			return undefined;
		};

		// Add Inputs
		for (const input of inputs) {
			// If using signal mode (packed4), force bits to be at least 4 to match layout expectations
			const effectiveBits = input.mode === "signal" && input.bits < 4 ? 4 : input.bits;

			const type = input.signed
				? IoTypeWrapper.signedInt(effectiveBits)
				: IoTypeWrapper.unsignedInt(effectiveBits);

			const region = resolveRegion(input.region, input.blockFilter);
			const sortStrategy = resolveSort(input.sort);

			if (input.mode === "signal") {
				const layout = LayoutFunctionWrapper.packed4();
				if (sortStrategy) {
					builder = builder.withInputSorted(input.name, type, layout, region, sortStrategy);
				} else {
					builder = builder.withInput(input.name, type, layout, region);
				}
			} else {
				// Use Auto for default/binary mode
				if (sortStrategy) {
					builder = builder.withInputAutoSorted(input.name, type, region, sortStrategy);
				} else {
					builder = builder.withInputAuto(input.name, type, region);
				}
			}
		}

		// Add Outputs
		for (const output of outputs) {
			// If using signal mode (packed4), force bits to be at least 4 to match layout expectations
			const effectiveBits = output.mode === "signal" && output.bits < 4 ? 4 : output.bits;

			const type = output.signed
				? IoTypeWrapper.signedInt(effectiveBits)
				: IoTypeWrapper.unsignedInt(effectiveBits);

			const region = resolveRegion(output.region, output.blockFilter);
			const sortStrategy = resolveSort(output.sort);

			if (output.mode === "signal") {
				const layout = LayoutFunctionWrapper.packed4();
				if (sortStrategy) {
					builder = builder.withOutputSorted(output.name, type, layout, region, sortStrategy);
				} else {
					builder = builder.withOutput(output.name, type, layout, region);
				}
			} else {
				// Use Auto for default/binary mode
				if (sortStrategy) {
					builder = builder.withOutputAutoSorted(output.name, type, region, sortStrategy);
				} else {
					builder = builder.withOutputAuto(output.name, type, region);
				}
			}
		}

		// Build directly to executor
		const executor = builder.build();

		// 4. Return the Interface
		return {
			run: (
				inputValues: Record<string, number | boolean>,
				maxTicks = 1000,
				mode: "stable" | "fixed" = "stable"
			) => {
				// Sanitize inputs: Convert booleans to numbers (1/0)
				const sanitizedInputs: Record<string, number> = {};
				for (const [key, val] of Object.entries(inputValues)) {
					sanitizedInputs[key] = typeof val === "boolean" ? (val ? 1 : 0) : val;
				}

				let executionMode;
				if (mode === "fixed") {
					executionMode = ExecutionModeWrapper.fixedTicks(maxTicks);
				} else {
					executionMode = ExecutionModeWrapper.untilStable(2, maxTicks);
				}

				const result = executor.execute(sanitizedInputs, executionMode);
				return result;
			},
			reset: () => executor.reset(),
			sync: async () => {
				const updatedSchematic = executor.syncToSchematic();
				// Update the wrapper reference to the new state
				this.schematicWrapper = updatedSchematic;
				// Rebuild visuals
				await this.rebuildMesh();
				// Return the current outputs for convenience
				// Note: This requires polling the outputs again from the executor if we want the latest values
				// But since syncToSchematic consumes the simulation state, we might not be able to query outputs directly afterwards
				// unless we re-create the executor or if syncToSchematic keeps the simulation alive.
				// Based on mchprs logic, sync usually updates the schematic data.
			},
			executor,
		};
	}

	private getPalettes(schematic: SchematicWrapper): any {
		// Safety check for get_all_palettes
		if (typeof schematic.get_all_palettes === "function") {
			return schematic.get_all_palettes();
		}

		console.warn("[SchematicObject] get_all_palettes missing, falling back to get_palette");

		// Fallback to get_palette
		if (typeof schematic.get_palette === "function") {
			return { default: schematic.get_palette() };
		}

		console.error("[SchematicObject] Both get_all_palettes and get_palette are missing!");
		return { default: [] };
	}

	public getBlockEntitiesMap(): Map<string, any> {
		if (this.blockEntitiesMap === null) {
			this.blockEntitiesMap = new Map();
			const entities = this.schematicWrapper.get_all_block_entities() || [];
			for (const entity of entities) {
				if (entity && entity.position && entity.position.length === 3) {
					const key = `${entity.position[0]},${entity.position[1]},${entity.position[2]}`;
					this.blockEntitiesMap.set(key, entity);
				}
			}
		}
		return this.blockEntitiesMap;
	}

	public async setBlockNoRebuild(position: THREE.Vector3 | number[], blockType: string) {
		// performanceMonitor.startOperation("setBlockNoRebuild"); // Too much overhead for bulk operations
		if (Array.isArray(position)) {
			position = new THREE.Vector3(position[0], position[1], position[2]);
		}

		this.schematicWrapper.set_block(position.x, position.y, position.z, blockType);

		// Invalidate cached dimensions since we modified the schematic
		this._cachedDimensions = null;
		this.blockEntitiesMap = null;

		// performanceMonitor.endOperation("setBlockNoRebuild");
	}

	public async setBlockWithNbt(
		position: THREE.Vector3 | number[],
		blockType: string,
		nbtData: Record<string, string>
	) {
		performanceMonitor.startOperation("setBlockWithNbt");
		if (Array.isArray(position)) {
			position = new THREE.Vector3(position[0], position[1], position[2]);
		}

		this.schematicWrapper.setBlockWithNbt(position.x, position.y, position.z, blockType, nbtData);
		performanceMonitor.endOperation("setBlockWithNbt");
	}

	/**
	 * Compiles Insign annotations from sign blocks in the schematic
	 * @returns Raw Insign data (DslMap) or null if compilation fails
	 */
	public compileInsign(): any {
		try {
			return this.schematicWrapper.compileInsign();
		} catch (e) {
			console.warn("[SchematicObject] Insign compilation failed:", e);
			return null;
		}
	}

	private enqueueEdit<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.editQueue.then(async () => {
			try {
				await this.meshesReady;
			} catch {
				// Wait for the initial build to settle without blocking recovery operations.
				// Its original promise still reports the failure to initial-build callers.
			}
			return operation();
		});
		this.editQueue = run.then(
			() => {},
			() => {}
		);
		return run;
	}

	public async setBlock(position: THREE.Vector3 | number[], blockType: string) {
		return this.setBlocks([[position, blockType]]);
	}

	public async setBlocks(blocks: [THREE.Vector3 | number[], string][]): Promise<void> {
		if (!blocks.length) return;
		const updates = blocks.map(
			([point, state]) =>
				[
					Array.isArray(point)
						? new THREE.Vector3(...(point as [number, number, number]))
						: point.clone(),
					state,
				] as const
		);
		// Serialize edits so async texture preparation cannot apply an older edit last.
		return this.enqueueEdit(async () => {
			let surfacesChanged = false,
				surfaceOnly = true;
			const positions: THREE.Vector3[] = [];
			for (const [point, blockType] of updates) {
				const position = point;
				const old =
					this.schematicWrapper.get_block_string(position.x, position.y, position.z) || "";
				surfacesChanged ||= isSurfaceBlock(old) || isSurfaceBlock(blockType);
				surfaceOnly &&= this.isSurfaceOnlyState(old) && this.isSurfaceOnlyState(blockType);
				await this.setBlockNoRebuild(position, blockType);
				positions.push(position);
			}
			if (surfacesChanged && surfaceOnly) {
				await this.refreshSurfaceCells(positions);
				return;
			}
			// Opaque or waterlogged transitions also change the main mesher's geometry.
			// Global batches cannot be replaced with a single incremental chunk safely.
			const mode = this.schematicRenderer.options.meshBuildingMode || "incremental";
			if (surfacesChanged || !["immediate", "incremental"].includes(mode)) {
				await this.rebuildMeshNow();
				return;
			}
			const chunks = new Set(
				positions.map((p) => {
					const c = this.getChunkCoordinates(p);
					return `${c.x},${c.y},${c.z}`;
				})
			);
			for (const key of chunks) {
				const [x, y, z] = key.split(",").map(Number);
				await this.rebuildChunk(x, y, z);
			}
			this.schematicRenderer.invalidate();
		});
	}

	public async copyRegionFromSchematic(
		sourceSchematicName: string,
		sourceMin?: THREE.Vector3 | number[],
		sourceMax?: THREE.Vector3 | number[],
		targetPosition?: THREE.Vector3 | number[],
		excludeBlocks?: string[],
		rebuild: boolean = false
	) {
		const sourceSchematic =
			this.sceneManager?.schematicRenderer?.schematicManager?.getSchematic(sourceSchematicName);
		if (!sourceSchematic) {
			throw new Error(`Schematic ${sourceSchematicName} not found`);
		}
		if (Array.isArray(sourceMin)) {
			sourceMin = new THREE.Vector3(sourceMin[0], sourceMin[1], sourceMin[2]);
		}
		if (Array.isArray(sourceMax)) {
			sourceMax = new THREE.Vector3(sourceMax[0], sourceMax[1], sourceMax[2]);
		}
		if (Array.isArray(targetPosition)) {
			targetPosition = new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2]);
		}

		const sourceDimensions = sourceSchematic.getDimensions();

		if (!sourceMin) {
			sourceMin = new THREE.Vector3(0, 0, 0);
		}
		if (!sourceMax) {
			sourceMax = new THREE.Vector3(
				sourceDimensions[0] - 1,
				sourceDimensions[1] - 1,
				sourceDimensions[2] - 1
			);
		}

		if (!targetPosition) {
			targetPosition = new THREE.Vector3(0, 0, 0);
		}

		if (!excludeBlocks) {
			excludeBlocks = [];
		}

		await this.schematicWrapper.copy_region(
			sourceSchematic.schematicWrapper,
			sourceMin.x,
			sourceMin.y,
			sourceMin.z,
			sourceMax.x,
			sourceMax.y,
			sourceMax.z,
			targetPosition.x,
			targetPosition.y,
			targetPosition.z,
			excludeBlocks
		);

		if (rebuild) {
			await this.rebuildMesh();
		}
	}

	// ==== block inspector support (viewer features) ====
	/** Set when the current build came from the GPU path (enables hide-and-rebuild;
	 *  the grid itself is NOT retained — hide re-extracts it, saving sx*sy*sz*4 bytes) */
	public gpuBuilt = false;
	/** Schematic-space cells hidden via the inspector ("x,y,z"); applied on GPU rebuilds */
	public hiddenCells = new Set<string>();

	private applyHiddenCells(grid: Uint32Array, sx: number, sy: number, sz: number): void {
		if (this.hiddenCells.size === 0) return;
		for (const key of this.hiddenCells) {
			const [x, y, z] = key.split(",").map(Number);
			if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) grid[(y * sz + z) * sx + x] = 0;
		}
	}

	/** Surface-only inspector edits replace their affected sections in every build mode. */
	public async hideBlockAndRebuild(x: number, y: number, z: number): Promise<boolean> {
		return this.enqueueEdit(async () => {
			const state = this.schematicWrapper.get_block_string(x, y, z) || "";
			if (!this.gpuBuilt && !isSurfaceBlock(state)) return false;
			this.hiddenCells.add(`${x},${y},${z}`);
			if (isSurfaceBlock(state) && this.isSurfaceOnlyState(state)) {
				await this.refreshSurfaceCells([new THREE.Vector3(x, y, z)]);
				return true;
			}
			return this.rebuildAfterEdit();
		});
	}

	public async unhideAllBlocks(): Promise<boolean> {
		return this.enqueueEdit(async () => {
			if (!this.hiddenCells.size) return false;
			const positions = [...this.hiddenCells].map(
				(key) => new THREE.Vector3(...(key.split(",").map(Number) as [number, number, number]))
			);
			const surfaceOnly = positions.every(({ x, y, z }) => {
				const state = this.schematicWrapper.get_block_string(x, y, z) || "";
				return isSurfaceBlock(state) && this.isSurfaceOnlyState(state);
			});
			this.hiddenCells.clear();
			if (surfaceOnly) {
				await this.refreshSurfaceCells(positions);
				return true;
			}
			return this.rebuildAfterEdit();
		});
	}

	private async rebuildAfterEdit(): Promise<boolean> {
		// Use the normal lifecycle: replace surfaces, fluids and tracked mesh lists too.
		await this.rebuildMeshNow();
		this.schematicRenderer.invalidate();
		return true;
	}

	public getBlock(position: THREE.Vector3 | number[]): string | undefined {
		if (Array.isArray(position)) {
			position = new THREE.Vector3(position[0], position[1], position[2]);
		}
		return this.schematicWrapper.get_block(position.x, position.y, position.z);
	}

	public debugBlock(position: THREE.Vector3 | { x: number; y: number; z: number }) {
		const x = Math.floor(position.x);
		const y = Math.floor(position.y);
		const z = Math.floor(position.z);

		console.log(`🔍 Debug Block at (${x}, ${y}, ${z}):`);
		const blockType = this.schematicWrapper.get_block(x, y, z);
		console.log(`Type: ${blockType}`);

		try {
			// @ts-ignore
			const blockState = this.schematicWrapper.get_block_with_properties?.(x, y, z);
			if (blockState) {
				console.log(`Properties:`, blockState.properties());
			}
		} catch (e) {
			console.warn("Could not get block properties:", e);
		}

		try {
			const sim = this.schematicWrapper.create_simulation_world();
			console.log(`Redstone Power: ${sim.get_redstone_power(x, y, z)}`);
			// @ts-ignore
			if (sim.is_lit) {
				// @ts-ignore
				console.log(`Is Lit: ${sim.is_lit(x, y, z)}`);
			}
			sim.free();
		} catch (e) {
			console.warn("Could not check simulation state:", e);
		}
	}

	public async replaceBlock(replaceBlock: string, newBlock: string) {
		const blocks: [THREE.Vector3, string][] = [];
		const dimensions = this.getDimensions();
		for (let x = 0; x < dimensions[0]; x++) {
			for (let y = 0; y < dimensions[1]; y++) {
				for (let z = 0; z < dimensions[2]; z++) {
					const block = this.schematicWrapper.get_block(x, y, z);
					if (block === replaceBlock) {
						blocks.push([new THREE.Vector3(x, y, z), newBlock]);
					}
				}
			}
		}
		await this.setBlocks(blocks);
	}

	public async addCube(
		position: THREE.Vector3 | number[],
		size: THREE.Vector3 | number[],
		blockType: string
	): Promise<SchematicObject> {
		if (Array.isArray(position)) {
			position = new THREE.Vector3(position[0], position[1], position[2]);
		}
		if (Array.isArray(size)) {
			size = new THREE.Vector3(size[0], size[1], size[2]);
		}

		const blocks: [THREE.Vector3, string][] = [];
		for (let x = 0; x < size.x; x++) {
			for (let y = 0; y < size.y; y++) {
				for (let z = 0; z < size.z; z++) {
					blocks.push([position.clone().add(new THREE.Vector3(x, y, z)), blockType]);
				}
			}
		}

		await this.setBlocks(blocks);
		return this;
	}

	public async rebuildChunkAtPosition(position: THREE.Vector3) {
		const chunkCoords = this.getChunkCoordinates(position);
		await this.rebuildChunk(chunkCoords.x, chunkCoords.y, chunkCoords.z);
	}

	public rebuildAllChunks(): void {
		// Rebuild all chunks by triggering a full mesh rebuild
		this.rebuildMesh();
	}

	private getChunkCoordinates(position: THREE.Vector3): {
		x: number;
		y: number;
		z: number;
	} {
		return {
			x: Math.floor(position.x / this.chunkDimensions.chunkWidth),
			y: Math.floor(position.y / this.chunkDimensions.chunkHeight),
			z: Math.floor(position.z / this.chunkDimensions.chunkLength),
		};
	}

	public async rebuildChunk(chunkX: number, chunkY: number, chunkZ: number) {
		const chunkOffset = {
			x: chunkX * this.chunkDimensions.chunkWidth,
			y: chunkY * this.chunkDimensions.chunkHeight,
			z: chunkZ * this.chunkDimensions.chunkLength,
		};

		// Check if chunk is outside rendering bounds - if so, just remove it
		if (this.renderingBounds) {
			const chunkMaxX = chunkOffset.x + this.chunkDimensions.chunkWidth;
			const chunkMaxY = chunkOffset.y + this.chunkDimensions.chunkHeight;
			const chunkMaxZ = chunkOffset.z + this.chunkDimensions.chunkLength;

			// If the chunk is completely outside rendering bounds, just remove it
			if (
				chunkMaxX <= this.renderingBounds.min.x ||
				chunkOffset.x >= this.renderingBounds.max.x ||
				chunkMaxY <= this.renderingBounds.min.y ||
				chunkOffset.y >= this.renderingBounds.max.y ||
				chunkMaxZ <= this.renderingBounds.min.z ||
				chunkOffset.z >= this.renderingBounds.max.z
			) {
				this.removeChunkObjects(chunkX, chunkY, chunkZ);
				return;
			}
		}

		// Use WASM optimization to get both blocks and pre-filtered entities
		// Cast to any as TS definitions might not be up to date immediately
		let chunkData: any;
		let blocks: any[];
		let entities: any[] | undefined;

		// Check if the new method exists (it should with nucleation 0.1.116)
		if ((this.schematicWrapper as any).getChunkData) {
			chunkData = (this.schematicWrapper as any).getChunkData(
				chunkX,
				chunkY,
				chunkZ,
				this.chunkDimensions.chunkWidth,
				this.chunkDimensions.chunkHeight,
				this.chunkDimensions.chunkLength
			);
			blocks = chunkData.blocks;
			entities = chunkData.entities;
		} else {
			// Fallback for older versions
			blocks = this.schematicWrapper.get_chunk_blocks_indices(
				chunkOffset.x,
				chunkOffset.y,
				chunkOffset.z,
				this.chunkDimensions.chunkWidth,
				this.chunkDimensions.chunkHeight,
				this.chunkDimensions.chunkLength
			);
		}

		// Remove old chunk objects from the scene
		this.removeChunkObjects(chunkX, chunkY, chunkZ);

		// Build new chunk objects using the optimized format
		const newChunkObjects = await this.worldMeshBuilder.getChunkMesh(
			{
				blocks: blocks, // This is already in format: [[x,y,z,paletteIndex],...]
				chunk_x: chunkX,
				chunk_y: chunkY,
				chunk_z: chunkZ,
			},
			this,
			this.renderingBounds,
			entities // Pass pre-filtered entities if available
		);

		// Apply properties to the new objects
		this.applyPropertiesToObjects(newChunkObjects);

		newChunkObjects.forEach((obj) => {
			this.group.add(obj);
		});

		// Update the chunk object reference in chunkMeshes map
		this.setChunkObjectsAt(chunkX, chunkY, chunkZ, newChunkObjects);
	}

	private removeChunkObjects(chunkX: number, chunkY: number, chunkZ: number) {
		const oldChunkObjects = this.getChunkObjectsAt(chunkX, chunkY, chunkZ);
		if (oldChunkObjects) {
			oldChunkObjects.forEach((obj) => {
				this.group.remove(obj);
				// Dispose of geometries and materials within the object
				obj.traverse((child) => {
					if (child instanceof THREE.Mesh && !(child as any).userData?.gpuBuilt) {
						child.geometry?.dispose();
						if (Array.isArray(child.material)) {
							child.material.forEach((material) => material.dispose());
						} else {
							child.material?.dispose();
						}
					}
				});
			});
			this.chunkMeshes.delete(`${chunkX},${chunkY},${chunkZ}`);
		}
	}

	public containsPosition(position: THREE.Vector3): boolean {
		// Calculate the bounds of the schematic
		const dimensions = this.getDimensions();
		const min = this.position.clone();
		const max = min
			.clone()
			.add(new THREE.Vector3(dimensions[0], dimensions[1], dimensions[2]).multiply(this.scale));

		return (
			position.x >= min.x &&
			position.x <= max.x &&
			position.y >= min.y &&
			position.y <= max.y &&
			position.z >= min.z &&
			position.z <= max.z
		);
	}

	public getSchematicCenter(): THREE.Vector3 {
		const box = this.getTightWorldBox();
		return box.getCenter(new THREE.Vector3());
	}

	/**
	 * Get the world-space bounding box of the schematic's actual block content
	 */
	public getTightWorldBox(): THREE.Box3 {
		const tightMin = this.getTightBoundsMin();
		const tightDimensions = this.getTightDimensions();
		const hasTightBounds =
			tightMin !== null &&
			tightDimensions[0] > 0 &&
			tightDimensions[1] > 0 &&
			tightDimensions[2] > 0;

		const box = new THREE.Box3();
		if (hasTightBounds) {
			box.min.set(tightMin[0], tightMin[1], tightMin[2]);
			box.max.set(
				tightMin[0] + tightDimensions[0],
				tightMin[1] + tightDimensions[1],
				tightMin[2] + tightDimensions[2]
			);
		} else {
			const dims = this.getDimensions();
			box.min.set(0, 0, 0);
			box.max.set(dims[0], dims[1], dims[2]);
		}

		// Apply the group's transform
		this.group.updateMatrixWorld(true);
		box.applyMatrix4(this.group.matrixWorld);

		return box;
	}

	public centerInScene() {
		const averagePosition = this.getSchematicCenter();
		const newSchematicPosition = new THREE.Vector3(
			this.position.x - averagePosition.x,
			this.position.y - averagePosition.y,
			this.position.z - averagePosition.z
		);
		this.position.copy(newSchematicPosition);
		this.updateTransform();
	}

	public centerInScenePlane() {
		const averagePosition = this.getSchematicCenter();
		const newSchematicPosition = new THREE.Vector3(
			this.position.x - averagePosition.x,
			0,
			this.position.z - averagePosition.z
		);
		this.position.copy(newSchematicPosition);
		this.updateTransform();
	}

	public setPosition(position: THREE.Vector3 | number[]): void {
		if (Array.isArray(position)) {
			this.position = new THREE.Vector3(position[0], position[1], position[2]);
			this.updateTransform();
			return;
		}
		this.position = position;
		this.updateTransform();
	}

	public setRotation(rotation: THREE.Euler | number[]): void {
		if (Array.isArray(rotation)) {
			this.rotation = new THREE.Euler(rotation[0], rotation[1], rotation[2]);
			return;
		}
		this.rotation = rotation;
	}

	public setScale(scale: THREE.Vector3 | number[]): void {
		if (Array.isArray(scale)) {
			this.scale = new THREE.Vector3(scale[0], scale[1], scale[2]);
			return;
		}
		this.scale = scale;
	}

	public getWorldPosition(): THREE.Vector3 {
		return this.group.getWorldPosition(new THREE.Vector3());
	}

	public getBoundingBox(): [number[], number[]] {
		// Get the actual world-space bounds after centering
		this.group.updateMatrixWorld();
		const box = new THREE.Box3().setFromObject(this.group);

		const min = [box.min.x, box.min.y, box.min.z];
		const max = [box.max.x, box.max.y, box.max.z];

		return [min, max];
	}

	// Optimized getAllBlocks method with optional filtering
	public getAllBlocks(filter?: (block: BlockData) => boolean): BlockData[] {
		const dimensions = this.getDimensions();
		const blocks: BlockData[] = [];

		for (let x = 0; x < dimensions[0]; x++) {
			for (let y = 0; y < dimensions[1]; y++) {
				for (let z = 0; z < dimensions[2]; z++) {
					const blockName = this.schematicWrapper.get_block(x, y, z);
					if (blockName && blockName !== "minecraft:air") {
						// Get block properties using the correct method name
						let properties = {};
						try {
							const blockWithProps = this.schematicWrapper.get_block_with_properties?.(x, y, z);
							if (blockWithProps) {
								// Extract properties from BlockStateWrapper if available
								properties = blockWithProps.properties || {};
							}
						} catch (error) {
							// Fallback to empty properties if method doesn't exist or fails
							properties = {};
						}

						const blockData: BlockData = {
							x,
							y,
							z,
							name: blockName,
							properties: properties,
							chunk_x: Math.floor(x / this.chunkDimensions.chunkWidth),
							chunk_y: Math.floor(y / this.chunkDimensions.chunkHeight),
							chunk_z: Math.floor(z / this.chunkDimensions.chunkLength),
							stateKey: `${blockName}${
								Object.keys(properties).length > 0
									? `[${Object.entries(properties)
											.map(([k, v]) => `${k}=${v}`)
											.join(",")}]`
									: ""
							}`, // Generate stateKey
						};

						// Apply filter if provided
						if (!filter || filter(blockData)) {
							blocks.push(blockData);
						}
					}
				}
			}
		}

		return blocks;
	}

	/**
	 * Creates an object with properties and methods for easily manipulating rendering bounds
	 * Useful for console manipulation and testing
	 * @returns Settings object with properties and methods
	 */
	public createBoundsControls(): any {
		const dimensions = this.getDimensions();
		const [width, height, depth] = dimensions;

		const settings = {
			minX: this.renderingBounds.min.x,
			maxX: this.renderingBounds.max.x,
			minY: this.renderingBounds.min.y,
			maxY: this.renderingBounds.max.y,
			minZ: this.renderingBounds.min.z,
			maxZ: this.renderingBounds.max.z,

			// Apply a specific axis
			applyX: () => {
				const min = this.renderingBounds.min.clone();
				const max = this.renderingBounds.max.clone();
				min.x = settings.minX;
				max.x = settings.maxX;
				this.setRenderingBounds(min, max);
				return `X axis bounds set to [${settings.minX}, ${settings.maxX}]`;
			},

			applyY: () => {
				const min = this.renderingBounds.min.clone();
				const max = this.renderingBounds.max.clone();
				min.y = settings.minY;
				max.y = settings.maxY;
				this.setRenderingBounds(min, max);
				return `Y axis bounds set to [${settings.minY}, ${settings.maxY}]`;
			},

			applyZ: () => {
				const min = this.renderingBounds.min.clone();
				const max = this.renderingBounds.max.clone();
				min.z = settings.minZ;
				max.z = settings.maxZ;
				this.setRenderingBounds(min, max);
				return `Z axis bounds set to [${settings.minZ}, ${settings.maxZ}]`;
			},

			// Apply all axes
			applyAll: () => {
				this.setRenderingBounds(
					[settings.minX, settings.minY, settings.minZ],
					[settings.maxX, settings.maxY, settings.maxZ]
				);
				return `All bounds set to min:[${settings.minX}, ${settings.minY}, ${settings.minZ}], max:[${settings.maxX}, ${settings.maxY}, ${settings.maxZ}]`;
			},

			// Reset to full dimensions
			reset: () => {
				this.resetRenderingBounds();
				// Update local settings to match
				settings.minX = 0;
				settings.maxX = width;
				settings.minY = 0;
				settings.maxY = height;
				settings.minZ = 0;
				settings.maxZ = depth;
				return `Reset rendering bounds to full dimensions: [${width}, ${height}, ${depth}]`;
			},

			// Toggle helper visibility
			toggleHelper: (visible = true) => {
				this.showRenderingBoundsHelper(visible);
				return `Rendering bounds helper ${visible ? "shown" : "hidden"}`;
			},

			// Get current bounds
			getCurrentBounds: () => {
				return {
					min: this.renderingBounds.min.toArray(),
					max: this.renderingBounds.max.toArray(),
				};
			},

			// Sync from current bounds
			syncFromCurrent: () => {
				settings.minX = this.renderingBounds.min.x;
				settings.maxX = this.renderingBounds.max.x;
				settings.minY = this.renderingBounds.min.y;
				settings.maxY = this.renderingBounds.max.y;
				settings.minZ = this.renderingBounds.min.z;
				settings.maxZ = this.renderingBounds.max.z;
				return "Settings synchronized with current bounds";
			},

			// Slice from one side (useful for slider UI)
			sliceX: (value: number) => {
				settings.maxX = value;
				return settings.applyX();
			},

			sliceY: (value: number) => {
				settings.maxY = value;
				return settings.applyY();
			},

			sliceZ: (value: number) => {
				settings.maxZ = value;
				return settings.applyZ();
			},
		};

		return settings;
	}
}
