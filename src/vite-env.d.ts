/// <reference types="vite/client" />

// vite.config.js inlines WASM imports as data URLs.
declare module "*.wasm" {
	const url: string;
	export default url;
}
