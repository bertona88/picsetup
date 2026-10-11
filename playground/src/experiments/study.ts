import type { CircuitDocument, Diagnostic } from '../model/types';
import { datasetMetadata } from '../model/dataset';
import { waveguideMetadata } from '../model/propagation';
import { assessSampleQuality } from '../solver/quality';
import { sweepCircuit, sweepWavelength, type SweepOptions, type SweepSample } from '../solver/sweep';
import type { ComparisonResult } from './compare';
import { freezeSnapshot, validateNotebook, type StudyNotebook } from './notebook';

/** JSON-safe infinities: zero transmission is never conflated with unavailable data. */
export interface DbMetric { value: number | null; status: 'finite' | 'positive-infinity' | 'negative-infinity' | 'unavailable' }
export interface SemanticDifference { path: string; before: unknown; after: unknown }
export interface VariantDifferences { variantId: string; baselineVariantId: string; isBaseline: boolean; differences: SemanticDifference[] }
export interface StudyOutputMeasurement { powerW: number | null; normalizedPower: number | null; outputDb: DbMetric }
export interface StudyMeasurement {
  wavelengthM: number; eligible: boolean; reasons: Diagnostic[];
  desired: StudyOutputMeasurement; unwanted: StudyOutputMeasurement;
  insertionLossDb: DbMetric; crosstalkDb: DbMetric;
}
export interface StudyBandMetrics {
  worstInsertionLossDb: DbMetric; worstCrosstalkDb: DbMetric;
  /** Only a fully eligible, complete grid can receive a pass/fail decision. */
  status: 'sampled-pass' | 'sampled-fail' | 'unresolved';
  insertionLossPass: boolean | null; crosstalkPass: boolean | null;
  eligibleSamples: number; excludedSamples: number; warningSamples: number; expectedSamples: number;
}
export interface StudyCurve extends ComparisonResult {
  scenarioId: string; scenarioName: string;
  desiredDetectorId: string; unwantedDetectorId: string;
  measurements: StudyMeasurement[]; metrics: StudyBandMetrics;
}
export interface StudyRequest { id: number; notebook: StudyNotebook }
export interface StudyResult {
  schema: 'picsetup-study-result/1'; request: StudyRequest; curves: StudyCurve[];
  differences: VariantDifferences[]; sampling: { stepM: number; caveat: string };
  cancelled: boolean;
}
export interface StudyOptions extends Omit<SweepOptions, 'onProgress'> {
  onProgress?: (completed: number, total: number) => void;
}
export type StudyMessage = ({ type: 'run' } & StudyRequest) | { type: 'cancel'; id: number };
export type StudyResponse =
  | { type: 'progress'; id: number; completed: number; total: number }
  | { type: 'complete'; id: number; result: StudyResult }
  | { type: 'cancelled'; id: number; completed: number; total: number }
  | { type: 'error'; id: number; message: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const unavailable = (): DbMetric => ({ value: null, status: 'unavailable' });
const finite = (value: number): DbMetric => Number.isNaN(value) ? unavailable() : Number.isFinite(value) ? { value: value === 0 ? 0 : value, status: 'finite' } : { value: null, status: value > 0 ? 'positive-infinity' : 'negative-infinity' };
const metricNumber = (metric: DbMetric): number | null => metric.status === 'finite' ? metric.value : metric.status === 'positive-infinity' ? Infinity : metric.status === 'negative-infinity' ? -Infinity : null;
const db = (ratio: number | null): DbMetric => ratio === null || !Number.isFinite(ratio) || ratio < 0 ? unavailable() : ratio === 0 ? { value: null, status: 'negative-infinity' } : finite(10 * Math.log10(ratio));

export function formatDbMetric(metric: DbMetric, digits = 2): string {
  return metric.status === 'finite' ? `${metric.value!.toFixed(digits)} dB` : metric.status === 'positive-infinity' ? '+∞ dB' : metric.status === 'negative-infinity' ? '−∞ dB' : 'unavailable';
}

/** Stable physical comparison; reciprocal link direction, labels, layout and array order are ignored. */
function semantic(document: CircuitDocument): Record<string, unknown> {
  const components = Object.fromEntries([...document.circuit.components].sort((a, b) => a.id.localeCompare(b.id)).map(component => [component.id, { model: component.model, version: component.version, params: component.params }]));
  const connections = Object.fromEntries(document.circuit.connections.map(connection => {
    const endpoints = [connection.from, connection.to].map(endpoint => JSON.stringify([endpoint.component, endpoint.port])).sort();
    const { id: _, from: _from, to: _to, ...propagation } = connection;
    return [endpoints.join(' ↔ '), propagation];
  }).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return { wavelengthM: document.circuit.wavelengthM, components, connections };
}
function difference(before: unknown, after: unknown, path: string, output: SemanticDifference[]): void {
  if (Object.is(before, after)) return;
  if (record(before) && record(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) difference(before[key], after[key], path ? `${path}.${key}` : key, output);
  } else output.push({ path, before: before === undefined ? null : structuredClone(before), after: after === undefined ? null : structuredClone(after) });
}
export function semanticDifferences(baseline: CircuitDocument, variant: CircuitDocument): SemanticDifference[] {
  const output: SemanticDifference[] = [];
  difference(semantic(baseline), semantic(variant), '', output);
  return output;
}
export function diffVariants(notebook: StudyNotebook): VariantDifferences[] {
  validateNotebook(notebook);
  const baseline = notebook.variants.find(variant => variant.id === notebook.study.baselineVariantId)!;
  return notebook.variants.map(variant => ({ variantId: variant.id, baselineVariantId: baseline.id, isBaseline: variant.id === baseline.id, differences: semanticDifferences(baseline.document, variant.document) }));
}

export function validateStudyRequest(value: unknown): asserts value is StudyRequest {
  if (!record(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'id') || !Object.hasOwn(value, 'notebook') || !Number.isSafeInteger(value.id) || (value.id as number) < 0) throw new Error('Study request needs exactly a nonnegative safe integer id and notebook.');
  validateNotebook(value.notebook);
  if (value.notebook.schema !== 'picsetup-notebook/2') throw new Error('Study evaluation requires picsetup-notebook/2 with explicit design intent.');
}

function measurement(sample: SweepSample, sourcePowerW: number, desiredDetectorId: string, unwantedDetectorId: string): StudyMeasurement {
  const desiredPowerW = sample.detectors[desiredDetectorId]?.powerW;
  const unwantedPowerW = sample.detectors[unwantedDetectorId]?.powerW;
  const quality = assessSampleQuality({ ok: sample.ok, diagnostics: sample.diagnostics, values: [desiredPowerW, unwantedPowerW, sample.residual] });
  if (!Number.isFinite(sourcePowerW) || sourcePowerW <= 0) { quality.eligible = false; quality.reasons.push({ severity: 'error', code: 'STUDY_ZERO_SOURCE', message: 'Normalized study measurements require positive finite emitted source power.' }); }
  if ((desiredPowerW ?? 0) < 0 || (unwantedPowerW ?? 0) < 0) { quality.eligible = false; quality.reasons.push({ severity: 'error', code: 'STUDY_NEGATIVE_POWER', message: 'Negative output power is unavailable for study metrics.' }); }
  if (quality.eligible && (![desiredPowerW!, unwantedPowerW!].every(power => Number.isFinite(power / sourcePowerW)))) { quality.eligible = false; quality.reasons.push({ severity: 'error', code: 'STUDY_NORMALIZATION_OVERFLOW', message: 'Normalized output power exceeds the supported numerical range.' }); }
  const output = (power: number | undefined): StudyOutputMeasurement => {
    const normalizedPower = quality.eligible ? power! / sourcePowerW : null;
    return { powerW: Number.isFinite(power) ? power! : null, normalizedPower, outputDb: db(normalizedPower) };
  };
  const desired = output(desiredPowerW), unwanted = output(unwantedPowerW);
  let crosstalkDb = unavailable();
  if (quality.eligible && desiredPowerW! > 0) crosstalkDb = unwantedPowerW === 0 ? { value: null, status: 'negative-infinity' } : finite(10 * (Math.log10(unwantedPowerW!) - Math.log10(desiredPowerW!)));
  else if (quality.eligible && unwantedPowerW! > 0) crosstalkDb = { value: null, status: 'positive-infinity' };
  const insertionLossDb = desired.outputDb.status === 'negative-infinity' ? { value: null, status: 'positive-infinity' as const } : desired.outputDb.status === 'finite' ? finite(-desired.outputDb.value!) : unavailable();
  return { wavelengthM: sample.wavelengthM, eligible: quality.eligible, reasons: quality.reasons, desired, unwanted, insertionLossDb, crosstalkDb };
}
function summarizeCurve(notebook: StudyNotebook, result: ComparisonResult, scenarioId: string, scenarioName: string): StudyCurve {
  const outputs = notebook.study.outputs.find(output => output.variantId === result.variantId);
  if (!outputs) throw new Error('Study result refers to an unmapped variant.');
  const measurements = result.samples.map(sample => measurement(sample, result.sourcePowerW, outputs.desiredDetectorId, outputs.unwantedDetectorId));
  const expectedSamples = notebook.sweep.points;
  const completeGrid = result.samples.length === expectedSamples && result.samples.every((sample, index) => sample.wavelengthM === sweepWavelength(notebook.sweep, index));
  const eligibleSamples = measurements.filter(item => item.eligible).length;
  const aggregate = (field: 'insertionLossDb' | 'crosstalkDb'): DbMetric => {
    const values = measurements.map(item => metricNumber(item[field]));
    return completeGrid && values.every(value => value !== null) ? finite(Math.max(...values as number[])) : unavailable();
  };
  const worstInsertionLossDb = aggregate('insertionLossDb'), worstCrosstalkDb = aggregate('crosstalkDb');
  const test = (metric: DbMetric, target: number): boolean | null => { const value = metricNumber(metric); return value === null ? null : value <= target; };
  const insertionLossPass = test(worstInsertionLossDb, notebook.study.targets.maxInsertionLossDb), crosstalkPass = test(worstCrosstalkDb, notebook.study.targets.maxCrosstalkDb);
  const status = insertionLossPass === null || crosstalkPass === null ? 'unresolved' : insertionLossPass && crosstalkPass ? 'sampled-pass' : 'sampled-fail';
  return { ...structuredClone(result), scenarioId, scenarioName, desiredDetectorId: outputs.desiredDetectorId, unwantedDetectorId: outputs.unwantedDetectorId, measurements, metrics: { worstInsertionLossDb, worstCrosstalkDb, status, insertionLossPass, crosstalkPass, eligibleSamples, excludedSamples: result.samples.length - eligibleSamples, warningSamples: result.samples.filter(sample => sample.diagnostics.some(item => item.severity !== 'info')).length, expectedSamples } };
}
function resultEnvelope(request: StudyRequest, curves: StudyCurve[], cancelled: boolean): StudyResult {
  return freezeSnapshot({ schema: 'picsetup-study-result/1', request: structuredClone(request), curves, differences: diffVariants(request.notebook), sampling: { stepM: (request.notebook.sweep.stopM - request.notebook.sweep.startM) / (request.notebook.sweep.points - 1), caveat: 'Metrics cover only the declared wavelength samples and explicit phase-offset scenarios. Narrow features may lie between samples; these results do not establish continuous-band limits, worst-case fabrication behavior, yield, or physical calibration.' }, cancelled });
}
/** Summarizes an already completed nominal comparison, without further solving. */
export function summarizeStudy(request: StudyRequest, results: readonly ComparisonResult[]): StudyResult {
  validateStudyRequest(request);
  if (new Set(results.map(result => result.variantId)).size !== results.length) throw new Error('Study comparison results must contain each variant at most once.');
  return resultEnvelope(request, results.map(result => summarizeCurve(request.notebook, result, 'nominal', 'Nominal')), false);
}
/** Frozen replayable experiment with uniform common wavelength samples; no optimizer. */
export async function evaluateStudy(request: StudyRequest, options: StudyOptions = {}): Promise<StudyResult> {
  validateStudyRequest(request);
  const snapshot = freezeSnapshot(structuredClone(request));
  const scenarios = [{ id: 'nominal', name: 'Nominal', offsets: [] }, ...snapshot.notebook.study.phaseScenarios];
  const total = scenarios.length * snapshot.notebook.variants.length * snapshot.notebook.sweep.points;
  let completed = 0;
  const curves: StudyCurve[] = [];
  for (const scenario of scenarios) for (const variant of snapshot.notebook.variants) {
    if (options.isCancelled?.()) return resultEnvelope(snapshot, curves, true);
    const circuit = structuredClone(variant.document.circuit);
    for (const offset of scenario.offsets.filter(item => item.variantId === variant.id)) circuit.components.find(component => component.id === offset.componentId)!.params.phaseRad += offset.phaseOffsetRad;
    const { onProgress, ...sweepOptions } = options;
    const output = await sweepCircuit({ id: snapshot.id, circuit, ...snapshot.notebook.sweep }, { ...sweepOptions, onProgress: samples => onProgress?.(completed + samples.length, total) });
    const sourcePowerW = circuit.components.filter(component => component.model === 'source').reduce((sum, source) => sum + source.params.powerW, 0);
    curves.push(summarizeCurve(snapshot.notebook, { variantId: variant.id, variantName: variant.name, sourcePowerW, samples: output.samples }, scenario.id, scenario.name));
    completed += output.samples.length;
    if (output.cancelled || options.isCancelled?.()) return resultEnvelope(snapshot, curves, true);
    onProgress?.(completed, total);
  }
  return resultEnvelope(snapshot, curves, false);
}
export function createStudyRunner(emit: (response: StudyResponse) => void, options: Omit<StudyOptions, 'isCancelled' | 'onProgress'> = {}): { handle(message: unknown): void } {
  let active: { id: number; cancelled: boolean; completed: number; total: number } | undefined;
  return { handle(message: unknown): void {
    const id = record(message) && Number.isSafeInteger(message.id) ? message.id as number : -1;
    if (record(message) && message.type === 'cancel') { if (active?.id === id) active.cancelled = true; return; }
    if (!record(message) || message.type !== 'run') { emit({ type: 'error', id, message: 'Expected a study run or cancel message.' }); return; }
    if (active) active.cancelled = true;
    let request: StudyRequest;
    try { const { type: _, ...data } = message; validateStudyRequest(data); request = freezeSnapshot(structuredClone(data)); }
    catch (error) { emit({ type: 'error', id, message: error instanceof Error ? error.message : 'Invalid study request.' }); return; }
    const job = { id, cancelled: false, completed: 0, total: request.notebook.variants.length * (request.notebook.study.phaseScenarios.length + 1) * request.notebook.sweep.points };
    active = job;
    void evaluateStudy(request, { ...options, isCancelled: () => job.cancelled || active !== job, onProgress: (completed, total) => { job.completed = completed; if (active === job && !job.cancelled) emit({ type: 'progress', id, completed, total }); } }).then(result => {
      if (result.cancelled || job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: result.curves.reduce((sum, curve) => sum + curve.samples.length, 0), total: job.total });
      else emit({ type: 'complete', id, result });
    }).catch(error => { if (job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: job.completed, total: job.total }); else emit({ type: 'error', id, message: error instanceof Error ? error.message : 'Study failed.' }); }).finally(() => { if (active === job) active = undefined; });
  } };
}

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && /^[=+@\t\r-]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
export function exportStudyCsv(result: StudyResult): string {
  validateStudyRequest(result.request);
  const variants = result.request.notebook.variants;
  const lines = ['# schema: picsetup-study-csv/1', '# units: wavelength_m=m; power_W=W; normalized_power=power_W/source_power_W; output_dB=10*log10(normalized_power); insertion_loss_dB=-desired_output_dB; crosstalk_dB=10*log10(unwanted_W/desired_W)', '# Infinity is represented by a separate status field; unavailable values are blank. Raw solver powers/budgets/diagnostics are retained for excluded samples.',
    ...(variants.some(variant => variant.document.circuit.components.some(component => component.model === 'siepic-coupler')) ? [`# dataset_provenance: ${JSON.stringify(datasetMetadata)}`] : []),
    ...(variants.some(variant => variant.document.circuit.connections.some(connection => connection.waveguide)) ? [`# waveguide_provenance: ${JSON.stringify(waveguideMetadata)}`] : []),
    `# sampling_caveat: ${result.sampling.caveat}`, `# request: ${JSON.stringify(result.request)}`, `# differences: ${JSON.stringify(result.differences)}`, 'scenario_id,scenario_name,variant_id,variant_name,wavelength_m,eligible,source_power_W,desired_detector,desired_power_W,desired_normalized_power,desired_output_dB,desired_output_dB_status,unwanted_detector,unwanted_power_W,unwanted_normalized_power,unwanted_output_dB,unwanted_output_dB_status,insertion_loss_dB,insertion_loss_dB_status,crosstalk_dB,crosstalk_dB_status,residual,budget_json,diagnostics_json,exclusion_reasons_json'];
  for (const curve of result.curves) for (let index = 0; index < curve.samples.length; index++) {
    const sample = curve.samples[index], measured = curve.measurements[index];
    lines.push([curve.scenarioId, curve.scenarioName, curve.variantId, curve.variantName, sample.wavelengthM, measured.eligible, curve.sourcePowerW, curve.desiredDetectorId, measured.desired.powerW, measured.desired.normalizedPower, measured.desired.outputDb.value, measured.desired.outputDb.status, curve.unwantedDetectorId, measured.unwanted.powerW, measured.unwanted.normalizedPower, measured.unwanted.outputDb.value, measured.unwanted.outputDb.status, measured.insertionLossDb.value, measured.insertionLossDb.status, measured.crosstalkDb.value, measured.crosstalkDb.status, sample.residual, sample.budget ? JSON.stringify(sample.budget) : null, JSON.stringify(sample.diagnostics), JSON.stringify(measured.reasons)].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
