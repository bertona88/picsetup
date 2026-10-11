import { datasetMetadata } from '../model/dataset';
import { sweepCircuit, type SweepOptions, type SweepSample } from '../solver/sweep';
import { freezeSnapshot, validateNotebook, type Notebook } from './notebook';

export interface CompareRequest { id: number; notebook: Notebook; variantIds?: string[] }
export interface ComparisonResult { variantId: string; variantName: string; sourcePowerW: number; samples: SweepSample[] }
export type CompareMessage = ({ type: 'run' } & CompareRequest) | { type: 'cancel'; id: number };
export type CompareResponse =
  | { type: 'progress'; id: number; completed: number; total: number; results: ComparisonResult[] }
  | { type: 'complete'; id: number; request: CompareRequest; results: ComparisonResult[] }
  | { type: 'cancelled'; id: number; completed: number; total: number }
  | { type: 'error'; id: number; message: string };
export interface ComparisonOptions extends Omit<SweepOptions, 'onProgress'> { onProgress?: (results: ComparisonResult[], completed: number, total: number) => void }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function validateCompareRequest(value: unknown): asserts value is CompareRequest {
  if (!object(value) || !Number.isSafeInteger(value.id) || (value.id as number) < 0) throw new Error('Comparison ID must be a nonnegative safe integer.');
  if (Object.keys(value).some(key => !['id', 'notebook', 'variantIds'].includes(key))) throw new Error('Comparison request supports only id, notebook and optional variantIds.');
  validateNotebook(value.notebook);
  const notebook = value.notebook;
  const ids = value.variantIds;
  if (ids !== undefined && (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !notebook.variants.some(variant => variant.id === id)))) throw new Error('Comparison selection must contain distinct existing variant IDs.');
  if (!(ids === undefined ? notebook.variants.length : (ids as string[]).length)) throw new Error('Capture at least one variant before comparing.');
}
/** Each curve uses the identical wavelength grid and its own frozen circuit/source power. */
export async function compareExperiments(request: CompareRequest, options: ComparisonOptions = {}): Promise<{ results: ComparisonResult[]; cancelled: boolean }> {
  validateCompareRequest(request);
  const snapshot = freezeSnapshot(structuredClone(request));
  const variants = snapshot.notebook.variants.filter(variant => !snapshot.variantIds || snapshot.variantIds.includes(variant.id));
  const total = variants.length * snapshot.notebook.sweep.points;
  const results: ComparisonResult[] = [];
  let completed = 0;
  for (const variant of variants) {
    if (options.isCancelled?.()) return { results, cancelled: true };
    const curve: ComparisonResult = { variantId: variant.id, variantName: variant.name, sourcePowerW: variant.document.circuit.components.filter(component => component.model === 'source').reduce((sum, source) => sum + source.params.powerW, 0), samples: [] };
    const { onProgress, ...sweepOptions } = options;
    const output = await sweepCircuit({ id: snapshot.id, circuit: variant.document.circuit, ...snapshot.notebook.sweep }, {
      ...sweepOptions,
      onProgress: samples => onProgress?.(structuredClone([...results, { ...curve, samples }]), completed + samples.length, total),
    });
    curve.samples = output.samples;
    results.push(curve);
    completed += output.samples.length;
    if (output.cancelled || options.isCancelled?.()) return { results, cancelled: true };
    options.onProgress?.(structuredClone(results), completed, total);
  }
  return { results, cancelled: false };
}
export function createComparisonRunner(emit: (response: CompareResponse) => void, options: Omit<ComparisonOptions, 'isCancelled' | 'onProgress'> = {}): { handle(message: unknown): void } {
  let active: { id: number; cancelled: boolean; completed: number; total: number } | undefined;
  return { handle(message: unknown): void {
    const id = object(message) && Number.isSafeInteger(message.id) ? message.id as number : -1;
    if (object(message) && message.type === 'cancel') { if (active?.id === id) active.cancelled = true; return; }
    if (!object(message) || message.type !== 'run') { emit({ type: 'error', id, message: 'Expected a comparison run or cancel message.' }); return; }
    if (active) active.cancelled = true;
    let request: CompareRequest;
    try {
      const { type: _, ...data } = message;
      validateCompareRequest(data);
      request = freezeSnapshot(structuredClone(data));
    } catch (error) { emit({ type: 'error', id, message: error instanceof Error ? error.message : 'Invalid comparison request.' }); return; }
    const job = { id, cancelled: false, completed: 0, total: (request.variantIds?.length ?? request.notebook.variants.length) * request.notebook.sweep.points };
    active = job;
    void compareExperiments(request, {
      ...options,
      isCancelled: () => job.cancelled || active !== job,
      onProgress: (results, completed, total) => { job.completed = completed; if (active === job && !job.cancelled) emit({ type: 'progress', id, completed, total, results }); },
    }).then(output => {
      if (output.cancelled || job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: output.results.reduce((sum, result) => sum + result.samples.length, 0), total: job.total });
      else emit({ type: 'complete', id, request, results: output.results });
    }).catch(error => {
      if (job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: job.completed, total: job.total });
      else emit({ type: 'error', id, message: error instanceof Error ? error.message : 'Comparison failed.' });
    }).finally(() => { if (active === job) active = undefined; });
  } };
}
export function normalizedPower(sample: SweepSample, detectorId: string, sourcePowerW: number): number | null {
  const power = sample.ok ? sample.detectors[detectorId]?.powerW : undefined;
  return power !== undefined && Number.isFinite(power) && Number.isFinite(sourcePowerW) && sourcePowerW > 0 ? power / sourcePowerW : null;
}
const csvCell = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Names may come from imported notebooks; keep spreadsheets from executing them.
  if (typeof value === 'string' && /^[=+@\t\r-]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
export function exportComparisonCsv(request: CompareRequest, results: readonly ComparisonResult[]): string {
  validateCompareRequest(request);
  const usesDataset = request.notebook.variants.some(variant => variant.document.circuit.components.some(component => component.model === 'siepic-coupler'));
  const lines = [
    '# schema: picsetup-comparison/1',
    '# units: wavelength_m=m; power_W=W; phase_rad=rad; source_power_W=W; normalized_power=power_W/source_power_W',
    '# Missing/failed measurements and normalization at zero source power are blank, never fabricated zero.',
    '# time_convention: Re{E exp(+i omega t)}; port_amplitudes=sqrt(W)',
    ...(usesDataset ? [`# dataset_provenance: ${JSON.stringify(datasetMetadata)}`] : []),
    `# request: ${JSON.stringify(request)}`,
    'variant_id,variant_name,detector_id,wavelength_m,ok,power_W,normalized_power,phase_rad,source_power_W,residual,budget_json,diagnostics_json',
  ];
  for (const result of results) {
    const variant = request.notebook.variants.find(item => item.id === result.variantId);
    if (!variant) throw new Error('Comparison result refers to an unknown variant.');
    const detectorIds = variant.document.circuit.components.filter(component => component.model === 'detector').map(component => component.id);
    for (const sample of result.samples) for (const detectorId of detectorIds.length ? detectorIds : ['']) {
      const detector = sample.ok ? sample.detectors[detectorId] : undefined;
      lines.push([result.variantId, result.variantName, detectorId, sample.wavelengthM, sample.ok, detector?.powerW, normalizedPower(sample, detectorId, result.sourcePowerW), detector?.phaseRad, result.sourcePowerW, sample.ok ? sample.residual : null, sample.ok ? JSON.stringify(sample.budget) : null, JSON.stringify(sample.diagnostics)].map(csvCell).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}
