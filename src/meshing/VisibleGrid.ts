import type { FluidStateFilter } from "./FluidStateLookup";

/** Extract the same half-open, cell-aligned volume used by the surface passes.
 * Zero is reserved by the GPU mesher; remap palette indices if zero isn't air. */
export function extractVisibleGrid(
	schematic: { create_lazy_chunk_iterator: (...args: any[]) => any },
	palette: ReadonlyArray<{ name?: string; Name?: string }>,
	sx: number,
	sy: number,
	sz: number,
	{ bounds, hiddenCells }: FluidStateFilter = {}
): { grid: Uint32Array; indexOffset: number } {
	const excluded = new Set<number>();
	palette.forEach((entry, i) => {
		if (
			/^(?:minecraft:)?(?:air|cave_air|void_air|water|lava|bubble_column)$/.test(
				entry.name || entry.Name || ""
			)
		)
			excluded.add(i);
	});
	const indexOffset = excluded.has(0) ? 0 : 1;
	const grid = new Uint32Array(sx * sy * sz);
	const minX = bounds?.enabled ? Math.max(0, bounds.min.x) : 0;
	const minY = bounds?.enabled ? Math.max(0, bounds.min.y) : 0;
	const minZ = bounds?.enabled ? Math.max(0, bounds.min.z) : 0;
	const maxX = bounds?.enabled ? Math.min(sx, bounds.max.x) : sx;
	const maxY = bounds?.enabled ? Math.min(sy, bounds.max.y) : sy;
	const maxZ = bounds?.enabled ? Math.min(sz, bounds.max.z) : sz;
	const put = (x: number, y: number, z: number, p: number) => {
		if (!excluded.has(p) && x >= minX && y >= minY && z >= minZ && x < maxX && y < maxY && z < maxZ)
			grid[(y * sz + z) * sx + x] = p + indexOffset;
	};
	const iterator = schematic.create_lazy_chunk_iterator(16, 16, 16, "bottom_up", 0, 0, 0);
	try {
		while (iterator.has_next()) {
			const blocks = iterator.next()?.blocks;
			if (blocks instanceof Int32Array || blocks instanceof Uint32Array) {
				for (let i = 0; i + 3 < blocks.length; i += 4)
					put(blocks[i], blocks[i + 1], blocks[i + 2], blocks[i + 3]);
			} else if (blocks) {
				for (const [x, y, z, p] of blocks) put(x, y, z, p);
			}
		}
	} finally {
		iterator.free?.();
	}
	// Sparse edits: avoid building a string key for every cell of a large volume.
	for (const key of hiddenCells ?? []) {
		const [x, y, z] = key.split(",").map(Number);
		if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) grid[(y * sz + z) * sx + x] = 0;
	}
	return { grid, indexOffset };
}
