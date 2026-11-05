// RecordRenderer.ts — Phase B of the records path: renders the 8B/triangle record
// stream DIRECTLY in WebGL2 via gl_VertexID vertex pulling. No vertex attributes, no
// vertex-data readback: the triangle stream lives in an RG32UI texture; template
// corners (positions already atlas-UV'd) in float textures; the shader expands
// block + template-corner on the fly, doing the same f32 add the compute mesher
// did (oracle-frozen arithmetic order).
import * as THREE from "three";

export interface RecordTables {
	// per template triangle row: (c0, c1, c2, _) — ABSOLUTE template vertex ids
	rowCorners: Uint32Array; // length rows*4
	rows: number;
	// template vertex tables (global ids)
	tplPos: Float32Array; // ×3
	tplNrm: Float32Array; // ×3
	tplUv: Float32Array; // ×2
	verts: number;
}

export interface RecordStream {
	// one concatenated record array per transparency category: pairs (cell, row)
	perCategory: { category: string; records: Uint32Array; tris: number }[];
	tables: RecordTables;
	sx: number;
	sy: number;
	sz: number;
}

const RW = 8192; // records texture width (chunk rows ≤ 1024 → ≤64MB per texture, D3D-cap-safe)
const TW = 1024; // template-table texture width (rows/verts textures)
const CHUNK_TRIS = RW * 1024; // records per chunk texture

// ---- section/page culling (the A/B gap vs schemat.io: our p95 was 2 vsync periods) ----
// Records are reordered into 16³-section-contiguous order at build time. Per frame the
// CPU frustum-culls section AABBs, sorts them front-to-back (back-to-front for the
// transparent category), and flattens visible 64-item "pages" into a small lookup
// texture. The vertex shader maps slot -> page -> real record, so culling + early-Z
// ordering cost ONE draw per category (no per-section meshes, no per-draw overhead).
const SEC = 16; // section edge in blocks
const PAGE = 64; // items (tris or quads) per page slot
const PW = 1024; // page-table texture width

export interface SectionRange {
	base: number; // first item index of this section (in the reordered stream)
	count: number; // items in this section
	box: [number, number, number, number, number, number]; // grid-space AABB (padded)
}

/** Reorder a record stream into 16³-section-contiguous order and return section ranges.
 * Pure permutation — the emission stream and oracle hashes are untouched.
 * Streams above SECTIONIZE_MAX items keep their original order with ONE whole-range
 * section: the reorder would double record memory (317M tris → +2.5GB) for little
 * culling benefit when the build fills the view anyway. */
export const SECTIONIZE_MAX = 40_000_000;
export function sectionize(
	records: Uint32Array,
	items: number,
	sx: number,
	sy: number,
	sz: number
): { rec: Uint32Array; sections: SectionRange[] } {
	if (items === 0) return { rec: records, sections: [] };
	if (items > SECTIONIZE_MAX) {
		return {
			rec: records,
			sections: [{ base: 0, count: items, box: [-2, -2, -2, sx + 2, sy + 2, sz + 2] }],
		};
	}
	const nx = Math.ceil(sx / SEC),
		ny = Math.ceil(sy / SEC),
		nz = Math.ceil(sz / SEC);
	const nSec = nx * ny * nz;
	// counting pass (section id recomputed in the scatter pass — no items-sized index array)
	const counts = new Uint32Array(nSec + 1);
	const secOfItem = (i: number) => {
		const cell = records[i * 2];
		const y = (cell / (sx * sz)) | 0;
		const z = ((cell / sx) | 0) % sz;
		const x = cell % sx;
		return ((x / SEC) | 0) + ((z / SEC) | 0) * nx + ((y / SEC) | 0) * nx * nz;
	};
	for (let i = 0; i < items; i++) counts[secOfItem(i) + 1]++;
	for (let s = 0; s < nSec; s++) counts[s + 1] += counts[s];
	const out = new Uint32Array(items * 2);
	const cursor = counts.slice(0, nSec);
	for (let i = 0; i < items; i++) {
		const o = cursor[secOfItem(i)]++;
		out[o * 2] = records[i * 2];
		out[o * 2 + 1] = records[i * 2 + 1];
	}
	const sections: SectionRange[] = [];
	for (let s = 0; s < nSec; s++) {
		const count = counts[s + 1] - counts[s];
		if (count === 0) continue;
		const y0 = ((s / (nx * nz)) | 0) * SEC;
		const z0 = (((s / nx) | 0) % nz) * SEC;
		const x0 = (s % nx) * SEC;
		const x1 = Math.min(sx, x0 + SEC) - 1,
			y1 = Math.min(sy, y0 + SEC) - 1,
			z1 = Math.min(sz, z0 + SEC) - 1;
		// pad generously: template geometry can leave the 0..1 cell (crosses, candles, …)
		const P = 2.0;
		sections.push({
			base: counts[s],
			count,
			box: [x0 - P, y0 - P, z0 - P, x1 + 1 + P, y1 + 1 + P, z1 + 1 + P],
		});
	}
	return { rec: out, sections };
}

/** Slice a sectionized stream into CHUNK_TRIS-sized record textures, clipping section
 * ranges to each chunk (a boundary splits at most one section; both halves keep the box). */
