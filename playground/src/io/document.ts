import { defaultParams, MODEL_IDS, portNames } from '../model/registry';
import { MAX_COMPONENTS, MAX_CONNECTIONS, validateCircuit } from '../solver/solve';
import type { CircuitDocument, ModelId } from '../model/types';

export const MAX_DOCUMENT_BYTES = 1_048_576;
export { MAX_COMPONENTS, MAX_CONNECTIONS } from '../solver/solve';
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
type JsonObject = Record<string, unknown>;

function fail(message: string): never { throw new Error(`Invalid document: ${message}`); }
function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  return value as JsonObject;
}
function keys(value: JsonObject, required: string[], path: string) {
  if (Object.keys(value).some(key => !required.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    fail(`${path} must contain exactly ${required.join(', ')}. Unsupported fields are not imported.`);
  }
}
function string(value: unknown, path: string, max = 200): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(`${path} must be a nonempty string of at most ${max} characters.`);
}
function identifier(value: unknown, path: string): asserts value is string {
  string(value, path, 100);
  if (UNSAFE_KEYS.has(value)) fail(`${path} is a reserved identifier.`);
}
function finite(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be finite.`);
}
function coordinate(value: unknown, path: string) {
  finite(value, path);
  if (Math.abs(value) > 10_000_000) fail(`${path} exceeds the supported canvas range (±10,000,000).`);
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${path} must be an array containing at most ${max} entries.`);
  return value;
}

/** Reject unsupported content before it can replace an editor's current document. */
export function validateDocument(value: unknown): asserts value is CircuitDocument {
  const doc = object(value, 'document');
  keys(doc, ['schema', 'title', 'circuit', 'layout'], 'document');
  if (doc.schema !== 'picsetup-playground/1') fail('unsupported schema. Expected picsetup-playground/1.');
  string(doc.title, 'title');
  const circuit = object(doc.circuit, 'circuit');
  keys(circuit, ['components', 'connections', 'wavelengthM'], 'circuit');
  finite(circuit.wavelengthM, 'wavelengthM');
  if (circuit.wavelengthM <= 0) fail('wavelengthM must be positive.');
  const components = list(circuit.components, 'components', MAX_COMPONENTS);
  const connections = list(circuit.connections, 'connections', MAX_CONNECTIONS);
  const models = new Map<string, ModelId>();
  const allIds = new Set<string>();
  for (const [index, raw] of components.entries()) {
    const path = `components[${index}]`;
    const component = object(raw, path);
    keys(component, ['id', 'model', 'version', 'label', 'params'], path);
    identifier(component.id, `${path}.id`);
    if (allIds.has(component.id)) fail(`duplicate identifier ${component.id}.`);
    allIds.add(component.id);
    if (!MODEL_IDS.includes(component.model as ModelId)) fail(`${path} uses an unsupported model.`);
    const model = component.model as ModelId;
    if (component.version !== '1') fail(`${path} uses an unsupported model version.`);
    string(component.label, `${path}.label`);
    const params = object(component.params, `${path}.params`);
    keys(params, Object.keys(defaultParams(model)), `${path}.params`);
    for (const [key, number] of Object.entries(params)) finite(number, `${path}.params.${key}`);
    models.set(component.id, model);
  }
  const connectionIds = new Set<string>();
  const occupied = new Set<string>();
  for (const [index, raw] of connections.entries()) {
    const path = `connections[${index}]`;
    const connection = object(raw, path);
    keys(connection, ['id', 'from', 'to', 'lengthM', 'lossDbPerM', 'neff'], path);
    identifier(connection.id, `${path}.id`);
    if (allIds.has(connection.id)) fail(`duplicate identifier ${connection.id}.`);
    allIds.add(connection.id);
    connectionIds.add(connection.id);
    for (const side of ['from', 'to']) {
      const endpoint = object(connection[side], `${path}.${side}`);
      keys(endpoint, ['component', 'port'], `${path}.${side}`);
      identifier(endpoint.component, `${path}.${side}.component`);
      const model = models.get(endpoint.component);
      if (!model) fail(`${path}.${side} refers to a missing component.`);
      if (typeof endpoint.port !== 'number' || !Number.isInteger(endpoint.port) || endpoint.port < 0 || endpoint.port >= portNames(model).length) fail(`${path}.${side} refers to an invalid port.`);
      const portKey = JSON.stringify([endpoint.component, endpoint.port]);
      if (occupied.has(portKey)) fail(`port ${endpoint.component}:${endpoint.port} already has a connection.`);
      occupied.add(portKey);
    }
    for (const name of ['lengthM', 'lossDbPerM', 'neff']) finite(connection[name], `${path}.${name}`);
    if ((connection.lengthM as number) < 0 || (connection.lossDbPerM as number) < 0 || (connection.neff as number) <= 0) fail(`${path} needs nonnegative length/loss and positive effective index.`);
  }

  const layout = object(doc.layout, 'layout');
  keys(layout, ['components', 'connections', 'viewport'], 'layout');
  const positions = object(layout.components, 'layout.components');
  keys(positions, [...models.keys()], 'layout.components');
  for (const [id, value] of Object.entries(positions)) {
    const position = object(value, `layout.components.${id}`);
    keys(position, ['x', 'y', 'rotation'], `layout.components.${id}`);
    for (const name of ['x', 'y', 'rotation']) coordinate(position[name], `layout.components.${id}.${name}`);
  }
  const curves = object(layout.connections, 'layout.connections');
  keys(curves, [...connectionIds], 'layout.connections');
  for (const [id, value] of Object.entries(curves)) {
    const curve = object(value, `layout.connections.${id}`);
    keys(curve, ['bend'], `layout.connections.${id}`);
    coordinate(curve.bend, `layout.connections.${id}.bend`);
  }
  const viewport = object(layout.viewport, 'layout.viewport');
  keys(viewport, ['x', 'y', 'zoom'], 'layout.viewport');
  for (const name of ['x', 'y']) coordinate(viewport[name], `layout.viewport.${name}`);
  finite(viewport.zoom, 'layout.viewport.zoom');
  if (viewport.zoom < 0.05 || viewport.zoom > 20) fail('viewport zoom must be between 0.05 and 20.');

  const errors = validateCircuit(circuit as unknown as CircuitDocument['circuit']).filter(diagnostic => diagnostic.severity === 'error');
  if (errors.length) fail(errors.map(error => error.message).join(' '));
}

export function blankDocument(): CircuitDocument {
  return {
    schema: 'picsetup-playground/1', title: 'Untitled circuit',
    circuit: { components: [], connections: [], wavelengthM: 1550e-9 },
    layout: { components: {}, connections: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

export function parseDocument(text: string): CircuitDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) fail('file exceeds the 1 MiB limit.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('file is not valid JSON.'); }
  validateDocument(value);
  return value;
}

export function serializeDocument(doc: CircuitDocument): string {
  validateDocument(doc);
  const text = JSON.stringify(doc, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) fail('file exceeds the 1 MiB limit.');
  return text;
}
