import { describe, expect, it } from 'vitest';
import { solveCircuit } from '../src/solver/solve';
import type { Circuit, Complex, Component, Connection, SolveResult } from '../src/model/types';

// Independent closed-form oracles: no production complex helpers, scattering
// evaluator, example circuits, or matrix solver are used to calculate expectations.
const component = (id: string, model: Component['model'], params: Component['params'] = {}): Component => ({
  id, model, version: '1', label: id, params,
});
const link = (id: string, from: string, fromPort: number, to: string, toPort: number,
  lengthM = 0, lossDbPerM = 0, neff = 2.4): Connection => ({
  id, from: { component: from, port: fromPort }, to: { component: to, port: toPort },
  lengthM, lossDbPerM, neff,
});
const inputAt = (result: SolveResult, id: string, port = 0): Complex => {
  const value = result.ports.find(item => item.componentId === id && item.port === port);
  expect(value, `missing port ${id}:${port}`).toBeDefined();
  return value!.incoming;
};
function closeField(actual: Complex, expected: Complex, tolerance = 1e-12) {
  expect(Math.abs(actual.re - expected.re)).toBeLessThan(tolerance);
  expect(Math.abs(actual.im - expected.im)).toBeLessThan(tolerance);
}
function wellConditioned(result: SolveResult) {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  expect(result.residual).toBeLessThan(1e-10);
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  expect(Math.abs(result.budget.imbalanceW)).toBeLessThan(1e-12);
}

describe('independent arbitrary-coupler MZI reference', () => {
  // K denotes POWER coupling. Unequal arm lengths, unequal n_eff and unequal
  // losses expose sign, sqrt(power), reference-plane and dB-unit mistakes.
  const settings = [
    { k1: 0.07, k2: 0.31, wavelengthM: 1490e-9, extraPhase: 0.27, upperLoss: 0, lowerLoss: 0 },
    { k1: 0.82, k2: 0.64, wavelengthM: 1550e-9, extraPhase: -0.62, upperLoss: 2000, lowerLoss: 4000 },
    { k1: 0.5, k2: 0.5, wavelengthM: 1620e-9, extraPhase: 2.3, upperLoss: 750, lowerLoss: 1900 },
    { k1: 0, k2: 1, wavelengthM: 1535e-9, extraPhase: 0.91, upperLoss: 4000, lowerLoss: 9000 },
    { k1: 1, k2: 0.3, wavelengthM: 1580e-9, extraPhase: -1.7, upperLoss: 1200, lowerLoss: 2300 },
  ];

  it.each(settings)('matches both complex outputs for K1=$k1, K2=$k2, lambda=$wavelengthM', setting => {
    const { k1, k2, wavelengthM, extraPhase, upperLoss, lowerLoss } = setting;
    const powerW = 0.0027;
    const sourcePhase = -0.37;
    const upperLength = 80e-6;
    const lowerLength = 143e-6;
    const circuit: Circuit = {
      wavelengthM,
      components: [
        component('source', 'source', { powerW, phaseRad: sourcePhase }),
        component('split', 'coupler', { coupling: k1 }),
        component('phase', 'phase', { phaseRad: extraPhase }),
        component('combine', 'coupler', { coupling: k2 }),
        component('out0', 'detector'), component('out1', 'detector'),
      ],
      connections: [
        link('in', 'source', 0, 'split', 0),
        link('upper', 'split', 2, 'phase', 0, upperLength, upperLoss, 2.4),
        link('upper-end', 'phase', 1, 'combine', 0),
        link('lower', 'split', 3, 'combine', 1, lowerLength, lowerLoss, 2.41),
        link('out0', 'combine', 2, 'out0', 0), link('out1', 'combine', 3, 'out1', 0),
      ],
    };
    const result = solveCircuit(circuit);
    wellConditioned(result);

    const amplitude = Math.sqrt(powerW);
    const upperAttenuation = 10 ** (-upperLoss * upperLength / 20);
    const lowerAttenuation = 10 ** (-lowerLoss * lowerLength / 20);
    const upperPhase = sourcePhase - 2 * Math.PI * 2.4 * upperLength / wavelengthM - extraPhase;
    const lowerPhase = sourcePhase - 2 * Math.PI * 2.41 * lowerLength / wavelengthM;
    const uu = Math.sqrt((1 - k1) * (1 - k2)) * upperAttenuation;
    const ll = Math.sqrt(k1 * k2) * lowerAttenuation;
    const ul = Math.sqrt((1 - k1) * k2) * upperAttenuation;
    const lu = Math.sqrt(k1 * (1 - k2)) * lowerAttenuation;
    // E0=(t1 t2 hu - sqrt(K1 K2) hl) s.
    // E1=i (t1 sqrt(K2) hu + sqrt(K1) t2 hl) s.
    const expected0 = {
      re: amplitude * (uu * Math.cos(upperPhase) - ll * Math.cos(lowerPhase)),
      im: amplitude * (uu * Math.sin(upperPhase) - ll * Math.sin(lowerPhase)),
    };
    const expected1 = {
      re: -amplitude * (ul * Math.sin(upperPhase) + lu * Math.sin(lowerPhase)),
      im: amplitude * (ul * Math.cos(upperPhase) + lu * Math.cos(lowerPhase)),
    };
    closeField(inputAt(result, 'out0'), expected0);
    closeField(inputAt(result, 'out1'), expected1);
    expect(result.detectors.out0.powerW).toBeCloseTo(expected0.re ** 2 + expected0.im ** 2, 13);
    expect(result.detectors.out1.powerW).toBeCloseTo(expected1.re ** 2 + expected1.im ** 2, 13);
    const transmitted = powerW * ((1 - k1) * upperAttenuation ** 2 + k1 * lowerAttenuation ** 2);
    expect(result.budget.detectedW).toBeCloseTo(transmitted, 13);
    expect(result.budget.propagationLossW).toBeCloseTo(powerW - transmitted, 13);
    expect(result.budget.returnedToSourceW).toBe(0);
    expect(result.budget.escapedW).toBe(0);
    expect(result.budget.componentAbsorbedW).toBe(0);
  });
});