function chunkWithSections(
	rec: Uint32Array,
	sections: SectionRange[],
	_chunk: number
): { rec: Uint32Array; items: number; sections: SectionRange[] }[] {
	const out: { rec: Uint32Array; items: number; sections: SectionRange[] }[] = [];
	for (let base = 0; base < sectionsTotal(sections); base += CHUNK_TRIS) {
		const items = Math.min(CHUNK_TRIS, sectionsTotal(sections) - base);
		const clipped: SectionRange[] = [];
		for (const s of sections) {
			const a = Math.max(s.base, base),
				b = Math.min(s.base + s.count, base + items);
			if (a < b) clipped.push({ base: a - base, count: b - a, box: s.box });
		}
		out.push({ rec: rec.subarray(base * 2, (base + items) * 2), items, sections: clipped });
	}
	if (out.length === 0) out.push({ rec: new Uint32Array(0), items: 0, sections: [] });
	return out;
}
function sectionsTotal(sections: SectionRange[]): number {
	let n = 0;
	for (const s of sections) n = Math.max(n, s.base + s.count);
	return n;
}

/** Per-frame page-table culling. Attached as mesh.onBeforeRender. */
function attachSectionCulling(
	mesh: THREE.Mesh,
	sections: SectionRange[],
	pageTable: THREE.DataTexture,
	pageData: Uint32Array,
	perItem: number, // 3 (tri) or 6 (quad — drawRange is in index units)
	backToFront: boolean
): void {
	const frustum = new THREE.Frustum();
	const vp = new THREE.Matrix4();
	const worldBoxes = sections.map(() => new THREE.Box3());
	const gridBoxes = sections.map(
		(s) =>
			new THREE.Box3(
				new THREE.Vector3(s.box[0], s.box[1], s.box[2]),
				new THREE.Vector3(s.box[3], s.box[4], s.box[5])
			)
	);
	const order: number[] = [];
	mesh.onBeforeRender = (_renderer, _scene, camera) => {
		// strip animation clock (liquid still/flow)
		const mat = mesh.material as THREE.ShaderMaterial;
		if (mat.uniforms?.uTime) mat.uniforms.uTime.value = performance.now() / 1000;
		// lazy-bind the liquid frame array (registered by AssetLoader after atlas build)
		if (
			mat.uniforms?.uWaterFramesOn &&
			mat.uniforms.uWaterFramesOn.value === 0 &&
			liquidFrameTextures.water
		) {
			mat.uniforms.uWaterFrames.value = liquidFrameTextures.water;
			mat.uniforms.uWaterFramesOn.value = 1;
		}
		vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		frustum.setFromProjectionMatrix(vp);
		// update ancestors too: the schematic group REPOSITIONS per build (each load
		// centers a different-sized build), and matrixAutoUpdate=false never refreshes
		// matrixWorld from a moved parent — stale world boxes culled visible sections
		// ("blocks vanish from afar, appear elsewhere as the view changes")
		mesh.updateWorldMatrix(true, false);
		for (let i = 0; i < gridBoxes.length; i++)
			worldBoxes[i].copy(gridBoxes[i]).applyMatrix4(mesh.matrixWorld);
		order.length = 0;
		const cp = camera.getWorldPosition(new THREE.Vector3());
		for (let i = 0; i < worldBoxes.length; i++)
			if (frustum.intersectsBox(worldBoxes[i])) order.push(i);
		order.sort((a, b) => {
			const da = boxDistSq(worldBoxes[a], cp),
				db = boxDistSq(worldBoxes[b], cp);
			return backToFront ? db - da : da - db;
		});
		// flatten visible sections into pages
		let p = 0;
		for (const si of order) {
			const s = sections[si];
			for (let o = 0; o < s.count; o += PAGE) {
				if (p * 2 + 1 >= pageData.length) break;
				pageData[p * 2] = s.base + o;
				pageData[p * 2 + 1] = Math.min(PAGE, s.count - o);
				p++;
			}
		}
		for (let i = p; i < pageData.length / 2; i++) {
			pageData[i * 2] = 0;
			pageData[i * 2 + 1] = 0;
		}
		pageTable.needsUpdate = true;
		(mesh as any).userData.pagesDrawn = p;
		// the quad path's drawRange is in INDEX units: page padding can push the count
		// past the static index buffer's end (quads not divisible by PAGE) — GL then
		// rejects the entire draw and NOTHING renders. Padded slots have no backing
		// indices, so clamping to the buffer is lossless.
		const cap = mesh.geometry.index ? mesh.geometry.index.count : Infinity;
		mesh.geometry.setDrawRange(0, Math.min(p * PAGE * perItem, cap));
	};
	// safety net for direct draws before the first onBeforeRender fires: all pages
	mesh.userData.pagesDrawn = Math.ceil(sectionsTotal(sections) / PAGE);
}
function boxDistSq(b: THREE.Box3, p: THREE.Vector3): number {
	const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
	const dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y);
	const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
	return dx * dx + dy * dy + dz * dz;
}

