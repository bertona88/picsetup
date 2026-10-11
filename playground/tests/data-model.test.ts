import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { evaluate } from '../src/model/registry';
import { datasetMetadata, datasetSigmaMax, evaluateDataset } from '../src/model/dataset';
import { parseDocument, serializeDocument } from '../src/io/document';
import { createMziExample } from '../src/model/examples';
import { solveCircuit } from '../src/solver/solve';
import type { Circuit, Complex, Component } from '../src/model/types';

const C = 299_792_458;
const folder = new URL('../models/siepic-dc-200nm-10um/', import.meta.url);
const raw = readFileSync(new URL('source.sparam', folder), 'utf8');
const bundle = JSON.parse(readFileSync(new URL('data.json', folder), 'utf8')) as {
  schema: string; id: string; version: string; frequencyHz: number[]; s: Complex[][][];
  metadata: { sourceSha256: string; passiveCertified: boolean };
};
const component: Component = { id: 'data', model: 'siepic-coupler', version: '1', label: 'Native-port coupler', params: {} };

/** Independent reader of the pinned text fixture; production converter/evaluator is never reused. */
function readReference() {
  const lines = raw.trim().split(/\r?\n/);
  const matrices: Complex[][][] = [];
  let frequencies: number[] = [];
  const seen = new Set<string>();
  for (let at = 0; at < lines.length;) {
    const header = /^\('port (\d+)','TE',1,'port (\d+)',1,'transmission'\)$/.exec(lines[at++]);
    if (!header) throw new Error('Unexpected source format');
    const output = Number(header[1]) - 1, input = Number(header[2]) - 1;
    const shape = /^\((\d+),3\)$/.exec(lines[at++]);
    if (!shape) throw new Error('Unexpected source block dimensions');
    const count = Number(shape[1]);
    if (seen.size === 0) {
      frequencies = new Array(count);
      for (let i = 0; i < count; i++) matrices.push(Array.from({ length: 4 }, () => new Array(4)));
    }
    const key = `${output},${input}`;
    if (seen.has(key)) throw new Error('Duplicated source matrix entry');
    seen.add(key);
    for (let sample = 0; sample < count; sample++) {
      const [frequency, amplitude, phase] = lines[at++].trim().split(/\s+/).map(Number);
      if (seen.size === 1) frequencies[sample] = frequency;
      else if (frequencies[sample] !== frequency) throw new Error('Source frequency grids differ');
      // Source exp(-iωt) → playground exp(+iωt): conjugate amplitude × exp(i phase).
      matrices[sample][output][input] = { re: amplitude * Math.cos(phase), im: -amplitude * Math.sin(phase) };
    }
  }
  if (seen.size !== 16) throw new Error('Full four-port matrix was not retained');
  return { frequencies, matrices };
}
const reference = readReference();
const power = (value: Complex) => value.re ** 2 + value.im ** 2;
function expectMatrix(actual: Complex[][], expected: Complex[][]) {
  expect(actual).toHaveLength(4);
  for (let output = 0; output < 4; output++) {
    expect(actual[output]).toHaveLength(4);
    for (let input = 0; input < 4; input++) {
      expect(actual[output][input].re).toBeCloseTo(expected[output][input].re, 11);
      expect(actual[output][input].im).toBeCloseTo(expected[output][input].im, 11);
    }
  }
}

