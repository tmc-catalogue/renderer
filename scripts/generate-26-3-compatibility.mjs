// Rebuild the regression walkthrough: node scripts/generate-26-3-compatibility.mjs
import fs from "node:fs";
import assert from "node:assert/strict";
import init, { SchematicWrapper } from "nucleation";
await init();
const s = new SchematicWrapper();
s.setName("26.3 Rendering Compatibility");
s.setDescription(
	"Copper chest halves, all statue poses, all shelf states, tinted plants, emissive firefly bushes, modern signs and fluid adjacency regressions. Each row is labeled. Dry and waterlogged cases are paired."
);
const cases = [],
	labels = [];
const put = (x, y, z, state, check = false) => {
	s.set_block_from_string(x, y, z, `minecraft:${state}`);
	if (check) cases.push([x, y, z, state]);
};
function sign(
	x,
	y,
	z,
	lines,
	state = "pale_oak_sign[rotation=0,waterlogged=false]",
	back = ["BACK", ...lines.slice(0, 3)]
) {
	put(x, y, z, state, true);
	const side = (text, color) =>
		`{messages:[${Array.from({ length: 4 }, (_, i) => JSON.stringify(JSON.stringify({ text: text[i] ?? "" }))).join(",")}],color:"${color}",has_glowing_text:0b}`;
	s.setBlockEntity(
		x,
		y,
		z,
		state.includes("hanging") ? "minecraft:hanging_sign" : "minecraft:sign",
		`{front_text:${side(lines, "black")},back_text:${side(back, "blue")},is_waxed:1b}`
	);
	labels.push([x, y, z]);
}
function pad(x, z, width, depth) {
	for (let dx = 0; dx < width; dx++)
		for (let dz = 0; dz < depth; dz++) put(x + dx, 0, z + dz, "smooth_quartz");
}
const stages = ["", "exposed_", "weathered_", "oxidized_"];
const facings = ["north", "east", "south", "west"];
let row = 0;
// West wing, z=0..63: every chest facing, half, oxidation, wax, and water state.
for (const wax of ["", "waxed_"])
	for (const stage of stages) {
		const z = row++ * 8;
		pad(0, z, 32, 7);
		let col = 0;
		for (const waterlogged of [false, true])
			for (const facing of facings) {
				const x = 1 + col++ * 4;
				put(
					x,
					1,
					z + 1,
					`${wax}${stage}copper_chest[facing=${facing},type=single,waterlogged=${waterlogged}]`,
					true
				);
				const [dx, dz] =
					facing === "north"
						? [1, 0]
						: facing === "south"
							? [-1, 0]
							: facing === "east"
								? [0, 1]
								: [0, -1];
				put(
					x,
					1,
					z + 4,
					`${wax}${stage}copper_chest[facing=${facing},type=left,waterlogged=${waterlogged}]`,
					true
				);
				put(
					x + dx,
					1,
					z + 4 + dz,
					`${wax}${stage}copper_chest[facing=${facing},type=right,waterlogged=${waterlogged}]`,
					true
				);
			}
		sign(15, 1, z + 6, [
			`${wax ? "WAXED " : ""}${stage.replaceAll("_", " ")}`.trim(),
			"COPPER CHESTS",
			"N / E / S / W",
			"Dry | Waterlogged",
		]);
	}
// Middle wing: all 256 statue states, grouped by oxidation/wax and pose.
row = 0;
for (const wax of ["", "waxed_"])
	for (const stage of stages) {
		const z = row++ * 8;
		pad(36, z, 32, 7);
		let col = 0;
		for (const waterlogged of [false, true])
			for (const facing of facings) {
				const x = 37 + col++ * 4;
				for (const [i, pose] of ["standing", "sitting", "running", "star"].entries())
					put(
						x,
						1,
						z + i * 2,
						`${wax}${stage}copper_golem_statue[facing=${facing},copper_golem_pose=${pose},waterlogged=${waterlogged}]`,
						true
					);
			}
		sign(51, 1, z + 7, [
			`${wax ? "WAXED " : ""}${stage.replaceAll("_", " ")}`.trim(),
			"COPPER STATUES",
			"Stand / sit / run / star",
			"Dry | Waterlogged",
		]);
	}
