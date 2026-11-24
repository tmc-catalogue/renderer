import * as THREE from "three";
import type { ProcessedBlockGeometry } from "../types";
import type { GetBlock } from "./WaterMesher";
import type { SurfaceCell } from "./SurfaceIndex";
import { installSurfaceSorting } from "./SurfaceSorting";

const EPS = 1e-4;
const baseName = (state: string) => state.split("[")[0].replace(/^minecraft:/, "");

export function isGlass(state: string): boolean {
	return /^(glass|glass_pane|tinted_glass|[a-z_]+_stained_glass(?:_pane)?)$/.test(baseName(state));
}

export function isSurfaceBlock(state: string): boolean {
	return isGlass(state) || /^(nether_portal|end_portal)$/.test(baseName(state));
}

export interface SurfaceFace {
	positions: THREE.Vector3[];
	uvs: THREE.Vector2[];
	normal: THREE.Vector3;
	box: THREE.Box3;
	texture: string;
}

/** Keep the resource pack's geometry, rotations, pane arms, and face UVs. */
export function surfaceFaces(parts: ProcessedBlockGeometry[]): SurfaceFace[] {
	const faces: SurfaceFace[] = [];
	for (const { geometry, material } of parts) {
		if (material.userData.isWater || material.userData.isLava) continue;
		const p = geometry.getAttribute("position");
		const uv = geometry.getAttribute("uv");
		if (!p || !uv) continue;
		const rect = material.userData.atlasUV;
		const count = geometry.index?.count ?? p.count;
		for (let start = 0; start + 5 < count; start += 6) {
			const positions: THREE.Vector3[] = [];
			const uvs: THREE.Vector2[] = [];
			for (let k = 0; k < 6; k++) {
				const i = geometry.index?.getX(start + k) ?? start + k;
				positions.push(new THREE.Vector3().fromBufferAttribute(p, i));
				const tex = new THREE.Vector2(uv.getX(i), uv.getY(i));
				if (rect)
					tex.set(
						(tex.x - rect.u) / rect.width,
						(tex.y - (1 - rect.v - rect.height)) / rect.height
					);
				uvs.push(tex);
			}
			const normal = positions[1]
				.clone()
				.sub(positions[0])
				.cross(positions[2].clone().sub(positions[0]))
				.normalize();
			faces.push({
				positions,
				uvs,
				normal,
				box: new THREE.Box3().setFromPoints(positions),
				texture: material.userData.texturePath,
			});
		}
	}
	return faces;
}

function contains(face: SurfaceFace, point: THREE.Vector3): boolean {
	return (
		point.x >= face.box.min.x - EPS &&
		point.x <= face.box.max.x + EPS &&
		point.y >= face.box.min.y - EPS &&
		point.y <= face.box.max.y + EPS &&
		point.z >= face.box.min.z - EPS &&
		point.z <= face.box.max.z + EPS
	);
}

interface FaceInfo {
	offset: THREE.Vector3;
	probes: Array<{ point: THREE.Vector3; offset: THREE.Vector3 }>;
	hidden: WeakMap<SurfaceFace[], boolean>;
	connected: WeakMap<SurfaceFace[], number>;
	vertices: number[];
	indices: number[];
}
const faceInfo = new WeakMap<SurfaceFace, FaceInfo>();

/** Geometry-dependent work is done once per template, never per placed block. */
function prepareFace(face: SurfaceFace): FaceInfo {
	const cached = faceInfo.get(face);
	if (cached) return cached;
	const center = face.box.getCenter(new THREE.Vector3());
	const edgePoint = (axis: "x" | "y", high: boolean) => {
		const values = face.uvs.map((uv) => uv[axis]);
		const target = high ? Math.max(...values) : Math.min(...values);
		return new THREE.Box3()
			.setFromPoints(face.positions.filter((_, i) => Math.abs(values[i] - target) < EPS))
			.getCenter(new THREE.Vector3());
	};
	const edges = [
		edgePoint("x", false),
		edgePoint("x", true),
		edgePoint("y", false),
		edgePoint("y", true),
	];
	const points = [
		...edges,
		...[
			[0, 2],
			[1, 2],
			[0, 3],
			[1, 3],
		].map(([a, b]) => edges[a].clone().add(edges[b]).sub(center)),
	];
	const probes = points.map((point) => {
		const p = point.clone().add(
			point
				.clone()
				.sub(center)
				.normalize()
				.multiplyScalar(EPS * 4)
		);
		const offset = p.clone().addScalar(0.5).floor();
		for (const axis of ["x", "y", "z"] as const)
			if (Math.abs(face.normal[axis]) > 0.999) offset[axis] = 0;
		return { point: p.sub(offset), offset };
	});
	const vertices: number[] = [],
		indices: number[] = [];
	for (let k = 0; k < 6; k++) {
		let i = vertices.findIndex(
			(v) => face.positions[v].equals(face.positions[k]) && face.uvs[v].equals(face.uvs[k])
		);
		if (i < 0) {
			i = vertices.length;
			vertices.push(k);
		}
		indices.push(i);
	}
	const info = {
		offset: face.normal.clone().round(),
		probes,
		hidden: new WeakMap<SurfaceFace[], boolean>(),
		connected: new WeakMap<SurfaceFace[], number>(),
		vertices,
		indices,
	};
	faceInfo.set(face, info);
	return info;
}

