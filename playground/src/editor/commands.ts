import { defaultParams } from '../model/registry';
import type { CircuitDocument, Connection, Endpoint, ModelId } from '../model/types';
import { validateDocument } from '../io/document';

const LABELS: Record<ModelId, string> = { source: 'CW source', coupler: 'Coupler', phase: 'Phase shifter', attenuator: 'Attenuator', detector: 'Detector', termination: 'Termination' };

function nextId(doc: CircuitDocument, prefix: string): string {
  const ids = new Set([...doc.circuit.components, ...doc.circuit.connections].map(item => item.id));
  let i = 1;
  while (ids.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}
function edit(doc: CircuitDocument, change: (draft: CircuitDocument) => void): CircuitDocument {
  const draft = structuredClone(doc);
  change(draft);
  validateDocument(draft);
  return draft;
}
function requireComponent(doc: CircuitDocument, id: string) {
  const component = doc.circuit.components.find(component => component.id === id);
  if (!component) throw new Error(`Component ${id} does not exist.`);
  return component;
}

export function addComponent(doc: CircuitDocument, model: ModelId, x: number, y: number): CircuitDocument {
  return edit(doc, draft => {
    const id = nextId(draft, model);
    draft.circuit.components.push({ id, model, version: '1', label: LABELS[model], params: { ...defaultParams(model) } });
    draft.layout.components[id] = { x, y, rotation: 0 };
  });
}

export function connectPorts(doc: CircuitDocument, from: Endpoint, to: Endpoint): CircuitDocument {
  return edit(doc, draft => {
    const id = nextId(draft, 'link');
    draft.circuit.connections.push({ id, from: { ...from }, to: { ...to }, lengthM: 0, lossDbPerM: 0, neff: 2.4 });
    draft.layout.connections[id] = { bend: 0 };
  });
}

export function deleteSelection(doc: CircuitDocument, ids: string[]): CircuitDocument {
  return edit(doc, draft => {
    const selected = new Set(ids);
    draft.circuit.components = draft.circuit.components.filter(component => !selected.has(component.id));
    draft.circuit.connections = draft.circuit.connections.filter(connection => !selected.has(connection.id) && !selected.has(connection.from.component) && !selected.has(connection.to.component));
    const remainingComponents = new Set(draft.circuit.components.map(component => component.id));
    const remainingConnections = new Set(draft.circuit.connections.map(connection => connection.id));
    for (const id of Object.keys(draft.layout.components)) if (!remainingComponents.has(id)) delete draft.layout.components[id];
    for (const id of Object.keys(draft.layout.connections)) if (!remainingConnections.has(id)) delete draft.layout.connections[id];
  });
}

/** Duplicate selected components and the wiring entirely contained between them. */
export function duplicateSelection(doc: CircuitDocument, ids: string[]): CircuitDocument {
  return edit(doc, draft => {
    const selected = new Set(ids);
    const remap = new Map<string, string>();
    for (const component of doc.circuit.components.filter(item => selected.has(item.id))) {
      const id = nextId(draft, component.model);
      remap.set(component.id, id);
      draft.circuit.components.push({ ...structuredClone(component), id, label: `${component.label.slice(0, 195)} copy` });
      const position = doc.layout.components[component.id];
      draft.layout.components[id] = { ...position, x: position.x + 32, y: position.y + 32 };
    }
    for (const connection of doc.circuit.connections) {
      const from = remap.get(connection.from.component), to = remap.get(connection.to.component);
      if (!from || !to) continue;
      const id = nextId(draft, 'link');
      draft.circuit.connections.push({ ...structuredClone(connection), id, from: { ...connection.from, component: from }, to: { ...connection.to, component: to } });
      draft.layout.connections[id] = { ...doc.layout.connections[connection.id] };
    }
  });
}

export function updateComponent(doc: CircuitDocument, id: string, params: Record<string, number>): CircuitDocument {
  return edit(doc, draft => {
    const component = requireComponent(draft, id);
    component.params = { ...component.params, ...params };
  });
}

export function moveComponent(doc: CircuitDocument, id: string, x: number, y: number): CircuitDocument {
  return edit(doc, draft => {
    requireComponent(draft, id);
    draft.layout.components[id] = { ...draft.layout.components[id], x, y };
  });
}

export function rotateComponent(doc: CircuitDocument, id: string, rotation: number): CircuitDocument {
  return edit(doc, draft => {
    requireComponent(draft, id);
    draft.layout.components[id].rotation = ((rotation % 360) + 360) % 360;
  });
}

export function updateConnection(doc: CircuitDocument, id: string, params: Partial<Pick<Connection, 'lengthM' | 'lossDbPerM' | 'neff'>>): CircuitDocument {
  return edit(doc, draft => {
    const connection = draft.circuit.connections.find(item => item.id === id);
    if (!connection) throw new Error(`Connection ${id} does not exist.`);
    Object.assign(connection, params);
  });
}

export function setConnectionBend(doc: CircuitDocument, id: string, bend: number): CircuitDocument {
  return edit(doc, draft => {
    if (!draft.layout.connections[id]) throw new Error(`Connection ${id} does not exist.`);
    draft.layout.connections[id].bend = bend;
  });
}

function snapshot(doc: CircuitDocument): CircuitDocument {
  validateDocument(doc);
  const copy = structuredClone(doc);
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

/** Atomic immutable snapshots; a new commit after undo discards the redo branch. */
export class History {
  private entries: CircuitDocument[];
  private index = 0;
  constructor(doc: CircuitDocument) { this.entries = [snapshot(doc)]; }
  get doc(): CircuitDocument { return this.entries[this.index]; }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.entries.length - 1; }
  commit(doc: CircuitDocument): CircuitDocument {
    const entry = snapshot(doc);
    if (JSON.stringify(entry) === JSON.stringify(this.doc)) return this.doc;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > 100) this.entries.shift();
    this.index = this.entries.length - 1;
    return this.doc;
  }
  undo(): CircuitDocument { if (this.canUndo) this.index--; return this.doc; }
  redo(): CircuitDocument { if (this.canRedo) this.index++; return this.doc; }
}
