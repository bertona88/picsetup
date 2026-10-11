import { describe, expect, it } from 'vitest';
import { BLOCK_DEFINITIONS, blockCatalog, insertBlock, instantiateBlock } from '../src/blocks';
import type { BlockFragment, BlockId, BlockParams } from '../src/blocks';
import { blankDocument, parseDocument, serializeDocument } from '../src/io/document';
import { createDatasetMziExperiment } from '../src/model/experiments';
import type { Circuit, Component, Connection, Endpoint, SolveResult } from '../src/model/types';
import { solveCircuit } from '../src/solver/solve';

const model = (id: string, name: Component['model'], params: Component['params'] = {}): Component => ({
  id, model: name, version: '1', label: id, params,
});
const link = (id: string, from: Endpoint, to: Endpoint): Connection => ({ id, from, to, lengthM: 0, lossDbPerM: 0, neff: 2.4 });
function illuminate(fragment: BlockFragment, input: string, outputs: string[], wavelengthM = 1550e-9): Circuit {
  return {
    wavelengthM,
    components: [...fragment.components, model('source', 'source', { powerW: 0.001, phaseRad: 0 }), ...outputs.map(id => model(id, 'detector'))],
    connections: [...fragment.connections, link('source-link', { component: 'source', port: 0 }, fragment.ports[input]), ...outputs.map(id => link(`detect-${id}`, fragment.ports[id], { component: id, port: 0 }))],
  };
}
function good(result: SolveResult) {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  expect(result.residual).toBeLessThan(1e-10);
  expect(Math.abs(result.budget.imbalanceW)).toBeLessThan(1e-12);
}
function field(result: SolveResult, id: string) {
  return result.ports.find(item => item.componentId === id && item.port === 0)!.incoming;
}

