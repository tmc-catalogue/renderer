import { MeshBuilderWorkerRuntime } from "./MeshBuilderWorkerRuntime";

const runtime = new MeshBuilderWorkerRuntime((message, transfer = []) =>
	self.postMessage(message, { transfer })
);
self.onmessage = (event: MessageEvent) => runtime.handle(event.data);
