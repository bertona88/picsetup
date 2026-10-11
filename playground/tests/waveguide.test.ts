import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { evaluatePropagation, SPEED_OF_LIGHT, validatePropagation, waveguideMetadata } from '../src/model/propagation';
import { defaultParams } from '../src/model/registry';
import type { Circuit, Complex, Component, Connection, ModelId } from '../src/model/types';
import { solveCircuit } from '../src/solver/solve';
import reference from '../models/siepic-strip-500x220-te/reference.json';
import manifest from '../models/siepic-strip-500x220-te/manifest.json';

const waveguide = { model: 'siepic-strip-500x220-te', version: '1' } as const;
const component = (id: string, model: ModelId, params: Record<string, number> = {}): Component => ({ id, model, version: '1', label: id, params: { ...defaultParams(model), ...params } });
const line = (id: string, from: string, fromPort: number, to: string, toPort: number, lengthM = 0, lossDbPerM = 0): Connection => ({
  id, from: { component: from, port: fromPort }, to: { component: to, port: toPort }, lengthM, lossDbPerM,
  neff: waveguideMetadata.neff, waveguide: { ...waveguide },
});
const closeComplex = (actual: Complex, expected: Complex, tolerance = 2e-11) => {
  expect(Math.abs(actual.re - expected.re)).toBeLessThan(tolerance);
  expect(Math.abs(actual.im - expected.im)).toBeLessThan(tolerance);
};
function mzi(wavelengthM: number, phaseRad = reference.mzi.phaseRad): Circuit {
  return { wavelengthM, components: [component('s', 'source'), component('c1', 'coupler'), component('c2', 'coupler'), component('p', 'phase', { phaseRad }), component('d0', 'detector'), component('d1', 'detector')],
    connections: [line('in', 's', 0, 'c1', 0), line('up0', 'c1', 2, 'p', 0, 80e-6), line('up1', 'p', 1, 'c2', 0), line('down', 'c1', 3, 'c2', 1, 100e-6), line('out0', 'c2', 2, 'd0', 0), line('out1', 'c2', 3, 'd1', 0)] };
}