// Vertex pulling per the Opus r184 recipe: EMPTY BufferGeometry (no attributes — a dummy
// position would CLAMP the drawRange), drawRange = tris×3, manual boundingSphere.
// ShaderMaterial (not Raw): three provides matrix uniforms + tone/colorspace chunks.
// NOTE: don't reuse three's reserved names (position/normal/uv) for varyings/uniforms.
const PULL_VERT = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;
uniform highp usampler2D uRecords;  // RG32UI: (linear cell index, template triangle row)
uniform highp usampler2D uRows;     // RGBA32UI: (c0, c1, c2, _) absolute template vertex ids
uniform highp usampler2D uPages;    // RG32UI: (base item, count) per ${PAGE}-item page
uniform highp sampler2D uPos;       // RGBA32F corner positions (block-local)
uniform highp sampler2D uNrm;       // RGBA32F
uniform highp sampler2D uUv;        // RGBA32F atlas-space uvs
uniform vec3 uDims;                 // sx, sy, sz (vec3 — uvec3 uniform setters vary)
uniform vec4 uPow2;                 // (xMask, zShiftZMask, yShift, enabled) — pow2 fast decode (gpt-6 #3)
out vec2 vUv;
out float vShade;
out float vWy;
out float vCy;
// strip animation (liquid still/flow): signed frames, frame step, frame-0 top V.
// FLAT: these are per-face constants; interpolating them lets a quad straddle
// two parameter sets and feeds a varying into fragment control flow.
flat out float vAnimF;
flat out float vStep;
flat out float vTop;
// fable water: full world position (smooth) + face normal (flat) for the frame-array path
out vec3 vWp;
flat out vec3 vNw;
uniform vec2 uLayerClip; // (enabled, topY) — slice view: discard fragments above grid Y
void main() {
  uint vid = uint(gl_VertexID);
  // slot -> page -> real record (culling happens by rewriting the page table per frame)
  uint slot = vid / 3u;
  uint k = vid - slot * 3u;
  uint page = slot / ${PAGE}u;
  uint local = slot - page * ${PAGE}u;
  uvec2 pe = texelFetch(uPages, ivec2(int(page & ${PW - 1}u), int(page / ${PW}u)), 0).rg;
  if (local >= pe.y) { gl_Position = vec4(2e9, 2e9, 2e9, 1.0); return; } // padded slot
  uint tri = pe.x + local;
  uvec2 rec = texelFetch(uRecords, ivec2(int(tri & ${RW - 1}u), int(tri / ${RW}u)), 0).rg;
  uint cell = rec.x;
  uint row = rec.y;
  uint sx = uint(uDims.x), sy = uint(uDims.y), sz = uint(uDims.z);
  // pow2 dims avoid three runtime integer div/mod per vertex (uniform branch, cheap);
  // the general path stays for builds like 64x48x64 whose sy isn't a power of two
  uvec3 bc;
  if (uPow2.w > 0.5) {
    bc = uvec3(cell & uint(uPow2.x), cell >> uint(uPow2.z), (cell >> uint(uPow2.y)) & uint(uPow2.x));
  } else {
    bc = uvec3(cell % sx, cell / (sx * sz), (cell / sx) % sz); // x, y, z
  }
  uvec4 corners = texelFetch(uRows, ivec2(int(row) & ${TW - 1}, int(row) / ${TW}), 0);
  uint vi = k == 0u ? corners.x : (k == 1u ? corners.y : corners.z);
  ivec2 ct = ivec2(int(vi) & ${TW - 1}, int(vi) / ${TW});
  vec3 pos = texelFetch(uPos, ct, 0).xyz;
  vUv = texelFetch(uUv, ct, 0).xy;
  // Fixed WORLD-space face shading (vanilla-style: top 1.0, bottom 0.5, z 0.8, x 0.6).
  // The previous view-space light (normalMatrix * n dotted with a fixed dir) made the
  // bright/dark set reshuffle with every camera move — the "black/white checker that
  // flickers when moving" artifact. Template normals are grid-space = world-space.
  vec3 wn = texelFetch(uNrm, ct, 0).xyz;
  float ax = abs(wn.x), ay = abs(wn.y), az = abs(wn.z);
  vShade = (ay >= ax && ay >= az) ? (wn.y > 0.0 ? 1.0 : 0.5) : (az >= ax ? 0.8 : 0.6);
  // oracle-frozen arithmetic: same componentwise f32 add the compute mesher performs
  vec3 world = vec3(bc) + pos;
  vWy = world.y;
  vCy = float(bc.y); // owning CELL y — layer slicing is cell-aligned, not a geometry cut
  // animation channels ride in the free w components of the corner tables
  vAnimF = texelFetch(uUv, ct, 0).w;
  vStep = texelFetch(uPos, ct, 0).w;
  vTop = texelFetch(uNrm, ct, 0).w;
  // world position + normal for the water frame-array path (fable)
  vWp = world;
  vNw = wn;
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(world, 1.0));
}`;

const PULL_VERT_QUAD = PULL_VERT.replace("uint slot = vid / 3u;", "uint slot = vid / 4u;")
	.replace("uint k = vid - slot * 3u;", "uint k = vid - slot * 4u;")
	// the tri-path ternary only handles k in 0..2; quad corner 3 fell through to
	// corner 2 (collapsing the second triangle — the "half texture" bug)
	.replace(
		"uint vi = k == 0u ? corners.x : (k == 1u ? corners.y : corners.z);",
		"uint vi = k == 0u ? corners.x : (k == 1u ? corners.y : (k == 2u ? corners.z : corners.w));"
	);

const PULL_FRAG_BASE = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uAtlas;
uniform sampler2DArray uWaterFrames; // fable: liquid frames as array LAYERS (hardware wrap, no atlas bleed)
uniform float uWaterFramesOn;        // 1.0 when the array texture is loaded
uniform vec2 uLayerClip;
uniform float uShadeMix;
uniform float uTime;
in vec2 vUv;
in float vShade;
in float vWy;
in float vCy;
// per-primitive constants: flat, so a quad never blends two faces' parameters
flat in float vAnimF;
flat in float vStep;
flat in float vTop;
in vec3 vWp;
flat in vec3 vNw;
layout(location = 0) out vec4 outColor;

// ONE world-space flow for the whole water body (blocks per second).
// Tops scroll by (x,z); x-normal sides scroll along z by WATER_FLOW.y; z-normal
// sides scroll along x by WATER_FLOW.x; every side also falls by WATER_FALL.
// Shared edges therefore move identically on both faces ("one continuous flow").
const vec2  WATER_FLOW = vec2(0.045, 0.030);
const float WATER_FALL = 0.090;
const float WATER_FPS  = 5.0;
const float WATER_TEXELS_PER_BLOCK = 16.0;
// second octave at 1/4 scale breaks the 1-block tile period (same mean, same flow)
const float WATER_OCT2_SCALE = 0.25;
const float WATER_OCT2_MIX   = 0.35;

// two-frame cross-fade at ONE explicit LOD (no implicit derivatives anywhere in
// the water path -> defined regardless of the enclosing non-uniform branch)
vec4 waterTap(vec2 uv, float k0, float k1, float fk, float lod) {
  vec4 a = textureLod(uWaterFrames, vec3(uv, k0), lod);
  vec4 b = textureLod(uWaterFrames, vec3(uv, k1), lod);
  return mix(a, b, fk);
}

void main() {
  // ---- ALL derivatives up front, in uniform control flow, before any discard ----
  // atlas path
  vec2 duv = vUv * 2048.0;
  float dx2 = dot(dFdx(duv), dFdx(duv));
  float dy2 = dot(dFdy(duv), dFdy(duv));
  float lod = 0.5 * log2(max(dx2, dy2));

  // water path: world-space uv for THIS face (normal is flat -> constant per primitive)
  vec3 an = abs(vNw);
  vec2 wuv;
  vec2 scroll;
  if (an.y > 0.5) {
    wuv = vWp.xz;
    scroll = WATER_FLOW;
  } else if (an.x > 0.5) {
    wuv = vWp.zy;
    scroll = vec2(WATER_FLOW.y, WATER_FALL);
  } else {
    wuv = vWp.xy;
    scroll = vec2(WATER_FLOW.x, WATER_FALL);
  }
  // scroll is spatially constant, so it does not change the derivatives
  wuv += scroll * uTime;
  vec2 wduv = wuv * WATER_TEXELS_PER_BLOCK;
  float wdx2 = dot(dFdx(wduv), dFdx(wduv));
  float wdy2 = dot(dFdy(wduv), dFdy(wduv));
  // ISOTROPIC (max-axis) LOD: the footprint's long axis decides, so the result does
  // not depend on footprint orientation -> no view-direction-dependent mip patchwork.
  // Level 4 of a 16x16 layer is its 1x1 mean: distance converges to a uniform sheet.
  float wlod = clamp(0.5 * log2(max(max(wdx2, wdy2), 1e-12)), 0.0, 4.0);
  // 1/4-scale octave has 4x fewer texels per pixel -> two levels sharper
  float wlod2 = clamp(wlod - 2.0, 0.0, 4.0);

  // layer slice, CELL-aligned: partial geometry (fences are 1.5 tall, slabs 0.5)
  // belongs wholly to its owning cell, so Minecraft layer view must cut on bc.y,
  // not on world Y (a Y-plane halves fences/panes at layer boundaries)
  if (uLayerClip.x > 0.5 && vCy > uLayerClip.y + 0.5) discard;

  // Cap atlas mip selection at level 4 (a 16px tile is 1px there): levels 5+ average
  // across atlas tiles — foreign colors and the transparent padding between tiles.
  // ISOTROPIC textureLod, not textureGrad: anisotropic footprints at the LOD-4 cap
  // stretch flat-on wall faces ACROSS neighbouring atlas tiles.
  vec4 c;
  if (vAnimF != 0.0 && uWaterFramesOn > 0.5) {
    // fable WATER ARRAY PATH: frames are array LAYERS (16x16 each) with hardware
    // RepeatWrapping; uvs are world coordinates (continuous across every block
    // boundary by construction); nothing can sample outside the water texture.
    float nFrames = float(textureSize(uWaterFrames, 0).z);
    float ft = mod(uTime * WATER_FPS, nFrames);
    float k0 = floor(ft);
    float k1 = mod(k0 + 1.0, nFrames);
    float fk = ft - k0;
    vec4 c1 = waterTap(wuv, k0, k1, fk, wlod);
    vec4 c2 = waterTap(wuv * WATER_OCT2_SCALE + vec2(0.37, 0.61), k0, k1, fk, wlod2);
    c = mix(c1, c2, WATER_OCT2_MIX);
  } else {
    vec2 tuv = vUv;
    if (vAnimF > 0.5) {
      float k = floor(mod(uTime * 5.0, vAnimF));
      float lv = clamp(vUv.y - (vTop - vStep), 0.03 * vStep, 0.97 * vStep);
      tuv.y = (vTop - vStep) + lv - k * vStep;
    } else if (vAnimF < -0.5) {
      float frames = -vAnimF;
      float k = floor(mod(uTime * 5.0, frames));
      float q = clamp(fract(vWy * 0.5 + uTime * 0.25), 0.03, 0.97);
      tuv.y = (vTop - k * vStep) - q * vStep;
      float lu = clamp(fract(vUv.x / vStep), 0.03, 0.97);
      float u0 = vUv.x - lu * vStep;
      tuv.x = u0 + fract(lu + vWp.x + vWp.z + uTime * 0.08) * vStep;
    }
    c = textureLod(uAtlas, tuv, min(lod, 4.0));
  }
  /*CUTOUT*/
  // uShadeMix: 1.0 = full vanilla directional shade (opaque blocks); transparent
  // materials (water) soften toward 1.0 — vanilla's 0.5 bottom-face shade makes
  // water read near-black when looked at from below ("dark blue from underneath")
  outColor = vec4(c.rgb * mix(1.0, vShade, uShadeMix), /*ALPHA*/);
  #ifdef TONE_MAPPING
    outColor.rgb = toneMapping(outColor.rgb);
  #endif
  outColor = linearToOutputTexel(outColor);
}`;

