import type { Circuit, Diagnostic, PowerBudget, SolveResult } from '../model/types';
import { datasetMetadata } from '../model/dataset';
import { solveCircuit } from './solve';

export interface SweepRequest {
  id: number;
  circuit: Circuit;
  startM: number;
  stopM: number;
  points: number;
}

export interface SweepSample {
  wavelengthM: number;
  ok: boolean;
  detectors: Record<string, { powerW: number; phaseRad: number | null }>;
  /** A failed solve has no measured powers or residual, never fabricated zeros. */
  budget: PowerBudget | null;
  residual: number | null;
  diagnostics: Diagnostic[];
}

export type SweepMessage = ({ type: 'run' } & SweepRequest) | { type: 'cancel'; id: number };
export type SweepResponse =
  | { type: 'progress'; id: number; completed: number; total: number; samples: SweepSample[] }
  | { type: 'complete'; id: number; request: SweepRequest; samples: SweepSample[] }
  | { type: 'cancelled'; id: number; completed: number; total: number }
  | { type: 'error'; id: number; message: string; diagnostics: Diagnostic[] };

export const MIN_SWEEP_POINTS = 2;
export const MAX_SWEEP_POINTS = 1001;
const diagnostic = (code: string, message: string): Diagnostic => ({ severity: 'error', code, message });
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Range validation is separate from per-wavelength circuit/model admission. */
export function validateSweepRequest(request: unknown): Diagnostic[] {
  if (!record(request)) return [diagnostic('INVALID_SWEEP', 'Sweep request must be an object.')];
  const diagnostics: Diagnostic[] = [];
  if (!Number.isSafeInteger(request.id) || (request.id as number) < 0) diagnostics.push(diagnostic('INVALID_SWEEP_ID', 'Sweep ID must be a nonnegative safe integer.'));
  if (typeof request.startM !== 'number' || !Number.isFinite(request.startM) || request.startM <= 0 || typeof request.stopM !== 'number' || !Number.isFinite(request.stopM) || request.stopM <= request.startM) {
    diagnostics.push(diagnostic('INVALID_SWEEP_RANGE', 'Sweep wavelengths must be finite, positive metres, with stop greater than start.'));
  }
  if (!Number.isInteger(request.points) || (request.points as number) < MIN_SWEEP_POINTS || (request.points as number) > MAX_SWEEP_POINTS) {
    diagnostics.push(diagnostic('INVALID_SWEEP_POINTS', `Sweep needs an integer from ${MIN_SWEEP_POINTS} to ${MAX_SWEEP_POINTS} points.`));
  }
  if (!record(request.circuit) || !Array.isArray(request.circuit.components) || !Array.isArray(request.circuit.connections)) diagnostics.push(diagnostic('INVALID_CIRCUIT', 'Sweep circuit must contain component and connection arrays.'));
  return diagnostics;
}

/** Includes exact endpoints; each wavelength is calculated directly, without cumulative drift. */
export function sweepWavelength(request: Pick<SweepRequest, 'startM' | 'stopM' | 'points'>, index: number): number {
  if (index === request.points - 1) return request.stopM;
  return request.startM + (request.stopM - request.startM) * (index / (request.points - 1));
}

function solveSample(circuit: Circuit, wavelengthM: number, solve: (circuit: Circuit) => SolveResult): SweepSample {
  try {
    const result = solve({ ...circuit, wavelengthM });
    return {
      wavelengthM, ok: result.ok, detectors: result.ok ? result.detectors : {},
      budget: result.ok ? result.budget : null, residual: result.ok ? result.residual : null,
      diagnostics: !result.ok && !result.diagnostics.some(item => item.severity === 'error')
        ? [...result.diagnostics, diagnostic('SWEEP_SAMPLE_FAILED', 'No valid solve was available at this wavelength.')]
        : result.diagnostics,
    };
  } catch (error) {
    return { wavelengthM, ok: false, detectors: {}, budget: null, residual: null, diagnostics: [diagnostic('SWEEP_SAMPLE_FAILED', error instanceof Error ? error.message : 'The model failed at this wavelength.')] };
  }
}

export interface SweepOptions {
  /** Yield a macrotask so worker messages can cancel/supersede this run. */
  yieldControl?: () => Promise<void>;
  chunkSize?: number;
  isCancelled?: () => boolean;
  onProgress?: (samples: SweepSample[]) => void;
  solve?: (circuit: Circuit) => SolveResult;
}
const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Headless orchestration shared by the worker, experiments and cancellation tests. */
export async function sweepCircuit(request: SweepRequest, options: SweepOptions = {}): Promise<{ samples: SweepSample[]; cancelled: boolean }> {
  const invalid = validateSweepRequest(request);
  if (invalid.length) throw new Error(invalid.map(item => item.message).join(' '));
  const chunkSize = options.chunkSize ?? 8;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_SWEEP_POINTS) throw new Error('Sweep chunk size must be a positive integer no greater than 1001.');
  // Also protects headless callers from mutating an in-flight experiment.
  const snapshot = structuredClone(request);
  const yieldControl = options.yieldControl ?? nextTask;
  const isCancelled = options.isCancelled ?? (() => false);
  const samples: SweepSample[] = [];
  await yieldControl();
  for (let index = 0; index < snapshot.points; index++) {
    if (isCancelled()) return { samples, cancelled: true };
    samples.push(solveSample(snapshot.circuit, sweepWavelength(snapshot, index), options.solve ?? solveCircuit));
    if ((index + 1) % chunkSize === 0 && index + 1 < snapshot.points) {
      options.onProgress?.([...samples]);
      await yieldControl();
    }
  }
  return { samples, cancelled: isCancelled() };
}

