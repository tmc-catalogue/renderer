import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync, MeshBuilder } from "../wasm/mesh_builder_wasm.js";
import { buildChunkGeometry, type ChunkResult, type PaletteGeometryData } from "./MeshBuilderCore";
import { MeshBuilderWorkerRuntime } from "./MeshBuilderWorkerRuntime";
import { WasmChunkEngine } from "./WasmChunkEngine";
import { CHUNK_INPUT_HEADER_SIZE } from "./SharedMemoryManager";

beforeAll(() => {
	const bytes = readFileSync(resolve(process.cwd(), "src/wasm/mesh_builder_wasm_bg.wasm"));
	initSync({ module: new Uint8Array(bytes) });
});

function geometry(category: string, materialIndex: number, source: THREE.BufferGeometry) {
	return {
		category,
		materialIndex,
		positions: source.getAttribute("position").array as Float32Array,
		normals: source.getAttribute("normal").array as Float32Array,
		uvs: source.getAttribute("uv").array as Float32Array,
		indices: Uint32Array.from(source.index!.array),
	};
}

function palette(...entries: PaletteGeometryData[]) {
	return new Map(entries.map((entry) => [entry.index, entry]));
}

/** Compare emitted triangle positions, UVs, normals and material rather than
 * incidental vertex/index ordering or padding. */
function triangles(result: ChunkResult) {
	const out: string[] = [];
	for (const mesh of result.meshes) {
		const scale = mesh.positions instanceof Int16Array ? 1 / 1024 : 1;
		for (const group of mesh.groups)
			for (let i = group.start; i < group.start + group.count; i += 3) {
				const vertices = [];
				for (let j = 0; j < 3; j++) {
					const v = mesh.indices[i + j];
					vertices.push(
						[
							...Array.from(mesh.positions.subarray(v * 3, v * 3 + 3), (p, axis) =>
								Math.round((p * scale + result.origin[axis]) * 1024)
							),
							...mesh.normals.subarray(v * 3, v * 3 + 3),
							...Array.from(mesh.uvs.subarray(v * 2, v * 2 + 2), (u) => Math.round(u * 1e5)),
						].join(",")
					);
				}
				out.push(`${mesh.category}:${group.materialIndex}:${vertices.join(";")}`);
			}
	}
	return out.sort();
}

