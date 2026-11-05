// Fluid surfaces with vanilla corner heights and shared water/waterlogged geometry.
// Only exposed faces are emitted; water uses one transparent draw per schematic.
import * as THREE from "three";
import { FLUID_VERT, FLUID_FRAG } from "./FluidShaders";
import { fluidAnimationFrame, hasFluidAnimation } from "./FluidAnimation";
import { WATER_OPACITY } from "./WaterTextures";
import type { BubbleCell } from "./BubbleColumns";

export type GetBlock = (x: number, y: number, z: number) => string | null | undefined;
export type FluidKind = "water" | "lava";
export interface FluidTextures {
	water?: THREE.DataArrayTexture | null;
	waterFlow?: THREE.DataArrayTexture | null;
	lava?: THREE.DataArrayTexture | null;
	lavaFlow?: THREE.DataArrayTexture | null;
	waterOverlay?: THREE.DataArrayTexture | null;
}
export interface FluidBuildResult {
	meshes: THREE.Mesh[];
	cells: number;
	ms: number;
	bubbleCells: BubbleCell[];
}

// ---------------------------------------------------------------------------
// Block classification
// ---------------------------------------------------------------------------
const K_NONE = 0,
	K_WATER = 1,
	K_LAVA = 2;
const KIND_NAME: FluidKind[] = ["water", "water", "lava"];

// Heuristic: blocks that do NOT hide an adjacent fluid face.
const NON_OCCLUDING =
	/^(air|cave_air|void_air)$|glass|pane|bars|leaves|slab|stairs|fence|wall|torch|sign|button|pressure_plate|rail|carpet|trapdoor|door|chain|lantern|flower|grass|fern|sapling|kelp|seagrass|lily_pad|vine|ladder|scaffolding|cobweb|banner|candle|coral|pickle|bamboo|cactus|sugar_cane|bubble_column|campfire|hopper|cauldron|anvil|head|skull|pot|bed$|bell|lever|tripwire|redstone_wire|repeater|comparator|mushroom$|tulip|rose|dandelion|orchid|poppy|lilac|peony|azalea|dripleaf|moss_carpet|sculk_vein|amethyst_cluster|bud$|frogspawn|hanging_roots|spore_blossom|pointed_dripstone|end_rod|brewing_stand|enchanting_table|conduit|chest|shulker_box|cocoa|wheat|carrots|potatoes|beetroots|nether_wart|stem|ice$|slime_block|honey_block|daylight_detector|lectern|stonecutter|grindstone|composter|barrel|snow$|shelf$|dried_ghast|sulfur_spike|resin_clump|pale_hanging_moss|bush$|leaf_litter|copper_golem_statue$/;

function parseLevel(props: string): number {
	const i = props.indexOf("level=");
	if (i < 0) return 0;
	let v = 0,
		j = i + 6;
	while (j < props.length) {
		const c = props.charCodeAt(j);
		if (c < 48 || c > 57) break;
		v = v * 10 + (c - 48);
		j++;
	}
	return v > 15 ? 15 : v;
}

/** Packed: kind (bits 0-1) | level (bits 2-5) | occluding (bit 8). */
const IMPLICIT_WATER = new Set([
	"bubble_column",
	"kelp",
	"kelp_plant",
	"seagrass",
	"tall_seagrass",
]);

function classify(s: string | null | undefined): number {
	if (!s) return 0;
	let name = s,
		props = "";
	const b = s.indexOf("[");
	if (b >= 0) {
		name = s.slice(0, b);
		props = s.slice(b + 1, s.length - 1);
	}
	if (name.startsWith("minecraft:")) name = name.slice(10);
	if (name === "water" || name === "flowing_water") return K_WATER | (parseLevel(props) << 2);
	if (name === "lava" || name === "flowing_lava") return K_LAVA | (parseLevel(props) << 2);
	if (name === "bubble_column") return K_WATER | 512 | (props.includes("drag=true") ? 1024 : 0);
	if (props.indexOf("waterlogged=true") >= 0 || IMPLICIT_WATER.has(name)) return K_WATER;
	const overlay = /^(?:glass|tinted_glass|.*_stained_glass|ice|frosted_ice|.*_leaves)$/.test(name);
	return (NON_OCCLUDING.test(name) ? 0 : 1 << 8) | (overlay ? 2048 : 0);
}

/** Palette-level early exit avoids scanning dry schematics for a fluid surface. */
export function hasFluid(state: string): boolean {
	return (classify(state) & 3) !== K_NONE;
}

