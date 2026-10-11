import { describe, expect, it } from 'vitest';
import { createMziExample } from '../src/model/examples';
import { solveCircuit } from '../src/solver/solve';
import type { Diagnostic, SolveResult } from '../src/model/types';
import { addVariant, clearStudy, createNotebook, parseNotebook, serializeNotebook, setStudy, setSweep, type StudyNotebook } from '../src/experiments/notebook';
import { compareExperiments } from '../src/experiments/compare';
import { createStudyRunner, diffVariants, evaluateStudy, exportStudyCsv, semanticDifferences, summarizeStudy, type StudyResponse } from '../src/experiments/study';

const noYield = async () => {};
function notebook(phase = 0): StudyNotebook {
  const document = createMziExample();
  document.circuit.components.find(component => component.model === 'phase')!.params.phaseRad = phase;
  const classic = setSweep(createNotebook(document), { startM: 1520e-9, stopM: 1580e-9, points: 7 });
  return setStudy(classic, { schema: 'picsetup-study/1', baselineVariantId: 'variant-1', outputs: [{ variantId: 'variant-1', desiredDetectorId: 'detector-2', unwantedDetectorId: 'detector-1' }], targets: { maxInsertionLossDb: 1, maxCrosstalkDb: -20 }, phaseScenarios: [{ id: 'phase-plus', name: '+0.1 rad assumed', offsets: [{ variantId: 'variant-1', componentId: 'phase-1', phaseOffsetRad: 0.1 }] }, { id: 'phase-minus', name: '−0.1 rad assumed', offsets: [{ variantId: 'variant-1', componentId: 'phase-1', phaseOffsetRad: -0.1 }] }] });
}
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function scheduler() {
  const pending: (() => void)[] = [];
  return { yieldControl: () => new Promise<void>(resolve => pending.push(resolve)), async drain() { for (let n = 0; pending.length; n++) { if (n > 500) throw new Error('Study did not finish'); pending.shift()!(); await tick(); } }, async next() { pending.shift()!(); await tick(); } };
}

describe('explicit portable study intent', () => {
  it('roundtrips exact study references and immutable offsets while retaining classic /1', () => {
    const original = notebook();
    const replay = parseNotebook(serializeNotebook(original));
    expect(replay).toEqual(original);
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen((replay as StudyNotebook).study.phaseScenarios[0].offsets[0])).toBe(true);
    const classic = clearStudy(original);
    expect(classic.schema).toBe('picsetup-notebook/1');
    expect(Object.keys(classic).sort()).toEqual(['schema', 'sweep', 'title', 'variants']);
    expect(parseNotebook(serializeNotebook(classic))).toEqual(classic);
    expect(() => addVariant(original, createMziExample())).toThrow(/map every variant/);
  });
  it('rejects guessed/missing/duplicate references, extra fields and unbounded scenarios', () => {
    const mutators: ((n: any) => void)[] = [
      n => n.study.baselineVariantId = 'missing', n => n.study.extra = true,
      n => n.study.outputs[0].desiredDetectorId = 'source-1', n => n.study.outputs[0].unwantedDetectorId = 'detector-2',
      n => n.study.outputs.push(n.study.outputs[0]), n => n.study.outputs[0].variantId = 'stale',
      n => n.study.targets.maxCrosstalkDb = Infinity, n => n.study.targets.hidden = 1,
      n => n.study.phaseScenarios[0].id = 'nominal', n => n.study.phaseScenarios[0].offsets[0].componentId = 'coupler-1',
      n => n.study.phaseScenarios[0].offsets[0].phaseOffsetRad = 7,
      n => n.study.phaseScenarios[0].offsets.push(n.study.phaseScenarios[0].offsets[0]),
      n => n.study.phaseScenarios = Array.from({ length: 6 }, (_, i) => ({ ...n.study.phaseScenarios[0], id: `case-${i}` })),
    ];
    for (const mutate of mutators) { const invalid = structuredClone(notebook()); mutate(invalid); expect(() => setStudy(invalid, invalid.study)).toThrow(); }
  });
});

