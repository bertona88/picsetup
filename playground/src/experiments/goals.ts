import { validateDocument } from '../io/document';
import type { Circuit, CircuitDocument, Diagnostic, SolveResult } from '../model/types';
import { solveCircuit } from '../solver/solve';
import { assessSampleQuality } from '../solver/quality';
import { freezeSnapshot } from './notebook';

export type GoalParameter = { kind: 'component'; componentId: string; name: 'phaseRad' | 'coupling' } | { kind: 'connection'; connectionId: string; name: 'lengthM' };
export interface GoalRequest { id: number; document: CircuitDocument; wavelengthM: number; detectorId: string; objective: 'minimize' | 'maximize'; parameter: GoalParameter; min: number; max: number; points: number }
export interface GoalSample { index: number; value: number; ok: boolean; powerW: number | null; diagnostics: Diagnostic[]; eligible: boolean; rejectionReasons: Diagnostic[] }
export interface GoalBaseline { value: number; ok: boolean; powerW: number | null; sourcePowerW: number | null; diagnostics: Diagnostic[]; eligible: boolean; rejectionReasons: Diagnostic[] }
export interface GoalBest { index: number; value: number; powerW: number; document: CircuitDocument }
export type GoalDecision = 'improved' | 'no-improvement' | 'unresolved' | 'cancelled';
export interface GoalResult {
  request: GoalRequest; samples: GoalSample[]; best: GoalBest | null;
  /** Null only when cancelled before the baseline solve. */
  baseline: GoalBaseline | null;
  decision: GoalDecision; cancelled: boolean; failedCount: number; rejectedCount: number; boundaryHit: boolean;
  /** Objective-directed gain; positive is better. Null when either comparison endpoint is ineligible. */
  improvementW: number | null;
  /** Numerical comparison threshold, not a physical uncertainty or optimum guarantee. */
  toleranceW: number | null;
}
export type GoalMessage = ({ type: 'run' } & GoalRequest) | { type: 'cancel'; id: number };
export type GoalResponse =
  | { type: 'progress'; id: number; completed: number; total: number; samples: GoalSample[] }
  | { type: 'complete'; id: number; result: GoalResult }
  | { type: 'cancelled'; id: number; completed: number; total: number }
  | { type: 'error'; id: number; message: string };
