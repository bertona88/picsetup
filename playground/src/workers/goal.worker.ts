import { createGoalRunner } from '../experiments/goals';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const runner = createGoalRunner(response => worker.postMessage(response));
worker.addEventListener('message', (event: MessageEvent<unknown>) => runner.handle(event.data));
