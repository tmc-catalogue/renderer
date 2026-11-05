// ChestModels.ts — per-cell chest rendering (vanilla blockstate-model port).
// Design doc: "Chest rendering port — review" (approved). Each half renders in
// its OWN cell with its own facing rotation; no pairing/midpoint/stretching —
// the pair assembles from two ordinary per-cell renders, exactly like the
// reference viewer. Front at local -Z; theta = -blockstateY * PI/180.
// ============================================================================
// Chest per-cell template system (design: "Chest rendering port — review")
// ============================================================================

import * as THREE from "three";

export type ChestType = "single" | "left" | "right";
export type ChestFacing = "north" | "east" | "south" | "west";
export type ChestKind =
	| "normal"
	| "trapped"
	| "ender"
	| "copper"
	| "copper_exposed"
	| "copper_weathered"
	| "copper_oxidized";

type ChestFaceDir = "down" | "up" | "north" | "south" | "west" | "east";
type UV4 = readonly [number, number, number, number];
type Vec3 = readonly [number, number, number];

interface ChestFaceDef {
	/** Vanilla block-model UV [u0, v0, u1, v1] in 0..16. NEVER min/max-normalized. */
	uv: UV4;
	/** Vanilla face rotation (texture rotated clockwise). */
	rotation?: 0 | 90 | 180 | 270;
}

interface ChestBoxDef {
	/** Template coords, 0..16, front at local -Z (facing=north). */
	from: Vec3;
	to: Vec3;
	/** Omitted faces are intentionally not emitted (hidden / shared boundary). */
	faces: Partial<Record<ChestFaceDir, ChestFaceDef>>;
}

/**
 * Template boxes. Front = -Z (north). Latch protrudes to z ∈ [0,1].
 * Hidden faces omitted: base-up (under lid), lid-down (on base),
 * latch-south (inside base), and the shared-boundary caps
 * (left: +X caps at x=16; right: -X caps at x=0).
 */
const CHEST_TEMPLATES: Record<ChestType, readonly ChestBoxDef[]> = {
	single: [
		// base
		{
			from: [1, 0, 1],
			to: [15, 10, 15],
			faces: {
				down: { uv: [7, 8.25, 3.5, 4.75] },
				north: { uv: [14, 10.75, 10.5, 8.25] },
				south: { uv: [7, 10.75, 3.5, 8.25] },
				east: { uv: [3.5, 10.75, 0, 8.25] },
				west: { uv: [10.5, 10.75, 7, 8.25] },
			},
		},
		// lid (viewer lid y 10..14; vanilla 9..14 — visible top 4 px of the side strips)
		{
			from: [1, 10, 1],
			to: [15, 14, 15],
			faces: {
				up: { uv: [10.5, 0, 7, 3.5] },
				north: { uv: [14, 4.75, 10.5, 3.75] },
				south: { uv: [7, 4.75, 3.5, 3.75] },
				east: { uv: [3.5, 4.75, 0, 3.75] },
				west: { uv: [10.5, 4.75, 7, 3.75] },
			},
		},
		// latch
		{
			from: [7, 7, 0],
			to: [9, 11, 1],
			faces: {
				up: { uv: [1.25, 0, 0.75, 0.25] },
				down: { uv: [0.75, 0.25, 0.25, 0] },
				north: { uv: [1.5, 1.25, 1, 0.25] },
				east: { uv: [0.25, 1.25, 0, 0.25] },
				west: { uv: [1, 1.25, 0.75, 0.25] },
			},
		},
	],

	// LEFT: on the WEST at facing=north; fills to x=16 (shared boundary = its +X edge).
	left: [
		{
			from: [1, 0, 1],
			to: [16, 10, 15],
			faces: {
				down: { uv: [7.25, 8.25, 3.5, 4.75] },
				north: { uv: [14.5, 10.75, 10.75, 8.25] },
				south: { uv: [7.25, 10.75, 3.5, 8.25] },
				west: { uv: [10.75, 10.75, 7.25, 8.25] },
			},
		},
		{
			from: [1, 10, 1],
			to: [16, 14, 15],
			faces: {
				up: { uv: [11, 0, 7.25, 3.5] },
				north: { uv: [14.5, 4.75, 10.75, 3.75] },
				south: { uv: [7.25, 4.75, 3.5, 3.75] },
				west: { uv: [10.75, 4.75, 7.25, 3.75] },
			},
		},
		{
			from: [15, 7, 0],
			to: [16, 11, 1],
			faces: {
				up: { uv: [0.75, 0, 0.5, 0.25] },
				down: { uv: [0.5, 0.25, 0.25, 0] },
				north: { uv: [1, 1.25, 0.75, 0.25] },
				west: { uv: [0.75, 1.25, 0.5, 0.25] },
			},
		},
	],

	// RIGHT: on the EAST at facing=north; starts at x=0 (shared boundary = its -X edge).
	right: [
		{
			from: [0, 0, 1],
			to: [15, 10, 15],
			faces: {
				down: { uv: [7.25, 8.25, 3.5, 4.75] },
				north: { uv: [14.5, 10.75, 10.75, 8.25] },
				south: { uv: [7.25, 10.75, 3.5, 8.25] },
				east: { uv: [3.5, 10.75, 0, 8.25] },
			},
		},
		{
			from: [0, 10, 1],
			to: [15, 14, 15],
			faces: {
				up: { uv: [11, 0, 7.25, 3.5] },
				north: { uv: [14.5, 4.75, 10.75, 3.75] },
				south: { uv: [7.25, 4.75, 3.5, 3.75] },
				east: { uv: [3.5, 4.75, 0, 3.75] },
			},
		},
		{
			from: [0, 7, 0],
			to: [1, 11, 1],
			faces: {
				up: { uv: [0.75, 0, 0.5, 0.25] },
				down: { uv: [0.5, 0.25, 0.25, 0] },
				north: { uv: [1, 1.25, 0.75, 0.25] },
				east: { uv: [0.25, 1.25, 0, 0.25] },
			},
		},
	],
};