/** Fresh material per mesh (uniforms carry per-mesh textures; the compiled program is
 *  shared automatically by three's program cache). */
/** Liquid animation frames as array-texture layers, registered by AssetLoader at
 * atlas build (fable design: hardware RepeatWrapping per layer — no atlas bleed). */
export const liquidFrameTextures: {
	water: THREE.DataArrayTexture | null;
	waterFlow: THREE.DataArrayTexture | null;
	lava: THREE.DataArrayTexture | null;
	lavaFlow: THREE.DataArrayTexture | null;
	waterOverlay: THREE.DataArrayTexture | null;
} = {
	water: null,
	waterFlow: null,
	lava: null,
	lavaFlow: null,
	waterOverlay: null,
};

export function makePullMaterial(transparent: boolean, quad = false): THREE.ShaderMaterial {
	// discard kills early-Z on the OPAQUE pass (measured: 320ms/frame up close on 30M
	// tris) — the solid material is discard-free; only the transparent pass keeps cutout
	const frag = transparent
		? PULL_FRAG_BASE.replace("/*CUTOUT*/", "if (c.a < 0.5) discard;").replace("/*ALPHA*/", "c.a")
		: PULL_FRAG_BASE.replace("/*CUTOUT*/", "").replace("/*ALPHA*/", "1.0");
	return new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: quad ? PULL_VERT_QUAD : PULL_VERT,
		fragmentShader: frag,
		transparent,
		depthWrite: !transparent,
		side: THREE.FrontSide,
		forceSinglePass: true,
		uniforms: {
			uRecords: { value: null },
			uRows: { value: null },
			uPages: { value: null },
			uPos: { value: null },
			uNrm: { value: null },
			uUv: { value: null },
			uAtlas: { value: null },
			uDims: { value: new THREE.Vector3(1, 1, 1) },
			uPow2: { value: new THREE.Vector4(0, 0, 0, 0) }, // (xMask, xBits, yShift, enabled)
			uLayerClip: { value: new THREE.Vector2(0, 1e9) },
			// transparent (water/glass): NO directional shading — vShade varies by face
			// (top 1.0 / bottom 0.5) which reads as water changing color with view
			// angle. Opaque blocks keep full vanilla shading for 3D read.
			uShadeMix: { value: transparent ? 0.0 : 1.0 },
			uTime: { value: 0 }, // strip animation clock (set per frame in onBeforeRender)
			uWaterFrames: { value: null },
			uWaterFramesOn: { value: 0 },
		},
	});
}

