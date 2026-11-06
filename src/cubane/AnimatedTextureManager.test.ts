import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimatedTextureManager } from "./AnimatedTextureManager";
import type { AssetLoader } from "./AssetLoader";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function setup() {
	const images: MockImage[] = [];
	class MockImage {
		width = 16;
		height = 32;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		src = "";
		constructor() {
			images.push(this);
		}
	}
	vi.stubGlobal("Image", MockImage);
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:animated-texture");
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const assets = {
		getResourceString: vi.fn().mockResolvedValue('{"animation":{"frametime":1}}'),
		getResourceBlob: vi.fn().mockResolvedValue(new Blob(["texture"])),
	};
	const manager = new AnimatedTextureManager(assets as unknown as AssetLoader);
	return { assets, manager, images, revoke };
}

describe("animated texture cache invalidation", () => {
	it("replaces old registrations and hands their textures back for disposal", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const { manager, assets, images } = setup();
		const firstLoad = manager.createAnimatedTexture("block/kelp");
		await vi.waitFor(() => expect(images).toHaveLength(1));
		images[0].onload!();
		const first = (await firstLoad)!;
		const disposed = vi.fn();
		first.addEventListener("dispose", disposed);
		expect(await manager.createAnimatedTexture("block/kelp")).toBe(first);
		expect(manager.hasActiveTextures()).toBe(true);
		expect(manager.clear()).toEqual([first]);
		expect(manager.hasActiveTextures()).toBe(false);
		expect(disposed).not.toHaveBeenCalled();

		assets.getResourceString.mockResolvedValue('{"animation":{"frametime":2}}');
		const secondLoad = manager.createAnimatedTexture("block/kelp");
		await vi.waitFor(() => expect(images).toHaveLength(2));
		images[1].height = 64;
		images[1].onload!();
		const second = (await secondLoad)!;
		expect(second).not.toBe(first);
		expect(second.repeat.y).toBe(0.25);
		vi.setSystemTime(Date.now() + 100);
		expect(manager.update()).toBe(true);
		expect(second.offset.y).toBe(0.5);
		expect(first.offset.y).toBe(0);
		expect(manager.clear()).toEqual([second]);
		expect(manager.clear()).toEqual([]);
		first.dispose();
		second.dispose();
	});

	it("cancels pending image decodes and ignores their late callbacks after clear", async () => {
		const { manager, images, revoke } = setup();
		const load = manager.createAnimatedTexture("block/kelp");
		await vi.waitFor(() => expect(images).toHaveLength(1));
		const oldOnload = images[0].onload!;
		expect(manager.clear()).toEqual([]);
		await expect(load).resolves.toBeNull();
		expect(revoke).toHaveBeenCalledOnce();
		expect(images[0].onload).toBeNull();
		oldOnload();
		expect(manager.hasActiveTextures()).toBe(false);
		expect(revoke).toHaveBeenCalledOnce();

		const replacement = manager.createAnimatedTexture("block/kelp");
		await vi.waitFor(() => expect(images).toHaveLength(2));
		images[1].onload!();
		const texture = (await replacement)!;
		expect(manager.hasActiveTextures()).toBe(true);
		oldOnload();
		expect(manager.clear()).toEqual([texture]);
		texture.dispose();
	});

	it.each(["metadata", "blob"])("discards pending %s work after clear", async (stage) => {
		const { manager, assets, images } = setup();
		let finish!: (value: any) => void;
		const pending = new Promise((resolve) => {
			finish = resolve;
		});
		if (stage === "metadata") assets.getResourceString.mockReturnValue(pending);
		else assets.getResourceBlob.mockReturnValue(pending);
		const load = manager.createAnimatedTexture("block/kelp");
		if (stage === "blob")
			await vi.waitFor(() => expect(assets.getResourceBlob).toHaveBeenCalledOnce());
		manager.clear();
		finish(stage === "metadata" ? '{"animation":{}}' : new Blob(["old texture"]));
		await expect(load).resolves.toBeNull();
		expect(images).toHaveLength(0);
		expect(manager.hasActiveTextures()).toBe(false);
		if (stage === "metadata") expect(assets.getResourceBlob).not.toHaveBeenCalled();
	});

	it.each(["metadata", "blob"])("ignores stale %s failures after clear", async (stage) => {
		const { manager, assets } = setup();
		let fail!: (error: Error) => void;
		const pending = new Promise((_, reject) => {
			fail = reject;
		});
		if (stage === "metadata") assets.getResourceString.mockReturnValue(pending);
		else assets.getResourceBlob.mockReturnValue(pending);
		const load = manager.createAnimatedTexture("block/kelp");
		if (stage === "blob")
			await vi.waitFor(() => expect(assets.getResourceBlob).toHaveBeenCalledOnce());
		manager.clear();
		fail(new Error("old pack read failed"));
		await expect(load).resolves.toBeNull();
		expect(manager.hasActiveTextures()).toBe(false);
	});
});
