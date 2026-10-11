import { validateDocument } from '../io/document';
import type { CircuitDocument } from '../model/types';
import { validateSweepRequest } from '../solver/sweep';

export interface SweepConfig { startM: number; stopM: number; points: number }
export interface ExperimentVariant { id: string; name: string; document: CircuitDocument; detectorId: string | null }
export interface Notebook { schema: 'picsetup-notebook/1'; title: string; sweep: SweepConfig; variants: ExperimentVariant[] }
export const MAX_VARIANTS = 6;
export const MAX_NOTEBOOK_BYTES = 6 * 1_048_576 + 65_536;
export const DEFAULT_SWEEP: SweepConfig = { startM: 1500e-9, stopM: 1600e-9, points: 201 };
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (message: string): never => { throw new Error(`Invalid notebook: ${message}`); };
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function exact(value: unknown, fields: string[], path: string): asserts value is Record<string, unknown> {
  if (!object(value) || fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(key => !fields.includes(key))) fail(`${path} must contain exactly ${fields.join(', ')}.`);
}
function name(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail(`${path} needs 1–200 characters.`);
}
export function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeSnapshot); Object.freeze(value); }
  return value;
}
export function validateNotebook(value: unknown): asserts value is Notebook {
  exact(value, ['schema', 'title', 'sweep', 'variants'], 'notebook');
  if (value.schema !== 'picsetup-notebook/1') fail('unsupported schema. Expected picsetup-notebook/1.');
  name(value.title, 'title');
  exact(value.sweep, ['startM', 'stopM', 'points'], 'sweep');
  const invalid = validateSweepRequest({ id: 0, circuit: { components: [], connections: [] }, ...value.sweep });
  if (invalid.length) fail(invalid.map(item => item.message).join(' '));
  if (!Array.isArray(value.variants) || value.variants.length > MAX_VARIANTS) fail(`at most ${MAX_VARIANTS} variants are supported.`);
  const variants = value.variants as unknown[];
  const ids = new Set<string>();
  for (const variant of variants) {
    exact(variant, ['id', 'name', 'document', 'detectorId'], 'variant');
    if (typeof variant.id !== 'string' || !variant.id || variant.id.length > 100 || reserved.has(variant.id) || ids.has(variant.id)) fail('variant IDs must be unique, nonempty, nonreserved strings up to 100 characters.');
    ids.add(variant.id as string);
    name(variant.name, 'variant name');
    validateDocument(variant.document);
    if (variant.detectorId !== null && !variant.document.circuit.components.some(component => component.id === variant.detectorId && component.model === 'detector')) fail('selected detector must belong to its variant.');
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_NOTEBOOK_BYTES) fail('notebook exceeds the supported byte limit.');
}
function snapshot(value: Notebook): Notebook { validateNotebook(value); return freezeSnapshot(structuredClone(value)); }
export function createNotebook(document?: CircuitDocument, title = 'Circuit experiments'): Notebook {
  const notebook: Notebook = { schema: 'picsetup-notebook/1', title, sweep: { ...DEFAULT_SWEEP }, variants: [] };
  return document ? addVariant(notebook, document) : snapshot(notebook);
}
export function addVariant(notebook: Notebook, document: CircuitDocument, variantName = document.title): Notebook {
  validateNotebook(notebook);
  let index = 1;
  while (notebook.variants.some(variant => variant.id === `variant-${index}`)) index++;
  return snapshot({ ...notebook, variants: [...notebook.variants, { id: `variant-${index}`, name: variantName, document, detectorId: document.circuit.components.find(component => component.model === 'detector')?.id ?? null }] });
}
export function forkVariant(notebook: Notebook, id: string, variantName?: string): Notebook {
  const original = notebook.variants.find(variant => variant.id === id);
  if (!original) fail(`unknown variant ${id}.`);
  const forked = addVariant(notebook, original!.document, variantName ?? `${original!.name} copy`);
  return selectVariantDetector(forked, forked.variants.at(-1)!.id, original!.detectorId);
}
function editVariant(notebook: Notebook, id: string, edit: (variant: ExperimentVariant) => ExperimentVariant): Notebook {
  validateNotebook(notebook);
  if (!notebook.variants.some(variant => variant.id === id)) fail(`unknown variant ${id}.`);
  return snapshot({ ...notebook, variants: notebook.variants.map(variant => variant.id === id ? edit(variant) : variant) });
}
export function removeVariant(notebook: Notebook, id: string): Notebook {
  validateNotebook(notebook);
  if (!notebook.variants.some(variant => variant.id === id)) fail(`unknown variant ${id}.`);
  return snapshot({ ...notebook, variants: notebook.variants.filter(variant => variant.id !== id) });
}
export function renameVariant(notebook: Notebook, id: string, variantName: string): Notebook { return editVariant(notebook, id, variant => ({ ...variant, name: variantName })); }
export function replaceVariant(notebook: Notebook, id: string, document: CircuitDocument): Notebook {
  return editVariant(notebook, id, variant => ({ ...variant, document, detectorId: document.circuit.components.some(component => component.model === 'detector' && component.id === variant.detectorId) ? variant.detectorId : document.circuit.components.find(component => component.model === 'detector')?.id ?? null }));
}
export function selectVariantDetector(notebook: Notebook, id: string, detectorId: string | null): Notebook { return editVariant(notebook, id, variant => ({ ...variant, detectorId })); }
export function setSweep(notebook: Notebook, sweep: SweepConfig): Notebook { return snapshot({ ...notebook, sweep }); }
export const updateSweep = setSweep;
export function parseNotebook(text: string): Notebook {
  if (new TextEncoder().encode(text).byteLength > MAX_NOTEBOOK_BYTES) fail('notebook exceeds the supported byte limit.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('file is not valid JSON.'); }
  validateNotebook(value);
  return freezeSnapshot(value);
}
export function serializeNotebook(notebook: Notebook): string {
  validateNotebook(notebook);
  const text = JSON.stringify(notebook, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_NOTEBOOK_BYTES) fail('notebook exceeds the supported byte limit.');
  return text;
}
