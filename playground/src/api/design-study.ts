import { compileRecipe, type CircuitRecipe } from './recipe';
import { addVariant, createNotebook, setStudy, setSweep, type StudyNotebook } from '../experiments/notebook';
import { waveguideMetadata } from '../model/propagation';

/** A controlled comparison: phase matched at λ0, then change dispersion and arm difference. */
export function createMziDesignStudy(): StudyNotebook {
 const wavelengthM = waveguideMetadata.referenceWavelengthM;
 const designs = [
  { name: 'A · Constant index · ΔL 20 µm', dispersive: false, deltaLengthM: 20e-6 },
  { name: 'B · Dispersive guide · ΔL 20 µm', dispersive: true, deltaLengthM: 20e-6 },
  { name: 'C · Dispersive guide · ΔL 10 µm', dispersive: true, deltaLengthM: 10e-6 },
 ];
 let notebook = createNotebook(undefined, 'Does the design survive dispersion?');
 for (const design of designs) {
  const phaseRad = (2 * Math.PI * waveguideMetadata.neff * design.deltaLengthM / wavelengthM + Math.PI) % (2 * Math.PI);
  const recipe: CircuitRecipe = {
   schema: 'picsetup-recipe/1', title: design.name, wavelengthM,
   parts: [
    { id: 'laser', model: 'source', params: { powerW: 0.001 } },
    { id: 'mzi', block: 'mzi', params: { couplerModel: 'siepic-coupler', guideModel: design.dispersive ? waveguideMetadata.id : 'constant-index', neff: waveguideMetadata.neff, deltaLengthM: design.deltaLengthM, phaseRad, lossDbPerM: 100 } },
    { id: 'desired', model: 'detector', label: 'Desired output' },
    { id: 'unwanted', model: 'detector', label: 'Unwanted output' },
   ],
   links: [{ from: 'laser.out', to: 'mzi.in0' }, { from: 'mzi.out0', to: 'desired.in' }, { from: 'mzi.out1', to: 'unwanted.in' }],
  };
  notebook = addVariant(notebook, compileRecipe(recipe), design.name);
 }
 notebook = setSweep(notebook, { startM: 1545e-9, stopM: 1555e-9, points: 101 });
 return setStudy(notebook, {
  schema: 'picsetup-study/1', baselineVariantId: notebook.variants[0].id,
  outputs: notebook.variants.map(variant => ({ variantId: variant.id, desiredDetectorId: 'desired', unwantedDetectorId: 'unwanted' })),
  targets: { maxInsertionLossDb: 1.5, maxCrosstalkDb: -8 },
  phaseScenarios: [-0.08, 0.08].map((phaseOffsetRad, index) => ({ id: `phase-${index + 1}`, name: `Assumed phase error ${phaseOffsetRad > 0 ? '+' : ''}${phaseOffsetRad} rad`, offsets: notebook.variants.map(variant => ({ variantId: variant.id, componentId: 'mzi__phase', phaseOffsetRad })) })),
 });
}
