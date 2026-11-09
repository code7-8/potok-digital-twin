// Node-only transport harness. The production worker handler is imported unchanged;
// this exercises structured cloning and messages, not browser loading or WebGL.
import { parentPort } from 'node:worker_threads';
globalThis.self = { postMessage: message => parentPort.postMessage(message) };
await import('../../lib/compute.worker.ts');
parentPort.on('message', data => self.onmessage({ data }));
parentPort.postMessage({ ready: true });
