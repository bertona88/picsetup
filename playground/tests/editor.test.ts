import { describe, expect, it } from 'vitest';
import { blankDocument, MAX_COMPONENTS, MAX_DOCUMENT_BYTES, parseDocument, serializeDocument } from '../src/io/document';
import { addComponent, connectPorts, deleteSelection, duplicateSelection, History, moveComponent, rotateComponent, setConnectionBend, updateComponent, updateConnection } from '../src/editor/commands';
import { createMziExample } from '../src/model/examples';

describe('portable documents', () => {
  it('round-trips a real interferometer including physical and independent layout state', () => {
    const doc = createMziExample();
    doc.layout.viewport = { x: -40, y: 12, zoom: 0.8 };
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
    expect(doc.circuit.connections.find(link => link.id === 'link-4')?.lengthM).toBe(80e-6);
  });

  it('rejects malformed JSON and unsupported schema, version, model or module data', () => {
    expect(() => parseDocument('{')).toThrow(/JSON/);
    expect(() => parseDocument('null')).toThrow(/object/);
    const mutations = [
      (doc: any) => { doc.schema = 'picsetup-playground/9'; },
      (doc: any) => { doc.circuit.components[0].version = '2'; },
      (doc: any) => { doc.circuit.components[0].model = 'custom'; },
      (doc: any) => { doc.modules = []; },
      (doc: any) => { doc.circuit.components[0].customData = {}; },
      (doc: any) => { doc.circuit.components[0].params.script = 'alert(1)'; },
      (doc: any) => { doc.circuit.connections[0].from.extension = 2; },
      (doc: any) => { doc.layout.viewport.extra = true; },
    ];
    for (const mutate of mutations) {
      const doc = createMziExample(); mutate(doc);
      expect(() => parseDocument(JSON.stringify(doc))).toThrow(/Invalid document/);
    }
  });

  it('rejects malformed numerical domains, layout and references', () => {
    const mutations = [
      (doc: any) => { doc.circuit.wavelengthM = -1; },
      (doc: any) => { doc.circuit.components[0].params.powerW = -0.1; },
      (doc: any) => { doc.circuit.components[1].params.coupling = 1.1; },
      (doc: any) => { doc.circuit.connections[0].lengthM = -1; },
      (doc: any) => { doc.circuit.connections[0].to.port = 999; },
      (doc: any) => { doc.circuit.connections[0].from.component = 'missing'; },
      (doc: any) => { doc.circuit.connections[0].to = doc.circuit.connections[0].from; },
      (doc: any) => { doc.circuit.connections[0].id = doc.circuit.components[0].id; },
      (doc: any) => { doc.layout.components['source-1'].x = null; },
      (doc: any) => { delete doc.layout.components['source-1']; },
      (doc: any) => { doc.layout.connections.missing = { bend: 1 }; },
      (doc: any) => { doc.layout.viewport.zoom = 0; },
    ];
    for (const mutate of mutations) {
      const doc = createMziExample(); mutate(doc);
      expect(() => parseDocument(JSON.stringify(doc))).toThrow(/Invalid document/);
    }
    expect(() => parseDocument(serializeDocument(blankDocument()).replace(/"wavelengthM": [\de.\-]+/, '"wavelengthM": 1e999'))).toThrow(/finite/);
    const doc = createMziExample(); doc.layout.components['source-1'].x = Infinity;
    expect(() => serializeDocument(doc)).toThrow(/finite/);
  });

  it('bounds file bytes and component counts before editor replacement', () => {
    expect(() => parseDocument(' '.repeat(MAX_DOCUMENT_BYTES + 1))).toThrow(/1 MiB/);
    // UTF-8 byte size, not just JavaScript string length, controls the cap.
    expect(() => parseDocument('é'.repeat(MAX_DOCUMENT_BYTES / 2 + 1))).toThrow(/1 MiB/);
    const doc = blankDocument();
    for (let index = 0; index <= MAX_COMPONENTS; index++) {
      const id = `detector-${index}`;
      doc.circuit.components.push({ id, model: 'detector', version: '1', label: id, params: {} });
      doc.layout.components[id] = { x: 0, y: 0, rotation: 0 };
    }
    expect(() => parseDocument(JSON.stringify(doc))).toThrow(/at most 100/);
    const manyPorts = blankDocument();
    for (let index = 0; index < 65; index++) {
      const id = `coupler-${index}`;
      manyPorts.circuit.components.push({ id, model: 'coupler', version: '1', label: id, params: { coupling: 0.5 } });
      manyPorts.layout.components[id] = { x: 0, y: 0, rotation: 0 };
    }
    expect(() => parseDocument(JSON.stringify(manyPorts))).toThrow(/256 optical ports/);
    const manyLinks = createMziExample();
    manyLinks.circuit.connections = Array.from({ length: 129 }, () => manyLinks.circuit.connections[0]);
    expect(() => parseDocument(JSON.stringify(manyLinks))).toThrow(/at most 128/);
  });

  it('preserves a structurally valid singular network for inspection instead of refusing to save it', () => {
    const phase = addComponent(blankDocument(), 'phase', 100, 100);
    const loop = connectPorts(phase, { component: 'phase-1', port: 0 }, { component: 'phase-1', port: 1 });
    expect(parseDocument(serializeDocument(loop))).toEqual(loop);
  });

  it('rejects reserved identifiers and unexpected own prototype keys', () => {
    const text = serializeDocument(blankDocument());
    expect(() => parseDocument(text.replace('"title":', '"__proto__": {}, "title":'))).toThrow(/Unsupported fields/);
    const doc = createMziExample(); doc.circuit.components[0].id = '__proto__';
    expect(() => parseDocument(JSON.stringify(doc))).toThrow(/reserved/);
  });
});

