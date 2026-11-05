import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import JSZip from "jszip";
import { buildFluidMeshes, setFluidTextures } from "../../../src/meshing/WaterMesher";
import { createFluidFrameTexture, tintWaterPixels } from "../../../src/meshing/WaterTextures";
import type { FluidAnimationMetadata } from "../../../src/meshing/FluidAnimation";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151f);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(4, 1, 1);
const views = { front: [4, 4, 18], above: [10, 12, 12], below: [4, -2, 14] };
for (const [id, position] of Object.entries(views)) {
	document.getElementById(id)!.onclick = () => {
		camera.position.fromArray(position);
		controls.update();
	};
}
camera.position.fromArray(views.front);
controls.update();
const status = document.getElementById("status")!;
const pack = await JSZip.loadAsync(await (await fetch("pack.zip")).arrayBuffer());
async function texture(name: string) {
	const image = await createImageBitmap(
		await pack.file(`assets/minecraft/textures/block/${name}.png`)!.async("blob")
	);
	const canvas = document.createElement("canvas");
	canvas.width = image.width;
	canvas.height = image.height;
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	tintWaterPixels(pixels);
	image.close();
	const sidecar = pack.file(`assets/minecraft/textures/block/${name}.png.mcmeta`);
	const metadata: FluidAnimationMetadata | undefined = sidecar
		? JSON.parse(await sidecar.async("string"))
		: undefined;
	return createFluidFrameTexture(pixels, canvas.width, canvas.height, metadata);
}
setFluidTextures({ water: await texture("water_still"), waterFlow: await texture("water_flow") });
const sx = 10,
	sy = 6,
	sz = 4;
const blocks = new Map<string, string>();
function block(x: number, y: number, z: number, state: string) {
	blocks.set(`${x},${y},${z}`, state);
}
function box(x: number, y: number, z: number, w: number, h: number, d: number, color: number) {
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(w, h, d),
		new THREE.MeshBasicMaterial({ color })
	);
	mesh.position.set(x, y, z);
	scene.add(mesh);
	return mesh;
}
for (let x = 0; x < 6; x++)
	for (let z = 0; z < 4; z++) {
		block(x, 0, z, "stone");
		box(x, 0, z, 1, 1, 1, (x + z) % 2 ? 0xddd1b4 : 0x59667a);
		block(x, 1, z, "water");
	}
block(1, 1, 2, "oak_slab[type=bottom,waterlogged=true]");
box(1, 0.75, 2, 1, 0.5, 1, 0xc68b44);
block(3, 1, 2, "stone_stairs[waterlogged=true]");
box(3, 0.75, 2, 1, 0.5, 1, 0xa0adb8);
box(3, 1.25, 1.75, 1, 0.5, 0.5, 0xa0adb8);
block(5, 1, 2, "oak_fence[waterlogged=true]");
box(5, 1, 2, 0.25, 1, 0.25, 0xc68b44);
box(5, 1.2, 2, 1, 0.2, 0.15, 0xc68b44);
for (let x = 7; x < 10; x++)
	for (let y = 0; y < 6; y++) {
		block(x, y, 2, y === 5 ? "water[level=0]" : "water[level=8]");
		box(x, y, 0, 1, 1, 0.3, (x + y) % 2 ? 0xd3b84b : 0x835746);
	}
const fluid = buildFluidMeshes((x, y, z) => blocks.get(`${x},${y},${z}`), sx, sy, sz);
fluid.meshes.forEach((mesh) => scene.add(mesh));
document.getElementById("toggle")!.onclick = () =>
	fluid.meshes.forEach((mesh) => {
		mesh.visible = !mesh.visible;
	});

// Rendered-pixel regression: a colored opaque block behind a water cell must
// still influence the final pixel. This also catches shader compile/bind failures.
const testScene = new THREE.Scene();
const testCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
testCamera.position.set(0, 0, 3);
testCamera.lookAt(0, 0, 0);
const testWater = buildFluidMeshes(() => "water", 1, 1, 1).meshes[0];
const backdrop = new THREE.Mesh(
	new THREE.PlaneGeometry(2, 2),
	new THREE.MeshBasicMaterial({ color: 0xff0000 })
);
backdrop.position.z = -1;
testScene.add(backdrop, testWater);
const target = new THREE.WebGLRenderTarget(16, 16);
const pixel = new Uint8Array(4);
function sample(color: number, visible: boolean) {
	backdrop.material.color.setHex(color);
	testWater.visible = visible;
	renderer.setRenderTarget(target);
	renderer.render(testScene, testCamera);
	renderer.readRenderTargetPixels(target, 8, 8, 1, 1, pixel);
	return [...pixel];
}
const red = sample(0xff0000, true);
const green = sample(0x00ff00, true);
const waterDrawCalls = renderer.info.render.calls - 1; // subtract the backdrop
const dry = sample(0x00ff00, false);
const passed =
	waterDrawCalls === 1 &&
	red[0] > green[0] + 20 &&
	green[1] > red[1] + 20 &&
	green[2] > dry[2] + 10;
renderer.setRenderTarget(null);
target.dispose();
testWater.geometry.dispose();
(testWater.material as THREE.Material).dispose();
status.textContent = `Pixel transparency: ${passed ? "PASS" : "FAIL"} · ${fluid.cells} water cells · ${fluid.meshes.length} water draw · ${fluid.meshes[0].geometry.index!.count / 3} triangles`;
console.log("Water pixel regression", JSON.stringify({ passed, waterDrawCalls, red, green, dry }));
function render() {
	renderer.render(scene, camera);
	requestAnimationFrame(render);
}
render();
addEventListener("resize", () => {
	renderer.setSize(innerWidth, innerHeight);
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
});
