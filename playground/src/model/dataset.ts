import data from '../../models/siepic-dc-200nm-10um/data.json';
import type { Complex } from './types';

const C = 299_792_458;
const frequencies = data.frequencyHz;
const minFrequency = frequencies[0];
const maxFrequency = frequencies[frequencies.length - 1];

/** Adapter version 1 permanently resolves this exact dataset/version/hash. */
export const datasetMetadata = {
  title: 'SiEPIC directional coupler',
  datasetId: data.id,
  modelVersion: data.version,
  sourceSha256: data.metadata.sourceSha256,
  wavelengthRangeNm: [C / maxFrequency * 1e9, C / minFrequency * 1e9] as [number, number],
  sourceUrl: `https://github.com/BYUCamachoLab/simphony/blob/${data.metadata.sourceCommit}/simphony/libraries/siepic/source_data/ebeam_dc_te1550/dc_gap%3D200nm_Lc%3D10um.sparam`,
  geometry: ['200 nm gap', '10 µm coupling length', 'TE · mode 1'],
};

/** Complex Cartesian interpolation in frequency, never geometry or extrapolation. */
export function evaluateDataset(wavelengthM: number): Complex[][] {
  if (!Number.isFinite(wavelengthM) || wavelengthM <= 0) throw new RangeError('Dataset wavelength must be finite and positive.');
  const frequency = C / wavelengthM;
  // Only absorb floating point round-trip error when λ was computed from a grid endpoint.
  const tolerance = maxFrequency * 4 * Number.EPSILON;
  if (frequency < minFrequency - tolerance || frequency > maxFrequency + tolerance) {
    throw new RangeError(`Outside dataset band: ${datasetMetadata.wavelengthRangeNm[0].toFixed(6)}–${datasetMetadata.wavelengthRangeNm[1].toFixed(6)} nm. No extrapolation.`);
  }
  const f = Math.max(minFrequency, Math.min(maxFrequency, frequency));
  let low = 0, high = frequencies.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (frequencies[mid] <= f) low = mid; else high = mid;
  }
  const weight = (f - frequencies[low]) / (frequencies[high] - frequencies[low]);
  return data.s[low].map((row, output) => row.map((a, input) => {
    const b = data.s[high][output][input];
    return { re: a.re + weight * (b.re - a.re), im: a.im + weight * (b.im - a.im) };
  }));
}

// This fixed dataset has exact mirror symmetry: a,b,t,q arranged by XOR indices.
// A real orthogonal Hadamard basis diagonalizes it, including interpolated S.
// Thus the largest |eigenvalue| is its exact spectral norm (no power iteration).
for (const matrix of data.s) {
  for (let out = 0; out < 4; out++) for (let input = 0; input < 4; input++) {
    const a = matrix[out][input], b = matrix[0][out ^ input];
    if (a.re !== b.re || a.im !== b.im) throw new Error('Bundled SiEPIC symmetry changed; passivity evaluator must be reviewed.');
  }
}
export function datasetSigmaMax(wavelengthM: number): number {
  const row = evaluateDataset(wavelengthM)[0];
  return Math.max(...[[1, 1, 1, 1], [1, -1, 1, -1], [1, 1, -1, -1], [1, -1, -1, 1]].map(signs => {
    const value = row.reduce((sum, entry, i) => ({ re: sum.re + signs[i] * entry.re, im: sum.im + signs[i] * entry.im }), { re: 0, im: 0 });
    return Math.hypot(value.re, value.im);
  }));
}