/** Every job has its own token: a stale cancel/result can never target a newer job. */
export function createSweepRunner(emit: (response: SweepResponse) => void, options: Omit<SweepOptions, 'isCancelled' | 'onProgress'> = {}): { handle: (message: unknown) => void } {
  let active: { id: number; cancelled: boolean; completed: number; total: number } | undefined;
  return {
    handle(message: unknown): void {
      const id = record(message) && Number.isSafeInteger(message.id) ? message.id as number : -1;
      if (record(message) && message.type === 'cancel') {
        if (active?.id === id) active.cancelled = true;
        return;
      }
      if (!record(message) || message.type !== 'run') {
        emit({ type: 'error', id, message: 'Unknown sweep worker message.', diagnostics: [diagnostic('INVALID_SWEEP_MESSAGE', 'Expected a run or cancel message.')] });
        return;
      }
      if (active) active.cancelled = true;
      const invalid = validateSweepRequest(message);
      if (invalid.length) {
        emit({ type: 'error', id, message: invalid.map(item => item.message).join(' '), diagnostics: invalid });
        return;
      }
      let request: SweepRequest;
      try {
        request = structuredClone({ id, circuit: message.circuit, startM: message.startM, stopM: message.stopM, points: message.points }) as SweepRequest;
      } catch {
        emit({ type: 'error', id, message: 'The sweep circuit could not be copied.', diagnostics: [diagnostic('INVALID_CIRCUIT', 'Sweep state must contain serializable data only.')] });
        return;
      }
      const job = { id, cancelled: false, completed: 0, total: request.points };
      active = job;
      void sweepCircuit(request, {
        ...options,
        isCancelled: () => job.cancelled || active !== job,
        onProgress: samples => {
          job.completed = samples.length;
          if (active === job && !job.cancelled) emit({ type: 'progress', id, completed: samples.length, total: request.points, samples });
        },
      }).then(result => {
        if (result.cancelled || job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: result.samples.length, total: request.points });
        else emit({ type: 'complete', id, request, samples: result.samples });
      }).catch(error => {
        if (job.cancelled || active !== job) emit({ type: 'cancelled', id, completed: job.completed, total: request.points });
        else {
          const message = error instanceof Error ? error.message : 'The wavelength sweep failed.';
          emit({ type: 'error', id, message, diagnostics: [diagnostic('SWEEP_FAILED', message)] });
        }
      }).finally(() => { if (active === job) active = undefined; });
    },
  };
}

const budgetKeys: (keyof PowerBudget)[] = ['emittedW', 'modelSuppliedW', 'detectedW', 'escapedW', 'componentAbsorbedW', 'returnedToSourceW', 'propagationLossW', 'imbalanceW'];
const csvCell = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Full-precision raw spectra and replayable SI state; empty cells mean unavailable. */
export function exportSweepCsv(request: SweepRequest, samples: readonly SweepSample[]): string {
  const ids = [...new Set([...request.circuit.components.filter(component => component.model === 'detector').map(component => component.id), ...samples.flatMap(sample => Object.keys(sample.detectors))])];
  const metadata = [
    '# schema: picsetup-spectrum/1',
    '# units: wavelength_m=m; detector_power_W=W; detector_phase_rad=rad; budget_*=W; residual=dimensionless',
    '# Empty detector/budget/residual fields indicate unavailable values; blank phase is undefined, never zero.',
    '# time_convention: Re{E exp(+i omega t)}; ports: one declared scalar guided mode per port; amplitudes: sqrt(W)',
    `# models: ${JSON.stringify(request.circuit.components.map(({ id, model, version }) => ({ id, model, version })))}`,
    ...(request.circuit.components.some(component => component.model === 'siepic-coupler') ? [`# dataset_provenance: ${JSON.stringify(datasetMetadata)}`] : []),
    `# request: ${JSON.stringify({ id: request.id, startM: request.startM, stopM: request.stopM, points: request.points, exportedSamples: samples.length })}`,
    `# circuit: ${JSON.stringify(request.circuit)}`,
  ];
  const headers = ['wavelength_m', 'ok', ...ids.flatMap(id => [`detector:${id}:power_W`, `detector:${id}:phase_rad`]), ...budgetKeys.map(key => `budget_${key.replace(/W$/, '_W')}`), 'residual', 'diagnostics_json'];
  const rows = samples.map(sample => [sample.wavelengthM, sample.ok, ...ids.flatMap(id => [sample.ok ? sample.detectors[id]?.powerW : null, sample.ok ? sample.detectors[id]?.phaseRad : null]), ...budgetKeys.map(key => sample.ok ? sample.budget?.[key] : null), sample.ok ? sample.residual : null, JSON.stringify(sample.diagnostics)].map(csvCell).join(','));
  // Metadata lines are prefixed comments. The following header/data records are CSV.
  return [...metadata, headers.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n';
}