function levelToHeight(l: number): number {
	if (l >= 8) return 8 / 9;
	if (l === 0) return 8 / 9;
	return (8 - l) / 9;
}

// ---------------------------------------------------------------------------
// Growable buffers
// ---------------------------------------------------------------------------
class F32 {
	a: Float32Array;
	n = 0;
	constructor(cap: number) {
		this.a = new Float32Array(Math.max(cap, 64));
	}
	ensure(k: number) {
		if (this.n + k <= this.a.length) return;
		let c = this.a.length * 2;
		while (c < this.n + k) c *= 2;
		const b = new Float32Array(c);
		b.set(this.a.subarray(0, this.n));
		this.a = b;
	}
	view() {
		return this.a.subarray(0, this.n);
	}
}
class U32 {
	a: Uint32Array;
	n = 0;
	constructor(cap: number) {
		this.a = new Uint32Array(Math.max(cap, 64));
	}
	ensure(k: number) {
		if (this.n + k <= this.a.length) return;
		let c = this.a.length * 2;
		while (c < this.n + k) c *= 2;
		const b = new Uint32Array(c);
		b.set(this.a.subarray(0, this.n));
		this.a = b;
	}
	view() {
		return this.a.subarray(0, this.n);
	}
}

// ---------------------------------------------------------------------------
// Mesher
// ---------------------------------------------------------------------------
const EPS = 1 / 1024;