const CHEST_FACE_ORDER: readonly ChestFaceDir[] = ["down", "up", "north", "south", "west", "east"];

const CHEST_FACE_NORMAL: Record<ChestFaceDir, Vec3> = {
	down: [0, -1, 0],
	up: [0, 1, 0],
	north: [0, 0, -1],
	south: [0, 0, 1],
	west: [-1, 0, 0],
	east: [1, 0, 0],
};

/**
 * Vanilla per-face corner convention, corners ordered TL, TR, BR, BL as seen
 * from OUTSIDE the face. TL gets (u0,v0), TR (u1,v0), BR (u1,v1), BL (u0,v1).
 * e.g. north face: u0 at the +X side when viewed from outside.
 */
function chestFaceCorners(dir: ChestFaceDir, a: Vec3, b: Vec3): Vec3[] {
	const [x0, y0, z0] = a;
	const [x1, y1, z1] = b;
	switch (dir) {
		case "north":
			return [
				[x1, y1, z0],
				[x0, y1, z0],
				[x0, y0, z0],
				[x1, y0, z0],
			];
		case "south":
			return [
				[x0, y1, z1],
				[x1, y1, z1],
				[x1, y0, z1],
				[x0, y0, z1],
			];
		case "east":
			return [
				[x1, y1, z1],
				[x1, y1, z0],
				[x1, y0, z0],
				[x1, y0, z1],
			];
		case "west":
			return [
				[x0, y1, z0],
				[x0, y1, z1],
				[x0, y0, z1],
				[x0, y0, z0],
			];
		case "up":
			return [
				[x0, y1, z0],
				[x1, y1, z0],
				[x1, y1, z1],
				[x0, y1, z1],
			];
		case "down":
			return [
				[x0, y0, z1],
				[x1, y0, z1],
				[x1, y0, z0],
				[x0, y0, z0],
			];
	}
}

