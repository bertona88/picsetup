import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDemoCircuit, solveCircuit } from '../src/physics.js';
import { createParameterLink } from '../src/analysis.js';
import {
  autoLayoutCircuit, importSemanticNetlist, makeSParameterComponent, parseSParameterData,
  semanticNetlist, toGdsfactoryPython, toSaxYAML
} from '../src/export.js';

test('semantic and workflow exports preserve topology, models, provenance, and links', () => {
  const circuit = makeDemoCircuit();
  createParameterLink(circuit, ['component:dc-1:gapUm', 'component:dc-2:gapUm'], { name: 'Matched gaps' });
  const netlist = semanticNetlist(circuit);
  assert.equal(netlist.format, 'picsetup-semantic-netlist');
  assert.equal(netlist.circuit.components.length, circuit.components.length);
  assert.equal(netlist.circuit.parameterLinks[0].name, 'Matched gaps');
  assert.ok(netlist.models['dc-1'].provenance);
  const roundtrip = importSemanticNetlist(netlist);
  assert.equal(roundtrip.connections.length, circuit.connections.length);

  const sax = toSaxYAML(circuit);
  assert.match(sax, /instances:/);
  assert.match(sax, /connections:/);
  assert.match(sax, /Map model names to your PDK/);

  const python = toGdsfactoryPython(circuit);
  assert.match(python, /def picsetup_layout/);
  assert.match(python, /semantic_connections/);
  assert.match(python, /not a foundry-ready layout/i);
});

test('JSON and CSV complex S-parameter tables import into a solved custom block', () => {
  const json = JSON.stringify({
    modelName: 'Measured pass-through',
    ports: [
      { id: 'left', label: 'L', role: 'optical', x: -48, y: 0 },
      { id: 'right', label: 'R', role: 'optical', x: 48, y: 0 }
    ],
    wavelengthsNm: [1500, 1600],
    matrices: [
      [[[0, 0], [1, 0]], [[1, 0], [0, 0]]],
      [[[0, 0], [0.8, 0.1]], [[0.8, 0.1], [0, 0]]]
    ]
  });
  const parsed = parseSParameterData(json, 'measured.json');
  assert.equal(parsed.sParameters.wavelengthsNm.length, 2);

  const csv = 'wavelength_nm,s11_re,s11_im,s12_re,s12_im,s21_re,s21_im,s22_re,s22_im\n1550,0,0,1,0,1,0,0,0\n';
  const parsedCsv = parseSParameterData(csv, 'measured.csv');
  assert.equal(parsedCsv.ports.length, 2);
  assert.equal(parsedCsv.sParameters.matrices[0][0][1][0], 1);

  const base = makeDemoCircuit();
  const source = base.components.find(component => component.type === 'source');
  const detector = base.components.find(component => component.id === 'det-1');
  const block = makeSParameterComponent(parsedCsv, { x: 500, y: 300 });
  block.id = 'sblock';
  source.x = 100; source.y = 300;
  detector.x = 900; detector.y = 300;
  const circuit = {
    version: 2, name: 'Imported S test',
    settings: { wavelengthNm: 1550, routingMode: 'schematic', worldToUm: 0.2 },
    components: [source, block, detector],
    connections: [
      { id: 'a', a: { component: source.id, port: 'out' }, b: { component: block.id, port: block.params.ports[0].id }, waypoints: [], params: { routingMode: 'schematic', schematicLengthUm: 0, lossDbPerCm: 0, neff: 2.42 } },
      { id: 'b', a: { component: block.id, port: block.params.ports[1].id }, b: { component: detector.id, port: 'in' }, waypoints: [], params: { routingMode: 'schematic', schematicLengthUm: 0, lossDbPerCm: 0, neff: 2.42 } }
    ], lab: { measurements: [] }
  };
  const result = solveCircuit(circuit);
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.detectedPowerMw - 1) < 1e-9);
});

test('auto-layout assigns finite positions to topology-only imports', () => {
  const circuit = makeDemoCircuit();
  circuit.components.forEach(component => { delete component.x; delete component.y; });
  autoLayoutCircuit(circuit);
  assert.ok(circuit.components.every(component => Number.isFinite(component.x) && Number.isFinite(component.y)));
});