describe('source-free blocks as ordinary editable primitives', () => {
  it.each(Object.keys(BLOCK_DEFINITIONS) as BlockId[])('%s exposes only real unoccupied native ports and needs no special solver model', kind => {
    const block = instantiateBlock(kind);
    expect(block.components.every(item => item.model !== 'source' && item.model !== 'detector')).toBe(true);
    expect(block.components.every(item => item.version === '1')).toBe(true);
    expect(Object.keys(block.ports)).toEqual(BLOCK_DEFINITIONS[kind].ports);
    const used = new Set(block.connections.flatMap(item => [JSON.stringify(item.from), JSON.stringify(item.to)]));
    for (const endpoint of Object.values(block.ports)) {
      expect(used.has(JSON.stringify(endpoint))).toBe(false);
      expect(block.components.some(item => item.id === endpoint.component)).toBe(true);
    }
    const result = solveCircuit({ components: block.components, connections: block.connections, wavelengthM: 1550e-9 });
    good(result);
    expect(result.budget.emittedW).toBe(0);
    expect(result.ports.every(item => Math.hypot(item.incoming.re, item.incoming.im, item.outgoing.re, item.outgoing.im) === 0)).toBe(true);
  });

  it('provides a queryable catalog with exact defaults and SI units', () => {
    expect(blockCatalog).toHaveLength(4);
    const mzi = blockCatalog.find(item => item.id === 'mzi')!;
    expect(mzi.defaultParams.deltaLengthM).toBe(20e-6);
    expect(mzi.parameters.deltaLengthM.unit).toBe('m');
    expect(mzi.parameters.couplerModel.options).toEqual(['coupler', 'siepic-coupler']);
    expect(Object.isFrozen(BLOCK_DEFINITIONS.mzi.params.deltaLengthM)).toBe(true);
    expect(Object.isFrozen(mzi.parameters.couplerModel.options)).toBe(true);
    expect(() => { mzi.defaultParams.deltaLengthM = 1; }).toThrow();
    const first = instantiateBlock('mzi');
    first.components[0].params.coupling = 0.9;
    expect(instantiateBlock('mzi').components[0].params.coupling).toBe(0.5);
  });

  it.each([
    { phaseRad: 0, deltaLengthM: 0 },
    { phaseRad: Math.PI / 3, deltaLengthM: 0 },
    { phaseRad: -0.7, deltaLengthM: 13e-6 },
    { phaseRad: 1.8, deltaLengthM: -80e-6 },
  ])('MZI preserves the two-arm complex closed form for %j', params => {
    const wavelengthM = 1550e-9;
    const result = solveCircuit(illuminate(instantiateBlock('mzi', params), 'in0', ['out0', 'out1'], wavelengthM));
    good(result);
    const upper = -2 * Math.PI * 2.4 * 80e-6 / wavelengthM - params.phaseRad;
    const lower = -2 * Math.PI * 2.4 * (80e-6 + params.deltaLengthM) / wavelengthM;
    const amplitude = Math.sqrt(0.001) / 2;
    const expected0 = { re: amplitude * (Math.cos(upper) - Math.cos(lower)), im: amplitude * (Math.sin(upper) - Math.sin(lower)) };
    const expected1 = { re: -amplitude * (Math.sin(upper) + Math.sin(lower)), im: amplitude * (Math.cos(upper) + Math.cos(lower)) };
    expect(field(result, 'out0').re).toBeCloseTo(expected0.re, 12);
    expect(field(result, 'out0').im).toBeCloseTo(expected0.im, 12);
    expect(field(result, 'out1').re).toBeCloseTo(expected1.re, 12);
    expect(field(result, 'out1').im).toBeCloseTo(expected1.im, 12);
    expect(result.budget.detectedW).toBeCloseTo(0.001, 13);
  });

  it.each([1500e-9, 1550e-9, 1600e-9])('the SiEPIC MZI block reproduces the existing flattened experiment at λ=%s', wavelengthM => {
    const reference = createDatasetMziExperiment().circuit;
    reference.wavelengthM = wavelengthM;
    const actual = solveCircuit(illuminate(instantiateBlock('mzi', { couplerModel: 'siepic-coupler' }), 'in0', ['out0', 'out1'], wavelengthM));
    const expected = solveCircuit(reference);
    good(actual); good(expected);
    for (const [a, b] of [['out0', 'detector-1'], ['out1', 'detector-2']]) {
      expect(field(actual, a).re).toBeCloseTo(field(expected, b).re, 12);
      expect(field(actual, a).im).toBeCloseTo(field(expected, b).im, 12);
    }
    for (const key of Object.keys(expected.budget) as (keyof SolveResult['budget'])[]) expect(actual.budget[key]).toBeCloseTo(expected.budget[key], 12);
  });

  it.each([
    { phaseRad: 0, roundTripLengthM: 100e-6, lossDbPerM: 1000 },
    { phaseRad: 0.7, roundTripLengthM: 37e-6, lossDbPerM: 4500 },
    { phaseRad: -1.2, roundTripLengthM: 0, lossDbPerM: 0 },
  ])('all-pass ring matches independent H=(t-A)/(1-tA), including phase and loss: %j', params => {
    const wavelengthM = 1551.3e-9;
    const result = solveCircuit(illuminate(instantiateBlock('ring', params), 'in', ['out'], wavelengthM));
    good(result);
    const t = Math.sqrt(0.8);
    const magnitude = 10 ** (-params.lossDbPerM * params.roundTripLengthM / 20);
    const theta = -2 * Math.PI * 2.4 * params.roundTripLengthM / wavelengthM - params.phaseRad;
    const ar = magnitude * Math.cos(theta), ai = magnitude * Math.sin(theta);
    const dr = 1 - t * ar, di = -t * ai;
    const denominator = dr * dr + di * di;
    const hr = ((t - ar) * dr - ai * di) / denominator;
    const hi = (-ai * dr - (t - ar) * di) / denominator;
    expect(field(result, 'out').re).toBeCloseTo(Math.sqrt(0.001) * hr, 12);
    expect(field(result, 'out').im).toBeCloseTo(Math.sqrt(0.001) * hi, 12);
    expect(result.budget.propagationLossW).toBeCloseTo(0.001 * 0.2 * (1 - magnitude ** 2) / denominator, 12);
    expect(result.budget.componentAbsorbedW).toBe(0);
  });

  it('splitter tree gives four equal outputs with the declared branch loss exactly once', () => {
    const length = 73e-6, loss = 4700;
    const result = solveCircuit(illuminate(instantiateBlock('splitter-tree', { branchLengthM: length, lossDbPerM: loss }), 'in', ['out0', 'out1', 'out2', 'out3']));
    good(result);
    for (const detector of Object.values(result.detectors)) expect(detector.powerW).toBeCloseTo(0.001 / 4 * 10 ** (-loss * length / 10), 14);
    expect(result.budget.returnedToSourceW).toBe(0);
    expect(result.budget.escapedW).toBe(0);
  });

  it.each([false, true])('delay line preserves reciprocal phase and separates guide/lumped losses (reverse=%s)', reverse => {
    const lengthM = 19e-6, phaseRad = 0.38, attenuationDb = 2.1, lossDbPerM = 5100, neff = 2.37;
    const block = instantiateBlock('delay-line', { lengthM, phaseRad, attenuationDb, lossDbPerM, neff });
    const result = solveCircuit(illuminate(block, reverse ? 'out' : 'in', [reverse ? 'in' : 'out']));
    good(result);
    const amplitude = Math.sqrt(0.001) * 10 ** (-(attenuationDb + lossDbPerM * lengthM) / 20);
    const angle = -2 * Math.PI * neff * lengthM / 1550e-9 - phaseRad;
    const actual = field(result, reverse ? 'in' : 'out');
    expect(actual.re).toBeCloseTo(amplitude * Math.cos(angle), 13);
    expect(actual.im).toBeCloseTo(amplitude * Math.sin(angle), 13);
    expect(result.budget.componentAbsorbedW).toBeGreaterThan(0);
    expect(result.budget.propagationLossW).toBeGreaterThan(0);
    expect(result.budget.detectedW).toBeCloseTo(amplitude ** 2, 14);
  });
});

