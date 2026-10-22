import { describe, expect, it } from 'vitest';
import { compileRecipe, exampleRecipes, parseDocument, serializeDocument, solveCircuit } from '../src/api';
import recipe from '../examples/recipes/ideal-iq-transmitter.json';
import savedCircuit from '../examples/circuits/ideal-iq-transmitter.json';

function fixture(i: number, q: number, bias = Math.PI / 2, powerW = 0.001, sourcePhase = 0) {
  const doc = compileRecipe(recipe);
  const phases: Record<string, number> = { iUpper: i, iLower: -i, qUpper: q, qLower: -q, quadrature: bias };
  for (const component of doc.circuit.components) {
    if (component.id in phases) component.params.phaseRad = phases[component.id];
    if (component.id === 'laser') component.params = { powerW, phaseRad: sourcePhase };
  }
  return doc;
}

describe('ideal static IQ transmitter', () => {
  it.each([
    [0, 0, Math.PI / 2],
    [Math.PI / 3, Math.PI / 3, Math.PI / 2],
    [Math.PI / 2, Math.PI / 2, Math.PI / 2],
    [0.2, 2.1, 0],
    [-2.4, 0.8, 0.73],
    [Math.PI, -Math.PI / 4, -Math.PI / 2],
  ])('matches independent four-output fields and power for I=%s, Q=%s, bias=%s', (i, q, bias) => {
    const powerW = 0.0037, sourcePhase = 0.37;
    const doc = fixture(i, q, bias, powerW, sourcePhase);
    const result = solveCircuit(doc.circuit);
    expect(result.ok).toBe(true);
    const a = Math.sqrt(powerW) / 2, ci = Math.cos(i), cq = Math.cos(q);
    // Direct feed-forward algebra for ideal 50:50 couplers and exp(-i phi).
    // This oracle neither assembles nor solves the scattering network.
    const reference: Record<string, [number, number]> = {
      signal: [-a * cq * Math.sin(bias), a * (ci - cq * Math.cos(bias))],
      complement: [-a * (ci + cq * Math.cos(bias)), a * cq * Math.sin(bias)],
      iDump: [0, -Math.sqrt(powerW / 2) * Math.sin(i)],
      qDump: [Math.sqrt(powerW / 2) * Math.sin(q), 0],
    };
    for (const [id, [re, im]] of Object.entries(reference)) {
      const expected = {
        re: re * Math.cos(sourcePhase) - im * Math.sin(sourcePhase),
        im: re * Math.sin(sourcePhase) + im * Math.cos(sourcePhase),
      };
      const actual = result.ports.find(port => port.componentId === id && port.port === 0)!.incoming;
      expect(actual.re).toBeCloseTo(expected.re, 13);
      expect(actual.im).toBeCloseTo(expected.im, 13);
      expect(result.detectors[id].powerW).toBeCloseTo(re * re + im * im, 14);
    }
    expect(result.budget.detectedW).toBeCloseTo(powerW, 14);
    expect(Math.abs(result.budget.imbalanceW)).toBeLessThan(1e-14);
    expect(result.budget.escapedW).toBeCloseTo(0, 14);
    expect(result.budget.modelSuppliedW).toBe(0);
    expect(result.residual).toBeLessThan(1e-10);
  });

  it('changes orthogonal field coordinates at quadrature and preserves signed amplitudes', () => {
    const field = (i: number, q: number) => solveCircuit(fixture(i, q).circuit).ports.find(port => port.componentId === 'signal')!.incoming;
    const base = field(0, 0), iChanged = field(Math.PI, 0), qChanged = field(0, Math.PI);
    expect(iChanged.re).toBeCloseTo(base.re, 14);
    expect(iChanged.im).toBeCloseTo(-base.im, 14);
    expect(qChanged.re).toBeCloseTo(-base.re, 14);
    expect(qChanged.im).toBeCloseTo(base.im, 14);
  });

  it('ships a portable ideal example with explicit zero-length links and the documented default powers', () => {
    expect(exampleRecipes.find(example => example.id === 'ideal-iq-transmitter')!.recipe).toEqual(recipe);
    const doc = compileRecipe(recipe), restored = parseDocument(serializeDocument(doc));
    expect(restored.circuit).toEqual(doc.circuit);
    expect(parseDocument(JSON.stringify(savedCircuit)).circuit).toEqual(doc.circuit);
    expect(doc.circuit.components.filter(part => part.model === 'source')).toHaveLength(1);
    expect(doc.circuit.components.some(part => part.model === 'siepic-coupler')).toBe(false);
    expect(doc.circuit.connections.every(link => link.lengthM === 0 && link.lossDbPerM === 0)).toBe(true);
    const result = solveCircuit(restored.circuit);
    expect(result.detectors.signal.powerW).toBeCloseTo(0.000125, 14);
    expect(result.detectors.complement.powerW).toBeCloseTo(0.000125, 14);
    expect(result.detectors.iDump.powerW).toBeCloseTo(0.000375, 14);
    expect(result.detectors.qDump.powerW).toBeCloseTo(0.000375, 14);
  });

  it('preserves zero-power and dark-output states without inventing detector phase', () => {
    const zero = solveCircuit(fixture(0, 0, Math.PI / 2, 0).circuit);
    expect(zero.ok).toBe(true);
    for (const detector of Object.values(zero.detectors)) expect(detector).toEqual({ powerW: 0, phaseRad: null });
    const dark = solveCircuit(fixture(Math.PI / 2, Math.PI / 2).circuit);
    expect(dark.detectors.signal.powerW).toBeLessThan(1e-27);
    expect(dark.detectors.signal.phaseRad).toBeNull();
  });
});
