import { blockCatalog } from '../blocks';
import { datasetMetadata } from '../model/dataset';
import { defaultParams, MODEL_IDS, portNames } from '../model/registry';
import type { ModelId } from '../model/types';
import { recipeKeys, recipeObject } from './recipe';
import { waveguideMetadata } from '../model/propagation';

export interface CatalogFilter { kind?: 'model' | 'block' | 'waveguide'; modelKind?: 'analytical' | 'dataset' | 'composition' | 'coefficient-model'; mode?: 'TE' | 'TE0' | 'TE mode 1'; wavelengthM?: number; query?: string }
const modelDescriptions: Record<ModelId, [string, string]> = {
  source: ['Coherent source', 'One scalar TE0 source. Returning fields are absorbed; power is in W.'],
  coupler: ['Ideal directional coupler', 'Reciprocal lossless four-port analytical coupler with power coupling K.'],
  'siepic-coupler': ['SiEPIC directional coupler', 'Experimental fixed 200 nm gap, 10 µm coupling length; native TE mode 1 dataset.'],
  phase: ['Phase shifter', 'Reciprocal analytical exp(-i phaseRad) transmission.'],
  attenuator: ['Attenuator', 'Reciprocal analytical loss, specified in dB.'],
  detector: ['Power detector', 'Matched scalar port measuring incoming power and phase.'],
  termination: ['Matched termination', 'Absorbs incident power with zero reflected field.'],
};
const units: Record<string, string> = { powerW: 'W', phaseRad: 'rad', coupling: 'dimensionless', attenuationDb: 'dB' };
const limits: Record<string, { min?: number; max?: number }> = { powerW: { min: 0 }, coupling: { min: 0, max: 1 }, attenuationDb: { min: 0 } };

/** Fresh JSON metadata for bundled exact-version models and compositional blocks. */
export function queryCatalog(filter: CatalogFilter = {}) {
  const value = recipeObject(filter, 'catalog filter');
  recipeKeys(value, [], ['kind', 'modelKind', 'mode', 'wavelengthM', 'query'], 'catalog filter');
  if (filter.kind !== undefined && !['model', 'block', 'waveguide'].includes(filter.kind)) throw new Error('Catalog kind must be model, block or waveguide.');
  if (filter.modelKind !== undefined && !['analytical', 'dataset', 'composition', 'coefficient-model'].includes(filter.modelKind)) throw new Error('Catalog modelKind must be analytical, dataset, composition or coefficient-model.');
  if (filter.mode !== undefined && !['TE', 'TE0', 'TE mode 1'].includes(filter.mode)) throw new Error('Catalog mode must be TE, TE0 or the native label TE mode 1.');
  if (filter.wavelengthM !== undefined && (!Number.isFinite(filter.wavelengthM) || filter.wavelengthM <= 0)) throw new Error('Catalog wavelengthM must be positive finite metres.');
  if (filter.query !== undefined && (typeof filter.query !== 'string' || filter.query.length > 200)) throw new Error('Catalog query must be text of at most 200 characters.');
  const entries = [
    { kind: 'waveguide' as const, id: waveguideMetadata.id, version: waveguideMetadata.version,
      title: waveguideMetadata.title, description: 'Pinned frequency-quadratic TE strip propagation. Select on a connection; length and loss remain explicit.',
      placement: 'connection.waveguide', reference: { model: waveguideMetadata.id, version: waveguideMetadata.version },
      ports: ['L', 'R'], mode: 'TE', polarization: 'TE', sourceModeId: null,
      defaultParams: { lengthM: 100e-6, lossDbPerM: 0, neff: waveguideMetadata.neff },
      parameters: { lengthM: { type: 'number', default: 100e-6, unit: 'm', min: 0 }, lossDbPerM: { type: 'number', default: 0, unit: 'dB/m', min: 0 }, neff: { type: 'number', default: waveguideMetadata.neff, unit: '1', fixed: true } },
      wavelengthRangeM: [...waveguideMetadata.evaluationWindowM], wavelengthRangeBasis: waveguideMetadata.evaluationWindowBasis,
      coefficients: { referenceWavelengthM: waveguideMetadata.referenceWavelengthM, neff: waveguideMetadata.neff, groupIndex: waveguideMetadata.groupIndex, dispersionCoefficient: waveguideMetadata.dispersionCoefficient, dispersionCoefficientUnit: waveguideMetadata.dispersionCoefficientUnit },
      geometry: { widthM: waveguideMetadata.widthM, heightM: waveguideMetadata.heightM },
      provenance: { kind: 'coefficient-model', source: waveguideMetadata.source, limits: [...waveguideMetadata.limitations] },
    },
    ...MODEL_IDS.map(model => ({
      kind: 'model' as const, id: model, version: '1' as const,
      title: modelDescriptions[model][0], description: modelDescriptions[model][1],
      ports: portNames(model), defaultParams: defaultParams(model),
      parameters: Object.fromEntries(Object.entries(defaultParams(model)).map(([name, value]) => [name, { type: 'number', default: value, unit: units[name], ...limits[name] }])),
      mode: model === 'siepic-coupler' ? 'TE mode 1' : 'TE0', polarization: 'TE', sourceModeId: model === 'siepic-coupler' ? 1 : null,
      wavelengthRangeM: model === 'siepic-coupler' ? datasetMetadata.wavelengthRangeNm.map(nm => nm * 1e-9) : null,
      provenance: model === 'siepic-coupler'
        ? { kind: 'dataset', sourceUrl: datasetMetadata.sourceUrl, datasetId: datasetMetadata.datasetId, datasetVersion: datasetMetadata.modelVersion, sha256: datasetMetadata.sourceSha256,
          limits: ['Native mode ID 1 is not a transverse-order TE1 identification; spatial mode overlap is unqualified.', 'Complex Cartesian interpolation in frequency; no extrapolation.', 'Native reference-plane coordinates and process uncertainty are unknown.', 'Some samples violate passivity slightly; values are preserved and diagnostics remain visible.'] }
        : { kind: 'analytical', sourceUrl: null, limits: ['Reduced scalar TE0 model; not a calibrated device or fabrication layout.'] },
    })),
    ...blockCatalog.map(block => ({ ...block, kind: 'block' as const, version: '1' as const, mode: 'TE0', polarization: 'TE', sourceModeId: null, wavelengthRangeM: null,
      provenance: { kind: 'composition', sourceUrl: null, limits: ['Source-free analytical default; selecting SiEPIC couplers restricts the wavelength band to the bundled dataset.', 'Expansion retains independently editable primitive components.'] } })),
  ];
  const query = filter.query?.toLocaleLowerCase();
  return structuredClone(entries.filter(entry =>
    (!filter.kind || entry.kind === filter.kind)
    && (!filter.modelKind || entry.provenance.kind === filter.modelKind)
    && (!filter.mode || filter.mode === 'TE' || entry.mode === filter.mode)
    && (filter.wavelengthM === undefined || !entry.wavelengthRangeM || filter.wavelengthM >= entry.wavelengthRangeM[0] && filter.wavelengthM <= entry.wavelengthRangeM[1])
    && (!query || `${entry.id} ${entry.title} ${entry.description}`.toLocaleLowerCase().includes(query))));
}