export function buildFluidMeshes(
	getBlock: GetBlock,
	sx: number,
	sy: number,
	sz: number
): FluidBuildResult {
	const t0 = performance.now();
	const n = sx * sy * sz;
	const kind = new Uint8Array(n);
	const level = new Uint8Array(n);
	const occl = new Uint8Array(n);
	const classifications = new Map<string, number>();
	const bubbleCells: BubbleCell[] = [];
	let cells = 0;
	let hasWater = false,
		hasLava = false;

	for (let y = 0; y < sy; y++) {
		for (let z = 0; z < sz; z++) {
			const row = (y * sz + z) * sx;
			for (let x = 0; x < sx; x++) {
				const state = getBlock(x, y, z) || "";
				let c = classifications.get(state);
				if (c === undefined) {
					c = classify(state);
					classifications.set(state, c);
				}
				const k = c & 3;
				kind[row + x] = k;
				level[row + x] = (c >> 2) & 15;
				occl[row + x] = (c >> 8) & 9; // bit 0: solid; bit 3: water overlay neighbor
				if (c & 512) bubbleCells.push({ x, y, z, downward: !!(c & 1024) });
				if (k !== K_NONE) {
					cells++;
					if (k === K_WATER) hasWater = true;
					else hasLava = true;
				}
			}
		}
	}

	const I = (x: number, y: number, z: number) => (y * sz + z) * sx + x;
	const inb = (x: number, y: number, z: number) =>
		x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;

	/** Vanilla getHeight: fluid height (1 if same fluid above), 0 for air/outside the schematic, -1 for solid. */
	const H = (k: number, x: number, y: number, z: number): number => {
		if (!inb(x, y, z)) return 0;
		const i = I(x, y, z);
		if ((kind[i] & 3) === k) {
			if (y + 1 < sy && (kind[I(x, y + 1, z)] & 3) === k) return 1;
			return levelToHeight(level[i]);
		}
		return occl[i] & 1 ? -1 : 0;
	};

	// Water and waterlogged cells share a surface and material (no duplicate bucket).
	const buildKind = (k: number): THREE.Mesh[] => {
		// Reserve for a surface, not the entire fluid volume. Buffers grow only
		// when exposed faces need them (large lakes otherwise reserve hundreds of MB).
		const est = Math.min(Math.max(cells, 1), 4096);
		const mkBld = () => ({
			pos: new F32(est * 3 * 4 * 3),
			face: new F32(est * 3 * 4),
			uv: new F32(est * 3 * 4 * 2),
			texture: new F32(est * 3 * 4),
			idx: new U32(est * 3 * 6),
			vcount: 0,
		});
		const cur = mkBld();

		// per-cell state (set before emitting)
		let fFace = 0,
			fx = 0,
			fz = 0,
			fTexture = 0,
			cellX = 0,
			cellY = 0,
			cellZ = 0;

		const vert = (x: number, y: number, z: number) => {
			cur.pos.ensure(3);
			cur.face.ensure(1);
			cur.uv.ensure(2);
			cur.texture.ensure(1);
			cur.pos.a[cur.pos.n++] = x;
			cur.pos.a[cur.pos.n++] = y;
			cur.pos.a[cur.pos.n++] = z;
			cur.face.a[cur.face.n++] = fFace;
			// Per-block coordinates avoid the old world-space phase shifts and diagonal seams.
			const lx = x - cellX + 0.5,
				lz = z - cellZ + 0.5;
			let u: number, v: number;
			if (fFace <= 1) {
				if (fTexture === 1) {
					u = 0.5 + 0.5 * (fz * (lx - 0.5) - fx * (lz - 0.5));
					v = 0.5 + 0.5 * (fx * (lx - 0.5) + fz * (lz - 0.5));
				} else {
					u = lx;
					v = lz;
				}
			} else {
				u = (fFace === 2 ? lx : fFace === 3 ? 1 - lx : fFace === 4 ? 1 - lz : lz) * 0.5;
				v = y <= cellY - 0.5 + EPS ? 0.5 : (cellY + 0.5 - y) * 0.5;
			}
			cur.uv.a[cur.uv.n++] = u;
			cur.uv.a[cur.uv.n++] = v;
			cur.texture.a[cur.texture.n++] = fTexture;
			return cur.vcount++;
		};
		const quad = (
			x0: number,
			y0: number,
			z0: number,
			x1: number,
			y1: number,
			z1: number,
			x2: number,
			y2: number,
			z2: number,
			x3: number,
			y3: number,
			z3: number
		) => {
			const a = vert(x0, y0, z0),
				b = vert(x1, y1, z1),
				c = vert(x2, y2, z2),
				d = vert(x3, y3, z3);
			cur.idx.ensure(6);
			cur.idx.a[cur.idx.n++] = a;
			cur.idx.a[cur.idx.n++] = b;
			cur.idx.a[cur.idx.n++] = c;
			cur.idx.a[cur.idx.n++] = a;
			cur.idx.a[cur.idx.n++] = c;
			cur.idx.a[cur.idx.n++] = d;
		};

		let sum = 0,
			w = 0;
		const addW = (h: number) => {
			if (h >= 0.8) {
				sum += h * 10;
				w += 10;
			} else if (h >= 0) {
				sum += h;
				w += 1;
			}
		};
		const corner = (
			x: number,
			y: number,
			z: number,
			cx: number,
			cz: number,
			hC: number
		): number => {
			const hEW = H(k, x + cx, y, z);
			const hNS = H(k, x, y, z + cz);
			if (hEW >= 1 || hNS >= 1) return 1;
			sum = 0;
			w = 0;
			if (hEW > 0 || hNS > 0) {
				const hD = H(k, x + cx, y, z + cz);
				if (hD >= 1) return 1;
				addW(hD);
			}
			addW(hC);
			addW(hEW);
			addW(hNS);
			return w > 0 ? Math.min(1, sum / w) : hC;
		};

		const slope = (x: number, y: number, z: number, height: number): number => {
			if (!inb(x, y, z)) return 0;
			const neighbor = I(x, y, z);
			if (kind[neighbor] === k) return height - levelToHeight(level[neighbor]);
			if (kind[neighbor] !== K_NONE || occl[neighbor] & 1) return 0;
			if (y > 0 && kind[I(x, y - 1, z)] === k) {
				return height - levelToHeight(level[I(x, y - 1, z)]) + 8 / 9;
			}
			return 0;
		};

		for (let y = 0; y < sy; y++) {
			for (let z = 0; z < sz; z++) {
				for (let x = 0; x < sx; x++) {
					const i = I(x, y, z);
					if ((kind[i] & 3) !== k) continue;

					const above = y + 1 < sy && (kind[I(x, y + 1, z)] & 3) === k;
					// Fully enclosed cells contribute no vertices or UVs.
					if (
						above &&
						y > 0 &&
						x > 0 &&
						x + 1 < sx &&
						z > 0 &&
						z + 1 < sz &&
						kind[I(x, y - 1, z)] === k &&
						kind[i - 1] === k &&
						kind[i + 1] === k &&
						kind[i - sx] === k &&
						kind[i + sx] === k
					)
						continue;
					const hC = above ? 1 : levelToHeight(level[i]);

					// --- corner heights ---
					let h00: number, h10: number, h11: number, h01: number;
					if (hC >= 1) {
						h00 = h10 = h11 = h01 = 1;
					} else {
						h00 = corner(x, y, z, -1, -1, hC);
						h10 = corner(x, y, z, +1, -1, hC);
						h11 = corner(x, y, z, +1, +1, hC);
						h01 = corner(x, y, z, -1, +1, hC);
					}

					// Vanilla uses neighboring fluid's OWN height; air contributes only
					// when fluid exists below it. A bare edge is not itself a flow vector.
					fx = fz = 0;
					let magnitude = 0;
					if (!above) {
						const ownHeight = levelToHeight(level[i]);
						fx = slope(x + 1, y, z, ownHeight) - slope(x - 1, y, z, ownHeight);
						fz = slope(x, y, z + 1, ownHeight) - slope(x, y, z - 1, ownHeight);
						magnitude = Math.hypot(fx, fz);
						if (magnitude > 0) {
							fx /= magnitude;
							fz /= magnitude;
						}
					}
					cellX = x;
					cellY = y;
					cellZ = z;
					if (!above) {
						h00 -= EPS;
						h10 -= EPS;
						h11 -= EPS;
						h01 -= EPS;
					}
					// --- geometry (center-indexed) ---
					const xw = x - 0.5,
						xe = x + 0.5,
						zn = z - 0.5,
						zs = z + 0.5,
						yb = y - 0.5;
					const y00 = yb + h00,
						y10 = yb + h10,
						y11 = yb + h11,
						y01 = yb + h01;

					// top
					if (!above) {
						fFace = 0;
						fTexture = magnitude > 0 ? 1 : 0;
						quad(xw, y00, zn, xw, y01, zs, xe, y11, zs, xe, y10, zn);
					}
					// bottom
					{
						const bk = y > 0 ? kind[I(x, y - 1, z)] & 3 : K_NONE;
						const bo = y > 0 ? occl[I(x, y - 1, z)] : 0;
						if (bk !== k && !(bo & 1)) {
							fFace = 1;
							fTexture = 0;
							quad(xw, yb + EPS, zn, xe, yb + EPS, zn, xe, yb + EPS, zs, xw, yb + EPS, zs);
						}
					}
					const open = (nx: number, nz: number): boolean => {
						fTexture = 1;
						if (!inb(nx, y, nz)) return true;
						const j = I(nx, y, nz);
						if (k === K_WATER && occl[j] & 8) fTexture = 2;
						return (kind[j] & 3) !== k && !(occl[j] & 1);
					};
					// -z (north)
					if (open(x, z - 1)) {
						fFace = 2;
						const zz = zn + EPS;
						quad(xe, yb, zz, xw, yb, zz, xw, y00, zz, xe, y10, zz);
					}
					// +z (south)
					if (open(x, z + 1)) {
						fFace = 3;
						const zz = zs - EPS;
						quad(xw, yb, zz, xe, yb, zz, xe, y11, zz, xw, y01, zz);
					}
					// -x (west)
					if (open(x - 1, z)) {
						fFace = 4;
						const xx = xw + EPS;
						quad(xx, yb, zn, xx, yb, zs, xx, y01, zs, xx, y00, zn);
					}
					// +x (east)
					if (open(x + 1, z)) {
						fFace = 5;
						const xx = xe - EPS;
						quad(xx, yb, zs, xx, yb, zn, xx, y10, zn, xx, y11, zs);
					}
				}
			}
		}

		const assemble = (b: {
			pos: F32;
			face: F32;
			uv: F32;
			texture: F32;
			idx: U32;
			vcount: number;
		}): THREE.Mesh | null => {
			if (b.idx.n === 0) return null;
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.BufferAttribute(b.pos.view().slice(), 3));
			geo.setAttribute("aFace", new THREE.Uint8BufferAttribute(b.face.view(), 1));
			geo.setAttribute("uv", new THREE.BufferAttribute(b.uv.view().slice(), 2));
			geo.setAttribute("aTexture", new THREE.Uint8BufferAttribute(b.texture.view(), 1));
			geo.setIndex(new THREE.BufferAttribute(b.idx.view().slice(), 1));
			geo.computeBoundingSphere();
			geo.computeBoundingBox();
			const mat = createFluidMaterial(KIND_NAME[k]);
			const mesh = new THREE.Mesh(geo, mat);
			mesh.name = `fluid:${KIND_NAME[k]}`;
			mesh.userData.animatedSurface = ["uTex", "uFlowTex", "uOverlayTex"].some((key) =>
				hasFluidAnimation(mat.uniforms[key].value)
			);
			mesh.frustumCulled = true;
			if (k === K_WATER) mesh.renderOrder = 3; // after blocks, cutouts, and glass
			mesh.onBeforeRender = () => updateMaterialTime(mat, performance.now() / 1000);
			return mesh;
		};

		const mesh = assemble(cur);
		return mesh ? [mesh] : [];
	};

	const meshes: THREE.Mesh[] = [];
	if (hasWater) meshes.push(...buildKind(K_WATER));
	if (hasLava) meshes.push(...buildKind(K_LAVA));

	return { meshes, cells, bubbleCells, ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------
const live = new Set<THREE.ShaderMaterial>();
let textureSource: FluidTextures | null = null;

/** Optional explicit source; otherwise `globalThis.liquidFrameTextures` is used lazily. */
export function setFluidTextures(src: FluidTextures | null): void {
	textureSource = src;
	for (const m of live) {
		m.userData.bound = false;
		m.uniforms.uHasTex.value = 0;
		m.uniforms.uTex.value = null;
		m.uniforms.uFlowTex.value = null;
		tryBind(m);
	}
}

export function createFluidMaterial(kind: FluidKind, _logged = false): THREE.ShaderMaterial {
	const water = kind === "water";
	// convertLinearToSRGB: the pipeline is sRGB end-to-end (sRGB texels in, sRGB
	// framebuffer out, no conversions) — the Color constructor converts hex to
	// LINEAR working space, which collapsed the tint's luminance and rendered
	// the surface near-black ("really dark water")
	const tint = new THREE.Color(water ? 0x3f76e4 : 0xff6600).convertLinearToSRGB();
	const mat = new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: FLUID_VERT,
		fragmentShader: FLUID_FRAG,
		uniforms: {
			uTex: { value: null },
			uFlowTex: { value: null },
			uOverlayTex: { value: null },
			uOverlayFrame: { value: new THREE.Vector3() },
			uOpaque: { value: !water },
			uStillFrame: { value: new THREE.Vector3() },
			uFlowFrame: { value: new THREE.Vector3() },
			uHasTex: { value: 0 },
			uTint: { value: tint },
			uAlpha: { value: water ? WATER_OPACITY : 1 },
		},
		side: THREE.DoubleSide,
		forceSinglePass: true,
		transparent: water,
		depthWrite: !water,
		depthTest: true,
		// The host block wins coplanar ties on waterlogged faces.
		polygonOffset: water,
		polygonOffsetFactor: water ? 1 : 0,
		polygonOffsetUnits: water ? 1 : 0,
	});
	mat.userData.kind = kind;
	mat.userData.fluidAlpha = mat.uniforms.uAlpha.value;
	mat.userData.bound = false;
	live.add(mat);
	mat.addEventListener("dispose", () => live.delete(mat));
	tryBind(mat);
	return mat;
}