describe('independent reciprocal return-loop reference', () => {
  it.each([0, 0.13, 0.5, 0.91, 1])('accounts for matched source absorption at K=%s', coupling => {
    const powerW = 0.003;
    const phaseRad = 0.41;
    const lengthM = 47e-6;
    const lossDbPerM = 6300;
    const wavelengthM = 1577e-9;
    // Joining R0 to R1 sends BOTH outgoing waves back through the coupler.
    const circuit: Circuit = {
      wavelengthM,
      components: [
        component('source', 'source', { powerW, phaseRad }),
        component('coupler', 'coupler', { coupling }), component('detector', 'detector'),
      ],
      connections: [
        link('input', 'source', 0, 'coupler', 0),
        link('output', 'coupler', 1, 'detector', 0),
        link('return', 'coupler', 2, 'coupler', 3, lengthM, lossDbPerM),
      ],
    };
    const result = solveCircuit(circuit);
    wellConditioned(result);
    const attenuation = 10 ** (-lossDbPerM * lengthM / 20);
    const phase = phaseRad - 2 * Math.PI * 2.4 * lengthM / wavelengthM;
    const amplitude = Math.sqrt(powerW) * attenuation;
    const returnedAmplitude = 2 * Math.sqrt(coupling * (1 - coupling)) * amplitude;
    const detectedAmplitude = (1 - 2 * coupling) * amplitude;
    closeField(inputAt(result, 'source'), {
      re: -returnedAmplitude * Math.sin(phase), im: returnedAmplitude * Math.cos(phase),
    });
    closeField(inputAt(result, 'detector'), {
      re: detectedAmplitude * Math.cos(phase), im: detectedAmplitude * Math.sin(phase),
    });
    expect(result.budget.returnedToSourceW).toBeCloseTo(4 * coupling * (1 - coupling) * attenuation ** 2 * powerW, 13);
    expect(result.budget.detectedW).toBeCloseTo((1 - 2 * coupling) ** 2 * attenuation ** 2 * powerW, 13);
    expect(result.budget.propagationLossW).toBeCloseTo((1 - attenuation ** 2) * powerW, 13);
    expect(result.budget.emittedW).toBe(powerW);
    expect(result.budget.escapedW).toBe(0);
    expect(result.budget.componentAbsorbedW).toBe(0);
  });
});