describe('pinned SiEPIC model, independently reconstructed from source', () => {
  test('retains pinned bytes, version and every original complex coefficient', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe('945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371');
    expect(bundle.metadata.sourceSha256).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(bundle.schema).toBe('picsetup.smatrix.v1');
    expect(bundle.id).toBe('siepic-dc-200nm-10um');
    expect(bundle.version).toBe('1.0.0');
    expect(bundle.frequencyHz).toEqual(reference.frequencies);
    expect(bundle.s).toHaveLength(101);
    for (let sample = 0; sample < reference.frequencies.length; sample++) {
      expectMatrix(bundle.s[sample], reference.matrices[sample]);
    }
  });

  test('runtime registry reproduces all 101 samples including both band boundaries', () => {
    for (let sample = 0; sample < reference.frequencies.length; sample++) {
      expectMatrix(evaluate(component, C / reference.frequencies[sample]), reference.matrices[sample]);
    }
  });

  test('interpolates real and imaginary values in frequency and preserves the independent 1550 nm reference', () => {
    for (const sample of [0, 23, 49, 98]) {
      const frequency = (reference.frequencies[sample] + reference.frequencies[sample + 1]) / 2;
      const expected = reference.matrices[sample].map((row, output) => row.map((entry, input) => ({
        re: (entry.re + reference.matrices[sample + 1][output][input].re) / 2,
        im: (entry.im + reference.matrices[sample + 1][output][input].im) / 2,
      })));
      expectMatrix(evaluateDataset(C / frequency), expected);
    }
    const independent = JSON.parse(readFileSync(new URL('verification.json', folder), 'utf8'));
    expectMatrix(evaluateDataset(1550e-9), independent.referenceAt1550nm.s);
  });

  test('runtime passivity and reciprocity checks agree with the independent NumPy SVD audit', () => {
    const audit = JSON.parse(readFileSync(new URL('verification.json', folder), 'utf8'));
    const sigmas = reference.frequencies.map(frequency => datasetSigmaMax(C / frequency));
    expect(Math.min(...sigmas)).toBeCloseTo(audit.passivity.sigmaMaxMin, 11);
    expect(Math.max(...sigmas)).toBeCloseTo(audit.passivity.sigmaMaxMax, 11);
    expect(sigmas.flatMap((sigma, index) => sigma > 1 + audit.passivity.tolerance ? [index] : []))
      .toEqual(audit.passivity.sampleIndicesAboveOnePlusTolerance);
    for (const matrix of reference.matrices) for (let output = 0; output < 4; output++) for (let input = 0; input < 4; input++) {
      expect(matrix[output][input]).toEqual(matrix[input][output]);
    }
  });

  test('keeps the observed numerical passivity violation visible instead of repairing source values', () => {
    // Normalized coherent excitation [1,1,-1,-1]/2 exposes a violation invisible to individual column sums.
    const s = evaluateDataset(C / reference.frequencies[68]);
    const excitation = [.5, .5, -.5, -.5];
    const outputPower = s.reduce((total, row) => total + power(row.reduce((value, entry, input) => ({
      re: value.re + excitation[input] * entry.re,
      im: value.im + excitation[input] * entry.im,
    }), { re: 0, im: 0 })), 0);
    expect(outputPower).toBeCloseTo(1.0044755357261022, 11);
    expect(outputPower).toBeGreaterThan(1);
    expect(bundle.metadata.passiveCertified).toBe(false);
  });

  test('rejects extrapolation without fabricated detector results', () => {
    for (const wavelength of [1400e-9, 1700e-9]) {
      expect(() => evaluateDataset(wavelength)).toThrow(/outside|band/i);
      const circuit: Circuit = { wavelengthM: wavelength, components: [component], connections: [] };
      const result = solveCircuit(circuit);
      expect(result.ok).toBe(false);
      expect(result.ports).toEqual([]);
      expect(result.detectors).toEqual({});
      expect(result.diagnostics.some(diagnostic => diagnostic.code === 'DATASET_OUT_OF_BAND')).toBe(true);
    }
    expect(datasetMetadata.datasetId).toBe(bundle.id);
    expect(datasetMetadata.sourceSha256).toBe(bundle.metadata.sourceSha256);
  });

  test('accounts for all native outputs, reflected source power and component exchange', () => {
    const circuit: Circuit = {
      wavelengthM: C / reference.frequencies[50],
      components: [
        { id: 'source', model: 'source', version: '1', label: 'Source', params: { powerW: 1, phaseRad: 0 } },
        component,
        ...[1, 2, 3].map(port => ({ id: `d${port}`, model: 'detector' as const, version: '1' as const, label: `Port ${port + 1}`, params: {} })),
      ],
      connections: [0, 1, 2, 3].map(port => ({
        id: `link-${port}`, from: { component: port === 0 ? 'source' : `d${port}`, port: 0 },
        to: { component: component.id, port }, lengthM: 0, neff: 2.4, lossDbPerM: 0,
      })),
    };
    const result = solveCircuit(circuit);
    expect(result.ok).toBe(true);
    const expected = reference.matrices[50];
    for (const port of [1, 2, 3]) expect(result.detectors[`d${port}`].powerW).toBeCloseTo(power(expected[port][0]), 11);
    expect(result.budget.returnedToSourceW).toBeCloseTo(power(expected[0][0]), 11);
    const netAbsorption = 1 - expected.reduce((sum, row) => sum + power(row[0]), 0);
    expect(result.budget.componentAbsorbedW - result.budget.modelSuppliedW).toBeCloseTo(netAbsorption, 11);
    expect(Math.abs(result.budget.imbalanceW)).toBeLessThan(1e-10);
  });

  test('portable reopen retains exact model version and solves the same mixed-model MZI', () => {
    const document = createMziExample();
    const selected = document.circuit.components.find(item => item.model === 'coupler')!;
    selected.model = 'siepic-coupler'; selected.params = {}; selected.version = '1';
    const before = solveCircuit(document.circuit);
    expect(before.ok).toBe(true);
    const reopened = parseDocument(serializeDocument(document));
    expect(reopened).toEqual(document);
    expect(reopened.circuit.components.find(item => item.id === selected.id)).toMatchObject({ model: 'siepic-coupler', version: '1', params: {} });
    const after = solveCircuit(reopened.circuit);
    expect(after.ok).toBe(true);
    expect(after.ports).toEqual(before.ports);
    expect(after.budget).toEqual(before.budget);
  });
});
