import { describe, expect, test } from 'vitest';
import { createMziExample } from '../src/model/examples';
import { parseNotebook, serializeNotebook, type StudyNotebook } from '../src/experiments/notebook';
import { evaluateStudy } from '../src/experiments/study';
import { ringPreset, runRingExperiment, type RingRequest } from '../src/experiments/ring';

// Independent two-path oracle: no propagation evaluator, compact-model registry,
// goal ranking, or study measurement helpers are used to calculate these powers.
const c = 299792458, lambda0 = 1.55e-6, ne = 2.44553, ng = 4.19088, nd = .000354275;
function beta(wavelengthM: number) {
  const omega = 2 * Math.PI * c / wavelengthM, omega0 = 2 * Math.PI * c / lambda0;
  return 2 * Math.PI * ne / lambda0 + ng / c * (omega - omega0) - nd * lambda0 ** 2 / (4 * Math.PI * c) * (omega - omega0) ** 2;
}

function fixture(): StudyNotebook {
  const variants = [0, 10e-6, 20e-6].map((delta, index) => {
    const document = createMziExample();
    document.title = `Dispersive reference ${index}`;
    document.circuit.components.find(component => component.model === 'source')!.params.powerW = .0021;
    document.circuit.components.find(component => component.model === 'phase')!.params.phaseRad = beta(lambda0) * delta + Math.PI;
    document.circuit.connections.find(connection => connection.id === 'link-4')!.lengthM += delta;
    for (const connection of document.circuit.connections) if (connection.lengthM > 0) {
      connection.neff = ne;
      connection.waveguide = { model: 'siepic-strip-500x220-te', version: '1' };
    }
    return { id: `design-${index}`, name: document.title, document, detectorId: 'detector-1' };
  });
  return {
    schema: 'picsetup-notebook/2', title: 'Independent dispersive MZI decision',
    sweep: { startM: 1549e-9, stopM: 1551e-9, points: 9 }, variants,
    study: {
      schema: 'picsetup-study/1', baselineVariantId: 'design-0',
      outputs: variants.map(variant => ({ variantId: variant.id, desiredDetectorId: 'detector-1', unwantedDetectorId: 'detector-2' })),
      targets: { maxInsertionLossDb: .2, maxCrosstalkDb: -20 },
      phaseScenarios: [{ id: 'phase-plus', name: 'Assumed +0.15 rad', offsets: variants.map(variant => ({ variantId: variant.id, componentId: 'phase-1', phaseOffsetRad: .15 })) }],
    },
  };
}

describe('independent two-output study reference', () => {
  test('dispersive multi-variant band decisions and phase assumptions match a two-path analytical oracle', async () => {
    const notebook = fixture(), serialized = serializeNotebook(notebook);
    const reopened = parseNotebook(serialized) as StudyNotebook;
    expect(reopened).toEqual(notebook);
    const result = await evaluateStudy({ id: 17, notebook: reopened }, { yieldControl: async () => {} });
    expect(result.cancelled).toBe(false);
    expect(result.curves).toHaveLength(6);
    const statuses: Record<string, string> = {};
    for (const curve of result.curves) {
      const index = Number(curve.variantId.split('-')[1]), delta = index * 10e-6;
      const phaseOffset = curve.scenarioId === 'nominal' ? 0 : .15;
      const expected = curve.measurements.map(measured => {
        const phaseError = (beta(measured.wavelengthM) - beta(lambda0)) * delta - phaseOffset;
        const desired = Math.cos(phaseError / 2) ** 2, unwanted = Math.sin(phaseError / 2) ** 2;
        expect(measured.eligible).toBe(true);
        expect(measured.desired.normalizedPower).toBeCloseTo(desired, 11);
        expect(measured.unwanted.normalizedPower).toBeCloseTo(unwanted, 11);
        expect(measured.desired.powerW).toBeCloseTo(.0021 * desired, 14);
        expect(measured.unwanted.powerW).toBeCloseTo(.0021 * unwanted, 14);
        expect(measured.desired.powerW! + measured.unwanted.powerW!).toBeCloseTo(.0021, 14);
        return { il: -10 * Math.log10(desired), xt: 10 * Math.log10(unwanted / desired) };
      });
      const il = Math.max(...expected.map(value => value.il)), xt = Math.max(...expected.map(value => value.xt));
      expect(curve.metrics.worstInsertionLossDb.value).toBeCloseTo(il, 10);
      // A mathematically dark port is represented by floating-point amplitudes in
      // the circuit solve. Compare finite crosstalk away from that exact zero.
      if (Number.isFinite(xt)) expect(curve.metrics.worstCrosstalkDb.value).toBeCloseTo(xt, 9);
      else expect(curve.metrics.worstCrosstalkDb.status === 'negative-infinity' || curve.metrics.worstCrosstalkDb.value! < -200).toBe(true);
      expect(curve.metrics.status).toBe(il <= .2 && xt <= -20 ? 'sampled-pass' : 'sampled-fail');
      expect(curve.metrics.eligibleSamples).toBe(9);
      expect(curve.metrics.excludedSamples).toBe(0);
      statuses[`${curve.variantId}/${curve.scenarioId}`] = curve.metrics.status;
    }
    expect(statuses).toMatchObject({ 'design-0/nominal': 'sampled-pass', 'design-1/nominal': 'sampled-pass', 'design-2/nominal': 'sampled-fail', 'design-0/phase-plus': 'sampled-pass', 'design-1/phase-plus': 'sampled-fail', 'design-2/phase-plus': 'sampled-fail' });
    expect(result.differences[0].differences).toEqual([]);
    for (const change of result.differences.slice(1)) {
      expect(change.differences).toHaveLength(2);
      expect(change.differences.map(item => item.path).some(item => item.endsWith('params.phaseRad'))).toBe(true);
      expect(change.differences.map(item => item.path).some(item => item.endsWith('lengthM'))).toBe(true);
    }
    expect(serializeNotebook(notebook)).toBe(serialized);
    expect(Object.isFrozen(result.request.notebook.variants[0].document.circuit)).toBe(true);
  });
});

