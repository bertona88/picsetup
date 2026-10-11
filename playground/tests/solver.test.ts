import { describe, expect, it } from 'vitest';
import { defaultParams, evaluate, MODEL_IDS, portNames } from '../src/model/registry';
import type { Circuit, Component, Complex, Connection, ModelId } from '../src/model/types';
import { solveCircuit, validateCircuit } from '../src/solver/solve';

const component = (id: string, model: ModelId, params: Record<string, number> = {}): Component => ({ id, model, version: '1', label: id, params: { ...defaultParams(model), ...params } });
const line = (id: string, from: string, fromPort: number, to: string, toPort: number, extra: Partial<Connection> = {}): Connection => ({ id, from: { component: from, port: fromPort }, to: { component: to, port: toPort }, lengthM: 0, neff: 2.4, lossDbPerM: 0, ...extra });
const circuit = (components: Component[], connections: Connection[] = []): Circuit => ({ components, connections, wavelengthM: 1.55e-6 });
const closeComplex = (actual: Complex, expected: Complex, digits = 11) => {
  expect(actual.re).toBeCloseTo(expected.re, digits);
  expect(actual.im).toBeCloseTo(expected.im, digits);
};
const mzi = (phaseRad: number): Circuit => circuit([
  component('s', 'source', { powerW: 1 }), component('c1', 'coupler'), component('c2', 'coupler'),
  component('p', 'phase', { phaseRad }), component('d0', 'detector'), component('d1', 'detector'),
], [line('in', 's', 0, 'c1', 0), line('up0', 'c1', 2, 'p', 0), line('up1', 'p', 1, 'c2', 0), line('down', 'c1', 3, 'c2', 1), line('out0', 'c2', 2, 'd0', 0), line('out1', 'c2', 3, 'd1', 0)]);

describe('bundled scattering models', () => {
  it('declares supported ports and independent default parameter objects', () => {
    expect(MODEL_IDS).toEqual(['source', 'coupler', 'siepic-coupler', 'phase', 'attenuator', 'detector', 'termination']);
    expect(portNames('coupler')).toEqual(['L0', 'L1', 'R0', 'R1']);
    const params = defaultParams('source'); params.powerW = 8;
    expect(defaultParams('source').powerW).toBe(0.001);
  });

  it.each([0, 0.2, 0.5, 0.87, 1])('coupler K=%s is reciprocal and fully unitary, including off-diagonal terms', coupling => {
    const s = evaluate(component('c', 'coupler', { coupling }), 1.55e-6);
    // Independent S†S multiplication; checking only column norms misses interference signs.
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      closeComplex(s[i][j], s[j][i]);
      let re = 0; let im = 0;
      for (let k = 0; k < 4; k++) {
        re += s[k][i].re * s[k][j].re + s[k][i].im * s[k][j].im;
        im += s[k][i].re * s[k][j].im - s[k][i].im * s[k][j].re;
      }
      closeComplex({ re, im }, { re: i === j ? 1 : 0, im: 0 });
    }
    closeComplex(s[2][0], { re: Math.sqrt(1 - coupling), im: 0 });
    closeComplex(s[3][0], { re: 0, im: Math.sqrt(coupling) });
  });

  it('phase transmission uses exp(-iφ) in both directions', () => {
    const s = evaluate(component('p', 'phase', { phaseRad: Math.PI / 2 }), 1.55e-6);
    closeComplex(s[0][1], { re: 0, im: -1 });
    closeComplex(s[1][0], { re: 0, im: -1 });
  });

  it('attenuation is converted from power dB to field amplitude once', () => {
    const s = evaluate(component('a', 'attenuator', { attenuationDb: 20 }), 1.55e-6);
    closeComplex(s[1][0], { re: 0.1, im: 0 });
  });

  it.each(['source', 'detector', 'termination'] as const)('%s is a matched one-port model', model => {
    expect(evaluate(component('x', model), 1.55e-6)).toEqual([[{ re: 0, im: 0 }]]);
  });
});