// NOTE: DataTexture requires image.data.length === w*h*components EXACTLY — a shorter
// array fails the texSubImage2D upload with INVALID_OPERATION and every fetch reads garbage
function padToFull(w: number, h: number, data: Uint32Array, chans: number): Uint32Array {
	// Pad by the format's channels. Padding RG (2/texel) to RGBA size silently COPIED
	// the array — the texture then owned a different buffer than the caller's, so
	// per-frame mutations (the page table!) never reached the GPU and everything
	// rendered from zeros (all pages degenerate → invisible build).
	if (data.length >= w * h * chans) return data;
	const full = new Uint32Array(w * h * chans);
	full.set(data);
	return full;
}
function padToFullF(w: number, h: number, data: Float32Array): Float32Array {
	if (data.length >= w * h * 4) return data;
	const full = new Float32Array(w * h * 4);
	full.set(data);
	return full;
}
function makeUintTex(
	w: number,
	h: number,
	data: Uint32Array,
	format: THREE.PixelFormat,
	internal: string
) {
	const chans = format === THREE.RGIntegerFormat ? 2 : 4; // RG32UI packs 2 uints/texel
	data = padToFull(w, h, data, chans);
	const tex = new THREE.DataTexture(data, w, h, format, THREE.UnsignedIntType);
	(tex as any).internalFormat = internal; // explicit per the r184 recipe
	tex.needsUpdate = true;
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	return tex;
}
function makeFloatTex(w: number, h: number, data: Float32Array) {
	data = padToFullF(w, h, data);
	const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
	(tex as any).internalFormat = "RGBA32F";
	tex.needsUpdate = true;
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	return tex;
}

