import type { Cubane } from "../cubane/Cubane";
import type { DefaultPackCallback, ResourcePackManager } from "../managers/ResourcePackManager";
/** Rebuild in place: mesh builders keep their Cubane reference for their lifetime. */
export declare function reloadEnabledResourcePacks(cubane: Cubane, manager: ResourcePackManager): Promise<void>;
/** Reconcile persisted packs without rebuilding an already matching cached atlas. */
export declare function initializeResourcePacks(cubane: Cubane, manager: ResourcePackManager, defaults?: Record<string, DefaultPackCallback>): Promise<Blob[]>;
//# sourceMappingURL=initializeResourcePacks.d.ts.map