/** A boundary face is hidden only by the same glass, with matching face coverage. */
export function hiddenGlassFace(face: SurfaceFace, neighbors: SurfaceFace[]): boolean {
	const info = prepareFace(face);
	const cached = info.hidden.get(neighbors);
	if (cached !== undefined) return cached;
	const hidden =
		info.offset.distanceTo(face.normal) < EPS &&
		neighbors.some(
			(other) =>
				other.normal.dot(face.normal) < -0.999 &&
				face.positions.every((p) => contains(other, p.clone().sub(info.offset)))
		);
	info.hidden.set(neighbors, hidden);
	return hidden;
}

export function glassConnections(
	face: SurfaceFace,
	state: string,
	x: number,
	y: number,
	z: number,
	getBlock: GetBlock,
	templates: ReadonlyMap<string, SurfaceFace[]>,
	names?: ReadonlyMap<string, string>
): number[] {
	const info = prepareFace(face);
	const name = names?.get(state) ?? baseName(state);
	return info.probes.map(({ offset }, i) => {
		if (offset.lengthSq() === 0) return 0;
		const neighbor = getBlock(x + offset.x, y + offset.y, z + offset.z) || "";
		const faces = templates.get(neighbor);
		if (!faces || (names?.get(neighbor) ?? baseName(neighbor)) !== name) return 0;
		let mask = info.connected.get(faces);
		if (mask === undefined) {
			mask = 0;
			info.probes.forEach(({ point }, bit) => {
				if (
					faces.some(
						(f) =>
							f.texture === face.texture && f.normal.dot(face.normal) > 0.999 && contains(f, point)
					)
				)
					mask! |= 1 << bit;
			});
			info.connected.set(faces, mask);
		}
		return (mask >> i) & 1;
	});
}

const opaqueHighlights = new WeakMap<THREE.Material, THREE.Material>();
type GlassPass = "all" | "opaque" | "translucent";

export function makeGlassMaterial(
	map: THREE.Texture,
	connected: boolean,
	clip = { value: new THREE.Vector2(0, 1e9) },
	source?: THREE.Material
): THREE.MeshBasicMaterial {
	// Binary glass windows are cutouts, so the opaque borders/highlights must
	// occlude water and other glass behind them. Stained/resource-pack alpha
	// stays blended rather than discarding legitimate translucent texels.
	const transparent = source?.transparent ?? true;
	const split =
		transparent &&
		source?.opacity === 1 &&
		source.userData.alphaClass === "blend" &&
		source.userData.hasOpaquePixels;
	const material = createGlassPass(
		map,
		connected,
		clip,
		transparent,
		source?.alphaTest ?? 0.01,
		source?.opacity ?? 1,
		split ? "translucent" : "all"
	);
	if (split) {
		const highlight = createGlassPass(map, connected, clip, false, 0, 1, "opaque");
		highlight.userData.surfaceCacheOwned = true;
		opaqueHighlights.set(material, highlight);
		material.addEventListener("dispose", () => highlight.dispose());
	}
	return material;
}

function createGlassPass(
	map: THREE.Texture,
	connected: boolean,
	clip: { value: THREE.Vector2 },
	transparent: boolean,
	alphaTest: number,
	opacity: number,
	part: GlassPass
): THREE.MeshBasicMaterial {
	const material = new THREE.MeshBasicMaterial({
		map,
		transparent,
		alphaTest,
		opacity,
		depthWrite: !transparent,
		side: THREE.FrontSide,
	});
	material.userData.surfaceTransparent = transparent;
	const uLayerClip = clip;
	// The viewer's layer control uses the same uniform on conventional and pulling meshes.
	Object.assign(material, { uniforms: { uLayerClip } });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uLayerClip = uLayerClip;
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
attribute vec4 aEdges;
attribute vec4 aCorners;
attribute float aCellY;
varying vec4 vEdges;
varying vec4 vCorners;
varying float vCellY;`
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
vEdges = aEdges; vCorners = aCorners; vCellY = aCellY;`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				`#include <common>
uniform vec2 uLayerClip;
varying vec4 vEdges;
varying vec4 vCorners;
varying float vCellY;`
			)
			.replace(
				"#include <clipping_planes_fragment>",
				`#include <clipping_planes_fragment>
if (uLayerClip.x > 0.5 && vCellY > uLayerClip.y) discard;`
			);
		if (connected)
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <map_fragment>",
				`
vec2 glassUv = vMapUv;
// Remove only shared borders; keep tint, highlights, outside edges, and the
// corner of an L-shaped opening when its diagonal neighbor is missing.
bvec4 edge = bvec4(glassUv.x < 0.0625, glassUv.x > 0.9375, glassUv.y < 0.0625, glassUv.y > 0.9375);
bool corner = (edge.x && edge.z && vCorners.x < 0.5) || (edge.y && edge.z && vCorners.y < 0.5) || (edge.x && edge.w && vCorners.z < 0.5) || (edge.y && edge.w && vCorners.w < 0.5);
if (!corner) {
  if (edge.x && vEdges.x > 0.5) glassUv.x = 0.09375;
  if (edge.y && vEdges.y > 0.5) glassUv.x = 0.90625;
  if (edge.z && vEdges.z > 0.5) glassUv.y = 0.09375;
  if (edge.w && vEdges.w > 0.5) glassUv.y = 0.90625;
}
diffuseColor *= texture2D(map, glassUv);
`
			);
		if (part !== "all") {
			// The map (including connected-edge UV remapping) has already been sampled.
			// Select source alpha, not schematic opacity, so the two passes stay
			// mutually exclusive even while the whole schematic fades.
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <color_fragment>",
				`#include <color_fragment>
if (opacity <= 0.0) discard;
float glassSourceAlpha = diffuseColor.a / opacity;
if (glassSourceAlpha ${part === "opaque" ? "<" : ">="} 0.999) discard;`
			);
		}
	};
	material.customProgramCacheKey = () => `connected-glass-${connected}-${part}`;
	return material;
}

