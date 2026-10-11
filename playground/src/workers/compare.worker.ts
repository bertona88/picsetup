import { createComparisonRunner } from '../experiments/compare';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const runner = createComparisonRunner(response => worker.postMessage(response));
worker.addEventListener('message', (event: MessageEvent<unknown>) => runner.handle(event.data));
