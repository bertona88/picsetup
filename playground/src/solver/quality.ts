import type { Diagnostic } from '../model/types';

export interface SampleQualityInput {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  /** Optional quantities required by the decision. Do not include intentionally undefined phase. */
  values?: readonly (number | null | undefined)[];
}
export interface SampleQuality { eligible: boolean; reasons: Diagnostic[] }

/**
 * Numerical eligibility for ranking or measurement, not a model-validation claim.
 * Original diagnostics and values are never repaired or clipped. Dataset provenance,
 * passivity and model-supplied-power warnings remain model qualifications, not solve
 * failures; callers must continue to expose them alongside any eligible result.
 */
export function assessSampleQuality({ ok, diagnostics, values = [] }: SampleQualityInput): SampleQuality {
  const reasons = diagnostics.filter(item => item.severity === 'error' || item.code === 'POWER_IMBALANCE' || item.code === 'SMALL_PIVOT').map(item => ({ ...item }));
  if (!ok && !reasons.length) reasons.push({ severity: 'error', code: 'SAMPLE_UNAVAILABLE', message: 'The solver did not produce an available result.' });
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) reasons.push({ severity: 'error', code: 'NONFINITE_MEASUREMENT', message: 'A quantity required for this decision is missing or nonfinite.' });
  return { eligible: ok && reasons.length === 0, reasons };
}
