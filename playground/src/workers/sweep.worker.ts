import { createSweepRunner } from '../solver/sweep';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const runner = createSweepRunner(response => worker.postMessage(response));
worker.addEventListener('message', (event: MessageEvent<unknown>) => runner.handle(event.data));
