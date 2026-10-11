import { describe, expect, it } from 'vitest';
import { createMziExample } from '../src/model/examples';
import { createDatasetMziExperiment } from '../src/model/experiments';
import { solveCircuit } from '../src/solver/solve';
import { addVariant, createNotebook, forkVariant, MAX_NOTEBOOK_BYTES, parseNotebook, removeVariant, renameVariant, replaceVariant, selectVariantDetector, serializeNotebook, setSweep } from '../src/experiments/notebook';
import { compareExperiments, createComparisonRunner, exportComparisonCsv, normalizedPower, type CompareRequest, type CompareResponse } from '../src/experiments/compare';

const noYield = async () => {};
const request = (): CompareRequest => ({ id: 1, notebook: setSweep(createNotebook(createMziExample()), { startM: 1.5e-6, stopM: 1.6e-6, points: 9 }) });
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function scheduler() {
  const pending: (() => void)[] = [];
  return { yieldControl: () => new Promise<void>(resolve => pending.push(resolve)), async next() { expect(pending.length).toBeGreaterThan(0); pending.shift()!(); await microtasks(); }, async drain() { for (let i = 0; pending.length; i++) { if (i > 100) throw new Error('Comparison did not finish'); pending.shift()!(); await microtasks(); } } };
}
describe('portable experiment notebooks', () => {
  it('captures immutable circuits independently of edits, forks and explicit replacement', () => {
    const doc = createMziExample();
    const first = createNotebook(doc);
    doc.circuit.components[0].params.powerW = 0.004;
    expect(first.variants[0].document.circuit.components[0].params.powerW).toBe(0.001);
    expect(Object.isFrozen(first.variants[0].document.circuit.components[0].params)).toBe(true);
    const fork = forkVariant(first, 'variant-1', 'Second idea');
    const replaced = replaceVariant(fork, 'variant-2', doc);
    expect(replaced.variants.map(variant => variant.document.circuit.components[0].params.powerW)).toEqual([0.001, 0.004]);
    expect(first.variants).toHaveLength(1);
    expect(fork.variants[1].document.circuit.components[0].params.powerW).toBe(0.001);
  });
  it('roundtrips exact model versions, shared sampling, detector choice and layout', () => {
    let notebook = addVariant(createNotebook(createMziExample()), createDatasetMziExperiment(), 'Measured dataset');
    notebook = selectVariantDetector(notebook, 'variant-2', 'detector-2');
    notebook = setSweep(notebook, { startM: 1520e-9, stopM: 1580e-9, points: 101 });
    notebook = renameVariant(notebook, 'variant-1', 'Reference');
    expect(parseNotebook(serializeNotebook(notebook))).toEqual(notebook);
    expect(removeVariant(notebook, 'variant-1').variants[0].name).toBe('Measured dataset');
  });
  it('rejects unknown versions, extra fields, duplicate IDs, invalid selections and over-cap imports', () => {
    const original = JSON.parse(serializeNotebook(request().notebook));
    for (const mutate of [
      (n: any) => n.schema = 'picsetup-notebook/2',
      (n: any) => n.variants[0].document.circuit.components[0].version = 'latest',
      (n: any) => n.variants[0].detectorId = 'source-1',
      (n: any) => n.sweep.hidden = true,
      (n: any) => n.variants.push(n.variants[0]),
      (n: any) => n.variants[0].id = '__proto__',
      (n: any) => n.sweep.points = 1002,
    ]) { const invalid = structuredClone(original); mutate(invalid); expect(() => parseNotebook(JSON.stringify(invalid))).toThrow(); }
    let six = createNotebook();
    for (let i = 0; i < 6; i++) six = addVariant(six, createMziExample());
    expect(() => addVariant(six, createMziExample())).toThrow(/at most 6/);
    expect(() => parseNotebook(' '.repeat(MAX_NOTEBOOK_BYTES + 1))).toThrow(/byte limit/);
    expect(() => selectVariantDetector(six, 'variant-1', 'missing')).toThrow(/selected detector/);
    expect(() => removeVariant(six, 'missing')).toThrow(/unknown variant/);
  });
});
describe('same-grid physical comparison', () => {
  it('uses actual per-variant source power and keeps independent phase assumptions', async () => {
    const a = createMziExample();
    const b = createMziExample();
    b.circuit.components.find(component => component.model === 'source')!.params.powerW = 0.004;
    b.circuit.components.find(component => component.model === 'phase')!.params.phaseRad = Math.PI;
    const input = request();
    input.notebook = addVariant(input.notebook, b, 'Phase π, 4 mW');
    const output = await compareExperiments(input, { yieldControl: noYield });
    expect(output.cancelled).toBe(false);
    expect(output.results.map(result => result.sourcePowerW)).toEqual([0.001, 0.004]);
    expect(output.results[0].samples.map(sample => sample.wavelengthM)).toEqual(output.results[1].samples.map(sample => sample.wavelengthM));
    for (const sample of output.results[0].samples) expect(normalizedPower(sample, 'detector-2', 0.001)).toBeCloseTo(1, 12);
    for (const sample of output.results[1].samples) expect(normalizedPower(sample, 'detector-1', 0.004)).toBeCloseTo(1, 12);
    expect(output.results[1].samples[0].detectors['detector-1'].powerW).toBeCloseTo(0.004, 12);
    expect(a.circuit.components[0].params.powerW).toBe(0.001);
  });
  it('keeps model-domain failures as gaps and replays exact saved assumptions', async () => {
    const notebook = setSweep(createNotebook(createDatasetMziExperiment()), { startM: 1.49e-6, stopM: 1.56e-6, points: 3 });
    const input = { id: 8, notebook: parseNotebook(serializeNotebook(notebook)) };
    const { results } = await compareExperiments(input, { yieldControl: noYield });
    expect(results[0].samples.map(sample => sample.ok)).toEqual([false, true, true]);
    expect(normalizedPower(results[0].samples[0], 'detector-1', 0.001)).toBeNull();
    expect(normalizedPower(results[0].samples[1], 'detector-1', 0)).toBeNull();
    const csv = exportComparisonCsv(input, results);
    expect(csv).toContain('# dataset_provenance:');
    expect(csv).toContain(`# request: ${JSON.stringify(input)}`);
    expect(csv).toContain('detector-1,0.00000149,false,,,,0.001,,,');
    expect(csv).toContain('DATASET_OUT_OF_BAND');
    for (const sample of results[0].samples.slice(1)) expect(sample.detectors).toEqual(solveCircuit({ ...input.notebook.variants[0].document.circuit, wavelengthM: sample.wavelengthM }).detectors);
  });
  it('rejects empty and invalid subset selections', async () => {
    for (const input of [{ id: 1, notebook: createNotebook() }, { ...request(), variantIds: [] }, { ...request(), variantIds: ['missing'] }, { ...request(), variantIds: ['variant-1', 'variant-1'] }, { ...request(), unexpected: true }]) await expect(compareExperiments(input)).rejects.toThrow();
  });
});
describe('comparison worker lifecycle', () => {
  it('cancels before numerical work and never reports completion', async () => {
    const clock = scheduler(); const messages: CompareResponse[] = []; let solves = 0;
    const runner = createComparisonRunner(message => messages.push(message), { yieldControl: clock.yieldControl, solve: circuit => { solves++; return solveCircuit(circuit); } });
    runner.handle({ type: 'run', ...request() });
    runner.handle({ type: 'cancel', id: 1 });
    await clock.drain();
    expect(solves).toBe(0);
    expect(messages).toEqual([{ type: 'cancelled', id: 1, completed: 0, total: 9 }]);
  });
  it('supersedes stale work, ignores stale cancellation and freezes in-flight assumptions', async () => {
    const clock = scheduler(); const messages: CompareResponse[] = [];
    const runner = createComparisonRunner(message => messages.push(message), { yieldControl: clock.yieldControl, chunkSize: 2 });
    const input = JSON.parse(JSON.stringify(request()));
    runner.handle({ type: 'run', ...input });
    await clock.next();
    runner.handle({ type: 'run', ...input, id: 2 });
    input.notebook.variants[0].document.circuit.components[0].params.powerW = 5;
    runner.handle({ type: 'cancel', id: 1 });
    await clock.drain();
    expect(messages.filter(message => message.type === 'complete')).toHaveLength(1);
    const complete = messages.find(message => message.type === 'complete');
    expect(complete).toMatchObject({ type: 'complete', id: 2 });
    if (complete?.type !== 'complete') throw new Error('No completed comparison');
    expect(complete.results[0].sourcePowerW).toBe(0.001);
    expect(complete.results[0].samples).toHaveLength(9);
    expect(messages.some(message => message.type === 'cancelled' && message.id === 1)).toBe(true);
  });
});
