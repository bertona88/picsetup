import type { CircuitRecipe } from './recipe';
import iqTransmitter from '../../examples/recipes/ideal-iq-transmitter.json';

const mzi = (imported: boolean): CircuitRecipe => ({
  schema: 'picsetup-recipe/1', title: imported ? 'SiEPIC wavelength splitter' : 'Ideal wavelength splitter', wavelengthM: 1550e-9,
  parts: [
    { id: 'laser', model: 'source', params: { powerW: 0.001 } },
    { id: 'mzi', block: 'mzi', params: { couplerModel: imported ? 'siepic-coupler' : 'coupler', deltaLengthM: 20e-6, phaseRad: 0 } },
    { id: 'upper', model: 'detector' }, { id: 'lower', model: 'detector' },
  ],
  links: [{ from: 'laser.out', to: 'mzi.in0' }, { from: 'mzi.out0', to: 'upper.in' }, { from: 'mzi.out1', to: 'lower.in' }],
});
export const starterRecipe = mzi(true);
export const exampleRecipes: { id: string; title: string; description: string; recipe: CircuitRecipe }[] = [
  { id: 'imported-mzi', title: 'SiEPIC MZI', description: 'Two imported couplers with a 20 µm arm difference.', recipe: starterRecipe },
  { id: 'ideal-mzi', title: 'Ideal MZI', description: 'The same interferometer with ideal 50:50 couplers.', recipe: mzi(false) },
  { id: 'ideal-iq-transmitter', title: 'IQ transmitter', description: 'Two nested MZIs with static I/Q phases. One ideal scalar channel; no RF or gain.', recipe: iqTransmitter as CircuitRecipe },
  { id: 'ring', title: 'Ring resonator', description: 'A lossy single-bus ring; sweep to reveal sampled resonances.', recipe: {
    schema: 'picsetup-recipe/1', title: 'Ring transmission', wavelengthM: 1550e-9,
    parts: [{ id: 'laser', model: 'source' }, { id: 'ring', block: 'ring' }, { id: 'through', model: 'detector' }],
    links: [{ from: 'laser.out', to: 'ring.in' }, { from: 'ring.out', to: 'through.in' }],
  } },
  { id: 'splitter-tree', title: '1 × 4 splitter', description: 'A source feeding a balanced two-stage splitter tree.', recipe: {
    schema: 'picsetup-recipe/1', title: 'Four-way power splitter', wavelengthM: 1550e-9,
    parts: [{ id: 'laser', model: 'source' }, { id: 'tree', block: 'splitter-tree' }, ...[0, 1, 2, 3].map(index => ({ id: `out${index}`, model: 'detector' as const }))],
    links: [{ from: 'laser.out', to: 'tree.in' }, ...[0, 1, 2, 3].map(index => ({ from: `tree.out${index}`, to: `out${index}.in` }))],
  } },
  { id: 'delay-line', title: 'Delay line', description: 'Inspect phase and loss through a 100 µm guide.', recipe: {
    schema: 'picsetup-recipe/1', title: 'Delay and attenuation', wavelengthM: 1550e-9,
    parts: [{ id: 'laser', model: 'source' }, { id: 'delay', block: 'delay-line', params: { lengthM: 100e-6, attenuationDb: 3 } }, { id: 'out', model: 'detector' }],
    links: [{ from: 'laser.out', to: 'delay.in' }, { from: 'delay.out', to: 'out.in' }],
  } },
];
