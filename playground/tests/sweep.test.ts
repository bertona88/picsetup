import { describe, expect, it } from 'vitest';
import { createMziExample } from '../src/model/examples';
import { datasetMetadata } from '../src/model/dataset';
import type { Circuit } from '../src/model/types';
import { solveCircuit } from '../src/solver/solve';
import { createSweepRunner, exportSweepCsv, sweepCircuit, sweepWavelength, validateSweepRequest, type SweepRequest, type SweepResponse } from '../src/solver/sweep';

const request = (extra: Partial<SweepRequest> = {}): SweepRequest => ({ id: 1, circuit: createMziExample().circuit, startM: 1.5e-6, stopM: 1.6e-6, points: 201, ...extra });
const noYield = async (): Promise<void> => {};
const microtasks = async (): Promise<void> => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
const scheduler = () => {
  const pending: (() => void)[] = [];
  return {
    yieldControl: () => new Promise<void>(resolve => pending.push(resolve)),
    async next() { expect(pending.length).toBeGreaterThan(0); pending.shift()!(); await microtasks(); },
    async drain() { let steps = 0; while (pending.length) { if (++steps > 100) throw new Error('Sweep did not finish'); pending.shift()!(); await microtasks(); } },
  };
};

describe('wavelength sweep measurements', () => {
  it('matches an independent unequal-arm MZI oracle at all 201 wavelengths and conserves power', async () => {
    const input = request();
    input.circuit.connections.find(connection => connection.id === 'link-4')!.lengthM += 10e-6;
    const original = JSON.stringify(input);
    const { samples, cancelled } = await sweepCircuit(input, { yieldControl: noYield });
    expect(cancelled).toBe(false);
    expect(samples).toHaveLength(201);
    expect(samples[0].wavelengthM).toBe(input.startM);
    expect(samples.at(-1)!.wavelengthM).toBe(input.stopM);
    for (const sample of samples) {
      const phaseDifference = 2 * Math.PI * 2.4 * 10e-6 / sample.wavelengthM;
      expect(sample.ok).toBe(true);
      expect(sample.detectors['detector-1'].powerW).toBeCloseTo(0.001 * Math.sin(phaseDifference / 2) ** 2, 13);
      expect(sample.detectors['detector-2'].powerW).toBeCloseTo(0.001 * Math.cos(phaseDifference / 2) ** 2, 13);
      expect(sample.budget!.detectedW).toBeCloseTo(0.001, 13);
      expect(sample.budget!.imbalanceW).toBeCloseTo(0, 13);
      expect(sample.residual!).toBeLessThan(1e-10);
    }
    expect(JSON.stringify(input)).toBe(original);
  });

  it('protects the entire in-flight request from caller mutation', async () => {
    const input = request({ points: 3 });
    const time = scheduler();
    const task = sweepCircuit(input, { yieldControl: time.yieldControl });
    input.circuit.components.find(component => component.model === 'source')!.params.powerW = 9;
    input.startM = 8;
    input.points = 900;
    await time.drain();
    const result = await task;
    expect(result.samples).toHaveLength(3);
    expect(result.samples[0].wavelengthM).toBe(1.5e-6);
    expect(result.samples[0].budget!.emittedW).toBe(0.001);
  });

  it('keeps a failed wavelength as a diagnosed gap with no fabricated zero output', async () => {
    const input = request({ points: 3 });
    const { samples } = await sweepCircuit(input, {
      yieldControl: noYield,
      solve: circuit => circuit.wavelengthM === input.stopM
        ? { ...solveCircuit(circuit), ok: false, diagnostics: [{ severity: 'error', code: 'MODEL_DOMAIN', message: 'Outside this model’s wavelength range.' }] }
        : solveCircuit(circuit),
    });
    expect(samples.map(sample => sample.ok)).toEqual([true, true, false]);
    expect(samples[2]).toMatchObject({ wavelengthM: input.stopM, detectors: {}, budget: null, residual: null });
    expect(samples[2].diagnostics[0].code).toBe('MODEL_DOMAIN');
  });

  it('isolates unexpected model failures to explicit sample diagnostics', async () => {
    const result = await sweepCircuit(request({ points: 2 }), { yieldControl: noYield, solve: () => { throw new Error('Model wavelength interpolation failed.'); } });
    expect(result.samples.every(sample => !sample.ok && sample.budget === null && Object.keys(sample.detectors).length === 0)).toBe(true);
    expect(result.samples[0].diagnostics).toEqual([{ severity: 'error', code: 'SWEEP_SAMPLE_FAILED', message: 'Model wavelength interpolation failed.' }]);
  });

  it.each([NaN, Infinity, -Infinity, -1, 0, 1, 1.2, 1002])('rejects invalid point count %s', points => {
    expect(validateSweepRequest(request({ points })).some(item => item.code === 'INVALID_SWEEP_POINTS')).toBe(true);
  });

  it.each([
    { startM: NaN }, { stopM: Infinity }, { startM: 0 }, { startM: -1 }, { startM: 2e-6 }, { stopM: 1.5e-6 },
  ])('rejects invalid wavelength range %j', extra => {
    expect(validateSweepRequest(request(extra)).some(item => item.code === 'INVALID_SWEEP_RANGE')).toBe(true);
  });

  it('validates untrusted messages without throwing', () => {
    for (const invalid of [null, undefined, [], {}, { ...request(), id: 1.1 }, { ...request(), circuit: null }]) expect(validateSweepRequest(invalid).length).toBeGreaterThan(0);
    expect(validateSweepRequest(request({ points: 2 }))).toEqual([]);
    expect(validateSweepRequest(request({ points: 1001 }))).toEqual([]);
  });

  it('contains invalid circuit state as failed samples', async () => {
    const input = request({ points: 2 });
    input.circuit.components[0].params.powerW = NaN;
    const result = await sweepCircuit(input, { yieldControl: noYield });
    expect(result.samples.every(sample => !sample.ok && sample.budget === null)).toBe(true);
    expect(result.samples[0].diagnostics.some(item => item.code === 'INVALID_PARAMETERS')).toBe(true);
  });

  it('does not accumulate grid drift, including large representable endpoints', () => {
    expect(sweepWavelength(request(), 200)).toBe(1.6e-6);
    const range = { startM: 1e308, stopM: 1.5e308, points: 1001 };
    expect(Number.isFinite(sweepWavelength(range, 999))).toBe(true);
    expect(sweepWavelength(range, 1000)).toBe(range.stopM);
  });
});

