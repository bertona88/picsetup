import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDemoCircuit, makeRingCircuit, solveCircuit } from '../src/physics.js';
import {
  createParameterLink, defaultMeasurementSpecs, listSweepParameters, optimizeCircuit,
  resolveParameter, runTolerance, simulatePulse, sweepCircuit
} from '../src/analysis.js';

globalThis.requestAnimationFrame ??= callback => setTimeout(() => callback(performance.now()), 0);

const detectorSpec = (circuit, id = 'det-1') => ({ id: `m-${id}`, kind: 'component', componentId: id, metric: 'power', label: id });

test('MZI sweep derives power, phase, FSR, and group-delay metrics', () => {
  const circuit = makeDemoCircuit();
  const result = sweepCircuit(circuit, { parameterId: 'global:wavelengthNm', start: 1500, stop: 1600, points: 401 }, defaultMeasurementSpecs(circuit));
  assert.equal(result.failures, 0);
  assert.equal(result.x.length, 401);
  assert.ok(result.metrics[0].extinctionDb > 20);
  assert.ok(result.metrics[0].insertionLossDb < 1);
  assert.ok(result.metrics[0].fsr > 1 && result.metrics[0].fsr < 100);
  assert.ok(Number.isFinite(result.metrics[0].groupDelayAtMaxPs));
  assert.ok(Math.abs(result.metrics[0].groupDelayAtMaxPs) < 1000, 'group delay should be physical rather than a derivative sign artifact');
  assert.ok(result.metrics[0].phaseExcursionRad > 1);
  assert.ok(result.comparison && result.comparison.imbalanceMax <= 1 + 1e-9);
});

test('ring template yields a resonant wavelength response', () => {
  const circuit = makeRingCircuit();
  const result = sweepCircuit(circuit, { parameterId: 'global:wavelengthNm', start: 1500, stop: 1600, points: 801 }, defaultMeasurementSpecs(circuit));
  assert.equal(result.failures, 0);
  assert.ok(result.metrics.some(metric => metric.extinctionDb > 5));
  assert.ok(result.metrics.some(metric => metric.peakCount > 1));
});

test('linked parameters remain synchronized in direct edits and sweeps', () => {
  const circuit = makeDemoCircuit();
  const first = 'component:dc-1:gapUm';
  const second = 'component:dc-2:gapUm';
  const link = createParameterLink(circuit, [first, second], { name: 'Matched coupler gaps' });
  assert.equal(link.members.length, 2);
  resolveParameter(circuit, first).set(circuit, 0.31);
  assert.equal(circuit.components.find(component => component.id === 'dc-1').params.gapUm, 0.31);
  assert.equal(circuit.components.find(component => component.id === 'dc-2').params.gapUm, 0.31);
  const descriptor = listSweepParameters(circuit).find(parameter => parameter.id === second);
  assert.equal(descriptor.linkId, link.id);
  descriptor.set(circuit, 0.24);
  assert.equal(circuit.components.find(component => component.id === 'dc-1').params.gapUm, 0.24);
});

test('goal-based tuning improves a deliberately poor operating point', async () => {
  const circuit = makeDemoCircuit();
  circuit.components.find(component => component.id === 'phase-1').params.phaseRad = -2;
  const measurement = detectorSpec(circuit);
  const before = solveCircuit(circuit).components.get('det-1').measurementMw;
  const result = await optimizeCircuit(circuit, {
    measurement, goal: 'maximize', robustWindowNm: 1,
    parameterIds: ['component:phase-1:phaseRad'], passes: 3, samplesPerPass: 25
  });
  const after = solveCircuit(result.circuit).components.get('det-1').measurementMw;
  assert.ok(after > before + 0.5, `${before} -> ${after}`);
  assert.ok(result.evaluations > 20);
});

test('Monte Carlo is seeded, reports yield, corners, and sensitivities', async () => {
  const circuit = makeDemoCircuit();
  const config = {
    measurement: detectorSpec(circuit), samples: 80, threshold: 0.5, criterion: 'min', seed: 12345,
    parameters: [
      { id: 'component:phase-1:phaseRad', sigma: 0.08, relative: false },
      { id: 'component:dc-1:gapUm', sigma: 0.03, relative: true }
    ]
  };
  const a = await runTolerance(circuit, config);
  const b = await runTolerance(circuit, config);
  assert.deepEqual(a.values, b.values, 'seeded tolerance runs should reproduce exactly');
  assert.ok(a.yield >= 0 && a.yield <= 1);
  assert.equal(a.sensitivities.length, 2);
  assert.ok(a.worstCorner.value <= a.bestCorner.value);
  assert.ok(a.histogram.reduce((sum, bin) => sum + bin.count, 0) === a.samples);
});

test('pulse analysis reconstructs finite delay, width, and detector response', async () => {
  const circuit = makeDemoCircuit();
  circuit.components.find(component => component.type === 'source').params.sourceMode = 'pulsed';
  const result = await simulatePulse(circuit, detectorSpec(circuit), { durationPs: 8, repetitionRateMHz: 80, samples: 64 });
  assert.equal(result.kind, 'pulse');
  assert.equal(result.samples, 64);
  assert.ok(Number.isFinite(result.metrics.delayPs));
  assert.ok(result.metrics.outputFwhmPs >= 0);
  assert.ok(result.metrics.repetitionPeriodPs > 0);
  assert.ok(result.metrics.peakTransmission >= 0);
  assert.equal(result.timePs.length, 64);
});