describe('atomic editor commands', () => {
  it('builds and wires an ordinary blank circuit without deriving physical length from pixels', () => {
    const blank = blankDocument();
    const source = addComponent(blank, 'source', 10, 20);
    const receiver = addComponent(source, 'detector', 999, -200);
    const wired = connectPorts(receiver, { component: 'source-1', port: 0 }, { component: 'detector-1', port: 0 });
    expect(blank.circuit.components).toHaveLength(0);
    expect(wired.circuit.connections[0]).toMatchObject({ lengthM: 0, lossDbPerM: 0, neff: 2.4 });
    expect(() => connectPorts(wired, { component: 'source-1', port: 0 }, { component: 'detector-1', port: 0 })).toThrow(/already/);
    expect(wired.circuit.connections).toHaveLength(1);
  });

  it('keeps move, rotation and curve edits entirely in layout', () => {
    const original = createMziExample();
    let doc = moveComponent(original, 'phase-1', 321, -123);
    doc = rotateComponent(doc, 'phase-1', 450);
    doc = setConnectionBend(doc, 'link-4', -32);
    expect(doc.circuit).toEqual(original.circuit);
    expect(doc.layout.components['phase-1']).toEqual({ x: 321, y: -123, rotation: 90 });
    expect(original.layout.components['phase-1'].rotation).toBe(0);
  });

  it('updates declared parameters atomically and rejects invalid changes', () => {
    const original = createMziExample();
    const doc = updateComponent(original, 'phase-1', { phaseRad: Math.PI });
    expect(doc.circuit.components.find(component => component.id === 'phase-1')?.params.phaseRad).toBe(Math.PI);
    expect(original.circuit.components.find(component => component.id === 'phase-1')?.params.phaseRad).toBe(0);
    expect(() => updateComponent(original, 'coupler-1', { coupling: -1 })).toThrow();
    expect(() => updateComponent(original, 'phase-1', { unknown: 1 })).toThrow();
    expect(updateConnection(original, 'link-1', { lengthM: 20e-6 }).circuit.connections[0].lengthM).toBe(20e-6);
  });

  it('deletes incident wiring and duplicates selected subcircuits with new stable IDs', () => {
    const original = createMziExample();
    const deleted = deleteSelection(original, ['phase-1']);
    expect(deleted.circuit.components).toHaveLength(5);
    expect(deleted.circuit.connections).toHaveLength(4);
    expect(deleted.layout.connections['link-2']).toBeUndefined();
    const duplicated = duplicateSelection(original, ['phase-1', 'coupler-2']);
    expect(duplicated.circuit.components).toHaveLength(8);
    expect(duplicated.circuit.connections).toHaveLength(7);
    expect(duplicated.circuit.connections.at(-1)).toMatchObject({ from: { component: 'phase-2', port: 1 }, to: { component: 'coupler-3', port: 0 }, lengthM: 40e-6 });
    expect(original.circuit.components).toHaveLength(6);
    expect(duplicated.layout.components['phase-2'].x).toBe(original.layout.components['phase-1'].x + 32);
  });
});

describe('history', () => {
  it('holds immutable, independent snapshots with undo, redo and branch truncation', () => {
    const initial = blankDocument();
    const history = new History(initial);
    initial.title = 'external mutation';
    expect(history.doc.title).toBe('Untitled circuit');
    const next = addComponent(history.doc, 'phase', 0, 0);
    history.commit(next);
    next.circuit.components[0].params.phaseRad = 999;
    expect(history.doc.circuit.components[0].params.phaseRad).toBe(0);
    expect(Object.isFrozen(history.doc.circuit.components[0].params)).toBe(true);
    expect(history.canUndo).toBe(true);
    expect(history.undo().circuit.components).toHaveLength(0);
    expect(history.canRedo).toBe(true);
    expect(history.redo().circuit.components).toHaveLength(1);
    history.undo();
    history.commit(addComponent(history.doc, 'detector', 10, 10));
    expect(history.canRedo).toBe(false);
    expect(history.doc.circuit.components[0].model).toBe('detector');
  });

  it('does not replace the scene or lose undo when an import or commit is invalid', () => {
    const history = new History(createMziExample());
    history.commit(updateComponent(history.doc, 'phase-1', { phaseRad: 1 }));
    const previous = history.doc;
    expect(() => history.commit(parseDocument('{"schema":"future"}'))).toThrow();
    expect(history.doc).toBe(previous);
    expect(history.canUndo).toBe(true);
    const invalid = structuredClone(history.doc); invalid.circuit.wavelengthM = NaN;
    expect(() => history.commit(invalid)).toThrow();
    expect(history.doc).toBe(previous);
    history.commit(history.doc);
    history.undo();
    expect(history.doc.circuit.components.find(component => component.id === 'phase-1')?.params.phaseRad).toBe(0);
  });
});
