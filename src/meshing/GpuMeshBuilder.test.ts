import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GpuMeshBuilder } from "./GpuMeshBuilder";
import { buildRecordTables } from "./RecordRenderer";

describe("GPU template encoding", () => {
	it("preserves mixed face materials and handles non-indexed geometry", () => {
		const positions = new Float32Array([
			-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
		]);
		const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
		const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
		const builder = new GpuMeshBuilder();
		const result = (builder as any).buildTemplateBuffers([
			{
				index: 1,
				category: "solid",
				occlusionFlags: 63,
				geometries: [
					{
						positions,
						normals,
						uvs,
						indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
						materialIndex: 0,
					},
					{
						positions: positions.slice(0, 9),
						normals: normals.slice(0, 9),
						uvs: uvs.slice(0, 6),
						indices: null,
						materialIndex: 2,
					},
				],
			},
		]);
		expect(result.tplTriMat).toEqual([0, 0, 2]);
		expect(result.tplIdx).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6]);
		expect(result.tplCull).toEqual([4, 4, 4]);
		expect(result.nSlots).toBe(3);
		expect(result.quadStart.get(0)).toEqual([0, 1, 2, 3]);
		expect(result.quadStart.has(1)).toBe(false);
		const tables = buildRecordTables(
			result.tplPos,
			result.tplNrm,
			result.tplUv,
			result.tplIdx,
			result.desc,
			result.desc2,
			1
		);
		expect(tables.rows).toBe(3);
		expect(Array.from(tables.rowCorners)).toEqual([0, 1, 2, 0, 0, 2, 3, 0, 4, 5, 6, 0]);
	});

	it("keeps opaque neighbor flags distinct from actual pure-fluid identity", () => {
		const builder = new GpuMeshBuilder();
		const result = (builder as any).buildTemplateBuffers([
			{ index: 1, category: "solid", occlusionFlags: 15, geometries: [] },
			{ index: 2, category: "cutout", occlusionFlags: 0, geometries: [] },
			{ index: 3, category: "water", occlusionFlags: 0, fluid: "water", geometries: [] },
			{ index: 4, category: "solid", occlusionFlags: 63, fluid: "lava", geometries: [] },
		]);
		expect([1, 2, 3, 4].map((i) => result.desc[i * 4 + 3])).toEqual([15, 0, 64, 191]);
	});

	it("keeps triangles that extend beyond a neighboring block's face", () => {
		const normals = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
		const positions = new Float32Array([0.5, 0, 0, 0.5, 0.5, 0, 0.5, 0, 0.5, 0.5, 0.75, 0.5]);
		const builder = new GpuMeshBuilder();
		const result = (builder as any).buildTemplateBuffers([
			{
				index: 1,
				category: "solid",
				occlusionFlags: 0,
				geometries: [
					{
						positions,
						normals,
						uvs: new Float32Array(8),
						indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
						materialIndex: 0,
					},
				],
			},
		]);
		expect(result.tplCull).toEqual([0, 255]);
	});

	it("does not cull an upper slab's recessed bottom face at the cell center", () => {
		const builder = new GpuMeshBuilder();
		const result = (builder as any).buildTemplateBuffers([
			{
				index: 1,
				category: "solid",
				occlusionFlags: 0,
				geometries: [
					{
						positions: new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5]),
						normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
						uvs: new Float32Array(6),
						indices: null,
						materialIndex: 0,
					},
				],
			},
		]);
		expect(result.tplCull).toEqual([255]);
	});

	it.each([8, 10, 16])(
		"uses the available %i-buffer adapter limit and retains GPU emission",
		async (limit) => {
			const compileCodes: string[] = [];
			const device = {
				createShaderModule: vi.fn(({ code }) => {
					compileCodes.push(code);
					return { getCompilationInfo: async () => ({ messages: [] }) };
				}),
				createComputePipelineAsync: vi.fn(async () => ({})),
				destroy: vi.fn(),
				lost: new Promise(() => {}),
			};
			const requestDevice = vi.fn(async () => device);
			vi.stubGlobal("navigator", {
				gpu: {
					requestAdapter: async () => ({
						limits: {
							maxStorageBuffersPerShaderStage: limit,
							maxStorageBufferBindingSize: 1024,
							maxBufferSize: 1024,
						},
						requestDevice,
					}),
				},
			});
			const builder = new GpuMeshBuilder();
			try {
				expect(await builder.init()).toBe(true);
				expect(requestDevice).toHaveBeenCalledWith({
					requiredLimits: {
						maxStorageBuffersPerShaderStage: limit === 16 ? 16 : 8,
						maxStorageBufferBindingSize: 1024,
						maxBufferSize: 1024,
					},
				});
				expect(compileCodes.map((code) => code.match(/var<storage/g)?.length)).toEqual(
					limit === 16 ? [8, 16] : [8]
				);
				if (limit < 16) {
					const material = new THREE.MeshBasicMaterial();
					const stream = {
						sx: 1,
						sy: 1,
						sz: 1,
						tables: {
							rowCorners: new Uint32Array([0, 1, 2, 0]),
							rows: 1,
							tplPos: new Float32Array(12),
							tplNrm: new Float32Array(12),
							tplUv: new Float32Array(12),
							verts: 3,
						},
						perCategory: [
							{ category: "solid", tris: 1, records: new Uint32Array([0, 0]), material },
						],
					};
					const emit = vi
						.spyOn(builder, "buildRecordMeshes")
						.mockResolvedValue({ meshes: [], stream });
					const palette = [{ index: 1, category: "solid", occlusionFlags: 0, geometries: [] }];
					const grid = new Uint32Array([1]);
					const lookup = () => [material];
					const [mesh] = await builder.buildMeshes(grid, 1, 1, 1, palette, lookup);
					expect(emit).toHaveBeenCalledWith(grid, 1, 1, 1, palette, lookup, false);
					expect(mesh.geometry.getAttribute("position").count).toBe(3);
					expect(mesh.material).toBe(material);
					mesh.geometry.dispose();
				}
			} finally {
				builder.dispose();
				vi.unstubAllGlobals();
			}
			expect(device.destroy).toHaveBeenCalledOnce();
		}
	);
});