describe('actual semantic differences', () => {
  it('ignores drawing, labels, ordering and reciprocal storage direction, including link IDs', () => {
    const a = createMziExample(), b = structuredClone(a);
    b.title = 'A misleading title'; b.layout.viewport.zoom = 4;
    b.circuit.components.reverse().forEach(component => { component.label = 'new label'; b.layout.components[component.id].x += 11; });
    b.circuit.connections.reverse().forEach(connection => { [connection.from, connection.to] = [connection.to, connection.from]; connection.id += '-renamed'; });
    expect(semanticDifferences(a, b)).toEqual([]);
  });
  it('derives baseline/variant differences from actual models, parameters, topology and propagation', () => {
    const a = createMziExample(), b = structuredClone(a);
    b.circuit.wavelengthM = 1540e-9;
    b.circuit.components.find(component => component.id === 'phase-1')!.params.phaseRad = 0.3;
    b.circuit.connections.find(connection => connection.id === 'link-4')!.lengthM = 95e-6;
    b.circuit.connections.find(connection => connection.id === 'link-3')!.neff = 2.5;
    b.circuit.connections.find(connection => connection.id === 'link-2')!.lossDbPerM = 120;
    const changes = semanticDifferences(a, b);
    expect(changes.map(change => change.path)).toEqual(expect.arrayContaining(['wavelengthM', 'components.phase-1.params.phaseRad']));
    expect(changes.find(change => change.path.endsWith('.lengthM'))).toMatchObject({ before: 80e-6, after: 95e-6 });
    expect(changes.find(change => change.path.endsWith('.lossDbPerM'))).toMatchObject({ before: 0, after: 120 });
    let n = addVariant(clearStudy(notebook()), b, 'The same misleading title');
    n = setStudy(n, { ...notebook().study, outputs: [...notebook().study.outputs, { variantId: 'variant-2', desiredDetectorId: 'detector-2', unwantedDetectorId: 'detector-1' }] });
    const diff = diffVariants(n as StudyNotebook);
    expect(diff[0]).toMatchObject({ isBaseline: true, differences: [] });
    expect(diff[1].differences).toEqual(changes);
    const modeled = structuredClone(a);
    Object.assign(modeled.circuit.connections[1], { neff: 2.44553, waveguide: { model: 'siepic-strip-500x220-te', version: '1' } });
    expect(semanticDifferences(a, modeled).find(change => change.path.endsWith('.waveguide'))?.after).toEqual({ model: 'siepic-strip-500x220-te', version: '1' });
  });
});

