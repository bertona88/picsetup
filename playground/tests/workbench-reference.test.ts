import { describe, expect, test } from 'vitest';
import { compileRecipe } from '../src/api';
import { parseDocument, serializeDocument } from '../src/io/document';
import { createDatasetMziExperiment } from '../src/model/experiments';
import { solveCircuit } from '../src/solver/solve';

/** A separate flat fixture catches alias/expansion errors at the recipe boundary. */
const recipe = (phaseRad: number) => ({
  schema: 'picsetup-recipe/1', title: 'Independent recipe comparison', wavelengthM: 1550e-9,
  parts: [
    { id: 'laser', model: 'source', params: { powerW: .0021, phaseRad: .23 } },
    { id: 'device', block: 'mzi', params: { couplerModel: 'siepic-coupler', deltaLengthM: 8e-6, phaseRad, neff: 2.45, lossDbPerM: 111 } },
    { id: 'bar', model: 'detector' }, { id: 'cross', model: 'detector' },
  ],
  links: [
    { from: 'laser.out', to: 'device.in0' },
    { from: 'device.out0', to: 'bar.in' },
    { from: 'device.out1', to: 'cross.in' },
  ],
});

describe('recipe-to-solver reference checks', () => {
  test.each([0, .61, Math.PI])('compiled SiEPIC MZI matches independently wired fixture at phase %s', phase => {
    const compiled = compileRecipe(recipe(phase));
    const manual = createDatasetMziExperiment();
    manual.circuit.components.find(component => component.model === 'source')!.params = { powerW: .0021, phaseRad: .23 };
    manual.circuit.components.find(component => component.model === 'phase')!.params.phaseRad = phase;
    for (const connection of manual.circuit.connections) {
      connection.neff = 2.45;
      connection.lossDbPerM = 111;
    }
    manual.circuit.connections.find(connection => connection.id === 'link-4')!.lengthM = 88e-6;
    for (const wavelengthM of [1501, 1539, 1550, 1578, 1599].map(value => value * 1e-9)) {
      const actual = solveCircuit({ ...compiled.circuit, wavelengthM });
      const expected = solveCircuit({ ...manual.circuit, wavelengthM });
      expect(actual.ok).toBe(true);
      expect(expected.ok).toBe(true);
      expect(actual.residual).toBeLessThan(1e-12);
      for (const [actualId, expectedId] of [['bar', 'detector-1'], ['cross', 'detector-2']]) {
        expect(actual.detectors[actualId].powerW).toBeCloseTo(expected.detectors[expectedId].powerW, 13);
        const field = actual.ports.find(port => port.componentId === actualId)!.incoming;
        const reference = expected.ports.find(port => port.componentId === expectedId)!.incoming;
        expect(field.re).toBeCloseTo(reference.re, 12);
        expect(field.im).toBeCloseTo(reference.im, 12);
      }
      for (const key of Object.keys(expected.budget) as Array<keyof typeof expected.budget>) expect(actual.budget[key]).toBeCloseTo(expected.budget[key], 13);
    }
  });

  test('part ordering and bidirectional link notation preserve the experiment through portable JSON', () => {
    const input = recipe(.47);
    const compiled = compileRecipe(input);
    const reordered = compileRecipe({ ...input, parts: [...input.parts].reverse(), links: [...input.links].reverse().map(link => ({ from: link.to, to: link.from })) });
    const reopened = parseDocument(serializeDocument(reordered));
    const expected = solveCircuit(compiled.circuit);
    const actual = solveCircuit(reopened.circuit);
    expect(actual.ok).toBe(true);
    for (const detector of ['bar', 'cross']) expect(actual.detectors[detector].powerW).toBeCloseTo(expected.detectors[detector].powerW, 13);
    expect(reopened.circuit).toEqual(reordered.circuit);
  });
});