describe('pinned SiEPIC straight-guide propagation', () => {
  it('pins the original bytes and distinguishes the declared window from a source-validity claim', () => {
    const bytes = readFileSync(new URL('../models/siepic-strip-500x220-te/source.txt', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.source.sha256);
    expect(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex')).toBe(manifest.source.gitBlobSha1);
    expect(manifest.eligibility.sourceValidatedWavelengthBandM).toBeNull();
    expect(waveguideMetadata.evaluationWindowBasis).toContain('assumption');
    expect(Object.isFrozen(waveguideMetadata.source)).toBe(true);
    expect(Object.isFrozen(waveguideMetadata.evaluationWindowM)).toBe(true);
  });

  it.each(reference.guideSamples)('matches independent phase, delay and loss at $wavelengthM m', sample => {
    const guide = line('wg', 's', 0, 'd', 0, sample.lengthM, sample.lossDbPerM);
    const value = evaluatePropagation(guide, sample.wavelengthM);
    closeComplex(value.h, sample.h);
    expect(Math.abs(value.betaRadPerM - sample.betaRadPerM)).toBeLessThan(1e-7);
    expect(value.effectiveIndex).toBeCloseTo(sample.effectiveIndex, 13);
    expect(value.groupIndex).toBeCloseTo(sample.groupIndex, 13);
    expect(Math.abs(value.groupDelayS - sample.groupDelayS)).toBeLessThan(1e-27);
    const circuit: Circuit = { wavelengthM: sample.wavelengthM, components: [component('s', 'source', { powerW: 1 }), component('d', 'detector')], connections: [guide] };
    const solved = solveCircuit(circuit);
    expect(solved.ok).toBe(true);
    closeComplex(solved.ports.find(port => port.componentId === 'd')!.incoming, sample.h);
    expect(solved.budget.propagationLossW + solved.detectors.d.powerW).toBeCloseTo(1, 13);
    expect(solved.budget.modelSuppliedW).toBe(0);
    expect(solved.diagnostics.some(diagnostic => diagnostic.code === 'EXPERIMENTAL_WAVEGUIDE')).toBe(true);
    circuit.connections[0] = { ...guide, from: guide.to, to: guide.from };
    closeComplex(solveCircuit(circuit).ports.find(port => port.componentId === 'd')!.incoming, sample.h);
  });

  it('differentiates unwrapped transfer phase in angular frequency to obtain positive group delay', () => {
    const guide = line('wg', 's', 0, 'd', 0, 13.7e-6);
    const frequency = SPEED_OF_LIGHT / 1.55e-6;
    const stepHz = 1e9;
    const low = evaluatePropagation(guide, SPEED_OF_LIGHT / (frequency - stepHz));
    const high = evaluatePropagation(guide, SPEED_OF_LIGHT / (frequency + stepHz));
    const negativePhaseDerivative = (high.betaRadPerM - low.betaRadPerM) * guide.lengthM / (4 * Math.PI * stepHz);
    const center = evaluatePropagation(guide, 1.55e-6);
    expect(Math.abs(negativePhaseDerivative - center.groupDelayS)).toBeLessThan(1e-23);
    expect(center.groupIndex).toBe(4.19088);
    expect(center.effectiveIndex).toBeCloseTo(2.44553, 14);
  });

  it.each(reference.mzi.samples)('matches both complex MZI outputs at $wavelengthM m', sample => {
    const result = solveCircuit(mzi(sample.wavelengthM));
    expect(result.ok).toBe(true);
    closeComplex(result.ports.find(port => port.componentId === 'd0')!.incoming, sample.d0, 2e-12);
    closeComplex(result.ports.find(port => port.componentId === 'd1')!.incoming, sample.d1, 2e-12);
    expect(result.detectors.d0.powerW).toBeCloseTo(sample.d0PowerW, 13);
    expect(result.detectors.d1.powerW).toBeCloseTo(sample.d1PowerW, 13);
    expect(result.budget.detectedW).toBeCloseTo(0.001, 14);
    expect(Math.abs(result.budget.imbalanceW)).toBeLessThan(1e-17);
  });

  it('resolves independent equal-phase fringe roots with group-index spacing instead of neff spacing', () => {
    const roots = reference.fringes.equalPhaseOrders;
    for (const root of roots) {
      const result = solveCircuit(mzi(root.wavelengthM, 0));
      expect(result.ok).toBe(true);
      expect(result.detectors.d0.powerW).toBeLessThan(1e-25);
      expect(result.detectors.d1.powerW).toBeCloseTo(0.001, 14);
    }
    const measuredFrequencySpacing = (roots[2].frequencyHz - roots[0].frequencyHz) / 2;
    expect(Math.abs(measuredFrequencySpacing / reference.fringes.localReferenceFsrHz - 1)).toBeLessThan(0.001);
    const wrongNondispersiveSpacing = SPEED_OF_LIGHT / (waveguideMetadata.neff * 20e-6);
    expect(Math.abs(measuredFrequencySpacing / wrongNondispersiveSpacing - 1)).toBeGreaterThan(0.4);
  });

  it('rejects invalid identity, ignored-index ambiguity and evaluations beyond the declared window', () => {
    const guide = line('wg', 's', 0, 'd', 0, 10e-6);
    expect(validatePropagation({ ...guide, neff: 2.4 }, 1550e-9).map(d => d.code)).toContain('WAVEGUIDE_INDEX_MISMATCH');
    for (const invalid of [null, {}, { model: waveguide.model, version: '2' }, { ...waveguide, extra: true }]) {
      expect(validatePropagation({ ...guide, waveguide: invalid }, 1550e-9).map(d => d.code)).toContain('UNSUPPORTED_WAVEGUIDE');
    }
    for (const wavelengthM of [1499.999e-9, 1600.001e-9]) {
      expect(validatePropagation(guide, wavelengthM).map(d => d.code)).toContain('WAVEGUIDE_OUT_OF_BAND');
      expect(solveCircuit(mzi(wavelengthM)).ok).toBe(false);
    }
    expect(validatePropagation(guide, 1500e-9)).toEqual([]);
    expect(validatePropagation(guide, 1600e-9)).toEqual([]);
  });

  it('preserves the historical constant-index transmission and permits its wavelengths outside the guide window', () => {
    const guide = { lengthM: 12.7e-6, lossDbPerM: 3200, neff: 2.1 };
    const wavelengthM = 1400e-9;
    const phase = -2 * Math.PI * guide.neff * guide.lengthM / wavelengthM;
    const gain = 10 ** (-guide.lossDbPerM * guide.lengthM / 20);
    const actual = evaluatePropagation(guide, wavelengthM);
    expect(actual.h).toEqual({ re: gain * Math.cos(phase), im: gain * Math.sin(phase) });
    expect(actual.groupIndex).toBe(guide.neff);
    expect(validatePropagation(guide, wavelengthM)).toEqual([]);
  });

  it('rejects nonfinite, negative or overflow propagation before solving', () => {
    const guide = line('wg', 's', 0, 'd', 0, 10e-6);
    expect(validatePropagation({ ...guide, lossDbPerM: -1 }, 1550e-9)[0].code).toBe('INVALID_PROPAGATION');
    expect(validatePropagation({ ...guide, lengthM: Number.MAX_VALUE }, 1550e-9)[0].code).toBe('PROPAGATION_OVERFLOW');
    expect(() => evaluatePropagation(guide, Number.NaN)).toThrow('Vacuum wavelength');
  });
});
