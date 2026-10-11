import { describe, expect, it } from 'vitest';
import { arrangeDocument } from '../src/editor/arrange';
import { createDatasetMziExperiment } from '../src/model/experiments';
import { blankDocument } from '../src/io/document';
import { solveCircuit } from '../src/solver/solve';
import { addComponent, connectPorts } from '../src/editor/commands';

describe('automatic sketch arrangement', () => {
  it('preserves all semantic fields and the complete complex solve without mutating its input', () => {
    const original = createDatasetMziExperiment();
    const snapshot = structuredClone(original);
    const arranged = arrangeDocument(original);
    expect(original).toEqual(snapshot);
    expect(arranged.circuit).toEqual(original.circuit);
    expect(solveCircuit(arranged.circuit)).toEqual(solveCircuit(original.circuit));
    expect(arrangeDocument(arranged)).toEqual(arranged);
    expect(new Set(Object.values(arranged.layout.components).map(p => `${p.x},${p.y}`)).size).toBe(original.circuit.components.length);
  });
  it('is independent of connection storage direction and component array order', () => {
    const a = createDatasetMziExperiment(), b = structuredClone(a);
    b.circuit.components.reverse();
    b.circuit.connections.reverse().forEach(link => { [link.from, link.to] = [link.to, link.from]; });
    expect(arrangeDocument(a).layout).toEqual(arrangeDocument(b).layout);
  });
  it('handles disconnected components and feedback without changing or hiding the topology', () => {
    let doc = addComponent(blankDocument(), 'phase', 0, 0);
    doc = addComponent(doc, 'phase', 0, 0);
    doc = addComponent(doc, 'detector', 0, 0);
    doc = connectPorts(doc, { component: 'phase-1', port: 1 }, { component: 'phase-2', port: 0 });
    doc = connectPorts(doc, { component: 'phase-2', port: 1 }, { component: 'phase-1', port: 0 });
    const arranged = arrangeDocument(doc);
    expect(arranged.circuit).toEqual(doc.circuit);
    expect(Object.values(arranged.layout.connections).every(link => link.bend !== 0)).toBe(true);
    expect(Object.values(arranged.layout.components).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(arrangeDocument(blankDocument())).toEqual(blankDocument());
  });
});
