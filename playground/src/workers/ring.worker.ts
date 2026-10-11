import { createRingRunner } from '../experiments/ring';
const worker = self as unknown as DedicatedWorkerGlobalScope;
const runner = createRingRunner(response => worker.postMessage(response));
worker.addEventListener('message', (event: MessageEvent<unknown>) => runner.handle(event.data));