describe('worker orchestration and cancellation', () => {
  it('cancels after a progress batch, without completing or fabricating remaining points', async () => {
    const time = scheduler();
    const messages: SweepResponse[] = [];
    const runner = createSweepRunner(message => messages.push(message), { yieldControl: time.yieldControl, chunkSize: 8 });
    runner.handle({ type: 'run', ...request() });
    await time.next();
    expect(messages).toMatchObject([{ type: 'progress', id: 1, completed: 8, total: 201 }]);
    runner.handle({ type: 'cancel', id: 1 });
    await time.drain();
    expect(messages.at(-1)).toEqual({ type: 'cancelled', id: 1, completed: 8, total: 201 });
    expect(messages.some(message => message.type === 'complete')).toBe(false);
  });

  it('allows immediate cancellation before any numerical solve', async () => {
    const time = scheduler();
    const messages: SweepResponse[] = [];
    let solves = 0;
    const runner = createSweepRunner(message => messages.push(message), { yieldControl: time.yieldControl, solve: circuit => { solves++; return solveCircuit(circuit); } });
    runner.handle({ type: 'run', ...request() });
    runner.handle({ type: 'cancel', id: 1 });
    await time.drain();
    expect(solves).toBe(0);
    expect(messages).toEqual([{ type: 'cancelled', id: 1, completed: 0, total: 201 }]);
  });

  it('supersedes an old run and ignores stale cancellation of the new run', async () => {
    const time = scheduler();
    const messages: SweepResponse[] = [];
    const runner = createSweepRunner(message => messages.push(message), { yieldControl: time.yieldControl, chunkSize: 8 });
    runner.handle({ type: 'run', ...request() });
    await time.next();
    runner.handle({ type: 'run', ...request({ id: 2, points: 9, startM: 1.52e-6 }) });
    runner.handle({ type: 'cancel', id: 1 });
    await time.drain();
    expect(messages.filter(message => message.id === 1).map(message => message.type)).toEqual(['progress', 'cancelled']);
    const complete = messages.find(message => message.type === 'complete');
    expect(complete).toMatchObject({ type: 'complete', id: 2, request: { id: 2, points: 9 } });
    if (complete?.type !== 'complete') throw new Error('Missing complete event');
    expect(complete.samples).toHaveLength(9);
    expect(complete.samples[0].wavelengthM).toBe(1.52e-6);
  });

  it('reports malformed requests explicitly and cancels a superseded job', async () => {
    const time = scheduler();
    const messages: SweepResponse[] = [];
    const runner = createSweepRunner(message => messages.push(message), { yieldControl: time.yieldControl });
    runner.handle({ type: 'run', ...request() });
    runner.handle({ type: 'run', ...request({ id: 2, points: Infinity }) });
    runner.handle(null);
    await time.drain();
    expect(messages.some(message => message.type === 'error' && message.id === 2 && message.diagnostics.some(item => item.code === 'INVALID_SWEEP_POINTS'))).toBe(true);
    expect(messages.some(message => message.type === 'error' && message.id === -1)).toBe(true);
    expect(messages.some(message => message.type === 'complete')).toBe(false);
    expect(messages.some(message => message.type === 'cancelled' && message.id === 1)).toBe(true);
  });
});

