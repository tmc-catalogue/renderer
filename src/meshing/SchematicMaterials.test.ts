import * as THREE from "three";
import { expect, it } from "vitest";
import { applySchematicOpacity, type MaterialState } from "./SchematicMaterials";

it("restores native transparency, opacity, alpha test and depth after schematic fades", () => {
	const opaque = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
	const translucent = new THREE.MeshStandardMaterial({
		transparent: true,
		opacity: 0.6,
		depthWrite: false,
	});
	const states = new WeakMap<THREE.Material, MaterialState>();
	for (const material of [opaque, translucent]) applySchematicOpacity(material, 0.2, states);
	expect(opaque).toMatchObject({
		transparent: true,
		opacity: 0.2,
		alphaTest: 0.1,
		depthWrite: false,
	});
	expect(translucent.opacity).toBeCloseTo(0.12);
	for (const material of [opaque, translucent]) applySchematicOpacity(material, 1, states);
	expect(opaque).toMatchObject({
		transparent: false,
		opacity: 1,
		alphaTest: 0.5,
		depthWrite: true,
	});
	expect(translucent).toMatchObject({ transparent: true, opacity: 0.6, depthWrite: false });
});

it("passes schematic opacity to custom shader materials without losing fluid alpha", () => {
	const fluid = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: { uAlpha: { value: 0.6 }, uOpacity: { value: 1 } },
	});
	fluid.userData.fluidAlpha = 0.6;
	const states = new WeakMap<THREE.Material, MaterialState>();
	applySchematicOpacity(fluid, 0.25, states);
	expect(fluid.uniforms.uAlpha.value).toBeCloseTo(0.15);
	expect(fluid.uniforms.uOpacity.value).toBe(0.25);
	applySchematicOpacity(fluid, 1, states);
	expect(fluid.uniforms.uAlpha.value).toBeCloseTo(0.6);
});
