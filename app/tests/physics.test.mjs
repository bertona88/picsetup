import assert from 'node:assert/strict';
import { couplerCoefficients, makeDemoCircuit, solveCircuit, defaultParams } from '../src/physics.js';

const coeff = couplerCoefficients({ gapUm: 0.2, interactionLengthUm: 20, insertionLossDb: 0 }, 1550);
assert.ok(Math.abs(coeff.throughPower - 0.5) < 1e-12, 'reference coupler should be 50:50');
assert.ok(Math.abs(coeff.throughPower + coeff.crossPower - 1) < 1e-12, 'lossless coupler should conserve power');

const direct = {
  version: 1,
  name: 'direct',
  settings: { wavelengthNm: 1550 },
  components: [
    { id: 's', type: 'source', name: 'S', x: 100, y: 100, params: { ...defaultParams('source'), powerMw: 1 } },
    { id: 'd', type: 'detector', name: 'D', x: 300, y: 100, params: defaultParams('detector') }
  ],
  connections: [{ id: 'w', a: { component: 's', port: 'out' }, b: { component: 'd', port: 'in' }, waypoints: [], params: { neff: 2.42, lossDbPerCm: 0 } }]
};
const directResult = solveCircuit(direct);
assert.equal(directResult.ok, true);
assert.ok(Math.abs(directResult.detectedPowerMw - 1) < 1e-9, 'lossless direct link should deliver all source power');
assert.ok(directResult.residual < 1e-9, 'network equation residual should be tiny');

const mzi = makeDemoCircuit();
mzi.components.forEach(component => {
  if (component.type === 'coupler') component.params.insertionLossDb = 0;
  if (component.type === 'phase') component.params.lossDb = 0;
});
mzi.connections.forEach(connection => { connection.params.lossDbPerCm = 0; });
const resultA = solveCircuit(mzi);
assert.equal(resultA.ok, true);
assert.ok(Math.abs(resultA.detectedPowerMw - 1) < 1e-8, 'lossless MZI detector sum should conserve power');
const outputsA = mzi.components.filter(c => c.type === 'detector').map(c => resultA.components.get(c.id).measurementMw);
mzi.components.find(c => c.type === 'phase').params.phaseRad += 0.8;
const resultB = solveCircuit(mzi);
const outputsB = mzi.components.filter(c => c.type === 'detector').map(c => resultB.components.get(c.id).measurementMw);
assert.ok(Math.abs(outputsA[0] - outputsB[0]) > 0.05, 'phase change should move measurable output power');
assert.ok(Math.abs(resultB.detectedPowerMw - 1) < 1e-8, 'phase tuning should preserve total power in lossless MZI');

console.log('physics tests passed');
