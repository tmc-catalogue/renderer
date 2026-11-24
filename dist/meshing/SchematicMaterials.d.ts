import * as THREE from "three";
type MaterialState = {
    opacity: number;
    transparent: boolean;
    depthWrite: boolean;
    alphaTest: number;
};
/** A schematic fade is a multiplier, never a replacement for intrinsic alpha. */
export declare function applySchematicOpacity(material: THREE.Material, opacity: number, states: WeakMap<THREE.Material, MaterialState>): void;
export type { MaterialState };
//# sourceMappingURL=SchematicMaterials.d.ts.map