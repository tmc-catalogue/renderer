import * as THREE from "three";
/** Bake generated static models into one mesh per equivalent material, without changing cached prototypes. */
export declare function bakeStaticModelParts(root: THREE.Object3D): THREE.Mesh[];
/** Replace newly built, exclusively owned geometry; materials remain owned by the model. */
export declare function mergeOwnedStaticModelParts(root: THREE.Group): void;
//# sourceMappingURL=StaticModelParts.d.ts.map