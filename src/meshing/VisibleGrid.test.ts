import { describe, expect, it, vi } from "vitest";
import { extractVisibleGrid } from "./VisibleGrid";

describe("GPU grid visibility", () => {
	it.each([false, true])(
		"honors half-open bounds, fluids, hidden cells and palette index zero (flat=%s)",
		(flat) => {
			const entries = [
				[0, 0, 0, 0],
				[1, 0, 0, 0],
				[2, 0, 0, 0],
				[3, 0, 0, 2],
				[0, 1, 0, 0],
				[1, 1, 0, 1],
				[2, 1, 0, 0],
			];
			const iterator = {
				has_next: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
				next: () => ({ blocks: flat ? Int32Array.from(entries.flat()) : entries }),
				free: vi.fn(),
			};
			const palette = [
				{ name: "minecraft:obsidian" },
				{ name: "minecraft:air" },
				{ name: "minecraft:water" },
			];
			const { grid, indexOffset } = extractVisibleGrid(
				{ create_lazy_chunk_iterator: () => iterator },
				palette,
				4,
				2,
				1,
				{
					bounds: { enabled: true, min: { x: 1, y: 0, z: 0 }, max: { x: 4, y: 2, z: 1 } },
					hiddenCells: new Set(["2,0,0"]),
				}
			);
			expect(indexOffset).toBe(1);
			expect([...grid]).toEqual([0, 1, 0, 0, 0, 0, 1, 0]);
			expect(iterator.free).toHaveBeenCalledOnce();
		}
	);
});
