import { instantiateBlock, blockCatalog, type BlockId } from '../blocks';
import { arrangeDocument } from '../editor/arrange';
import { MAX_DOCUMENT_BYTES, validateDocument } from '../io/document';
import { defaultParams, MODEL_IDS, portNames } from '../model/registry';
import type { CircuitDocument, Component, Connection, Endpoint, ModelId } from '../model/types';
import { MAX_COMPONENTS, MAX_CONNECTIONS } from '../solver/solve';
import { semanticCircuitKey } from './authoring';
import { waveguideMetadata } from '../model/propagation';
import type { WaveguideReference } from '../model/types';

export interface RecipePart {
  id: string;
  model?: ModelId;
  block?: BlockId;
  version?: '1';
  label?: string;
  params?: Record<string, number | string>;
}
export interface RecipeLink {
  id?: string;
  from: string;
  to: string;
  lengthM?: number;
  neff?: number;
  lossDbPerM?: number;
  waveguide?: WaveguideReference;
}
export interface CircuitRecipe {
  schema: 'picsetup-recipe/1';
  title: string;
  wavelengthM: number;
  parts: RecipePart[];
  links: RecipeLink[];
}

const reserved = new Set(['__proto__', 'prototype', 'constructor']);
function fail(message: string): never { throw new Error(`Invalid recipe: ${message}`); }
export function recipeObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${path} must be a plain object.`);
  return value as Record<string, unknown>;
}
export function recipeKeys(value: Record<string, unknown>, required: string[], optional: string[], path: string): void {
  const unknown = Object.keys(value).find(key => !required.includes(key) && !optional.includes(key));
  if (unknown) fail(`${path} has an unsupported field: ${unknown}.`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key} is required.`);
}
function text(value: unknown, path: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${path} must be a nonempty string of at most ${max} characters.`);
  return value;
}
function id(value: unknown, path: string): string {
  const result = text(value, path, 40);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(result) || reserved.has(result)) fail(`${path} must start with a letter and contain only letters, digits, underscores or hyphens; reserved keys are forbidden.`);
  return result;
}
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a finite number in the declared SI units.`);
  return value;
}
function params(value: unknown, path: string): Record<string, number | string> {
  if (value === undefined) return {};
  const result = recipeObject(value, path);
  for (const [key, item] of Object.entries(result)) {
    if (reserved.has(key) || !(typeof item === 'string' || typeof item === 'number' && Number.isFinite(item))) fail(`${path}.${key} must be a finite number or a declared enum string.`);
  }
  return result as Record<string, number | string>;
}

/** Parse data only. No expressions, code evaluation, remote models or inferred units. */
export function parseRecipe(source: string): CircuitDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_DOCUMENT_BYTES) fail('JSON exceeds the 1 MiB limit.');
  let input: unknown;
  try { input = JSON.parse(source); } catch { fail('expected valid JSON.'); }
  return compileRecipe(input);
}