describe('safe atomic block insertion', () => {
  it('inserts two independent editable instances and round-trips without hidden module state', () => {
    const original = blankDocument();
    const first = insertBlock(original, 'mzi', { phaseRad: 0.4 }, { x: 100, y: 200 });
    const second = insertBlock(first.document, 'mzi', { phaseRad: 0.8 }, { x: 700, y: 200 });
    expect(original.circuit.components).toEqual([]);
    expect(first.document.circuit.components).toHaveLength(3);
    expect(second.document.circuit.components).toHaveLength(6);
    expect(new Set([...second.document.circuit.components, ...second.document.circuit.connections].map(item => item.id)).size).toBe(12);
    expect(first.componentIds.every(id => !second.componentIds.includes(id))).toBe(true);
    expect(second.ports.in0.component).not.toBe(first.ports.in0.component);
    expect(parseDocument(serializeDocument(second.document))).toEqual(second.document);
    const phase = second.document.circuit.components.find(item => item.id === 'mzi-2--phase')!;
    phase.params.phaseRad = 1.5;
    expect(second.document.circuit.components.find(item => item.id === 'mzi-1--phase')!.params.phaseRad).toBe(0.4);
    expect(first.document.circuit.components.find(item => item.model === 'phase')!.params.phaseRad).toBe(0.4);
  });

  it('namespaces against existing connection IDs as well as component IDs', () => {
    const first = insertBlock(blankDocument(), 'delay-line').document;
    const connection = first.circuit.connections[0];
    delete first.layout.connections[connection.id];
    connection.id = 'mzi-1--phase';
    first.layout.connections[connection.id] = { bend: 0 };
    const next = insertBlock(first, 'mzi');
    expect(next.componentIds).toContain('mzi-2--phase');
  });

  it('drawing position does not change the instantiated physical circuit', () => {
    const a = insertBlock(blankDocument(), 'ring', {}, { x: 0, y: 0 });
    const b = insertBlock(blankDocument(), 'ring', {}, { x: 3000, y: -2500 });
    expect(a.document.circuit).toEqual(b.document.circuit);
    expect(a.document.layout).not.toEqual(b.document.layout);
  });

  it.each([
    ['mzi', { deltaLengthM: -81e-6 }], ['mzi', { neff: 0 }], ['mzi', { phaseRad: NaN }],
    ['mzi', { lengthM: 1 }], ['mzi', { coupling: 0.7 }], ['mzi', { couplerModel: 'unknown' }],
    ['ring', { roundTripLengthM: -1 }], ['ring', { lossDbPerM: -1 }],
    ['delay-line', { attenuationDb: -1 }], ['delay-line', { lengthM: Infinity }],
  ] satisfies [BlockId, BlockParams][])('rejects invalid or unsupported %s parameters %j without changing the scene', (kind, params) => {
    const doc = blankDocument();
    const before = JSON.stringify(doc);
    expect(() => insertBlock(doc, kind, params)).toThrow();
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('rejects unknown block IDs, malformed parameters and unsafe insertion coordinates', () => {
    expect(() => instantiateBlock('constructor' as BlockId)).toThrow();
    expect(() => instantiateBlock('mzi', [] as unknown as BlockParams)).toThrow();
    expect(() => instantiateBlock('mzi', JSON.parse('{"__proto__":1}'))).toThrow();
    expect(() => insertBlock(blankDocument(), 'mzi', {}, { x: Infinity, y: 0 })).toThrow();
    expect(() => insertBlock(blankDocument(), 'mzi', {}, { x: 10_000_000, y: 0 })).toThrow();
  });
});