/**
 * Builds the merged chest BufferGeometry in [0,1]^3 cell space (coords / 16).
 * UV order of operations (design §3):
 *   1) corner UVs from [u0,v0,u1,v1] by corner order (no min/max sorting),
 *   2) apply face rotation,
 *   3) flipY: u' = u/16, v' = 1 - v/16  (textures use three.js default flipY=true).
 * Returns a fresh geometry each call (cheap, ~56 verts) so existing
 * dispose-on-rebuild code can't invalidate a shared cache.
 */
export function chestModelGeo(type: "single" | "left" | "right"): THREE.BufferGeometry {
	const boxes = CHEST_TEMPLATES[type];
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];

	for (const box of boxes) {
		const a: Vec3 = [box.from[0] / 16, box.from[1] / 16, box.from[2] / 16];
		const b: Vec3 = [box.to[0] / 16, box.to[1] / 16, box.to[2] / 16];

		for (const dir of CHEST_FACE_ORDER) {
			const face = box.faces[dir];
			if (!face) continue;

			const corners = chestFaceCorners(dir, a, b);
			const n = CHEST_FACE_NORMAL[dir];
			const [u0, v0, u1, v1] = face.uv;

			// 1) vanilla corner UVs (TL, TR, BR, BL) — mirror falls out of u0>u1 / v0>v1.
			const cornerUV: [number, number][] = [
				[u0, v0],
				[u1, v0],
				[u1, v1],
				[u0, v1],
			];

			// 2) rotation: texture rotated clockwise by k*90° → vertex i takes corner (i - k).
			const k = ((face.rotation ?? 0) / 90) | 0;

			const base = positions.length / 3;
			for (let i = 0; i < 4; i++) {
				const c = corners[i];
				positions.push(c[0], c[1], c[2]);
				normals.push(n[0], n[1], n[2]);
				const [u, v] = cornerUV[(i - k + 4) % 4];
				// 3) flipY applied last.
				uvs.push(u / 16, 1 - v / 16);
			}

			// TL,TR,BR,BL is clockwise from outside → emit CCW triangles.
			indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeBoundingBox();
	geo.computeBoundingSphere();
	return geo;
}

/** θ = −blockstate.y·π/180 (three.js rotateY, front at local −Z). */
export const CHEST_FACING_THETA: Record<ChestFacing, number> = {
	north: 0,
	east: -Math.PI / 2,
	south: Math.PI,
	west: Math.PI / 2,
};

export function chestTexturePath(kind: ChestKind, type: ChestType): string {
	if (kind === "ender") return "entity/chest/ender";
	const base = `entity/chest/${kind}`;
	return type === "single" ? base : `${base}_${type}`;
}

function chestMaterialFor(
	tex: THREE.Texture,
	cache: Map<THREE.Texture, THREE.MeshStandardMaterial>
): THREE.MeshStandardMaterial {
	const hit = cache.get(tex);
	if (hit) return hit;
	// Latch is 1–2 px wide: nearest mag + min, no mipmaps (own texture, not atlased).
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
	cache.set(tex, mat);
	return mat;
}

// ---- blockstate reading (string "minecraft:chest[facing=east,type=left]" or object) ----

function chestStateName(state: unknown): string {
	if (typeof state === "string") {
		const i = state.indexOf("[");
		return (i >= 0 ? state.slice(0, i) : state).trim();
	}
	if (state && typeof state === "object") {
		const s = state as Record<string, unknown>;
		const n = s.name ?? s.Name;
		if (typeof n === "string") return n;
	}
	return "";
}

function chestStateProp(state: unknown, key: string): string | undefined {
	if (typeof state === "string") {
		const open = state.indexOf("[");
		const close = state.lastIndexOf("]");
		if (open < 0 || close <= open) return undefined;
		for (const kv of state.slice(open + 1, close).split(",")) {
			const eq = kv.indexOf("=");
			if (eq < 0) continue;
			if (kv.slice(0, eq).trim() === key) return kv.slice(eq + 1).trim();
		}
		return undefined;
	}
	if (state && typeof state === "object") {
		const s = state as Record<string, unknown>;
		const props = (s.properties ?? s.Properties) as Record<string, unknown> | undefined;
		const v = props?.[key];
		return v == null ? undefined : String(v);
	}
	return undefined;
}

function chestKindOf(bucket: { state: unknown; chest?: unknown }): ChestKind | null {
	const hint = typeof bucket.chest === "string" ? bucket.chest : "";
	const name = `${chestStateName(bucket.state)} ${hint}`.toLowerCase();
	if (name.includes("ender_chest") || hint === "ender") return "ender";
	if (name.includes("trapped_chest") || hint === "trapped") return "trapped";
	if (name.includes("copper_chest")) {
		if (name.includes("oxidized")) return "copper_oxidized";
		if (name.includes("weathered")) return "copper_weathered";
		if (name.includes("exposed")) return "copper_exposed";
		return "copper";
	}
	if (name.includes("chest") || hint === "normal" || bucket.chest === true) return "normal";
	return null;
}

function asChestFacing(v: unknown): ChestFacing {
	return v === "east" || v === "south" || v === "west" ? v : "north"; // default north
}

function asChestType(v: unknown): ChestType {
	return v === "left" || v === "right" ? v : "single"; // default single
}

type CellList = ReadonlyArray<unknown> | ArrayLike<number>;

function forEachChestCell(
	positions: CellList,
	fn: (x: number, y: number, z: number) => void
): void {
	const n = positions.length;
	if (n === 0) return;
	const first = (positions as ArrayLike<unknown>)[0];
	if (typeof first === "number") {
		const flat = positions as ArrayLike<number>;
		for (let i = 0; i + 2 < n; i += 3) fn(flat[i], flat[i + 1], flat[i + 2]);
		return;
	}
	for (let i = 0; i < n; i++) {
		const p = (positions as ArrayLike<unknown>)[i] as
			ArrayLike<number> | { x: number; y: number; z: number };
		if ("x" in (p as object)) {
			const q = p as { x: number; y: number; z: number };
			fn(q.x, q.y, q.z);
		} else {
			const q = p as ArrayLike<number>;
			fn(q[0], q[1], q[2]);
		}
	}
}

export interface ChestBucketLike {
	state: unknown;
	double?: boolean;
	facing?: unknown;
	chest?: unknown;
	positions: CellList;
}

export interface ChestAssetLoaderLike {
	getTexture(path: string): THREE.Texture | Promise<THREE.Texture>;
}

/** The same state-aware templates used by GPU instances, for the CPU palette. */
export async function buildChestBlockMesh(
	state: unknown,
	al: ChestAssetLoaderLike
): Promise<THREE.Mesh | null> {
	const kind = chestKindOf({ state });
	if (!kind) return null;
	const type = kind === "ender" ? "single" : asChestType(chestStateProp(state, "type"));
	const facing = asChestFacing(chestStateProp(state, "facing"));
	const texture = await al.getTexture(chestTexturePath(kind, type));
	const geometry = chestModelGeo(type);
	geometry.translate(-0.5, -0.5, -0.5);
	geometry.rotateY(CHEST_FACING_THETA[facing]);
	const mesh = new THREE.Mesh(geometry, chestMaterialFor(texture, new Map()));
	mesh.name = `chest:${kind}:${facing}:${type}`;
	return mesh;
}

/**
 * Per-cell chest rendering. Re-buckets by FULL state (kind + facing + type);
 * one InstancedMesh per full state, one instance per cell, each half drawn
 * only in its own cell. No pairing / midpoint / stretching.
 * Non-chest buckets are returned untouched in `rest`.
 */
export async function buildChestInstancedMeshes<B extends ChestBucketLike>(
	buckets: Iterable<B>,
	al: ChestAssetLoaderLike,
	sx: number,
	sy: number,
	sz: number
): Promise<{ meshes: THREE.InstancedMesh[]; rest: B[] }> {
	interface Group {
		kind: ChestKind;
		facing: ChestFacing;
		type: ChestType;
		state: unknown;
		cells: number[];
	}

	const groups = new Map<string, Group>();
	const rest: B[] = [];

	for (const bucket of buckets) {
		const kind = chestKindOf(bucket);
		if (!kind) {
			rest.push(bucket);
			continue;
		}
		const facing = asChestFacing(chestStateProp(bucket.state, "facing") ?? bucket.facing);
		// Ender chest is single-only.
		const type: ChestType =
			kind === "ender" ? "single" : asChestType(chestStateProp(bucket.state, "type"));
		const key = `${kind}|${facing}|${type}`;
		let g = groups.get(key);
		if (!g) {
			g = { kind, facing, type, state: bucket.state, cells: [] };
			groups.set(key, g);
		}
		const cells = g.cells;
		forEachChestCell(bucket.positions, (x, y, z) => {
			cells.push(x, y, z);
		});
	}

	const matCache = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
	const fallbackSphere = new THREE.Sphere(
		new THREE.Vector3(sx / 2, sy / 2, sz / 2),
		0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz) + 1
	);

	const out: THREE.InstancedMesh[] = [];
	const pivotIn = new THREE.Matrix4();
	const rot = new THREE.Matrix4();
	const pivotOut = new THREE.Matrix4();
	const local = new THREE.Matrix4();
	const cellT = new THREE.Matrix4();
	const m = new THREE.Matrix4();

	for (const g of groups.values()) {
		const count = g.cells.length / 3;
		if (count === 0) continue;

		const geo = chestModelGeo(g.type);
		// getTexture is ASYNC on a cold cache — awaiting is mandatory; a Promise (or
		// any non-Texture) handed to MeshStandardMaterial.map compiles a broken
		// shader ('uvundefined') and crashes the render loop EVERY FRAME.
		const texMaybe = await al.getTexture(chestTexturePath(g.kind, g.type));
		const tex = texMaybe && (texMaybe as any).isTexture ? (texMaybe as THREE.Texture) : null;
		if (!tex) {
			console.warn(
				`[ChestModels] texture unavailable for ${g.kind}/${g.type}, skipping ${count} cells`
			);
			continue;
		}
		const mat = chestMaterialFor(tex, matCache);

		// local = T(.5,0,.5) · R_y(θ) · T(−.5,0,−.5)
		pivotIn.makeTranslation(0.5, 0, 0.5);
		rot.makeRotationY(CHEST_FACING_THETA[g.facing]);
		pivotOut.makeTranslation(-0.5, 0, -0.5);
		local.multiplyMatrices(pivotIn, rot).multiply(pivotOut);

		const mesh = new THREE.InstancedMesh(geo, mat, count);
		mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		for (let i = 0; i < count; i++) {
			const x = g.cells[i * 3];
			const y = g.cells[i * 3 + 1];
			const z = g.cells[i * 3 + 2];
			// CENTER convention: the record path renders cell (x,y,z) at [c−0.5,c+0.5]
			// (cubane geometry is centered on the integer coordinate), so chest
			// instances shift −0.5 to land in the same rendered cell as record blocks
			cellT.makeTranslation(x - 0.5, y - 0.5, z - 0.5);
			m.multiplyMatrices(cellT, local); // T(cell)·T(.5,0,.5)·R_y(θ)·T(−.5,0,−.5)
			mesh.setMatrixAt(i, m);
		}
		mesh.instanceMatrix.needsUpdate = true;

		// Instanced bounds AFTER writing matrices (r183 includes instances).
		mesh.computeBoundingBox();
		mesh.computeBoundingSphere();
		const bs = mesh.boundingSphere;
		if (!bs || !Number.isFinite(bs.radius) || bs.radius <= 0 || !Number.isFinite(bs.center.x)) {
			mesh.boundingSphere = fallbackSphere.clone();
		}

		mesh.name = `chest:${g.kind}:${g.facing}:${g.type}`;
		mesh.userData.chestBypass = true;
		mesh.userData.entityBypass = true;
		mesh.userData.blockState = g.state;
		mesh.userData.chestKind = g.kind;
		mesh.userData.chestFacing = g.facing;
		mesh.userData.chestType = g.type;
		mesh.userData.cells = Int32Array.from(g.cells); // instanceId → cell for bypass raycast
		out.push(mesh);
	}

	return { meshes: out, rest };
}
