import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curveLength, curveMinimumRadius, sampleCurve, polylineLength } from '../src/geometry.js';
import {
  connectionLengthUm, createHierarchicalBlock, expandHierarchicalBlock,
  makeDemoCircuit, solveCircuit, waveguideTransmission
} from '../src/physics.js';
import { buildModel, defaultParams, getPorts, listDefinitions } from '../src/models.js';

const distanceSum = points => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);

test('rendered cubic geometry and optical geometry are the same curve', () => {
  const points = [{ x: 0, y: 0 }, { x: 45, y: 0 }, { x: 55, y: 80 }, { x: 110, y: 80 }];
  const exact = curveLength(points);
  const dense = distanceSum(sampleCurve(points, 1000));
  assert.ok(Math.abs(exact - dense) / exact < 2e-5, `adaptive length ${exact} should match dense render sampling ${dense}`);
  assert.ok(Math.abs(exact - polylineLength(points)) > 0.1, 'curved route should not silently use control-polyline length');
  const bend = curveMinimumRadius(points, 256);
  assert.ok(Number.isFinite(bend.radius) && bend.radius > 0, 'curved route should have a finite bend radius');
  assert.equal(curveMinimumRadius([{ x: 0, y: 0 }, { x: 10, y: 0 }]).radius, Number.POSITIVE_INFINITY);
});

test('physical and schematic routing contracts are explicit', () => {
  const circuit = makeDemoCircuit();
  const connection = circuit.connections[1];
  const physical = connectionLengthUm(connection, circuit.components, circuit.settings);
  connection.params.routingMode = 'schematic';
  connection.params.schematicLengthUm = 432.1;
  assert.equal(connectionLengthUm(connection, circuit.components, circuit.settings), 432.1);
  connection.params.routingMode = 'physical';
  assert.ok(Math.abs(connectionLengthUm(connection, circuit.components, circuit.settings) - physical) < 1e-9);

  circuit.settings.minBendRadiusUm = 100;
  const transmission = waveguideTransmission(connection, circuit.components, 1550, circuit.settings);
  assert.equal(transmission.bendViolation, true);
  const result = solveCircuit(circuit);
  assert.ok(result.warnings.some(message => message.includes('bend radius')));
});

test('the model registry produces dimensionally valid compact models', () => {
  const definitions = listDefinitions();
  assert.ok(definitions.length >= 16, 'expanded registry should include the useful circuit library');
  for (const [index, definition] of definitions.entries()) {
    const component = { id: `c${index}`, type: definition.type, name: definition.label, x: 0, y: 0, params: defaultParams(definition.type) };
    const ports = getPorts(component);
    const model = buildModel(component, { wavelengthNm: 1550, extractBlockModel: null });
    assert.equal(model.ports.length, ports.length, `${definition.type}: port count`);
    assert.equal(model.scattering.length, ports.length, `${definition.type}: S rows`);
    assert.equal(model.s.length, ports.length, `${definition.type}: source vector`);
    model.scattering.forEach(row => assert.equal(row.length, ports.length, `${definition.type}: square S matrix`));
  }
});

test('hierarchy collapse and expansion preserve circuit response', () => {
  const circuit = makeDemoCircuit();
  const detectorIds = circuit.components.filter(component => component.type === 'detector').map(component => component.id);
  const powers = solve => detectorIds.map(id => solve.components.get(id).measurementMw);
  const before = powers(solveCircuit(circuit));
  const block = createHierarchicalBlock(circuit, ['dc-1', 'phase-1', 'dc-2'], { id: 'mzi-core', name: 'MZI core' });
  assert.equal(block.type, 'block');
  const collapsed = powers(solveCircuit(circuit));
  collapsed.forEach((value, index) => assert.ok(Math.abs(value - before[index]) < 1e-11));
  const expandedIds = expandHierarchicalBlock(circuit, block.id);
  assert.equal(expandedIds.length, 3);
  const expanded = powers(solveCircuit(circuit));
  expanded.forEach((value, index) => assert.ok(Math.abs(value - before[index]) < 1e-11));
});
