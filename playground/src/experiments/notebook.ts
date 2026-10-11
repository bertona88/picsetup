import { validateDocument } from '../io/document';
import type { CircuitDocument } from '../model/types';
import { validateSweepRequest } from '../solver/sweep';

export interface SweepConfig { startM: number; stopM: number; points: number }
export interface ExperimentVariant { id: string; name: string; document: CircuitDocument; detectorId: string | null }
export interface StudySpec {
  schema: 'picsetup-study/1';
  baselineVariantId: string;
  outputs: { variantId: string; desiredDetectorId: string; unwantedDetectorId: string }[];
  targets: { maxInsertionLossDb: number; maxCrosstalkDb: number };
  /** Explicit assumed offsets, not a process distribution or a fabrication tolerance. */
  phaseScenarios: { id: string; name: string; offsets: { variantId: string; componentId: string; phaseOffsetRad: number }[] }[];
}
interface NotebookFields { title: string; sweep: SweepConfig; variants: ExperimentVariant[] }
export interface ClassicNotebook extends NotebookFields { schema: 'picsetup-notebook/1' }
export interface StudyNotebook extends NotebookFields { schema: 'picsetup-notebook/2'; study: StudySpec }
export type Notebook = ClassicNotebook | StudyNotebook;
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
  const isStudy = object(value) && value.schema === 'picsetup-notebook/2';
  exact(value, ['schema', 'title', 'sweep', 'variants', ...(isStudy ? ['study'] : [])], 'notebook');
  if (value.schema !== 'picsetup-notebook/1' && !isStudy) fail('unsupported schema. Expected picsetup-notebook/1 or picsetup-notebook/2.');
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
  if (isStudy) validateStudySpec(value.study, value.variants as ExperimentVariant[]);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_NOTEBOOK_BYTES) fail('notebook exceeds the supported byte limit.');
}
/** Every detector/phase binding is explicit and revalidated against the saved snapshots. */
export function validateStudySpec(value: unknown, variants: readonly ExperimentVariant[]): asserts value is StudySpec {
  exact(value, ['schema', 'baselineVariantId', 'outputs', 'targets', 'phaseScenarios'], 'study');
  if (value.schema !== 'picsetup-study/1') fail('unsupported study schema.');
  if (!variants.length || !variants.some(variant => variant.id === value.baselineVariantId)) fail('study baseline must be an existing variant.');
  exact(value.targets, ['maxInsertionLossDb', 'maxCrosstalkDb'], 'study targets');
  if (Object.values(value.targets).some(item => typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1000)) fail('study targets must be finite dB values within ±1000 dB.');
  if (!Array.isArray(value.outputs) || value.outputs.length !== variants.length) fail('study outputs must explicitly map every variant once.');
  const mapped = new Set<string>();
  for (const output of value.outputs as unknown[]) {
    exact(output, ['variantId', 'desiredDetectorId', 'unwantedDetectorId'], 'study output');
    const variant = variants.find(item => item.id === output.variantId);
    if (!variant || mapped.has(variant.id)) fail('study output mappings must refer to distinct existing variants.');
    mapped.add(variant!.id);
    if (output.desiredDetectorId === output.unwantedDetectorId || ![output.desiredDetectorId, output.unwantedDetectorId].every(id => variant!.document.circuit.components.some(component => component.id === id && component.model === 'detector'))) fail('study outputs need two distinct existing detectors per variant.');
  }
  if (!Array.isArray(value.phaseScenarios) || value.phaseScenarios.length > 5) fail('study supports at most five explicit phase scenarios.');
  const scenarioIds = new Set(['nominal']);
  for (const scenario of value.phaseScenarios as unknown[]) {
    exact(scenario, ['id', 'name', 'offsets'], 'phase scenario');
    if (typeof scenario.id !== 'string' || !scenario.id || scenario.id.length > 100 || reserved.has(scenario.id) || scenarioIds.has(scenario.id)) fail('phase scenario IDs must be distinct nonreserved strings up to 100 characters; nominal is reserved.');
    scenarioIds.add(scenario.id as string);
    name(scenario.name, 'phase scenario name');
    if (!Array.isArray(scenario.offsets) || !scenario.offsets.length || scenario.offsets.length > 600) fail('phase scenario needs 1–600 explicit offsets.');
    const bindings = new Set<string>();
    for (const offset of scenario.offsets as unknown[]) {
      exact(offset, ['variantId', 'componentId', 'phaseOffsetRad'], 'phase offset');
      const variant = variants.find(item => item.id === offset.variantId);
      const phase = variant?.document.circuit.components.find(item => item.id === offset.componentId && item.model === 'phase');
      const key = JSON.stringify([offset.variantId, offset.componentId]);
      if (!phase || bindings.has(key)) fail('phase offsets must bind distinct existing phase components in existing variants.');
      bindings.add(key);
      if (typeof offset.phaseOffsetRad !== 'number' || !Number.isFinite(offset.phaseOffsetRad) || Math.abs(offset.phaseOffsetRad) > 2 * Math.PI || !Number.isFinite(phase!.params.phaseRad + offset.phaseOffsetRad)) fail('phase offsets must be finite radians within ±2π.');
    }
  }
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
export function setStudy(notebook: Notebook, study: StudySpec): StudyNotebook { return snapshot({ ...notebook, schema: 'picsetup-notebook/2', study }) as StudyNotebook; }
/** Explicitly remove design intent before a structural edit that invalidates its bindings. */
export function clearStudy(notebook: Notebook): ClassicNotebook {
  validateNotebook(notebook);
  const { title, sweep, variants } = notebook;
  return snapshot({ schema: 'picsetup-notebook/1', title, sweep, variants }) as ClassicNotebook;
}
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