/** Build the pulling meshes from a record stream. One mesh per category; each mesh gets
 *  its OWN material instance (uniforms carry per-mesh textures; three still shares the
 *  compiled program across identical ShaderMaterials). drawRange drives the draws;
 *  bounding volumes are set manually from the grid bounds. */
// Quad-merge: template quads are emitted as two ADJACENT triangle records (same cell,
// consecutive rows, pattern [a,b,c]+[a,c,d]). Merging them in JS (not in the shader —
// the emission stream stays oracle-frozen) lets quads render through a shared static
// index buffer [0,1,2, 0,2,3]: drawElements runs 4 vertex invocations per quad instead
// of 6. Rows that don't pair up (stairs, plants, partial faces) stay as tri records.
export function quadify(
	records: Uint32Array,
	tris: number,
	isQuadPair: (
		rowA: number,
		rowB: number
	) => { quad: boolean; corners: [number, number, number, number] | null }
): {
	quadRec: Uint32Array;
	quads: number;
	cornerTable: number[];
	triRec: Uint32Array;
	triTris: number;
} {
	// Records from different cells INTERLEAVE within a segment (atomic emission order),
	// so stream adjacency can't be trusted — pair via a pending map keyed by cell. Rows
	// emit in ascending order per cell, so a quad-start row always precedes its partner.
	const quadStartMemo = new Map<number, [number, number, number, number] | null>();
	const cornersFor = (row: number) => {
		if (!quadStartMemo.has(row)) {
			const q = isQuadPair(row, row + 1);
			quadStartMemo.set(row, q.quad ? q.corners : null);
		}
		return quadStartMemo.get(row)!;
	};
	const cornerTable: number[] = [];
	const quadRowByKey = new Map<string, number>();
	// typed arrays, not number[]: at boss scale (hundreds of millions of records) the
	// boxed JS arrays cost gigabytes and pushed the renderer process past its memory
	// ceiling (tab crash). Worst case bounds: quads <= tris/2, unpaired tris <= tris.
	const quadCells = new Uint32Array(Math.ceil(tris / 2));
	const quadRows = new Uint32Array(Math.ceil(tris / 2));
	const triRecArr = new Uint32Array(tris * 2);
	let nQuads = 0,
		nTri = 0;
	const consumed = new Uint8Array(tris);
	const pending = new Map<number, number>(); // cell -> stream index of the awaiting quad-start record
	for (let i = 0; i < tris; i++) {
		const cell = records[i * 2],
			row = records[i * 2 + 1];
		const prev = pending.get(cell);
		if (prev !== undefined && records[prev * 2 + 1] === row - 1) {
			const corners = cornersFor(row - 1);
			if (corners) {
				const key = corners.join(",");
				let qr = quadRowByKey.get(key);
				if (qr === undefined) {
					qr = cornerTable.length / 4;
					cornerTable.push(corners[0], corners[1], corners[2], corners[3]);
					quadRowByKey.set(key, qr);
				}
				quadCells[nQuads] = cell;
				quadRows[nQuads] = qr;
				nQuads++;
				consumed[prev] = 1;
				consumed[i] = 1;
				pending.delete(cell);
				continue;
			}
		}
		pending.set(cell, i);
	}
	const quadRec = new Uint32Array(nQuads * 2);
	for (let q = 0; q < nQuads; q++) {
		quadRec[q * 2] = quadCells[q];
		quadRec[q * 2 + 1] = quadRows[q];
	}
	for (let i = 0; i < tris; i++) {
		if (!consumed[i]) {
			triRecArr[nTri++] = records[i * 2];
			triRecArr[nTri++] = records[i * 2 + 1];
		}
	}
	return {
		quadRec,
		quads: nQuads,
		cornerTable,
		triRec: triRecArr.subarray(0, nTri),
		triTris: nTri / 2,
	};
}

// static shared quad index pattern: 6 indices per quad, 4 corner invocations
export function makeQuadIndexBuffer(maxQuads: number): THREE.BufferAttribute {
	const idx = new Uint32Array(maxQuads * 6);
	for (let q = 0, v = 0, j = 0; q < maxQuads; q++, v += 4) {
		idx[j++] = v;
		idx[j++] = v + 1;
		idx[j++] = v + 2;
		idx[j++] = v;
		idx[j++] = v + 2;
		idx[j++] = v + 3;
	}
	return new THREE.BufferAttribute(idx, 1);
}