describe('independent ring measurement reference', () => {
  test('both reviewed critical rings resolve against half-depth crossing bisection despite a shifted coarse grid', async () => {
    const cases: RingRequest[] = [
      { ...ringPreset, startM: 1500.003e-9, stopM: 1600.003e-9 },
      { ...ringPreset, coupling: 1 - 10 ** (-.1 / 10), roundTripLengthM: 100e-6, lossDbPerM: 1000, centerM: 1548.4e-9, startM: 1500.003e-9, stopM: 1600.003e-9 },
    ];
    for (const input of cases) {
      const t = Math.sqrt(1 - input.coupling), a = 10 ** (-input.lossDbPerM * input.roundTripLengthM / 20);
      const opticalLength = input.neff * input.roundTripLengthM, turns = input.phaseRad / (2 * Math.PI);
      const resonance = opticalLength / (Math.round(opticalLength / input.centerM + turns) - turns);
      // Direct complex numerator/denominator, separate from ring.ts's reduced real formula.
      const transfer = (wavelength: number) => {
        const angle = 2 * Math.PI * opticalLength / wavelength + input.phaseRad;
        const real = Math.cos(angle), imaginary = -Math.sin(angle);
        return ((t - a * real) ** 2 + (a * imaginary) ** 2) / ((1 - t * a * real) ** 2 + (t * a * imaginary) ** 2);
      };
      const peak = ((t + a) / (1 + t * a)) ** 2, minimum = ((t - a) / (1 - t * a)) ** 2, halfDepth = (minimum + peak) / 2;
      const crossing = (side: number) => {
        let inner = resonance, outer = resonance + side * 1e-9;
        expect(transfer(outer)).toBeGreaterThan(halfDepth);
        for (let iteration = 0; iteration < 45; iteration++) {
          const middle = (inner + outer) / 2;
          if (transfer(middle) < halfDepth) inner = middle; else outer = middle;
        }
        return (inner + outer) / 2;
      };
      const linewidth = crossing(1) - crossing(-1);
      const result = await runRingExperiment(input, { yieldControl: async () => {} });
      expect(result.status).toBe('resolved');
      expect(result.metrics).not.toBeNull();
      expect(Math.abs(result.metrics!.resonanceM - resonance) / linewidth).toBeLessThan(.01);
      expect(Math.abs(result.metrics!.linewidthM - linewidth) / linewidth).toBeLessThan(.002);
      expect(Math.abs(result.metrics!.minimumTransmission - minimum)).toBeLessThan(1e-8);
      expect(result.metrics!.q).toBeCloseTo(result.metrics!.resonanceM / result.metrics!.linewidthM, 8);
      expect(result.metrics!.extinctionDb).toBeNull();
      expect(result.metrics!.extinctionReportingThresholdDb).toBe(120);
      expect(result.evaluations).toBeLessThanOrEqual(input.maxEvaluations);
      const near = result.coarse.filter(sample => Math.abs(sample.wavelengthM - resonance) < 1e-9);
      expect(near.length).toBeGreaterThan(0);
      expect(Math.min(...near.map(sample => sample.transmission!))).toBeGreaterThan(.85);
      for (const sample of result.local) {
        expect(sample.eligible).toBe(true);
        expect(sample.transmission).toBeCloseTo(transfer(sample.wavelengthM), 6);
      }
    }
  });
});