describe('headless coherent network solver', () => {
  it('solves an empty sketch without inventing illumination', () => {
    const result = solveCircuit(circuit([]));
    expect(result.ok).toBe(true);
    expect(result.ports).toEqual([]);
    expect(result.budget.emittedW).toBe(0);
    expect(result.diagnostics.some(d => d.code === 'EMPTY_CIRCUIT')).toBe(true);
  });

  it('accounts for an unconnected source as escaping power', () => {
    const result = solveCircuit(circuit([component('s', 'source', { powerW: 0.002, phaseRad: 0.3 })]));
    expect(result.ok).toBe(true);
    closeComplex(result.ports[0].outgoing, { re: Math.sqrt(0.002) * Math.cos(0.3), im: Math.sqrt(0.002) * Math.sin(0.3) });
    expect(result.budget.escapedW).toBeCloseTo(0.002, 14);
    expect(result.budget.imbalanceW).toBeCloseTo(0, 14);
    expect(result.diagnostics.some(d => d.code === 'MATCHED_BOUNDARIES')).toBe(true);
  });

  it('calculates independent propagation phase and loss at the detector reference plane', () => {
    const wavelengthM = 1.4e-6;
    const lengthM = 13.7e-6;
    const neff = 2.2;
    const lossDbPerM = 24000;
    const phaseRad = 0.21;
    const fixture = { ...circuit([component('s', 'source', { powerW: 0.004, phaseRad }), component('d', 'detector')], [line('wg', 's', 0, 'd', 0, { lengthM, neff, lossDbPerM })]), wavelengthM };
    const result = solveCircuit(fixture);
    const expectedPower = 0.004 * Math.pow(10, -lossDbPerM * lengthM / 10);
    const expectedPhase = phaseRad - 2 * Math.PI * neff * lengthM / wavelengthM;
    expect(result.ok).toBe(true);
    closeComplex(result.ports.find(port => port.componentId === 'd')!.incoming, { re: Math.sqrt(expectedPower) * Math.cos(expectedPhase), im: Math.sqrt(expectedPower) * Math.sin(expectedPhase) });
    expect(result.detectors.d.powerW).toBeCloseTo(expectedPower, 14);
    expect(result.budget.propagationLossW).toBeCloseTo(0.004 - expectedPower, 14);
    expect(result.budget.imbalanceW).toBeCloseTo(0, 14);
    expect(result.residual).toBeLessThan(1e-10);
  });

  it.each(Array.from({ length: 17 }, (_, i) => i * Math.PI / 8))('MZI obeys complex and power closed forms at phase=%s', phaseRad => {
    const result = solveCircuit(mzi(phaseRad));
    const d0 = result.ports.find(port => port.componentId === 'd0')!.incoming;
    const d1 = result.ports.find(port => port.componentId === 'd1')!.incoming;
    expect(result.ok).toBe(true);
    closeComplex(d0, { re: (Math.cos(phaseRad) - 1) / 2, im: -Math.sin(phaseRad) / 2 });
    closeComplex(d1, { re: Math.sin(phaseRad) / 2, im: (Math.cos(phaseRad) + 1) / 2 });
    expect(result.detectors.d0.powerW).toBeCloseTo(Math.sin(phaseRad / 2) ** 2, 11);
    expect(result.detectors.d1.powerW).toBeCloseTo(Math.cos(phaseRad / 2) ** 2, 11);
    expect(result.budget.detectedW).toBeCloseTo(1, 11);
    expect(result.budget.imbalanceW).toBeCloseTo(0, 11);
    expect(result.residual).toBeLessThan(1e-10);
  });

  it('inserting a zero-phase model preserves fields when connection length is split explicitly', () => {
    const source = component('s', 'source', { powerW: 0.1, phaseRad: 0.72 });
    const detector = component('d', 'detector');
    const original = circuit([source, detector], [line('wg', 's', 0, 'd', 0, { lengthM: 18e-6, lossDbPerM: 2400 })]);
    const inserted = circuit([source, component('p', 'phase'), detector], [line('wg1', 's', 0, 'p', 0, { lengthM: 7e-6, lossDbPerM: 2400 }), line('wg2', 'p', 1, 'd', 0, { lengthM: 11e-6, lossDbPerM: 2400 })]);
    const a = solveCircuit(original); const b = solveCircuit(inserted);
    expect(a.ok && b.ok).toBe(true);
    closeComplex(b.ports.find(p => p.componentId === 'd')!.incoming, a.ports.find(p => p.componentId === 'd')!.incoming);
    expect(b.budget.propagationLossW).toBeCloseTo(a.budget.propagationLossW, 13);
  });

  it('marks numerically dark detector phase unresolved without clamping its computed power', () => {
    const result = solveCircuit(mzi(2 * Math.PI));
    expect(result.ok).toBe(true);
    expect(result.detectors.d0.powerW).toBeGreaterThan(0);
    expect(result.detectors.d0.powerW).toBeLessThan(1e-24);
    expect(result.detectors.d0.phaseRad).toBeNull();
    expect(result.detectors.d1.phaseRad).not.toBeNull();
  });

  it('accounts separately for attenuation, termination and disconnected escape', () => {
    const fixture = circuit([component('s', 'source', { powerW: 1 }), component('c', 'coupler'), component('a', 'attenuator', { attenuationDb: 10 }), component('t', 'termination')], [line('in', 's', 0, 'c', 0), line('a0', 'c', 2, 'a', 0), line('a1', 'a', 1, 't', 0)]);
    const result = solveCircuit(fixture);
    expect(result.ok).toBe(true);
    expect(result.budget.componentAbsorbedW).toBeCloseTo(0.5, 12);
    expect(result.budget.escapedW).toBeCloseTo(0.5, 12);
    expect(result.budget.detectedW).toBe(0);
    expect(result.budget.imbalanceW).toBeCloseTo(0, 12);
  });

  it('does not mutate circuit state and solves finite zero fields with no source', () => {
    const fixture = circuit([component('p', 'phase'), component('d', 'detector')], [line('w', 'p', 1, 'd', 0)]);
    const before = JSON.stringify(fixture);
    const result = solveCircuit(fixture);
    expect(JSON.stringify(fixture)).toBe(before);
    expect(result.ok).toBe(true);
    expect(result.detectors.d).toEqual({ powerW: 0, phaseRad: null });
    expect(result.diagnostics.some(d => d.code === 'NO_SOURCE')).toBe(true);
  });

  it('handles prototype-like IDs as ordinary identifiers', () => {
    const result = solveCircuit(circuit([component('constructor', 'source'), component('__proto__', 'detector')], [line('x', 'constructor', 0, '__proto__', 0)]));
    expect(result.ok).toBe(true);
    expect(Object.hasOwn(result.detectors, '__proto__')).toBe(true);
    expect(result.detectors.__proto__.powerW).toBeCloseTo(0.001, 14);
  });
});