export function makeRecordMeshes(
	stream: RecordStream,
	atlas: THREE.Texture,
	isQuadPair?: (
		rowA: number,
		rowB: number
	) => { quad: boolean; corners: [number, number, number, number] | null }
): THREE.Mesh[] {
	const t = stream.tables;
	const rowH = Math.ceil(t.rows / TW);
	const posH = Math.ceil(t.verts / TW);
	const posTex = makeFloatTex(TW, posH, t.tplPos);
	const nrmTex = makeFloatTex(TW, posH, t.tplNrm);
	const uvTex = makeFloatTex(TW, posH, t.tplUv);
	const rowTex = makeUintTex(TW, rowH, t.rowCorners, THREE.RGBAIntegerFormat, "RGBA32UI");

	const meshes: THREE.Mesh[] = [];
	for (const cat of stream.perCategory) {
		if (cat.tris === 0) continue;
		const transparent = cat.category !== "solid";
		const y0 = (cat as any).y0 ?? 0,
			sh = (cat as any).h ?? stream.sy;
		// quad-merge pass (JS-side; emission stream untouched): pairs of adjacent
		// same-cell records whose template rows form [a,b,c]+[a,c,d] become ONE quad
		// record drawn via the shared static index pattern (4 invocations, not 6)
		let quadData: { quadRec: Uint32Array; quads: number; cornerTable: number[] } | null = null;
		let triRec = cat.records,
			triTris = cat.tris;
		if (isQuadPair) {
			const q = quadify(cat.records, cat.tris, isQuadPair);
			quadData = { quadRec: q.quadRec, quads: q.quads, cornerTable: q.cornerTable };
			triRec = q.triRec;
			triTris = q.triTris;
		}
		// section-order both streams (pure permutation) for page culling
		const triSec = sectionize(triRec, triTris, stream.sx, stream.sy, stream.sz);
		const quadSec = quadData
			? sectionize(quadData.quadRec, quadData.quads, stream.sx, stream.sy, stream.sz)
			: null;
		for (const chunk of chunkWithSections(triSec.rec, triSec.sections, CHUNK_TRIS)) {
			const { rec, items: n, sections } = chunk;
			if (n === 0) continue;
			// chunk-local records texture (tail padded to full rows)
			const rows = Math.ceil(n / RW);
			const buf = new Uint32Array(rows * RW * 2);
			buf.set(rec);
			const recTex = makeUintTex(RW, rows, buf, THREE.RGIntegerFormat, "RG32UI");
			// page table (all-visible initially; onBeforeRender rewrites it per frame)
			const maxPages = Math.ceil(n / PAGE);
			const pageData = new Uint32Array(PW * Math.ceil(maxPages / PW) * 2);
			const pageTex = makeUintTex(
				PW,
				Math.ceil(maxPages / PW),
				pageData,
				THREE.RGIntegerFormat,
				"RG32UI"
			);
			const material = makePullMaterial(transparent);
			// WATER depth-writes (vanilla's translucent pass does too): without it,
			// looking through N stacked water shells alpha-compounds (0.84^N) and the
			// color shifts with view angle/depth; with it only the front shell blends
			// — one stable water color from every angle (fable invariance consult)
			if (cat.category === "water") material.depthWrite = true;
			material.uniforms.uRecords.value = recTex;
			material.uniforms.uRows.value = rowTex;
			material.uniforms.uPages.value = pageTex;
			material.uniforms.uPos.value = posTex;
			material.uniforms.uNrm.value = nrmTex;
			material.uniforms.uUv.value = uvTex;
			material.uniforms.uDims.value.set(stream.sx, stream.sy, stream.sz);
			// pow2 fast decode when the footprint is square and a power of two
			{
				const b = Math.log2(stream.sx);
				const ok = stream.sx === stream.sz && Number.isInteger(b) && stream.sx > 0;
				material.uniforms.uPow2.value.set(
					ok ? stream.sx - 1 : 0,
					ok ? b : 0,
					ok ? b * 2 : 0,
					ok ? 1 : 0
				);
			}
			material.uniforms.uAtlas.value = atlas;
			// EMPTY geometry (no attributes — a dummy position would CLAMP the draw);
			// drawRange carries the vertex count, manual bounds carry culling
			const geometry = new THREE.BufferGeometry();
			geometry.setDrawRange(0, Math.ceil(n / PAGE) * PAGE * 3);
			geometry.boundingBox = new THREE.Box3(
				new THREE.Vector3(-0.51, y0 - 0.51, -0.51),
				new THREE.Vector3(stream.sx - 0.49, y0 + sh + 0.01, stream.sz - 0.49)
			);
			geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
			const mesh = new THREE.Mesh(geometry, material);
			mesh.userData.category = cat.category;
			mesh.userData.gpuBuilt = true;
			mesh.userData.recordDrawn = n;
			mesh.frustumCulled = true;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			attachSectionCulling(mesh, sections, pageTex, pageData, 3, transparent);
			meshes.push(mesh);
		}
		// quad meshes: shared static index pattern + drawRange in INDEX units. Chunked —
		// the single-mesh variant allocated ONE maxQuads*6 index buffer, which on the
		// 317M-triangle boss exceeded the maximum typed-array size and killed the whole
		// GPU path ("RangeError: Array buffer allocation failed").
		if (quadData && quadData.quads > 0) {
			const QUAD_CHUNK = 12_000_000; // 288MB index buffer per mesh
			const cornerTable = new Uint32Array(Math.max(quadData.cornerTable.length, TW * 4));
			cornerTable.set(quadData.cornerTable);
			const rowTexQ = makeUintTex(
				TW,
				Math.ceil(cornerTable.length / 4 / TW),
				cornerTable,
				THREE.RGBAIntegerFormat,
				"RGBA32UI"
			);
			for (const qchunk of chunkWithSections(quadSec!.rec, quadSec!.sections, QUAD_CHUNK)) {
				const { rec: qrec, items: nQ, sections: qsections } = qchunk;
				if (nQ === 0) continue;
				const rowsQ = Math.ceil(nQ / RW);
				const bufQ = new Uint32Array(rowsQ * RW * 2);
				bufQ.set(qrec);
				const recTexQ = makeUintTex(RW, rowsQ, bufQ, THREE.RGIntegerFormat, "RG32UI");
				const material = makePullMaterial(transparent, true);
				if (cat.category === "water") material.depthWrite = true; // see tri path note
				material.uniforms.uRecords.value = recTexQ;
				material.uniforms.uRows.value = rowTexQ;
				material.uniforms.uPos.value = posTex;
				material.uniforms.uNrm.value = nrmTex;
				material.uniforms.uUv.value = uvTex;
				material.uniforms.uDims.value.set(stream.sx, stream.sy, stream.sz);
				// pow2 fast decode when the footprint is square and a power of two
				{
					const b = Math.log2(stream.sx);
					const ok = stream.sx === stream.sz && Number.isInteger(b) && stream.sx > 0;
					material.uniforms.uPow2.value.set(
						ok ? stream.sx - 1 : 0,
						ok ? b : 0,
						ok ? b * 2 : 0,
						ok ? 1 : 0
					);
				}
				material.uniforms.uAtlas.value = atlas;
				const maxPagesQ = Math.ceil(nQ / PAGE);
				const pageDataQ = new Uint32Array(PW * Math.ceil(maxPagesQ / PW) * 2);
				const pageTexQ = makeUintTex(
					PW,
					Math.ceil(maxPagesQ / PW),
					pageDataQ,
					THREE.RGIntegerFormat,
					"RG32UI"
				);
				material.uniforms.uPages.value = pageTexQ;
				const geometry = new THREE.BufferGeometry();
				geometry.setIndex(makeQuadIndexBuffer(nQ));
				geometry.setDrawRange(0, Math.min(Math.ceil(nQ / PAGE) * PAGE * 6, nQ * 6));
				geometry.boundingBox = new THREE.Box3(
					new THREE.Vector3(-0.51, y0 - 0.51, -0.51),
					new THREE.Vector3(stream.sx - 0.49, y0 + sh + 0.01, stream.sz - 0.49)
				);
				geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
				const mesh = new THREE.Mesh(geometry, material);
				mesh.userData.category = cat.category;
				mesh.userData.gpuBuilt = true;
				mesh.userData.recordDrawn = nQ;
				mesh.matrixAutoUpdate = false;
				mesh.updateMatrix();
				attachSectionCulling(mesh, qsections, pageTexQ, pageDataQ, 6, transparent);
				meshes.push(mesh);
			}
		}
	}
	return meshes;
}