describe("CPU and actual checked-in WASM mesh parity", () => {
	it("keeps material passes and occlusion correct across chunks, including an apron", () => {
		const box = new THREE.BoxGeometry();
		const cutout = geometry("cutout", 1, box);
		const opaque = geometry("solid", 0, box);
		const blend = geometry("transparent", 2, box);
		const data = palette(
			{ index: 1, category: "solid", occlusionFlags: 63, geometries: [opaque] },
			{ index: 2, category: "cutout", occlusionFlags: 0, geometries: [cutout] },
			{ index: 3, category: "solid", occlusionFlags: 63, geometries: [opaque, blend] }
		);
		const request = {
			chunkId: "mixed",
			blocks: Int32Array.of(0, 0, 0, 1, 1, 0, 0, 2, 10, 0, 0, 3),
			apronBlocks: Int32Array.of(-1, 0, 0, 1),
			chunkOrigin: [0, 0, 0] as [number, number, number],
		};
		const wasm = new WasmChunkEngine();
		wasm.update(data);
		try {
			const cpu = buildChunkGeometry(request, data);
			const compiled = wasm.build(request, data);
			expect(triangles(compiled)).toEqual(triangles(cpu));
			expect(new Set(compiled.meshes.map((m) => m.category))).toEqual(
				new Set(["solid", "cutout", "transparent"])
			);
			// Solid x=0 retains its east face against cutout; cuts west against the apron.
			expect(cpu.meshes.find((m) => m.category === "solid")!.indices.length).toBe(66);
		} finally {
			wasm.dispose();
			box.dispose();
		}
	});

	it("preserves oversized chunk positions without the i16 overflow", () => {
		const box = new THREE.BoxGeometry();
		const data = palette({
			index: 1,
			category: "solid",
			occlusionFlags: 63,
			geometries: [geometry("solid", 0, box)],
		});
		const request = {
			chunkId: "large",
			blocks: Int32Array.of(0, 0, 0, 1, 40, 0, 0, 1),
			chunkOrigin: [0, 0, 0] as [number, number, number],
		};
		const wasm = new WasmChunkEngine();
		wasm.update(data);
		try {
			const cpu = buildChunkGeometry(request, data),
				compiled = wasm.build(request, data);
			expect(triangles(compiled)).toEqual(triangles(cpu));
			expect(compiled.meshes[0].positions).toBeInstanceOf(Float32Array);
			expect(Math.max(...compiled.meshes[0].positions)).toBe(40.5);
		} finally {
			wasm.dispose();
			box.dispose();
		}
	});

	it("preserves a slab's recessed underside when a full block is below it", () => {
		const box = new THREE.BoxGeometry();
		const topSlab = new THREE.BoxGeometry(1, 0.5, 1).translate(0, 0.25, 0);
		const data = palette(
			{ index: 1, category: "solid", occlusionFlags: 63, geometries: [geometry("solid", 0, box)] },
			{
				index: 2,
				category: "solid",
				occlusionFlags: 8,
				geometries: [geometry("solid", 1, topSlab)],
			}
		);
		const request = {
			chunkId: "slab",
			blocks: Int32Array.of(0, 0, 0, 1, 0, 1, 0, 2),
			chunkOrigin: [0, 0, 0] as [number, number, number],
		};
		const wasm = new WasmChunkEngine();
		wasm.update(data);
		try {
			const cpu = buildChunkGeometry(request, data),
				compiled = wasm.build(request, data);
			expect(triangles(compiled)).toEqual(triangles(cpu));
			const slabGroup = compiled.meshes[0].groups.find((g) => g.materialIndex === 1)!;
			expect(slabGroup.count).toBe(36);
		} finally {
			wasm.dispose();
			box.dispose();
			topSlab.dispose();
		}
	});

	it("does not substitute a cube or atlas-wide UVs when legacy greedy is requested", () => {
		const partial = new THREE.PlaneGeometry(0.5, 0.5);
		const uv = partial.getAttribute("uv");
		for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.1 + uv.getX(i) * 0.1, 0.1 + uv.getY(i) * 0.1);
		const entry = {
			index: 1,
			category: "solid",
			occlusionFlags: 0,
			geometries: [geometry("solid", 0, partial)],
		};
		const builder = new MeshBuilder();
		builder.update_palette([entry]);
		try {
			const blocks = Int32Array.of(0, 0, 0, 1),
				apron = new Int32Array();
			const regular = builder.build_chunk(blocks, 0, 0, 0, apron),
				greedy = builder.build_chunk_greedy(blocks, 0, 0, 0, apron);
			expect(triangles(greedy)).toEqual(triangles(regular));
			expect(greedy.meshes[0].indices.length).toBe(6);
		} finally {
			builder.free();
			partial.dispose();
		}
	});

	it("JS worker implements batching, SAB, context isolation and palette replacement", () => {
		const box = new THREE.BoxGeometry();
		const entry = {
			index: 1,
			category: "solid",
			occlusionFlags: 63,
			geometries: [geometry("solid", 0, box)],
		};
		const messages: any[] = [];
		const worker = new MeshBuilderWorkerRuntime((message) => messages.push(message));
		const send = (message: any) => worker.handle({ meshContextId: "a", ...message });
		try {
			send({ type: "updatePalette", paletteData: [entry] });
			send({ type: "startBatch" });
			const sab = new SharedArrayBuffer(CHUNK_INPUT_HEADER_SIZE + 16),
				header = new DataView(sab);
			header.setUint32(0, 1, true);
			header.setInt32(4, 64, true);
			new Int32Array(sab, CHUNK_INPUT_HEADER_SIZE).set([64, 0, 0, 1]);
			send({ type: "buildChunkBatched", chunkId: "1", sharedInputBuffer: sab });
			expect(messages[messages.length - 1].type).toBe("chunkAccumulated");
			send({ type: "updatePalette", meshContextId: "b", paletteData: [] });
			send({ type: "finishBatch" });
			const batch = messages[messages.length - 1];
			expect(batch.type).toBe("batchFinished");
			expect(Math.max(...batch.meshes[0].positions)).toBe(64.5);
			send({ type: "updatePalette", paletteData: [] });
			send({ type: "buildChunk", chunkId: "missing", blocks: Int32Array.of(0, 0, 0, 1) });
			expect(messages[messages.length - 1].meshes).toEqual([]);
		} finally {
			box.dispose();
		}
	});
});