/** Expand source-free blocks into stable namespaced primitives, validate, and arrange. */
export function compileRecipe(input: unknown, options: { recordAuthoring?: boolean } = {}): CircuitDocument {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(input); } catch { fail('input must be serializable JSON data.'); }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_BYTES) fail('JSON exceeds the 1 MiB limit or is not a value.');
  const recipe = recipeObject(input, 'recipe');
  recipeKeys(recipe, ['schema', 'title', 'wavelengthM', 'parts', 'links'], [], 'recipe');
  if (recipe.schema !== 'picsetup-recipe/1') fail('unsupported schema; expected picsetup-recipe/1.');
  const title = text(recipe.title, 'title');
  const wavelengthM = finite(recipe.wavelengthM, 'wavelengthM');
  if (wavelengthM <= 0) fail('wavelengthM must be positive.');
  if (!Array.isArray(recipe.parts) || recipe.parts.length > MAX_COMPONENTS) fail(`parts must be an array of at most ${MAX_COMPONENTS} items.`);
  if (!Array.isArray(recipe.links) || recipe.links.length > MAX_CONNECTIONS) fail(`links must be an array of at most ${MAX_CONNECTIONS} items.`);
  const components: Component[] = [];
  const connections: Connection[] = [];
  const endpoints = new Map<string, Endpoint>();
  const instanceIds = new Set<string>();
  for (const [index, raw] of recipe.parts.entries()) {
    const path = `parts[${index}]`;
    const part = recipeObject(raw, path);
    recipeKeys(part, ['id'], ['model', 'block', 'version', 'label', 'params'], path);
    const instance = id(part.id, `${path}.id`);
    if (instanceIds.has(instance)) fail(`duplicate part ID ${instance}.`);
    instanceIds.add(instance);
    if (Object.hasOwn(part, 'model') === Object.hasOwn(part, 'block')) fail(`${path} must select exactly one model or block.`);
    if (Object.hasOwn(part, 'version') && part.version !== '1') fail(`${path} has an unsupported version; only exact version 1 is bundled.`);
    const label = part.label === undefined ? instance : text(part.label, `${path}.label`);
    const values = params(part.params, `${path}.params`);
    if (Object.hasOwn(part, 'model')) {
      if (!MODEL_IDS.includes(part.model as ModelId)) fail(`${path} uses an unsupported model: ${String(part.model)}.`);
      const model = part.model as ModelId;
      const defaults = defaultParams(model);
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(defaults, key)) fail(`${path}.params.${key} is not a parameter of ${model}.`);
        finite(value, `${path}.params.${key}`);
      }
      components.push({ id: instance, model, version: '1', label, params: { ...defaults, ...values } as Record<string, number> });
      portNames(model).forEach((name, port) => endpoints.set(`${instance}.${name}`, { component: instance, port }));
    } else {
      if (!blockCatalog.some(block => block.id === part.block)) fail(`${path} uses an unsupported block: ${String(part.block)}.`);
      const fragment = instantiateBlock(part.block as BlockId, values);
      const prefix = (local: string) => `${instance}__${local}`;
      const endpoint = (local: Endpoint): Endpoint => ({ component: prefix(local.component), port: local.port });
      for (const component of fragment.components) components.push({ ...component, id: prefix(component.id), label: `${label} · ${component.label}`.slice(0, 200), params: { ...component.params } });
      for (const connection of fragment.connections) connections.push({ ...connection, id: prefix(connection.id), from: endpoint(connection.from), to: endpoint(connection.to) });
      for (const [name, local] of Object.entries(fragment.ports)) endpoints.set(`${instance}.${name}`, endpoint(local));
    }
    if (components.length > MAX_COMPONENTS || connections.length > MAX_CONNECTIONS) fail(`expanded circuit exceeds ${MAX_COMPONENTS} components or ${MAX_CONNECTIONS} connections.`);
  }
  const usedIds = new Set([...components.map(component => component.id), ...connections.map(connection => connection.id)]);
  for (const [index, raw] of recipe.links.entries()) {
    const path = `links[${index}]`;
    const link = recipeObject(raw, path);
    recipeKeys(link, ['from', 'to'], ['id', 'lengthM', 'neff', 'lossDbPerM', 'waveguide'], path);
    let waveguide: WaveguideReference | undefined;
    if (Object.hasOwn(link, 'waveguide')) {
      const reference = recipeObject(link.waveguide, `${path}.waveguide`);
      recipeKeys(reference, ['model', 'version'], [], `${path}.waveguide`);
      if (reference.model !== 'siepic-strip-500x220-te' || reference.version !== '1') fail(`${path} uses an unsupported waveguide identity/version.`);
      waveguide = { model: 'siepic-strip-500x220-te', version: '1' };
    }
    const resolve = (name: unknown, side: string): Endpoint => {
      const key = text(name, `${path}.${side}`, 100);
      const endpoint = endpoints.get(key);
      if (!endpoint) fail(`${path}.${side} names no exposed port: ${key}. Available ports: ${[...endpoints.keys()].join(', ')}.`);
      return { ...endpoint };
    };
    let connectionId: string;
    if (link.id === undefined) {
      connectionId = `link_${index + 1}`;
      while (usedIds.has(connectionId)) connectionId += '_';
    } else connectionId = id(link.id, `${path}.id`);
    if (usedIds.has(connectionId)) fail(`${path} has duplicate identifier ${connectionId}.`);
    usedIds.add(connectionId);
    connections.push({
      id: connectionId, from: resolve(link.from, 'from'), to: resolve(link.to, 'to'),
      lengthM: link.lengthM === undefined ? 0 : finite(link.lengthM, `${path}.lengthM`),
      neff: link.neff === undefined ? (waveguide ? waveguideMetadata.neff : 2.4) : finite(link.neff, `${path}.neff`),
      lossDbPerM: link.lossDbPerM === undefined ? 0 : finite(link.lossDbPerM, `${path}.lossDbPerM`),
      ...(waveguide ? { waveguide } : {}),
    });
  }
  const document: CircuitDocument = {
    schema: 'picsetup-playground/1', title, circuit: { wavelengthM, components, connections },
    layout: {
      components: Object.fromEntries(components.map(component => [component.id, { x: 0, y: 0, rotation: 0 }])),
      connections: Object.fromEntries(connections.map(connection => [connection.id, { bend: 0 }])),
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
  validateDocument(document);
  const arranged = arrangeDocument(document);
  if (options.recordAuthoring !== false) arranged.authoring = { schema: 'picsetup-authoring/1', recipeJson: JSON.stringify(input), semanticKey: semanticCircuitKey(arranged.circuit) };
  validateDocument(arranged);
  return arranged;
}