interface Batch {
	material: THREE.Material;
	positions: number[];
	uvs: number[];
	edges: number[];
	corners: number[];
	cellY: number[];
	indices: number[];
	centers: number[];
}

/** Called once per occupied section. Work scales with surface cells, not bounds. */
export function buildGlassMeshes(
	getBlock: GetBlock,
	cells: Iterable<SurfaceCell>,
	templates: ReadonlyMap<string, SurfaceFace[]>,
	materials: ReadonlyMap<string, THREE.Material>
): THREE.Mesh[] {
	const batches = new Map<string, Batch>();
	const names = new Map([...templates.keys()].map((state) => [state, baseName(state)]));
	for (const { x, y, z, state } of cells) {
		const faces = templates.get(state);
		if (!faces) continue;
		const glass = isGlass(state);
		for (const face of faces) {
			const info = prepareFace(face),
				offset = info.offset;
			const neighbor = getBlock(x + offset.x, y + offset.y, z + offset.z) || "";
			const neighborFaces = templates.get(neighbor);
			if (
				glass &&
				neighborFaces &&
				names.get(state) === names.get(neighbor) &&
				hiddenGlassFace(face, neighborFaces)
			)
				continue;
			const connection = glass
				? glassConnections(face, state, x, y, z, getBlock, templates, names)
				: [0, 0, 0, 0, 0, 0, 0, 0];
			const material = materials.get(face.texture);
			if (!material) continue;
			const key = `${material.uuid}:${x >> 4},${y >> 4},${z >> 4}`;
			let batch = batches.get(key);
			if (!batch) {
				batch = {
					material,
					positions: [],
					uvs: [],
					edges: [],
					corners: [],
					cellY: [],
					indices: [],
					centers: [],
				};
				batches.set(key, batch);
			}
			const base = batch.positions.length / 3;
			for (const k of info.vertices) {
				const p = face.positions[k];
				batch.positions.push(p.x + x, p.y + y, p.z + z);
				batch.uvs.push(face.uvs[k].x, face.uvs[k].y);
				batch.edges.push(connection[0], connection[1], connection[2], connection[3]);
				batch.corners.push(connection[4], connection[5], connection[6], connection[7]);
				batch.cellY.push(y);
			}
			for (const i of info.indices) batch.indices.push(base + i);
			batch.centers.push(
				(face.box.min.x + face.box.max.x) / 2 + x,
				(face.box.min.y + face.box.max.y) / 2 + y,
				(face.box.min.z + face.box.max.z) / 2 + z
			);
		}
	}
	return [...batches.values()].flatMap((b) => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
		geometry.setAttribute("uv", new THREE.Float32BufferAttribute(b.uvs, 2));
		geometry.setAttribute("aEdges", new THREE.Uint8BufferAttribute(b.edges, 4));
		geometry.setAttribute("aCorners", new THREE.Uint8BufferAttribute(b.corners, 4));
		geometry.setAttribute("aCellY", new THREE.Float32BufferAttribute(b.cellY, 1));
		geometry.setIndex(b.indices);
		geometry.computeBoundingSphere();
		const centers = new Float32Array(b.centers);
		const build = (g: THREE.BufferGeometry, material: THREE.Material, name: string) => {
			const mesh = new THREE.Mesh(g, material);
			mesh.name = name;
			mesh.userData.surfaceMesh = true;
			installSurfaceSorting(mesh, centers, true);
			return mesh;
		};
		// Even cutout glass can be faded by a schematic's opacity control. Sort
		// only once it actually needs blending, keeping the common cutout path fast.
		const mesh = build(geometry, b.material, "connected-glass-and-portals");
		const highlight = opaqueHighlights.get(b.material);
		return highlight
			? [build(geometry.clone(), highlight, "glass-opaque-highlights"), mesh]
			: [mesh];
	});
}
