import * as THREE from "three";
import type { ChestAssetLoaderLike } from "./ChestModels";
/** Static entity-model poses, in Minecraft's pixel units (Y down).
 * CopperGolemPoses contains the vanilla 26.3 model dimensions and part transforms.
 * Reference: https://mc-packet-reference.netlify.app/26.x/source/net/minecraft/client/model/animal/golem/coppergolemmodel/
 * Keep the model's floor/origin: normalizing its bounding box changes running poses.
 */
export declare function buildCopperGolemStatue(name: string, properties: Record<string, string>, assets: ChestAssetLoaderLike): Promise<THREE.Group>;
//# sourceMappingURL=CopperGolemModels.d.ts.map