describe('admission and failure diagnostics', () => {
  const expectRejected = (fixture: Circuit, code: string) => {
    expect(validateCircuit(fixture).some(d => d.severity === 'error' && d.code === code)).toBe(true);
    const result = solveCircuit(fixture);
    expect(result.ok).toBe(false);
    expect(result.ports).toEqual([]);
  };

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid wavelength %s', wavelengthM => {
    expectRejected({ ...circuit([]), wavelengthM }, 'INVALID_WAVELENGTH');
  });
  it('rejects malformed runtime values without throwing', () => {
    for (const invalid of [null, undefined, [], {}, { components: null, connections: [] }, { components: [null], connections: [], wavelengthM: 1e-6 }]) {
      expect(() => solveCircuit(invalid as Circuit)).not.toThrow();
      expect(solveCircuit(invalid as Circuit).ok).toBe(false);
    }
  });
  it('rejects unsupported models and versions', () => {
    expectRejected(circuit([{ ...component('s', 'source'), model: 'mystery' as ModelId }]), 'UNSUPPORTED_MODEL');
    expectRejected(circuit([{ ...component('s', 'source'), version: '2' as '1' }]), 'UNSUPPORTED_MODEL_VERSION');
  });
  it.each([
    ['source', { powerW: -1, phaseRad: 0 }, 'INVALID_POWER'],
    ['source', { powerW: 1, phaseRad: NaN }, 'INVALID_PARAMETERS'],
    ['coupler', { coupling: -0.1 }, 'INVALID_COUPLING'],
    ['coupler', { coupling: 1.1 }, 'INVALID_COUPLING'],
    ['attenuator', { attenuationDb: -1 }, 'INVALID_ATTENUATION'],
    ['phase', { phaseRad: Infinity }, 'INVALID_PARAMETERS'],
  ] as const)('rejects %s out-of-domain parameters', (model, params, code) => {
    expectRejected(circuit([component('x', model, { ...params })]), code);
  });
  it('rejects extra or missing model parameters', () => {
    expectRejected(circuit([component('x', 'detector', { unexpected: 1 })]), 'INVALID_PARAMETERS');
    expectRejected(circuit([{ ...component('x', 'phase'), params: {} }]), 'INVALID_PARAMETERS');
  });
  it('rejects duplicated component IDs and multiple sources', () => {
    expectRejected(circuit([component('x', 'detector'), component('x', 'phase')]), 'DUPLICATE_COMPONENT');
    expectRejected(circuit([component('s1', 'source'), component('s2', 'source')]), 'MULTIPLE_SOURCES');
  });
  it('rejects nonexistent ports, duplicate links and self-endpoints', () => {
    const components = [component('s', 'source'), component('d', 'detector'), component('t', 'termination')];
    expectRejected(circuit(components, [line('w', 's', 1, 'd', 0)]), 'INVALID_ENDPOINT');
    expectRejected(circuit(components, [line('w', 's', 0, 'missing', 0)]), 'INVALID_ENDPOINT');
    expectRejected(circuit(components, [line('w', 's', 0, 'd', 0), line('w2', 's', 0, 't', 0)]), 'PORT_ALREADY_CONNECTED');
    expectRejected(circuit(components, [line('w', 's', 0, 's', 0)]), 'SELF_CONNECTION');
  });
  it.each([{ lengthM: -1 }, { lossDbPerM: -1 }, { neff: 0 }, { lengthM: NaN }, { neff: Infinity }])('rejects invalid propagation %j', extra => {
    expectRejected(circuit([component('s', 'source'), component('d', 'detector')], [line('w', 's', 0, 'd', 0, extra)]), 'INVALID_PROPAGATION');
  });
  it('rejects overflowing propagation without feeding NaN to the solver', () => {
    expectRejected(circuit([component('s', 'source'), component('d', 'detector')], [line('w', 's', 0, 'd', 0, { lengthM: Number.MAX_VALUE, neff: 3 })]), 'PROPAGATION_OVERFLOW');
  });
  it('bounds component and total port counts before allocating a dense matrix', () => {
    expectRejected(circuit(Array.from({ length: 101 }, (_, i) => component(String(i), 'detector'))), 'CIRCUIT_TOO_LARGE');
    expectRejected(circuit(Array.from({ length: 65 }, (_, i) => component(String(i), 'coupler'))), 'CIRCUIT_TOO_LARGE');
  });
});
