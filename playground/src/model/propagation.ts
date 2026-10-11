import { polar } from './complex';
import type { Complex, Connection, Diagnostic } from './types';
import manifest from '../../models/siepic-strip-500x220-te/manifest.json';

export const SPEED_OF_LIGHT = 299792458;

/** Pinned coefficient model; the evaluation window is an application assumption. */
export const waveguideMetadata = Object.freeze({
  id: 'siepic-strip-500x220-te' as const,
  version: '1' as const,
  title: 'SiEPIC strip waveguide, 500 × 220 nm, TE',
  referenceWavelengthM: 1.55e-6,
  neff: 2.44553,
  groupIndex: 4.19088,
  dispersionCoefficient: 0.000354275,
  dispersionCoefficientUnit: 's/m²',
  evaluationWindowM: Object.freeze([1500e-9, 1600e-9] as const),
  evaluationWindowBasis: 'Declared application evaluation assumption; the source supplies no validated fit band.',
  polarization: 'TE',
  widthM: 500e-9,
  heightM: 220e-9,
  source: Object.freeze({ ...manifest.source }),
  limitations: Object.freeze([
    'Frequency-quadratic reduced-order propagation, not a calibrated device prediction.',
    'Source fit band, temperature, process corner, spatial mode fields and uncertainty are unknown.',
    'Loss is independently user-declared; bends, heaters and geometric transitions are absent.',
    'Guide ends are abstract connection planes; physical mode matching to the bundled coupler is unqualified.',
  ]),
});

type PropagationLine = Pick<Connection, 'lengthM' | 'lossDbPerM' | 'neff'> & { id?: string; waveguide?: unknown };
export interface PropagationResult {
  h: Complex;
  betaRadPerM: number;
  effectiveIndex: number;
  groupIndex: number;
  groupDelayS: number;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** β(ω) is the pinned upstream quadratic. Canonical transmission is exp(-i β L). */
function coefficients(line: PropagationLine, wavelengthM: number): Omit<PropagationResult, 'h' | 'groupDelayS'> {
  if (line.waveguide === undefined) return { betaRadPerM: 2 * Math.PI * line.neff / wavelengthM, effectiveIndex: line.neff, groupIndex: line.neff };
  const { referenceWavelengthM: lambda0, neff: ne, groupIndex: ng, dispersionCoefficient: nd } = waveguideMetadata;
  const deltaOmega = 2 * Math.PI * SPEED_OF_LIGHT * (1 / wavelengthM - 1 / lambda0);
  const betaRadPerM = 2 * Math.PI * ne / lambda0 + ng / SPEED_OF_LIGHT * deltaOmega
    - nd * lambda0 ** 2 / (4 * Math.PI * SPEED_OF_LIGHT) * deltaOmega ** 2;
  return {
    betaRadPerM,
    effectiveIndex: betaRadPerM * wavelengthM / (2 * Math.PI),
    groupIndex: ng - nd * lambda0 ** 2 / (2 * Math.PI) * deltaOmega,
  };
}

/** Keeps imported out-of-window circuits editable while giving the solver structured errors. */
export function validatePropagation(line: PropagationLine, wavelengthM: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, message: string) => diagnostics.push({ severity: 'error' as const, code, message, ...(line.id ? { connectionId: line.id } : {}) });
  if (!finite(line.lengthM) || line.lengthM < 0 || !finite(line.lossDbPerM) || line.lossDbPerM < 0 || !finite(line.neff) || line.neff <= 0) {
    error('INVALID_PROPAGATION', 'Length (m) and loss (dB/m) must be finite and nonnegative; effective index must be finite and positive.');
    return diagnostics;
  }
  if (line.waveguide !== undefined) {
    const reference = line.waveguide;
    if (!record(reference) || Object.keys(reference).length !== 2 || reference.model !== waveguideMetadata.id || reference.version !== waveguideMetadata.version) {
      error('UNSUPPORTED_WAVEGUIDE', 'Waveguide reference must contain exactly model siepic-strip-500x220-te and version 1.');
      return diagnostics;
    }
    if (line.neff !== waveguideMetadata.neff) error('WAVEGUIDE_INDEX_MISMATCH', `The dispersive model fixes the reference effective index at ${waveguideMetadata.neff}; remove its reference to use a constant custom index.`);
    const [lower, upper] = waveguideMetadata.evaluationWindowM;
    if (finite(wavelengthM) && wavelengthM > 0 && (wavelengthM < lower || wavelengthM > upper)) error('WAVEGUIDE_OUT_OF_BAND', 'This waveguide is restricted to the declared 1500–1600 nm evaluation window. This is an application assumption, not a source-validated fit band.');
  }
  if (finite(wavelengthM) && wavelengthM > 0 && !diagnostics.length) {
    const { betaRadPerM, groupIndex } = coefficients(line, wavelengthM);
    const phase = line.waveguide === undefined ? 2 * Math.PI * line.neff * line.lengthM / wavelengthM : betaRadPerM * line.lengthM;
    const invalidDelay = line.waveguide !== undefined && !Number.isFinite(groupIndex / SPEED_OF_LIGHT * line.lengthM);
    if (!Number.isFinite(line.lengthM * line.lossDbPerM) || !Number.isFinite(phase) || invalidDelay) {
      error('PROPAGATION_OVERFLOW', 'Propagation phase, delay or attenuation exceeds the numerical range.');
    }
  }
  return diagnostics;
}

export function evaluatePropagation(line: PropagationLine, wavelengthM: number): PropagationResult {
  if (!finite(wavelengthM) || wavelengthM <= 0) throw new Error('Vacuum wavelength must be finite and positive metres.');
  const errors = validatePropagation(line, wavelengthM);
  if (errors.length) throw new Error(errors.map(error => error.message).join(' '));
  const values = coefficients(line, wavelengthM);
  // Preserve exactly the historical arithmetic ordering for constant-index paths.
  const phase = line.waveguide === undefined ? -2 * Math.PI * line.neff * line.lengthM / wavelengthM : -values.betaRadPerM * line.lengthM;
  return { ...values, h: polar(10 ** (-line.lossDbPerM * line.lengthM / 20), phase), groupDelayS: values.groupIndex / SPEED_OF_LIGHT * line.lengthM };
}
