import { createStudyRunner } from '../experiments/study';
const runner = createStudyRunner(message => self.postMessage(message));
self.onmessage = event => runner.handle(event.data);