describe('independent all-pass ring algebra', () => {
  // Solver-level fixtures only: these do not establish a spectral UI or M2.
  it.each([
    { coupling: 0.23, wavelengthM: 1550e-9, lossDbPerM: 0 },
    { coupling: 0.23, wavelengthM: 1551.2e-9, lossDbPerM: 3500 },
    { coupling: 0.76, wavelengthM: 1590e-9, lossDbPerM: 6000 },
    { coupling: 1, wavelengthM: 1500e-9, lossDbPerM: 1250 },
  ])('matches H=(t-A)/(1-tA) for $coupling, $wavelengthM, $lossDbPerM', setting => {
    const { coupling, wavelengthM, lossDbPerM } = setting;
    const powerW = 0.0017;
    const phaseRad = -0.23;
    const lengthM = 90e-6;
    const circuit: Circuit = {
      wavelengthM,
      components: [
        component('source', 'source', { powerW, phaseRad }),
        component('coupler', 'coupler', { coupling }), component('detector', 'detector'),
      ],
      connections: [
        link('input', 'source', 0, 'coupler', 0), link('output', 'coupler', 2, 'detector', 0),
        link('ring', 'coupler', 3, 'coupler', 1, lengthM, lossDbPerM),
      ],
    };
    const result = solveCircuit(circuit);
    wellConditioned(result);
    const t = Math.sqrt(1 - coupling);
    const roundTripAmplitude = 10 ** (-lossDbPerM * lengthM / 20);
    const theta = -2 * Math.PI * 2.4 * lengthM / wavelengthM;
    const ar = roundTripAmplitude * Math.cos(theta);
    const ai = roundTripAmplitude * Math.sin(theta);
    const dr = 1 - t * ar;
    const di = -t * ai;
    const denominator = dr ** 2 + di ** 2;
    const hr = ((t - ar) * dr - ai * di) / denominator;
    const hi = (-ai * dr - (t - ar) * di) / denominator;
    const amplitude = Math.sqrt(powerW);
    const expected = {
      re: amplitude * (hr * Math.cos(phaseRad) - hi * Math.sin(phaseRad)),
      im: amplitude * (hr * Math.sin(phaseRad) + hi * Math.cos(phaseRad)),
    };
    closeField(inputAt(result, 'detector'), expected);
    const transmissionPower = powerW * (hr ** 2 + hi ** 2);
    expect(result.detectors.detector.powerW).toBeCloseTo(transmissionPower, 13);
    // |b_ring|² = K P / |1-tA|²; circulating power is not output power.
    const expectedPropagationLoss = coupling * powerW / denominator * (1 - roundTripAmplitude ** 2);
    expect(result.budget.propagationLossW).toBeCloseTo(expectedPropagationLoss, 13);
    expect(result.budget.detectedW + result.budget.propagationLossW).toBeCloseTo(powerW, 13);
    expect(result.budget.returnedToSourceW).toBe(0);
  });

  function unsourcedLoop(attenuationDb: number): Circuit {
    return {
      wavelengthM: 1550e-9,
      components: [component('phase', 'phase', { phaseRad: 0 }), component('loss', 'attenuator', { attenuationDb })],
      connections: [link('forward', 'phase', 1, 'loss', 0), link('back', 'loss', 1, 'phase', 0)],
    };
  }

  it('rejects an exactly singular lossless unsourced loop without adding damping', () => {
    const circuit = unsourcedLoop(0);
    const before = JSON.stringify(circuit);
    const result = solveCircuit(circuit);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'SINGULAR_NETWORK' }));
    expect(result.ports).toEqual([]);
    expect(result.detectors).toEqual({});
    expect(JSON.stringify(circuit)).toBe(before);
  });

  it('warns on a resolvable near-singular loop and returns the exact unsourced zero solution', () => {
    const circuit = unsourcedLoop(1e-8);
    const before = JSON.stringify(circuit);
    const result = solveCircuit(circuit);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'SMALL_PIVOT' }));
    expect(result.residual).toBe(0);
    for (const port of result.ports) {
      expect(Math.hypot(port.incoming.re, port.incoming.im)).toBe(0);
      expect(Math.hypot(port.outgoing.re, port.outgoing.im)).toBe(0);
    }
    for (const value of Object.values(result.budget)) expect(value).toBe(0);
    expect(JSON.stringify(circuit)).toBe(before);
  });
});
