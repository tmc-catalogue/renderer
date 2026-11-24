import type { Cubane } from "../cubane/Cubane";
import type { DefaultPackCallback, ResourcePackManager } from "../managers/ResourcePackManager";

/** Rebuild in place: mesh builders keep their Cubane reference for their lifetime. */
export async function reloadEnabledResourcePacks(
	cubane: Cubane,
	manager: ResourcePackManager
): Promise<void> {
	const desired = [...manager.getEnabledPacksWithBlobs()].reverse();
	cubane.beginPackBatchUpdate();
	try {
		await cubane.removeAllPacks();
		for (const pack of desired) await cubane.loadResourcePack(pack.blob);
	} finally {
		await cubane.endPackBatchUpdate();
	}
}

/** Reconcile persisted packs without rebuilding an already matching cached atlas. */
export async function initializeResourcePacks(
	cubane: Cubane,
	manager: ResourcePackManager,
	defaults: Record<string, DefaultPackCallback> = {}
): Promise<Blob[]> {
	await Promise.all([cubane.ready(), manager.initPromise]);
	await manager.getResourcePackBlobs(defaults);
	// The renderer lists highest priority first; Cubane applies the last pack on top.
	const desired = manager.getEnabledPacksWithBlobs().reverse();
	const blobs = desired.map((pack) => pack.blob);
	const restored = cubane.getEnabledPacks();
	if (
		// Preserve standalone Cubane packs when no renderer pack configuration exists.
		manager.getPackCount() === 0 ||
		(desired.length === restored.length &&
			desired.every((pack, i) => pack.hash === restored[i].hash))
	)
		return blobs;

	cubane.beginPackBatchUpdate();
	try {
		await cubane.removeAllPacks();
		for (const pack of desired) {
			try {
				await cubane.loadResourcePack(pack.blob);
			} catch (error) {
				console.error(`[ResourcePacks] Failed to load ${pack.name}:`, error);
			}
		}
	} finally {
		await cubane.endPackBatchUpdate();
	}
	return blobs;
}
