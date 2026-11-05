import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { Cubane } from "./Cubane";
import { SignRenderer } from "./SignRenderer";

const canvases = new WeakMap<object, ImageData>();
beforeEach(() => {
	vi.stubGlobal(
		"ImageData",
		class {
			constructor(
				readonly data: Uint8ClampedArray,
				readonly width: number,
				readonly height: number
			) {}
		}
	);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext")
		.mockClear()
		.mockImplementation(function (this: HTMLCanvasElement) {
			return {
				putImageData: (pixels: ImageData) => canvases.set(this, pixels),
			} as unknown as CanvasRenderingContext2D;
		} as unknown as HTMLCanvasElement["getContext"]);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function pixels(red: number, width = 64, height = 32): ImageData {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = red;
		data[i + 3] = 255;
	}
	return new ImageData(data, width, height);
}
function map(root: THREE.Object3D | null): THREE.Texture {
	let texture: THREE.Texture | null = null;
	root?.traverse((part) => {
		if (part instanceof THREE.Mesh) texture = (part.material as THREE.MeshStandardMaterial).map;
	});
	if (!texture) throw new Error("Sign has no texture");
	return texture;
}
function fixture(modern = false) {
	const assets = new AssetLoader(false);
	const state = { red: 50, modern };
	const read = vi.spyOn(assets, "getTexturePixels").mockImplementation(async (path) => {
		if (path === "font/ascii") return pixels(state.red, 128, 128);
		if (path.startsWith("entity/") && state.modern) return null;
		return pixels(state.red, path.startsWith("block/") ? 32 : 64, 32);
	});
	vi.spyOn(assets, "getTexture").mockResolvedValue(new THREE.Texture());
	vi.spyOn(assets, "getBlockState").mockResolvedValue({
		variants: { "": { model: "block/oak_sign" } },
	});
	vi.spyOn(assets, "getModel").mockResolvedValue({
		textures: { all: "block/oak_sign" },
		elements: [
			{
				from: [0, 0, 0],
				to: [16, 16, 1],
				faces: { south: { texture: "#all", uv: [0, 0, 16, 16] } },
			},
		],
	});
	const signs = new SignRenderer(assets);
	const cubane = Object.assign(Object.create(Cubane.prototype), {
		signRenderer: signs,
		blockMeshCache: new Map(),
		entityMeshCache: new Map(),
		optimizationDataCache: new Map(),
	}) as Cubane;
	const build = () =>
		signs.buildSignMesh(
			"minecraft:oak_sign",
			{ rotation: "0" },
			{ front_text: { messages: ['{"text":"A"}'] } }
		);
	return { assets, state, read, signs, cubane, build };
}

describe("sign pack invalidation", () => {
	it.each([false, true])(
		"refreshes %s modern sign pixels and fonts and disposes old canvases",
		async (modern) => {
			const { state, read, signs, cubane, build } = fixture(modern);
			const first = map(await build());
			const disposed = vi.fn();
			first.addEventListener("dispose", disposed);
			state.red = 200;
			cubane.clearMeshCaches();
			expect(disposed).toHaveBeenCalledOnce();
			const replacement = map(await build());
			expect(replacement).not.toBe(first);
			expect(canvases.get(replacement.image as HTMLCanvasElement)!.data[0]).toBe(200);
			expect(read.mock.calls.filter(([path]) => path === "font/ascii")).toHaveLength(2);
			signs.dispose();
		}
	);

	it("invalidates cached missing legacy textures when switching from modern to legacy packs", async () => {
		const { state, read, signs, cubane, build } = fixture(true);
		await build();
		state.modern = false;
		cubane.clearMeshCaches();
		const replacement = await build();
		expect(replacement!.children[0].name).toBe("sign_oak");
		expect(read.mock.calls.filter(([path]) => path === "entity/signs/oak")).toHaveLength(2);
		signs.dispose();
	});

	it("keeps late pixel decodes from repopulating a replacement pack's cache", async () => {
		const { state, read, signs, cubane, build } = fixture();
		let finish!: (value: ImageData) => void;
		read.mockReturnValueOnce(
			new Promise<ImageData>((resolve) => {
				finish = resolve;
			})
		);
		const pending = build();
		state.red = 200;
		cubane.clearMeshCaches();
		const current = map(await build());
		const disposed = vi.fn();
		current.addEventListener("dispose", disposed);
		finish(pixels(50));
		expect(map(await pending)).toBe(current);
		expect(canvases.get(current.image as HTMLCanvasElement)!.data[0]).toBe(200);
		expect(disposed).not.toHaveBeenCalled();
		signs.dispose();
	});

	it("does not rebuild or retain textures after disposal interrupts a decode", async () => {
		const { read, signs, build } = fixture();
		let finish!: (value: ImageData) => void;
		read.mockReturnValueOnce(
			new Promise<ImageData>((resolve) => {
				finish = resolve;
			})
		);
		const pending = build();
		signs.dispose();
		finish(pixels(50));
		expect(await pending).toBeNull();
		expect(await build()).toBeNull();
		expect(read).toHaveBeenCalledOnce();
		expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
		expect(signs).toMatchObject({
			basePixelCache: new Map(),
			textureCache: new Map(),
			fontData: null,
			fontPromise: null,
		});
	});
});