export const MAX_GOAL_POINTS = 201;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function exact(value: unknown, fields: string[], path: string): asserts value is Record<string, unknown> {
  if (!object(value) || fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(`${path} must contain exactly ${fields.join(', ')}.`);
}
export function validateGoalRequest(value: unknown): asserts value is GoalRequest {
  exact(value, ['id', 'document', 'wavelengthM', 'detectorId', 'objective', 'parameter', 'min', 'max', 'points'], 'Goal request');
  if (!Number.isSafeInteger(value.id) || (value.id as number) < 0) throw new Error('Goal ID must be a nonnegative safe integer.');
  validateDocument(value.document);
  const document = value.document;
  if (typeof value.wavelengthM !== 'number' || !Number.isFinite(value.wavelengthM) || value.wavelengthM <= 0) throw new Error('Goal wavelength must be a finite positive number of metres.');
  if (typeof value.detectorId !== 'string' || !document.circuit.components.some(component => component.id === value.detectorId && component.model === 'detector')) throw new Error('Choose an existing detector for the goal.');
  if (value.objective !== 'minimize' && value.objective !== 'maximize') throw new Error('Goal objective must be minimize or maximize.');
  if (!Number.isInteger(value.points) || (value.points as number) < 2 || (value.points as number) > MAX_GOAL_POINTS) throw new Error(`Goal search requires 2–${MAX_GOAL_POINTS} sampled candidates.`);
  if (typeof value.min !== 'number' || typeof value.max !== 'number' || !Number.isFinite(value.min) || !Number.isFinite(value.max) || !Number.isFinite(value.max - value.min) || value.min >= value.max) throw new Error('Goal bounds must be finite with min less than max and a finite span.');
  const parameter = value.parameter;
  if (!object(parameter)) throw new Error('Goal parameter must identify a component parameter or connection length.');
  if (parameter.kind === 'component') {
    exact(parameter, ['kind', 'componentId', 'name'], 'Goal component parameter');
    const component = document.circuit.components.find(component => component.id === parameter.componentId);
    if (!component || !(component.model === 'phase' && parameter.name === 'phaseRad' || component.model === 'coupler' && parameter.name === 'coupling')) throw new Error('Supported component goals are analytical phase.phaseRad and coupler.coupling.');
    if (parameter.name === 'coupling' && (value.min < 0 || value.max > 1)) throw new Error('Coupling search bounds must be within [0, 1].');
  } else if (parameter.kind === 'connection') {
    exact(parameter, ['kind', 'connectionId', 'name'], 'Goal connection parameter');
    if (parameter.name !== 'lengthM' || !document.circuit.connections.some(connection => connection.id === parameter.connectionId)) throw new Error('Connection goals require an existing connection lengthM.');
    if (value.min < 0) throw new Error('Connection length search bounds must be nonnegative metres.');
  } else throw new Error('Unsupported goal parameter kind.');
}
export interface GoalOptions {
  yieldControl?: () => Promise<void>;
  chunkSize?: number;
  isCancelled?: () => boolean;
  onProgress?: (samples: GoalSample[]) => void;
  solve?: (circuit: Circuit) => SolveResult;
}
const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function candidateDocument(request: GoalRequest, value: number): CircuitDocument {
  const document = structuredClone(request.document);
  document.circuit.wavelengthM = request.wavelengthM;
  const parameter = request.parameter;
  if (parameter.kind === 'component') document.circuit.components.find(component => component.id === parameter.componentId)!.params[parameter.name] = value;
  else document.circuit.connections.find(connection => connection.id === parameter.connectionId)!.lengthM = value;
  return document;
}
function baselineValue(request: GoalRequest): number {
  const parameter = request.parameter;
  return parameter.kind === 'component'
    ? request.document.circuit.components.find(component => component.id === parameter.componentId)!.params[parameter.name]
    : request.document.circuit.connections.find(connection => connection.id === parameter.connectionId)!.lengthM;
}
function evaluate(request: GoalRequest, document: CircuitDocument, solve: (circuit: Circuit) => SolveResult): Omit<GoalBaseline, 'value'> {
  try {
    const result = solve(document.circuit);
    const detector = result.detectors[request.detectorId];
    const ok = result.ok && detector !== undefined && Number.isFinite(detector.powerW);
    const diagnostics = [...result.diagnostics];
    if (!ok && !diagnostics.some(item => item.severity === 'error')) diagnostics.push({ severity: 'error', code: 'GOAL_SAMPLE_FAILED', message: 'No valid detector power was available for this candidate.' });
    const quality = assessSampleQuality({ ok, diagnostics, values: [detector?.powerW, result.residual, ...Object.values(result.budget)] });
    return { ok, powerW: ok ? detector.powerW : null, sourcePowerW: Number.isFinite(result.budget.emittedW) ? result.budget.emittedW : null, diagnostics, eligible: quality.eligible, rejectionReasons: quality.reasons };
  } catch (error) {
    const diagnostics: Diagnostic[] = [{ severity: 'error', code: 'GOAL_SAMPLE_FAILED', message: error instanceof Error ? error.message : 'Candidate solve failed.' }];
    return { ok: false, powerW: null, sourcePowerW: null, diagnostics, eligible: false, rejectionReasons: [...diagnostics] };
  }
}
/** Bounded one-dimensional grid sampling. Reports a sampled best, not a global optimum. */
export async function runGoalSearch(input: GoalRequest, options: GoalOptions = {}): Promise<GoalResult> {
  validateGoalRequest(input);
  const request = freezeSnapshot(structuredClone(input));
  const samples: GoalSample[] = [];
  const chunkSize = options.chunkSize ?? 8;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_GOAL_POINTS) throw new Error('Goal chunk size must be an integer from 1 to 201.');
  const yieldControl = options.yieldControl ?? nextTask;
  let best: GoalBest | null = null;
  let baseline: GoalBaseline | null = null;
  const solve = options.solve ?? solveCircuit;
  await yieldControl();
  if (!options.isCancelled?.()) {
    const value = baselineValue(request);
    baseline = { value, ...evaluate(request, candidateDocument(request, value), solve) };
  }
  for (let index = 0; index < request.points; index++) {
    if (options.isCancelled?.()) break;
    const value = index === request.points - 1 ? request.max : request.min + (request.max - request.min) * (index / (request.points - 1));
    const document = candidateDocument(request, value);
    const { sourcePowerW: _, ...measurement } = evaluate(request, document, solve);
    const sample: GoalSample = { index, value, ...measurement };
    if (sample.eligible && sample.powerW !== null && (best === null || (request.objective === 'minimize' ? sample.powerW < best.powerW : sample.powerW > best.powerW))) best = freezeSnapshot({ index, value, powerW: sample.powerW, document });
    samples.push(sample);
    if ((index + 1) % chunkSize === 0 && index + 1 < request.points) { options.onProgress?.(structuredClone(samples)); await yieldControl(); }
  }
  const cancelled = samples.length < request.points || Boolean(options.isCancelled?.());
  let improvementW: number | null = null, toleranceW: number | null = null;
  // Match the solver's relative accounting scale; a fixed watt threshold would hide
  // meaningful changes for weak sources and reward noise for strong ones.
  if (baseline?.eligible && baseline.powerW !== null && best !== null) {
    improvementW = request.objective === 'maximize' ? best.powerW - baseline.powerW : baseline.powerW - best.powerW;
    toleranceW = Math.max(Number.MIN_VALUE, 1e-9 * Math.max(Math.abs(baseline.sourcePowerW ?? 0), Math.abs(baseline.powerW), Math.abs(best.powerW)));
  }
  const decision: GoalDecision = cancelled ? 'cancelled' : improvementW === null || toleranceW === null ? 'unresolved' : improvementW > toleranceW ? 'improved' : 'no-improvement';
  return freezeSnapshot({ request, samples, best, baseline, decision, improvementW, toleranceW, cancelled, failedCount: samples.filter(sample => !sample.ok).length, rejectedCount: samples.filter(sample => !sample.eligible).length, boundaryHit: best !== null && (best.index === 0 || best.index === request.points - 1) });
}
export function createGoalRunner(emit: (message: GoalResponse) => void, options: Omit<GoalOptions, 'onProgress' | 'isCancelled'> = {}): { handle(message: unknown): void } {
  let active: { id: number; cancelled: boolean; completed: number; total: number } | undefined;
  return { handle(message: unknown): void {
    const id = object(message) && Number.isSafeInteger(message.id) ? message.id as number : -1;
    if (object(message) && message.type === 'cancel') { if (active?.id === id) active.cancelled = true; return; }
    if (!object(message) || message.type !== 'run') { emit({ type: 'error', id, message: 'Expected a goal run or cancel message.' }); return; }
    if (active) active.cancelled = true;
    let request: GoalRequest;
    try {
      const { type: _, ...data } = message;
      validateGoalRequest(data);
      request = freezeSnapshot(structuredClone(data));
    } catch (error) { emit({ type: 'error', id, message: error instanceof Error ? error.message : 'Invalid goal request.' }); return; }
    const job = { id, cancelled: false, completed: 0, total: request.points };
    active = job;
    void runGoalSearch(request, { ...options, isCancelled: () => job.cancelled || active !== job, onProgress: samples => { job.completed = samples.length; if (!job.cancelled && active === job) emit({ type: 'progress', id, completed: samples.length, total: request.points, samples }); } }).then(result => {
      if (result.cancelled || job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: result.samples.length, total: request.points });
      else emit({ type: 'complete', id, result });
    }).catch(error => {
      if (job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: job.completed, total: job.total });
      else emit({ type: 'error', id, message: error instanceof Error ? error.message : 'Goal search failed.' });
    }).finally(() => { if (active === job) active = undefined; });
  } };
}