describe('spectral CSV', () => {
  it('exports every sample at full precision with model versions, SI state, diagnostics and blank unavailable fields', async () => {
    const input = request({ points: 3 });
    const { samples } = await sweepCircuit(input, { yieldControl: noYield });
    samples[2] = { wavelengthM: input.stopM, ok: false, detectors: {}, budget: null, residual: null, diagnostics: [{ severity: 'error', code: 'MODEL_DOMAIN', message: 'Out of band, no extrapolation.' }] };
    const csv = exportSweepCsv(input, samples);
    expect(csv).toContain('picsetup-spectrum/1');
    expect(csv).toContain('wavelength_m,ok,detector:detector-1:power_W,detector:detector-1:phase_rad');
    expect(csv).toContain('budget_propagationLoss_W');
    expect(csv).toContain('budget_modelSupplied_W');
    expect(csv).toContain('"model":"coupler","version":"1"');
    expect(csv).toContain('# circuit:');
    const rows = csv.split('\r\n').filter(line => /^[0-9]/.test(line));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(String(samples[0].detectors['detector-2'].powerW));
    expect(rows[0]).toContain(',true,0,,'); // Zero field has undefined phase, not a fabricated phase of zero.
    expect(rows[2]).toMatch(/^0\.0000016,false,,,,,,,,,,,,,,/);
    expect(rows[2]).toContain('MODEL_DOMAIN');
  });

  it('quotes adversarial detector identifiers instead of changing column count', async () => {
    const circuit: Circuit = { wavelengthM: 1.55e-6, components: [{ id: 'strange,"detector', model: 'detector', version: '1', params: {}, label: 'Quoted detector' }], connections: [] };
    const input = request({ circuit, points: 2 });
    const { samples } = await sweepCircuit(input, { yieldControl: noYield });
    expect(exportSweepCsv(input, samples)).toContain('"detector:strange,""detector:power_W"');
  });

  it('records exact imported dataset version/hash in CSV only when the circuit uses it', async () => {
    const input = request({ points: 3, startM: 1.51e-6, stopM: 1.59e-6 });
    for (const component of input.circuit.components) if (component.model === 'coupler') { component.model = 'siepic-coupler'; component.params = {}; }
    const { samples } = await sweepCircuit(input, { yieldControl: noYield });
    expect(samples.every(sample => sample.ok)).toBe(true);
    const csv = exportSweepCsv(input, samples);
    expect(csv).toContain(`# dataset_provenance: ${JSON.stringify(datasetMetadata)}`);
    expect(csv).toContain(datasetMetadata.sourceSha256);
    expect(exportSweepCsv(request(), [])).not.toContain('# dataset_provenance:');
  });
});
