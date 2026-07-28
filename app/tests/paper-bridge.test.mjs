import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectionDomain, isOpticalConnection, makePaperFigureCircuit, solveCircuit
} from '../src/physics.js';
import {
  SETUP_PORT_SCHEMA, bridgeManifest, buildOpticalBridgePayload,
  decodeBridgePayload, encodeBridgePayload, opticalSetupBridgeUrl
} from '../src/bridge.js';
import { semanticNetlist, toGdsfactoryPython, toSaxYAML } from '../src/export.js';
import { getDefinition, getPorts } from '../src/models.js';
import { opticalSetupBoundaryFromBridge, readIncomingBridge } from '../integrations/opticalsetup/receiver-adapter.js';

test('paper hybrid template contains the publication and cross-domain vocabulary', () => {
  const circuit = makePaperFigureCircuit();
  const types = new Set(circuit.components.map(component => component.type));
  for (const type of [
    'chip-frame', 'image-panel', 'plot-panel', 'annotation', 'panel-label',
    'optical-bridge', 'edge-coupler', 'polarization-controller', 'rf-source',
    'electrical-amplifier', 'oscilloscope', 'controller', 'system-block'
  ]) assert.ok(types.has(type), `paper template should include ${type}`);

  const domains = new Set(circuit.connections.map(connection => connectionDomain(connection, circuit.components)));
  assert.deepEqual([...domains].sort(), ['control', 'electrical', 'optical', 'rf']);
  assert.equal(circuit.settings.figureMode, 'paper');
  assert.ok(circuit.components.filter(component => getDefinition(component.type).diagramOnly).length >= 5);
  const photocurrent = circuit.connections.find(connection => connection.id === 'wire-paper-2');
  assert.equal(photocurrent.label, 'photocurrent');
  assert.equal(photocurrent.params.arrow, 'end');
});

test('typed figure links remain outside the coherent optical solve', () => {
  const circuit = makePaperFigureCircuit();
  const result = solveCircuit(circuit);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);

  const optical = circuit.connections.filter(connection => isOpticalConnection(connection, circuit.components));
  const nonOptical = circuit.connections.filter(connection => !isOpticalConnection(connection, circuit.components));
  assert.equal(result.connections.size, optical.length);
  for (const connection of optical) assert.ok(result.connections.has(connection.id));
  for (const connection of nonOptical) assert.equal(result.connections.has(connection.id), false);
  assert.ok(nonOptical.some(connection => connectionDomain(connection, circuit.components) === 'electrical'));
  assert.ok(nonOptical.some(connection => connectionDomain(connection, circuit.components) === 'rf'));
  assert.ok(nonOptical.some(connection => connectionDomain(connection, circuit.components) === 'control'));

  const detector = circuit.components.find(component => component.id === 'det-paper');
  assert.deepEqual(getPorts(detector).map(port => port.role), ['optical', 'electrical']);
  assert.ok(Number.isFinite(result.components.get(detector.id).measurementMw));
});

test('OpticalSetup bridge payloads are versioned, explicit, and base64url round-trip safely', () => {
  const circuit = makePaperFigureCircuit();
  const solve = solveCircuit(circuit);
  const input = circuit.components.find(component => component.id === 'bridge-in');
  const output = circuit.components.find(component => component.id === 'bridge-out');

  const inPayload = buildOpticalBridgePayload(circuit, input, solve, { returnUrl: 'https://picsetup.com/#example' });
  const outPayload = buildOpticalBridgePayload(circuit, output, solve);
  assert.equal(inPayload.schema, SETUP_PORT_SCHEMA);
  assert.equal(inPayload.domain, 'optical');
  assert.equal(inPayload.direction, 'input');
  assert.equal(inPayload.kind, 'fiber-mode');
  assert.ok(inPayload.state.opticalPowerMw > 0);
  assert.equal(inPayload.returnUrl, 'https://picsetup.com/#example');
  assert.ok(inPayload.omissions.some(item => /spatial field|transverse field/i.test(item)));
  assert.equal(outPayload.direction, 'output');
  assert.equal(outPayload.kind, 'free-space-beam');
  assert.ok(outPayload.state.opticalPowerMw > 0);

  const encoded = encodeBridgePayload(outPayload);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeBridgePayload(encoded), outPayload);
  const url = new URL(opticalSetupBridgeUrl(outPayload));
  assert.equal(url.origin, 'https://opticalsetup.com');
  assert.equal(url.searchParams.get('bridgeSchema'), SETUP_PORT_SCHEMA);
  assert.deepEqual(decodeBridgePayload(url.searchParams.get('incomingBridge')), outPayload);
  assert.equal(bridgeManifest(circuit, solve).length, 2);
});


test('the companion OpticalSetup receiver adapter preserves the handoff without inventing spatial optics', () => {
  const circuit = makePaperFigureCircuit();
  const solve = solveCircuit(circuit);
  const output = circuit.components.find(component => component.id === 'bridge-out');
  const payload = buildOpticalBridgePayload(circuit, output, solve, { returnUrl: 'https://picsetup.com/#paper' });
  const url = opticalSetupBridgeUrl(payload);
  const received = readIncomingBridge(url);
  const boundary = opticalSetupBoundaryFromBridge(received);

  assert.equal(received.bridgeId, payload.bridgeId);
  assert.equal(boundary.role, 'source');
  assert.equal(boundary.type, 'free-space-interface');
  assert.equal(boundary.opticalPowerMw, payload.state.opticalSetupSidePowerMw);
  assert.equal(boundary.wavelengthNm, payload.state.wavelengthNm);
  assert.equal(boundary.bridge.returnUrl, 'https://picsetup.com/#paper');
  assert.equal(boundary.unresolvedSpatialState.beamWaistUm, null);
  assert.equal(boundary.unresolvedSpatialState.wavefront, 'unspecified');
});

test('semantic export preserves the complete figure graph while physical handoffs exclude it', () => {
  const circuit = makePaperFigureCircuit();
  const netlist = semanticNetlist(circuit);
  assert.equal(netlist.schemaVersion, 2);
  assert.equal(netlist.graphSummary.components, circuit.components.length);
  assert.equal(netlist.graphSummary.connections, circuit.connections.length);
  assert.equal(netlist.graphSummary.connectionDomains.optical, 9);
  assert.equal(netlist.graphSummary.connectionDomains.electrical, 3);
  assert.equal(netlist.graphSummary.connectionDomains.rf, 1);
  assert.equal(netlist.graphSummary.connectionDomains.control, 1);
  assert.equal(netlist.bridges.length, 2);
  assert.equal(netlist.models['det-paper'].ports.find(port => port.id === 'elec').domain, 'electrical');

  const sax = toSaxYAML(circuit);
  assert.doesNotMatch(sax, /image-paper:/);
  assert.doesNotMatch(sax, /rf-paper-1/);
  assert.match(sax, /Figure-only objects and non-optical links/);

  const python = toGdsfactoryPython(circuit);
  assert.doesNotMatch(python, /image-paper/);
  assert.doesNotMatch(python, /rf-paper-1/);
  assert.match(python, /not a foundry-ready layout/i);
});