export function buildRecordTables(
	tplPos: number[],
	tplNrm: number[],
	tplUv: number[],
	tplIdx: number[],
	desc: number[], // flat [vertStart, idxStart, triStart, occ] per state (stride 4)
	desc2: number[], // flat [vertCount, idxCount, category, slotBase] per state (stride 4)
	states: number, // maxIdx
	tplPosW: number[] = [], // per-vertex anim frame step (pos.w)
	tplNrmW: number[] = [], // per-vertex anim frame-top V (nrm.w)
	tplUvW: number[] = [] // per-vertex signed anim frames (uv.w)
): RecordTables {
	const verts = tplPos.length / 3;
	const padPos = new Float32Array(verts * 4);
	const padNrm = new Float32Array(verts * 4);
	const padUv = new Float32Array(verts * 4);
	for (let v = 0; v < verts; v++) {
		padPos[v * 4] = tplPos[v * 3];
		padPos[v * 4 + 1] = tplPos[v * 3 + 1];
		padPos[v * 4 + 2] = tplPos[v * 3 + 2];
		padNrm[v * 4] = tplNrm[v * 3];
		padNrm[v * 4 + 1] = tplNrm[v * 3 + 1];
		padNrm[v * 4 + 2] = tplNrm[v * 3 + 2];
		padUv[v * 4] = tplUv[v * 2];
		padUv[v * 4 + 1] = tplUv[v * 2 + 1];
		padPos[v * 4 + 3] = tplPosW[v] || 0;
		padNrm[v * 4 + 3] = tplNrmW[v] || 0;
		padUv[v * 4 + 3] = tplUvW[v] || 0;
	}
	// one row per template triangle across all states, corners as ABSOLUTE template vertex ids
	let rows = 0;
	for (let p = 1; p <= states; p++) rows += Math.floor(desc2[p * 4 + 1] / 3);
	const rowCorners = new Uint32Array(Math.max(rows, 1) * 4);
	let w = 0;
	for (let p = 1; p <= states; p++) {
		const idxStart = desc[p * 4 + 1];
		const n = Math.floor(desc2[p * 4 + 1] / 3);
		for (let r = 0; r < n; r++) {
			rowCorners[w * 4] = tplIdx[idxStart + r * 3];
			rowCorners[w * 4 + 1] = tplIdx[idxStart + r * 3 + 1];
			rowCorners[w * 4 + 2] = tplIdx[idxStart + r * 3 + 2];
			w++;
		}
	}
	return { rowCorners, rows: Math.max(w, 1), tplPos: padPos, tplNrm: padNrm, tplUv: padUv, verts };
}