// East wing: all 13 wood types × 64 shelf states.
const woods = [
	"oak",
	"spruce",
	"birch",
	"jungle",
	"acacia",
	"dark_oak",
	"mangrove",
	"cherry",
	"bamboo",
	"crimson",
	"warped",
	"pale_oak",
	"poplar",
];
for (const [row, wood] of woods.entries()) {
	const z = row * 7;
	pad(72, z, 32, 6);
	let col = 0;
	for (const waterlogged of [false, true])
		for (const facing of facings) {
			const x = 73 + col++ * 4;
			for (const [i, side_chain] of ["unconnected", "left", "center", "right"].entries())
				for (const powered of [false, true])
					put(
						x + (powered ? 1 : 0),
						1,
						z + i,
						`${wood}_shelf[facing=${facing},side_chain=${side_chain},powered=${powered},waterlogged=${waterlogged}]`,
						true
					);
		}
	sign(87, 1, z + 5, [wood.toUpperCase(), "SHELVES", "Off / on; all chains", "N / E / S / W"]);
}
// South-west: sign families. Standing/ceiling: all 16 rotations; wall: all facings.
for (const [woodIndex, wood] of ["pale_oak", "poplar"].entries())
	for (const [typeIndex, type] of [
		"sign",
		"wall_sign",
		"hanging_sign",
		"wall_hanging_sign",
	].entries()) {
		const z = 70 + woodIndex * 18 + typeIndex * 4;
		const wall = type.includes("wall");
		pad(0, z, 65, 3);
		for (let i = 0; i < (wall ? 4 : 16); i++) {
			const props = wall
				? `facing=${facings[i]}`
				: `rotation=${i}${type.includes("hanging") ? `,attached=${i % 2 === 0}` : ""}`;
			sign(
				1 + i * 4,
				2,
				z + 1,
				[
					wood.toUpperCase(),
					type.includes("hanging") ? "HANGING" : "SIGN",
					wall ? facings[i] : `Rotation ${i}`,
					"FRONT",
				],
				`${wood}_${type}[${props},waterlogged=${i % 2 === 1}]`
			);
		}
	}
// South: plants with all amounts/orientations, and a dark backdrop for glow checks.
pad(0, 108, 65, 10);
for (const [i, name] of ["bush", "firefly_bush"].entries())
	for (let j = 0; j < 8; j++) put(2 + j * 3, 1, 109 + i * 3, name, true);
for (let x = 0; x < 29; x++) for (let y = 0; y < 4; y++) put(x, y, 107, "black_concrete");
put(27, 1, 112, "open_eyeblossom", true);
put(30, 1, 112, "potted_open_eyeblossom", true);
sign(13, 1, 117, [
	"BUSH / FIREFLY BUSH",
	"Grass tint / glow",
	"Dim scene lighting",
	"to inspect emission",
]);
for (const [ni, name] of ["leaf_litter", "wildflowers"].entries())
	for (const [fi, facing] of facings.entries())
		for (let amount = 1; amount <= 4; amount++)
			put(
				33 + fi * 8 + (amount - 1) * 2,
				1,
				109 + ni * 4,
				`${name}[facing=${facing},${name === "leaf_litter" ? "segment_amount" : "flower_amount"}=${amount}]`,
				true
			);
sign(47, 1, 117, ["LEAF LITTER / FLOWERS", "Dry foliage / grass", "All amounts + facings"]);
// Fluid side visibility: dry partials, waterlogged counterparts, plus solid controls.
const partial = [
	...woods.map(
		(w) => `${w}_shelf[facing=north,side_chain=unconnected,powered=false,waterlogged=false]`
	),
	"dried_ghast[hydration=0,waterlogged=false,facing=north]",
	"sulfur_spike[thickness=tip,vertical_direction=up,waterlogged=false]",
	"resin_clump[north=true,south=false,east=false,west=false,up=false,down=false,waterlogged=false]",
	"pale_hanging_moss[tip=true]",
	"bush",
	"firefly_bush",
	"leaf_litter[segment_amount=4,facing=north]",
	"copper_golem_statue[copper_golem_pose=star,facing=north,waterlogged=false]",
	"stone",
	"resin_block",
];
for (const [i, state] of partial.entries()) {
	const x = (i % 12) * 8,
		z = 123 + Math.floor(i / 12) * 8;
	pad(x, z, 7, 7);
	put(x + 1, 1, z + 1, "water[level=0]", true);
	put(x + 2, 1, z + 1, state, true);
	put(x + 1, 1, z + 3, "lava[level=0]", true);
	put(x + 2, 1, z + 3, state, true);
	if (state.includes("waterlogged=false")) {
		put(x + 4, 1, z + 1, "water[level=0]", true);
		put(x + 5, 1, z + 1, state.replace("waterlogged=false", "waterlogged=true"), true);
	}
	sign(x + 3, 1, z + 6, [
		state.split("[")[0].replaceAll("_", " "),
		"FLUID SIDE FACES",
		"Water / lava",
		"Solid controls last",
	]);
}
const bytes = s.to_litematic();
const out = new URL("../test/public/schematics/26.3-compatibility.litematic", import.meta.url);
fs.writeFileSync(out, bytes);
const loaded = new SchematicWrapper();
loaded.from_litematic(bytes);
for (const [x, y, z, state] of cases) {
	const actual = loaded.get_block_string(x, y, z);
	assert.equal(actual.split("[")[0], `minecraft:${state.split("[")[0]}`);
	const props = state.split("[")[1]?.slice(0, -1).split(",") ?? [];
	for (const prop of props)
		assert.ok(actual.includes(prop), `${x},${y},${z}: ${prop} missing from ${actual}`);
}
for (const p of labels) assert.ok(loaded.get_block_entity(...p)?.nbt?.front_text);
console.log(
	`Saved ${out.pathname}: ${cases.length} cases, ${labels.length} text entities, ${loaded.get_block_count()} blocks (${bytes.length} bytes).`
);
loaded.free();
s.free();