describe('two-output engineering study', () => {
  it('matches independent balanced-MZI formulas for nominal and both explicit phase errors', async () => {
    const input = notebook(0.2), request = { id: 3, notebook: input };
    const result = await evaluateStudy(request, { yieldControl: noYield });
    expect(result.cancelled).toBe(false); expect(result.curves).toHaveLength(3);
    for (const [curve, phase] of result.curves.map((curve, index) => [curve, [0.2, 0.3, 0.1][index]] as const)) {
      const desired = Math.cos(phase / 2) ** 2, unwanted = Math.sin(phase / 2) ** 2;
      for (const measured of curve.measurements) {
        expect(measured.eligible).toBe(true);
        expect(measured.desired.normalizedPower).toBeCloseTo(desired, 11);
        expect(measured.unwanted.normalizedPower).toBeCloseTo(unwanted, 11);
        expect(measured.insertionLossDb.value).toBeCloseTo(-10 * Math.log10(desired), 10);
        expect(measured.crosstalkDb.value).toBeCloseTo(10 * Math.log10(unwanted / desired), 10);
      }
      expect(curve.metrics.worstInsertionLossDb.value).toBeCloseTo(-10 * Math.log10(desired), 10);
      expect(curve.metrics.worstCrosstalkDb.value).toBeCloseTo(10 * Math.log10(unwanted / desired), 10);
    }
    expect(result.curves.map(curve => curve.metrics.status)).toEqual(['sampled-fail', 'sampled-fail', 'sampled-pass']);
    expect(result.sampling.caveat).toContain('between samples');
    expect(Object.isFrozen(result.request.notebook.study)).toBe(true);
    expect(input.variants[0].document.circuit.components.find(component => component.id === 'phase-1')!.params.phaseRad).toBe(0.2);
    const replay = await evaluateStudy({ id: 3, notebook: parseNotebook(serializeNotebook(input)) as StudyNotebook }, { yieldControl: noYield });
    expect(replay).toEqual(result);
  });
  it('computes worst sampled metrics over a wavelength-dependent MZI with each actual source normalization', async () => {
    const input = structuredClone(notebook(0.1));
    input.study.phaseScenarios = [];
    const circuit = input.variants[0].document.circuit;
    circuit.components.find(component => component.model === 'source')!.params.powerW = 0.004;
    circuit.connections.find(connection => connection.id === 'link-4')!.lengthM = 83e-6;
    const result = await evaluateStudy({ id: 4, notebook: input }, { yieldControl: noYield });
    const curve = result.curves[0];
    const desired = curve.samples.map(sample => Math.cos((0.1 - 2 * Math.PI * 2.4 * 3e-6 / sample.wavelengthM) / 2) ** 2);
    curve.measurements.forEach((measured, index) => expect(measured.desired.normalizedPower).toBeCloseTo(desired[index], 10));
    expect(curve.metrics.worstInsertionLossDb.value).toBeCloseTo(-10 * Math.log10(Math.min(...desired)), 9);
    expect(curve.sourcePowerW).toBe(0.004);
  });
  it('keeps exact zero, divergent ratios and 0/0 distinct and JSON safe', async () => {
    const input = notebook();
    const solveWithPowers = (desired: number, unwanted: number): ((circuit: any) => SolveResult) => circuit => { const solved = solveCircuit(circuit); solved.detectors['detector-2'].powerW = desired; solved.detectors['detector-1'].powerW = unwanted; return solved; };
    const result = await evaluateStudy({ id: 5, notebook: input }, { yieldControl: noYield, solve: solveWithPowers(0.001, 0) });
    expect(result.curves[0].measurements[0].unwanted.outputDb.status).toBe('negative-infinity');
    expect(result.curves[0].metrics.worstCrosstalkDb.status).toBe('negative-infinity');
    expect(result.curves[0].metrics.status).toBe('sampled-pass');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const blocked = await evaluateStudy({ id: 6, notebook: input }, { yieldControl: noYield, solve: solveWithPowers(0, 0.001) });
    expect(blocked.curves[0].metrics.worstInsertionLossDb.status).toBe('positive-infinity');
    expect(blocked.curves[0].metrics.worstCrosstalkDb.status).toBe('positive-infinity');
    expect(blocked.curves[0].metrics.status).toBe('sampled-fail');
    const dark = await evaluateStudy({ id: 7, notebook: input }, { yieldControl: noYield, solve: solveWithPowers(0, 0) });
    expect(dark.curves[0].metrics.worstCrosstalkDb.status).toBe('unavailable');
    expect(dark.curves[0].metrics.status).toBe('unresolved');
  });
  it('excludes accounting and pivot failures, keeps raw values/warnings, and does not certify a partial grid', async () => {
    const input = notebook();
    const warning: Diagnostic = { severity: 'warning', code: 'POWER_IMBALANCE', message: 'Independent acceptance probe' };
    const result = await evaluateStudy({ id: 8, notebook: input }, { yieldControl: noYield, solve: circuit => { const solved = solveCircuit(circuit); solved.diagnostics.push(warning); return solved; } });
    const curve = result.curves[0];
    expect(curve.samples[0].detectors['detector-2'].powerW).toBeCloseTo(0.001, 12);
    expect(curve.measurements[0].desired.powerW).toBeCloseTo(0.001, 12);
    expect(curve.measurements[0].desired.normalizedPower).toBeNull();
    expect(curve.measurements[0].reasons).toContainEqual(warning);
    expect(curve.metrics).toMatchObject({ excludedSamples: 7, eligibleSamples: 0, warningSamples: 7, status: 'unresolved' });
    const normal = await compareExperiments({ id: 9, notebook: input }, { yieldControl: noYield });
    const summary = summarizeStudy({ id: 9, notebook: input }, normal.results);
    expect(summary.curves[0].metrics.status).toBe('sampled-pass');
    normal.results[0].samples.pop();
    expect(summarizeStudy({ id: 9, notebook: input }, normal.results).curves[0].metrics.status).toBe('unresolved');
    const csv = exportStudyCsv(result);
    expect(csv).toContain(`# request: ${JSON.stringify(result.request)}`);
    expect(csv).toContain('POWER_IMBALANCE'); expect(csv).toContain('unavailable'); expect(csv).toContain('phase-plus');
  });
  it('leaves model warnings visible and excludes zero-source normalization', async () => {
    const input = structuredClone(notebook()); input.study.phaseScenarios = [];
    const warning: Diagnostic = { severity: 'warning', code: 'DATASET_NONPASSIVE', message: 'Source model warning remains qualified' };
    const result = await evaluateStudy({ id: 10, notebook: input }, { yieldControl: noYield, solve: circuit => { const solved = solveCircuit(circuit); solved.diagnostics.push(warning); return solved; } });
    expect(result.curves[0].metrics).toMatchObject({ eligibleSamples: 7, warningSamples: 7, status: 'sampled-pass' });
    expect(result.curves[0].samples[0].diagnostics).toContainEqual(warning);
    input.variants[0].document.circuit.components.find(component => component.model === 'source')!.params.powerW = 0;
    const dark = await evaluateStudy({ id: 11, notebook: input }, { yieldControl: noYield });
    expect(dark.curves[0].metrics.status).toBe('unresolved');
    expect(dark.curves[0].measurements[0].reasons.some(reason => reason.code === 'STUDY_ZERO_SOURCE')).toBe(true);
  });
});

