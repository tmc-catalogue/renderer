import * as THREE from "three";

type MaterialState = {
	opacity: number;
	transparent: boolean;
	depthWrite: boolean;
	alphaTest: number;
};

/** A schematic fade is a multiplier, never a replacement for intrinsic alpha. */
export function applySchematicOpacity(
	material: THREE.Material,
	opacity: number,
	states: WeakMap<THREE.Material, MaterialState>
): void {
	let base = states.get(material);
	if (!base) {
		base = {
			opacity: material.userData.baseOpacity ?? material.opacity,
			transparent: material.userData.baseTransparent ?? material.transparent,
			depthWrite: material.userData.baseDepthWrite ?? material.depthWrite,
			alphaTest: material.alphaTest,
		};
		states.set(material, base);
	}
	const fade = Math.max(0, Math.min(1, opacity));
	const transparent = fade < 1 || base.transparent;
	const depthWrite = fade === 1 && base.depthWrite;
	if (material.transparent !== transparent || material.depthWrite !== depthWrite) {
		material.transparent = transparent;
		material.depthWrite = depthWrite;
		material.needsUpdate = true;
	}
	material.opacity = base.opacity * fade;
	// Three's alpha test is applied after opacity multiplication. Preserve
	// the original silhouette throughout a fade and restore its threshold.
	if (!(material instanceof THREE.ShaderMaterial)) material.alphaTest = base.alphaTest * fade;
	if (material instanceof THREE.ShaderMaterial) {
		if (material.userData.fluidAlpha !== undefined && material.uniforms.uAlpha)
			material.uniforms.uAlpha.value = material.userData.fluidAlpha * material.opacity;
		if (material.uniforms.uOpacity) material.uniforms.uOpacity.value = material.opacity;
	}
}

export type { MaterialState };
