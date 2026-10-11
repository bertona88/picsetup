import { describe, expect, it } from 'vitest';
import { createMziExample } from '../src/model/examples';
import { createDatasetMziExperiment } from '../src/model/experiments';
import { runGoalSearch, createGoalRunner, type GoalRequest, type GoalResponse } from '../src/experiments/goals';

const request = (overrides: Partial<GoalRequest> = {}): GoalRequest => ({ id: 1, document: createMziExample(), wavelengthM: 1550e-9, detectorId: 'detector-1', objective: 'maximize', parameter: { kind: 'component', componentId: 'phase-1', name: 'phaseRad' }, min: 0, max: 2 * Math.PI, points: 101, ...overrides });
const noYield = async () => {};
describe('bounded sampled design goals', () => {
  it('finds the known MZI phase maximum, preserves the original, and keeps a replayable best', async () => {
    const input = request(); const original = JSON.stringify(input);
    const result = await runGoalSearch(input, { yieldControl: noYield });
    expect(result.best!.index).toBe(50);
    expect(result.best!.value).toBeCloseTo(Math.PI, 14);
    expect(result.best!.powerW).toBeCloseTo(0.001, 14);
    expect(result.best!.document.circuit.components.find(component => component.id === 'phase-1')!.params.phaseRad).toBeCloseTo(Math.PI, 14);
    expect(result.samples.every(sample => Math.abs(sample.powerW! - 0.001 * Math.sin(sample.value / 2) ** 2) < 1e-15)).toBe(true);
    expect(result.boundaryHit).toBe(false);
    expect(result.failedCount).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(JSON.stringify(input)).toBe(original);
    expect(Object.isFrozen(result.request.document.circuit)).toBe(true);
  });
  it('reports a best on a declared bound without claiming convergence', async () => {
    const result = await runGoalSearch(request({ objective: 'minimize', min: 0, max: Math.PI / 2, points: 11 }), { yieldControl: noYield });
    expect(result.best!.value).toBe(0);
    expect(result.boundaryHit).toBe(true);
    expect(result.samples).toHaveLength(11);
  });
  it('keeps sampled coordinates finite across large representable phase bounds', async () => {
    const result = await runGoalSearch(request({ min: 1e307, max: 1e308, points: 101 }), { yieldControl: noYield });
    expect(result.samples.every(sample => Number.isFinite(sample.value))).toBe(true);
    expect(result.samples[0].value).toBe(1e307);
    expect(result.samples.at(-1)!.value).toBe(1e308);
  });
  it('supports physical connection length and analytical coupling bounds', async () => {
    const lengths = await runGoalSearch(request({ parameter: { kind: 'connection', connectionId: 'link-4', name: 'lengthM' }, min: 80e-6, max: 80e-6 + 1550e-9 / 2.4, points: 101 }), { yieldControl: noYield });
    expect(lengths.best!.index).toBe(50);
    const couplings = await runGoalSearch(request({ parameter: { kind: 'component', componentId: 'coupler-1', name: 'coupling' }, min: 0, max: 1, points: 11, objective: 'minimize' }), { yieldControl: noYield });
    expect(couplings.best!.value).toBe(0.5);
  });
  it('preserves all rejected dataset candidates as diagnosed failures with no best', async () => {
    const doc = createDatasetMziExperiment();
    const result = await runGoalSearch(request({ document: doc, wavelengthM: 1400e-9, points: 5 }), { yieldControl: noYield });
    expect(result.best).toBeNull();
    expect(result.failedCount).toBe(5);
    expect(result.samples.every(sample => sample.powerW === null && sample.diagnostics.some(item => item.code === 'DATASET_OUT_OF_BAND'))).toBe(true);
  });
  it('rejects invalid domains, unknown targets, unbounded input and excess work', async () => {
    for (const input of [request({ points: 202 }), request({ points: 1 }), request({ min: 2, max: 1 }), request({ min: -1e308, max: 1e308 }), request({ detectorId: 'source-1' }), request({ parameter: { kind: 'component', componentId: 'source-1', name: 'phaseRad' } }), request({ parameter: { kind: 'component', componentId: 'coupler-1', name: 'coupling' }, min: -1, max: 1 }), request({ parameter: { kind: 'connection', connectionId: 'link-4', name: 'lengthM' }, min: -1, max: 1 })]) await expect(runGoalSearch(input)).rejects.toThrow();
  });
  it('cancels/supersedes worker searches before solving and ignores a stale cancel', async () => {
    const pending: (() => void)[] = []; const messages: GoalResponse[] = [];
    const runner = createGoalRunner(message => messages.push(message), { yieldControl: () => new Promise<void>(resolve => pending.push(resolve)) });
    runner.handle({ type: 'run', ...request() });
    runner.handle({ type: 'run', ...request({ id: 2, points: 3 }) });
    runner.handle({ type: 'cancel', id: 1 });
    for (let i = 0; pending.length; i++) { if (i > 100) throw new Error('Did not finish'); pending.shift()!(); for (let j = 0; j < 12; j++) await Promise.resolve(); }
    expect(messages.find(message => message.type === 'cancelled')).toEqual({ type: 'cancelled', id: 1, completed: 0, total: 101 });
    const complete = messages.find(message => message.type === 'complete');
    expect(complete).toMatchObject({ type: 'complete', id: 2 });
    if (complete?.type !== 'complete') throw new Error('No result');
    expect(complete.result.samples).toHaveLength(3);
    expect(complete.result.best!.value).toBe(Math.PI);
  });
});