describe('study worker isolation', () => {
  it('cancels before solving and never produces a completion', async () => {
    const clock = scheduler(), messages: StudyResponse[] = []; let solves = 0;
    const runner = createStudyRunner(message => messages.push(message), { yieldControl: clock.yieldControl, solve: circuit => { solves++; return solveCircuit(circuit); } });
    runner.handle({ type: 'run', id: 1, notebook: notebook() }); runner.handle({ type: 'cancel', id: 1 });
    await clock.drain(); expect(solves).toBe(0); expect(messages).toEqual([{ type: 'cancelled', id: 1, completed: 0, total: 21 }]);
  });
  it('supersedes runs, ignores stale cancel and clones source assumptions before yielding', async () => {
    const clock = scheduler(), messages: StudyResponse[] = [], input = structuredClone(notebook());
    const runner = createStudyRunner(message => messages.push(message), { yieldControl: clock.yieldControl, chunkSize: 2 });
    runner.handle({ type: 'run', id: 1, notebook: input }); await clock.next();
    runner.handle({ type: 'run', id: 2, notebook: input }); input.study.targets.maxCrosstalkDb = 200;
    runner.handle({ type: 'cancel', id: 1 }); await clock.drain();
    const completed = messages.filter(message => message.type === 'complete'); expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ type: 'complete', id: 2 });
    if (completed[0].type !== 'complete') throw new Error('Study completion missing');
    expect(completed[0].result.request.notebook.study.targets.maxCrosstalkDb).toBe(-20);
    expect(completed[0].result.curves).toHaveLength(3);
    expect(messages.some(message => message.type === 'cancelled' && message.id === 1)).toBe(true);
  });
});