function tryBind(m: THREE.ShaderMaterial): void {
	const src: FluidTextures | undefined = textureSource ?? (globalThis as any).liquidFrameTextures;
	const water = m.userData.kind === "water";
	const tex = src?.[m.userData.kind as FluidKind] ?? null;
	const flow = (water ? src?.waterFlow : src?.lavaFlow) ?? tex;
	const overlay = (water ? src?.waterOverlay : null) ?? flow;
	const u = m.uniforms;
	if (u.uTex.value === tex && u.uFlowTex.value === flow && u.uOverlayTex.value === overlay) return;
	u.uTex.value = tex;
	u.uFlowTex.value = flow;
	u.uOverlayTex.value = overlay;
	u.uHasTex.value = tex ? 1 : 0;
}

function updateMaterialTime(m: THREE.ShaderMaterial, t: number): void {
	tryBind(m);
	const u = m.uniforms;
	if (u.uTex.value) u.uStillFrame.value.copy(fluidAnimationFrame(u.uTex.value, t));
	if (u.uFlowTex.value) u.uFlowFrame.value.copy(fluidAnimationFrame(u.uFlowTex.value, t));
	if (u.uOverlayTex.value) u.uOverlayFrame.value.copy(fluidAnimationFrame(u.uOverlayTex.value, t));
}

/** Optional external clock; mesh callbacks update only their own material. */
export function updateFluidTime(t: number): void {
	for (const m of live) updateMaterialTime(m, t);
}

export function disposeFluidMeshes(meshes: THREE.Mesh[]): void {
	for (const mesh of meshes) {
		mesh.parent?.remove(mesh);
		mesh.geometry.dispose();
		const mat = mesh.material as THREE.ShaderMaterial;
		live.delete(mat);
		mat.dispose();
	}
}
