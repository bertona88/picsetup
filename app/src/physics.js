import {
  C, add, sub, mul, scale, abs2, arg, expi,
  zeroMatrix, zeros, identityMatrix, matrixMultiply,
  matrixVectorMultiply, solveLinearSystem
} from './complex.js';
import { curveLength, curveMinimumRadius, polylineLength } from './geometry.js';
import {
  COMPONENT_PORTS, DEFAULT_WAVELENGTH_NM, buildModel, couplerCoefficients,
  couplingCoefficient, defaultParams, getDefinition, getPorts, listDefinitions
} from './models.js';

export { COMPONENT_PORTS, DEFAULT_WAVELENGTH_NM, couplerCoefficients, couplingCoefficient, defaultParams, getDefinition, listDefinitions };

export const DEFAULT_WORLD_TO_UM = 0.2;
export const WORLD_TO_UM = DEFAULT_WORLD_TO_UM;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clone = value => structuredClone(value);
const endpointKey = endpoint => `${endpoint.component}:${endpoint.port}`;

function endpointPort(endpoint, components) {
  const component = components.find(item => item.id === endpoint?.component);
  if (!component) return null;
  return getPorts(component).find(port => port.id === endpoint?.port) ?? null;
}

export function connectionDomain(connection, components = []) {
  const declared = String(connection?.domain ?? '').toLowerCase();
  if (['optical', 'electrical', 'rf', 'control', 'annotation'].includes(declared)) return declared;
  return endpointPort(connection?.a, components)?.role ?? endpointPort(connection?.b, components)?.role ?? 'optical';
}

export function isOpticalConnection(connection, components = []) {
  return connectionDomain(connection, components) === 'optical';
}

export function componentPorts(component) {
  const ports = getPorts(component);
  const angle = (component.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return ports.map(port => ({
    ...port,
    x: component.x + port.x * cos - port.y * sin,
    y: component.y + port.x * sin + port.y * cos
  }));
}

export function portPosition(component, portId) {
  return componentPorts(component).find(port => port.id === portId) ?? null;
}

export function getConnectionPoints(connection, components) {
  const aComponent = components.find(item => item.id === connection.a.component);
  const bComponent = components.find(item => item.id === connection.b.component);
  if (!aComponent || !bComponent) return [];
  const start = portPosition(aComponent, connection.a.port);
  const end = portPosition(bComponent, connection.b.port);
  if (!start || !end) return [];
  const middle = Array.isArray(connection.waypoints) ? connection.waypoints : [];
  if (middle.length) return [{ x: start.x, y: start.y }, ...middle.map(point => ({ x: point.x, y: point.y })), { x: end.x, y: end.y }];

  const dx = end.x - start.x;
  const bend = Math.max(36, Math.min(150, Math.abs(dx) * 0.34));
  const direction = Math.sign(dx || 1);
  return [
    { x: start.x, y: start.y },
    { x: start.x + direction * bend, y: start.y },
    { x: end.x - direction * bend, y: end.y },
    { x: end.x, y: end.y }
  ];
}

export { polylineLength };

export function connectionLengthUm(connection, components, settings = {}) {
  const routingMode = connection.params?.routingMode ?? settings.routingMode ?? 'physical';
  if (routingMode === 'schematic') {
    const explicit = Number(connection.params?.schematicLengthUm ?? connection.params?.lengthOverrideUm);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  }
  const worldToUm = Math.max(1e-6, Number(connection.params?.worldToUm ?? settings.worldToUm ?? DEFAULT_WORLD_TO_UM));
  return curveLength(getConnectionPoints(connection, components)) * worldToUm;
}

export function waveguideTransmission(connection, components, wavelengthNm = DEFAULT_WAVELENGTH_NM, settings = {}) {
  const params = connection.params ?? {};
  const routingMode = params.routingMode ?? settings.routingMode ?? 'physical';
  const lengthUm = connectionLengthUm(connection, components, settings);
  const neff = Number(params.neff ?? 2.42);
  const lossDbPerCm = Math.max(0, Number(params.lossDbPerCm ?? 2));
  const wavelengthUm = Math.max(1e-9, wavelengthNm / 1000);
  const phase = -2 * Math.PI * neff * lengthUm / wavelengthUm;
  const amplitude = Math.pow(10, -(lossDbPerCm * (lengthUm / 10000)) / 20);
  const worldToUm = Math.max(1e-6, Number(params.worldToUm ?? settings.worldToUm ?? DEFAULT_WORLD_TO_UM));
  const bend = routingMode === 'physical' ? curveMinimumRadius(getConnectionPoints(connection, components)) : null;
  const minimumBendRadiusUm = bend && Number.isFinite(bend.radius) ? bend.radius * worldToUm : Number.POSITIVE_INFINITY;
  const requiredBendRadiusUm = Math.max(0, Number(params.minBendRadiusUm ?? settings.minBendRadiusUm ?? 0));
  return {
    value: scale(expi(phase), amplitude), lengthUm, neff, lossDbPerCm,
    phase, amplitude, powerTransmission: amplitude * amplitude,
    routingMode, minimumBendRadiusUm, requiredBendRadiusUm,
    bendViolation: routingMode === 'physical' && Number.isFinite(minimumBendRadiusUm) && minimumBendRadiusUm + 1e-9 < requiredBendRadiusUm,
    bendPoint: bend?.point ?? null
  };
}

function buildEntries(components, wavelengthNm, extractBlockModel) {
  const entries = [];
  const indexByKey = new Map();
  const modelByComponent = new Map();
  for (const component of components) {
    const model = buildModel(component, { wavelengthNm, extractBlockModel });
    modelByComponent.set(component.id, model);
    model.ports.forEach((port, localIndex) => {
      if ((port.role ?? 'optical') !== 'optical') return;
      const index = entries.length;
      const key = `${component.id}:${port.id}`;
      entries.push({ index, key, component, port, localIndex });
      indexByKey.set(key, index);
    });
  }
  return { entries, indexByKey, modelByComponent };
}

function assembleNetwork(components, connections, settings, wavelengthNm, warnings, blockStack = []) {
  const extractBlockModel = (component, lambda) => extractBlockScattering(component, lambda, warnings, blockStack);
  const { entries, indexByKey, modelByComponent } = buildEntries(components, wavelengthNm, extractBlockModel);
  const n = entries.length;
  const S = zeroMatrix(n);
  const sourceVector = zeros(n);

  for (const component of components) {
    const model = modelByComponent.get(component.id);
    const componentEntries = entries.filter(entry => entry.component.id === component.id);
    for (const rowEntry of componentEntries) {
      sourceVector[rowEntry.index] = model.s[rowEntry.localIndex] ?? C();
      for (const colEntry of componentEntries) {
        S[rowEntry.index][colEntry.index] = model.scattering[rowEntry.localIndex]?.[colEntry.localIndex] ?? C();
      }
    }
  }

  const Cmatrix = zeroMatrix(n);
  const connectionData = new Map();
  const occupied = new Set();
  for (const connection of connections) {
    if (!isOpticalConnection(connection, components)) continue;
    const ai = indexByKey.get(endpointKey(connection.a));
    const bi = indexByKey.get(endpointKey(connection.b));
    if (ai === undefined || bi === undefined) {
      warnings.push(`Optical connection ${connection.id} has a missing or non-optical endpoint.`);
      continue;
    }
    if (occupied.has(ai) || occupied.has(bi)) {
      warnings.push(`An optical port is connected more than once near ${connection.id}.`);
      continue;
    }
    occupied.add(ai);
    occupied.add(bi);
    const transmission = waveguideTransmission(connection, components, wavelengthNm, settings);
    if (transmission.bendViolation) warnings.push(`Waveguide ${connection.id} reaches ${transmission.minimumBendRadiusUm.toFixed(2)} µm bend radius, below the declared ${transmission.requiredBendRadiusUm.toFixed(2)} µm minimum. The compact model does not add bend loss automatically.`);
    Cmatrix[bi][ai] = transmission.value;
    Cmatrix[ai][bi] = transmission.value;
    connectionData.set(connection.id, { ai, bi, transmission });
  }

  const SC = matrixMultiply(S, Cmatrix);
  const A = identityMatrix(n);
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) A[row][col] = sub(A[row][col], SC[row][col]);
  }
  return { entries, indexByKey, modelByComponent, S, sourceVector, Cmatrix, connectionData, occupied, A };
}

function extractBlockScattering(component, wavelengthNm, warnings = [], stack = []) {
  const ports = getPorts(component);
  const subcircuit = component.params?.subcircuit;
  if (!subcircuit?.components || !Array.isArray(subcircuit.connections)) {
    return { ports, scattering: zeroMatrix(ports.length), s: zeros(ports.length) };
  }
  if (stack.includes(component.id)) {
    warnings.push(`Hierarchy loop detected in ${component.name ?? component.id}.`);
    return { ports, scattering: zeroMatrix(ports.length), s: zeros(ports.length) };
  }
  if (subcircuit.components.some(item => item.type === 'source')) {
    warnings.push(`${component.name ?? component.id} contains a source; active hierarchical extraction is not supported.`);
    return { ports, scattering: zeroMatrix(ports.length), s: zeros(ports.length) };
  }

  const localWarnings = [];
  const network = assembleNetwork(
    subcircuit.components,
    subcircuit.connections,
    subcircuit.settings ?? {},
    wavelengthNm,
    localWarnings,
    [...stack, component.id]
  );
  warnings.push(...localWarnings.map(message => `${component.name ?? component.id}: ${message}`));
  const scattering = zeroMatrix(ports.length);
  const boundaryIndices = ports.map(port => network.indexByKey.get(endpointKey(port.internalEndpoint ?? {})));
  if (boundaryIndices.some(index => index === undefined)) {
    warnings.push(`${component.name ?? component.id} has an invalid hierarchical boundary port.`);
    return { ports, scattering, s: zeros(ports.length) };
  }

  for (let input = 0; input < ports.length; input += 1) {
    const externalIncoming = zeros(network.entries.length);
    externalIncoming[boundaryIndices[input]] = C(1, 0);
    const rhs = matrixVectorMultiply(network.S, externalIncoming);
    const b = solveLinearSystem(network.A, rhs);
    if (!b) {
      warnings.push(`${component.name ?? component.id} could not be reduced at ${wavelengthNm.toFixed(2)} nm.`);
      continue;
    }
    for (let output = 0; output < ports.length; output += 1) scattering[output][input] = b[boundaryIndices[output]];
  }
  return { ports, scattering, s: zeros(ports.length) };
}

function componentPowerSummary(component, result) {
  const incomingMw = Object.values(result.ports).reduce((sum, port) => sum + port.incomingPowerMw, 0);
  const outgoingMw = Object.values(result.ports).reduce((sum, port) => sum + port.outgoingPowerMw, 0);
  const generatedMw = result.model.s.reduce((sum, value) => sum + abs2(value), 0);
  return { incomingMw, outgoingMw, generatedMw, netDissipationMw: incomingMw + generatedMw - outgoingMw };
}

export function solveCircuit(circuit, options = {}) {
  const started = performance.now();
  const components = circuit.components ?? [];
  const connections = circuit.connections ?? [];
  const opticalConnections = connections.filter(connection => isOpticalConnection(connection, components));
  const sources = components.filter(component => {
    const definition = getDefinition(component.type);
    return component.type === 'source' || (definition.sourceBoundary && ['input', 'bidirectional'].includes(component.params?.direction));
  });
  const wavelengthNm = Number(options.wavelengthNm ?? circuit.settings?.wavelengthNm ?? sources[0]?.params?.wavelengthNm ?? DEFAULT_WAVELENGTH_NM);
  const warnings = [];
  const network = assembleNetwork(components, opticalConnections, circuit.settings ?? {}, wavelengthNm, warnings);
  const b = solveLinearSystem(network.A, network.sourceVector);

  if (!b) {
    return {
      ok: false,
      error: 'The circuit equations are singular. Check ideal feedback loops, invalid imported S matrices, or incompatible connections.',
      warnings, wavelengthNm, elapsedMs: performance.now() - started,
      portEntries: network.entries, portIndex: network.indexByKey,
      a: zeros(network.entries.length), b: zeros(network.entries.length),
      components: new Map(), connections: new Map(),
      sourcePowerMw: 0, detectedPowerMw: 0, residual: Number.POSITIVE_INFINITY,
      powerBudget: null
    };
  }

  const a = matrixVectorMultiply(network.Cmatrix, b);
  const componentResults = new Map();
  for (const component of components) {
    const model = network.modelByComponent.get(component.id);
    const definition = getDefinition(component.type);
    const ports = {};
    model.ports.forEach(port => {
      const index = network.indexByKey.get(`${component.id}:${port.id}`);
      const incoming = index === undefined ? C() : (a[index] ?? C());
      const outgoing = index === undefined ? C() : (b[index] ?? C());
      ports[port.id] = {
        domain: port.role ?? 'optical', medium: port.medium ?? null,
        incoming, outgoing,
        incomingPowerMw: abs2(incoming), outgoingPowerMw: abs2(outgoing),
        incomingPhaseRad: arg(incoming), outgoingPhaseRad: arg(outgoing)
      };
    });
    const opticalPorts = Object.values(ports).filter(port => port.domain === 'optical');
    let measurementMw = 0;
    if (definition.detector || definition.termination || definition.bridge) measurementMw = opticalPorts.reduce((sum, port) => sum + port.incomingPowerMw, 0);
    else if (definition.probe) measurementMw = Math.max(0, ...opticalPorts.map(port => port.incomingPowerMw));
    const result = { component, ports, measurementMw, opticalPowerMw: measurementMw, model, definition };
    result.power = componentPowerSummary(component, result);
    if (definition.detector) {
      const responsivity = Number(component.params?.responsivity ?? 1);
      const darkCurrentMa = Number(component.params?.darkCurrentNa ?? 0) * 1e-6;
      result.photocurrentMa = measurementMw * responsivity + darkCurrentMa;
    }
    componentResults.set(component.id, result);
  }

  const solvedConnections = new Map();
  let waveguideLossMw = 0;
  for (const connection of opticalConnections) {
    const data = network.connectionData.get(connection.id);
    if (!data) continue;
    const waveA = b[data.ai];
    const waveB = b[data.bi];
    const deliveredB = mul(data.transmission.value, waveA);
    const deliveredA = mul(data.transmission.value, waveB);
    const powerFromAMw = abs2(waveA);
    const powerFromBMw = abs2(waveB);
    const deliveredToBMw = abs2(deliveredB);
    const deliveredToAMw = abs2(deliveredA);
    const lossMw = Math.max(0, powerFromAMw - deliveredToBMw) + Math.max(0, powerFromBMw - deliveredToAMw);
    waveguideLossMw += lossMw;
    solvedConnections.set(connection.id, {
      ...data.transmission, waveFromA: waveA, waveFromB: waveB,
      deliveredToB: deliveredB, deliveredToA: deliveredA,
      powerFromAMw, powerFromBMw, deliveredToBMw, deliveredToAMw, lossMw,
      maxPowerMw: Math.max(powerFromAMw, powerFromBMw, deliveredToAMw, deliveredToBMw)
    });
  }

  const sourcePowerMw = components.reduce((sum, component) => sum + (componentResults.get(component.id)?.power.generatedMw ?? 0), 0);
  const detectedPowerMw = components.filter(component => getDefinition(component.type).detector).reduce((sum, component) => sum + (componentResults.get(component.id)?.measurementMw ?? 0), 0);

  const calculated = matrixVectorMultiply(network.A, b);
  let residual = 0;
  let scaleNorm = 0;
  for (let i = 0; i < b.length; i += 1) {
    residual += abs2(sub(calculated[i], network.sourceVector[i]));
    scaleNorm += abs2(network.sourceVector[i]);
  }
  const normalizedResidual = Math.sqrt(residual / Math.max(scaleNorm, 1e-20));

  let detectorAbsorptionMw = 0;
  let terminationAbsorptionMw = 0;
  let componentLossMw = 0;
  let sourceAbsorptionMw = 0;
  let modelGainMw = 0;
  for (const component of components) {
    const result = componentResults.get(component.id);
    const definition = getDefinition(component.type);
    const isSourceBoundary = component.type === 'source' || (definition.sourceBoundary && ['input', 'bidirectional'].includes(component.params?.direction));
    if (isSourceBoundary) {
      sourceAbsorptionMw += result.power.incomingMw;
    } else if (definition.detector) {
      detectorAbsorptionMw += result.power.incomingMw;
    } else if (definition.termination || definition.bridge) {
      terminationAbsorptionMw += result.power.incomingMw;
    } else if (result.power.netDissipationMw >= -1e-9) {
      componentLossMw += Math.max(0, result.power.netDissipationMw);
    } else {
      modelGainMw += -result.power.netDissipationMw;
    }
  }

  let openPortPowerMw = 0;
  for (const entry of network.entries) {
    if (!network.occupied.has(entry.index)) openPortPowerMw += abs2(b[entry.index]);
  }
  const accountedMw = detectorAbsorptionMw + terminationAbsorptionMw + componentLossMw + waveguideLossMw + sourceAbsorptionMw + openPortPowerMw - modelGainMw;
  const balanceErrorMw = sourcePowerMw - accountedMw;
  const balanceErrorFraction = Math.abs(balanceErrorMw) / Math.max(sourcePowerMw, 1e-15);

  if (modelGainMw > Math.max(1e-9, sourcePowerMw * 1e-5)) warnings.push('At least one compact model is non-passive for the present coherent multi-port excitation. Inspect imported or approximate S matrices.');
  if (sources.length > 1) {
    const differentWavelength = sources.some(source => Math.abs(Number(source.params?.wavelengthNm ?? wavelengthNm) - wavelengthNm) > 1e-6);
    if (differentWavelength) warnings.push('Multiple source wavelengths are present; this solve uses the global wavelength and treats all sources as mutually coherent.');
  }

  return {
    ok: true, warnings, wavelengthNm, elapsedMs: performance.now() - started,
    residual: normalizedResidual, sourcePowerMw, detectedPowerMw,
    portEntries: network.entries, portIndex: network.indexByKey,
    a, b, components: componentResults, connections: solvedConnections,
    powerBudget: {
      launchedMw: sourcePowerMw,
      detectedMw: detectorAbsorptionMw,
      terminationMw: terminationAbsorptionMw,
      componentLossMw,
      waveguideLossMw,
      sourceAbsorptionMw,
      openPortMw: openPortPowerMw,
      modelGainMw,
      accountedMw,
      balanceErrorMw,
      balanceErrorFraction
    }
  };
}

export function localCouplerState(coupler, solveResult, zFraction = 1, side = 'auto') {
  const result = solveResult?.components?.get(coupler.id);
  const wavelengthNm = solveResult?.wavelengthNm ?? DEFAULT_WAVELENGTH_NM;
  const coeff = couplerCoefficients(coupler.params, wavelengthNm);
  const leftPower = (result?.ports.lt?.incomingPowerMw ?? 0) + (result?.ports.lb?.incomingPowerMw ?? 0);
  const rightPower = (result?.ports.rt?.incomingPowerMw ?? 0) + (result?.ports.rb?.incomingPowerMw ?? 0);
  const activeSide = side === 'auto' ? (rightPower > leftPower ? 'right' : 'left') : side;
  const in1 = activeSide === 'left' ? (result?.ports.lt?.incoming ?? C()) : (result?.ports.rt?.incoming ?? C());
  const in2 = activeSide === 'left' ? (result?.ports.lb?.incoming ?? C()) : (result?.ports.rb?.incoming ?? C());
  const fraction = clamp(zFraction, 0, 1);
  const z = coeff.interactionLengthUm * fraction;
  const angle = coeff.kappa * z;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const attenuation = Math.pow(coeff.amplitudeTransmission, fraction);
  const a1 = scale(add(scale(in1, c), mul(C(0, -s), in2)), attenuation);
  const a2 = scale(add(mul(C(0, -s), in1), scale(in2, c)), attenuation);
  return { activeSide, in1, in2, a1, a2, p1: abs2(a1), p2: abs2(a2), coeff, z, phase1: arg(a1), phase2: arg(a2) };
}

function component(id, type, name, x, y, params = {}) {
  return { id, type, name, x, y, rotation: 0, params: { ...defaultParams(type), ...params } };
}
function connection(id, a, b, waypoints = [], params = {}, domain = 'optical') {
  const baseParams = domain === 'optical' ? { lossDbPerCm: 2, neff: 2.42 } : {};
  return { id, domain, a, b, waypoints, params: { ...baseParams, ...params } };
}
function baseSettings() {
  return {
    wavelengthNm: 1550, canvasZoom: 1, canvasPanX: 0, canvasPanY: 0,
    routingMode: 'physical', worldToUm: DEFAULT_WORLD_TO_UM, gridUm: 5,
    snapToGrid: false, minBendRadiusUm: 0,
    figureMode: 'workbench', paperBackground: 'white', showPortsInFigure: true,
    showGridInFigure: false, figurePadding: 36
  };
}

export function makeDemoCircuit() {
  const components = [
    component('src-1', 'source', 'Laser', 105, 360, { powerMw: 1, wavelengthNm: 1550 }),
    component('dc-1', 'coupler', 'DC1', 310, 360),
    component('phase-1', 'phase', 'Phase shifter', 590, 190, { phaseRad: 1.15, lengthUm: 20 }),
    component('dc-2', 'coupler', 'DC2', 835, 360),
    component('det-1', 'detector', 'DET 1', 1015, 290),
    component('det-2', 'detector', 'DET 2', 1015, 430)
  ];
  const connections = [
    connection('wg-1', { component: 'src-1', port: 'out' }, { component: 'dc-1', port: 'lt' }),
    connection('wg-2', { component: 'dc-1', port: 'rt' }, { component: 'phase-1', port: 'left' }, [{ x: 440, y: 344 }, { x: 440, y: 190 }]),
    connection('wg-3', { component: 'phase-1', port: 'right' }, { component: 'dc-2', port: 'lt' }, [{ x: 742, y: 190 }, { x: 742, y: 344 }]),
    connection('wg-4', { component: 'dc-1', port: 'rb' }, { component: 'dc-2', port: 'lb' }, [{ x: 440, y: 510 }, { x: 742, y: 510 }]),
    connection('wg-5', { component: 'dc-2', port: 'rt' }, { component: 'det-1', port: 'in' }),
    connection('wg-6', { component: 'dc-2', port: 'rb' }, { component: 'det-2', port: 'in' })
  ];
  return {
    version: 2,
    name: 'MZI — Lab-ready demo',
    settings: baseSettings(),
    components, connections,
    lab: {
      measurements: [
        { id: 'm-det-1', kind: 'component', componentId: 'det-1', metric: 'power', label: 'DET 1 power' },
        { id: 'm-det-2', kind: 'component', componentId: 'det-2', metric: 'power', label: 'DET 2 power' }
      ]
    }
  };
}

export function makeRingCircuit() {
  const components = [
    component('src-ring', 'source', 'Laser', 120, 330),
    component('ring-1', 'ring', 'Add-drop ring', 530, 330, { radiusUm: 12, couplingPower: 15 }),
    component('det-through', 'detector', 'THRU', 930, 260),
    component('det-drop', 'detector', 'DROP', 930, 430),
    component('term-add', 'termination', 'ADD termination', 160, 455)
  ];
  return {
    version: 2, name: 'Add-drop ring filter', settings: baseSettings(), components,
    connections: [
      connection('wg-r1', { component: 'src-ring', port: 'out' }, { component: 'ring-1', port: 'lt' }),
      connection('wg-r2', { component: 'ring-1', port: 'rt' }, { component: 'det-through', port: 'in' }),
      connection('wg-r3', { component: 'ring-1', port: 'rb' }, { component: 'det-drop', port: 'in' }),
      connection('wg-r4', { component: 'term-add', port: 'in' }, { component: 'ring-1', port: 'lb' })
    ],
    lab: { measurements: [
      { id: 'm-through', kind: 'component', componentId: 'det-through', metric: 'power', label: 'Through' },
      { id: 'm-drop', kind: 'component', componentId: 'det-drop', metric: 'power', label: 'Drop' }
    ] }
  };
}

export function makeDelayCircuit() {
  const circuit = makeDemoCircuit();
  circuit.name = 'Delay-line interferometer';
  const phase = circuit.components.find(item => item.type === 'phase');
  phase.name = 'Long delay';
  phase.params.lengthUm = 800;
  phase.params.phaseRad = 0;
  circuit.components.find(item => item.type === 'source').params.sourceMode = 'pulsed';
  circuit.components.find(item => item.type === 'source').params.pulseDurationPs = 8;
  return circuit;
}

export function makeFilterBankCircuit() {
  const components = [component('src-fb', 'source', 'Laser', 90, 360), component('split-fb', 'splitter', 'Input split', 280, 360)];
  const connections = [connection('wg-fb0', { component: 'src-fb', port: 'out' }, { component: 'split-fb', port: 'in' })];
  for (let index = 0; index < 2; index += 1) {
    const y = index ? 470 : 250;
    const ringId = `ring-fb-${index + 1}`;
    const detId = `det-fb-${index + 1}`;
    components.push(component(ringId, 'ring', `Ring ${index + 1}`, 560, y, { radiusUm: 9 + index * 1.5, couplingPower: 18 }));
    components.push(component(detId, 'detector', `CH ${index + 1}`, 940, y));
    connections.push(connection(`wg-fb-${index + 1}a`, { component: 'split-fb', port: index ? 'bottom' : 'top' }, { component: ringId, port: 'lt' }));
    connections.push(connection(`wg-fb-${index + 1}b`, { component: ringId, port: 'rt' }, { component: detId, port: 'in' }));
    components.push(component(`term-fb-${index + 1}`, 'termination', `Drop term ${index + 1}`, 750, y + 95));
    connections.push(connection(`wg-fb-${index + 1}c`, { component: ringId, port: 'rb' }, { component: `term-fb-${index + 1}`, port: 'in' }));
  }
  return { version: 2, name: 'Two-channel ring filter bank', settings: baseSettings(), components, connections, lab: { measurements: components.filter(item => item.type === 'detector').map((item, index) => ({ id: `m-fb-${index}`, kind: 'component', componentId: item.id, metric: 'power', label: item.name })) } };
}


export function makePaperFigureCircuit() {
  const components = [
    component('frame-paper', 'chip-frame', 'Silicon photonic chip', 650, 295, { width: 650, height: 330, subtitle: 'coherent transmitter / receiver PIC', fillStyle: 'tint' }),
    component('panel-a', 'panel-label', 'Panel a', 52, 58, { text: 'a', fontSize: 34 }),
    component('bridge-in', 'optical-bridge', 'From OpticalSetup', 105, 245, { direction: 'input', interfaceKind: 'fiber', powerMw: 2, couplingEfficiency: .82, polarization: 'TE', guidedMode: 'TE0', sourceMode: 'cw' }),
    component('pc-paper', 'polarization-controller', 'Polarization controller', 265, 245, { state: 'linear' }),
    component('edge-paper', 'edge-coupler', 'Edge coupler', 410, 245, { peakEfficiency: 78, facetKind: 'fiber-array' }),
    component('split-paper', 'splitter', '1×2 splitter', 545, 245, { topPower: 50 }),
    component('mod-paper', 'modulator', 'EO phase modulator', 680, 175, { voltageV: 1.2, vpiV: 4, labelPosition: 'above', labelOffsetX: -18, labelOffsetY: -2 }),
    component('heater-paper', 'heater', 'Thermo-optic phase shifter', 680, 325, { voltageV: 1.1, phasePerV: .7, labelPosition: 'above', subtitleVisibility: 'hide', labelOffsetY: -3 }),
    component('combine-paper', 'coupler', '2×2 combiner', 815, 245, { crossPower: 50 }),
    component('det-paper', 'detector', 'Integrated photodetector', 960, 205, { responsivity: .9 }),
    component('bridge-out', 'optical-bridge', 'To OpticalSetup', 960, 325, { direction: 'output', interfaceKind: 'free-space', couplingEfficiency: .65, polarization: 'TE', guidedMode: 'TE0', labelPosition: 'below' }),
    component('rf-paper', 'rf-source', 'RF generator', 680, 70, { frequencyGhz: 20, amplitudeV: 1.2, subtitleVisibility: 'hide', labelOffsetX: 18 }),
    component('ctrl-paper', 'controller', 'Control & calibration', 555, 520, { subtitle: 'bias control · calibration · feedback', width: 170, height: 92, subtitleVisibility: 'hide', labelPosition: 'below' }),
    component('amp-paper', 'electrical-amplifier', 'TIA / amplifier', 770, 520, { gainDb: 26, bandwidthGhz: 18 }),
    component('scope-paper', 'oscilloscope', 'Oscilloscope', 955, 520, { subtitle: 'detected modulation' }),
    component('logic-paper', 'system-block', 'Experiment computer', 275, 520, { blockKind: 'processor', subtitle: 'automation · acquisition', width: 170, height: 95, subtitleVisibility: 'hide', labelPosition: 'above', labelOffsetX: -34 }),
    component('plot-paper', 'plot-panel', 'Transmission spectrum', 305, 690, { width: 260, height: 165, caption: 'Measured transmission', xLabel: 'Wavelength (nm)', yLabel: 'Transmission (dB)', traceStyle: 'resonance' }),
    component('image-paper', 'image-panel', 'Chip micrograph', 650, 690, { width: 260, height: 165, caption: 'Optical micrograph / SEM' }),
    component('note-paper', 'annotation', 'Operating conditions', 925, 690, { width: 230, height: 120, fontSize: 14, text: 'λ = 1550 nm\nTE₀ polarization\nCW input: 2.0 mW\nRF drive: 20 GHz', align: 'left' })
  ];
  const connections = [
    connection('wg-paper-1', { component: 'bridge-in', port: 'pic' }, { component: 'pc-paper', port: 'in' }, [], { routingMode: 'schematic', schematicLengthUm: 800 }),
    connection('wg-paper-2', { component: 'pc-paper', port: 'out' }, { component: 'edge-paper', port: 'external' }, [], { routingMode: 'schematic', schematicLengthUm: 500 }),
    connection('wg-paper-3', { component: 'edge-paper', port: 'pic' }, { component: 'split-paper', port: 'in' }, [], { routingMode: 'schematic', schematicLengthUm: 300 }),
    connection('wg-paper-4', { component: 'split-paper', port: 'top' }, { component: 'mod-paper', port: 'left' }, [{ x: 610, y: 227 }, { x: 610, y: 175 }], { routingMode: 'schematic', schematicLengthUm: 800 }),
    connection('wg-paper-5', { component: 'mod-paper', port: 'right' }, { component: 'combine-paper', port: 'lt' }, [{ x: 750, y: 175 }, { x: 750, y: 229 }], { routingMode: 'schematic', schematicLengthUm: 800 }),
    connection('wg-paper-6', { component: 'split-paper', port: 'bottom' }, { component: 'heater-paper', port: 'left' }, [{ x: 610, y: 263 }, { x: 610, y: 325 }], { routingMode: 'schematic', schematicLengthUm: 850 }),
    connection('wg-paper-7', { component: 'heater-paper', port: 'right' }, { component: 'combine-paper', port: 'lb' }, [{ x: 750, y: 325 }, { x: 750, y: 261 }], { routingMode: 'schematic', schematicLengthUm: 850 }),
    connection('wg-paper-8', { component: 'combine-paper', port: 'rt' }, { component: 'det-paper', port: 'in' }, [], { routingMode: 'schematic', schematicLengthUm: 450 }),
    connection('wg-paper-9', { component: 'combine-paper', port: 'rb' }, { component: 'bridge-out', port: 'pic' }, [], { routingMode: 'schematic', schematicLengthUm: 500 }),
    connection('rf-paper-1', { component: 'rf-paper', port: 'out' }, { component: 'mod-paper', port: 'rf' }, [{ x: 758, y: 70 }, { x: 758, y: 135 }, { x: 680, y: 135 }], { arrow: 'end', labelOffsetY: -12 }, 'rf'),
    connection('wire-paper-1', { component: 'ctrl-paper', port: 'drive' }, { component: 'heater-paper', port: 'drive' }, [{ x: 655, y: 520 }, { x: 655, y: 390 }, { x: 680, y: 390 }], { arrow: 'end', labelOffsetX: -4, labelOffsetY: -12 }, 'electrical'),
    connection('wire-paper-2', { component: 'det-paper', port: 'elec' }, { component: 'amp-paper', port: 'in' }, [{ x: 1020, y: 205 }, { x: 1020, y: 430 }, { x: 700, y: 430 }], { arrow: 'end', labelOffsetY: -12 }, 'electrical'),
    connection('wire-paper-3', { component: 'amp-paper', port: 'out' }, { component: 'scope-paper', port: 'ch1' }, [], { arrow: 'end', labelOffsetY: -12 }, 'electrical'),
    connection('ctrl-paper-1', { component: 'ctrl-paper', port: 'logic' }, { component: 'logic-paper', port: 'control' }, [{ x: 555, y: 455 }, { x: 360, y: 455 }], { arrow: 'start', labelOffsetY: -12 }, 'control')
  ];
  connections.find(item => item.id === 'rf-paper-1').label = '20 GHz drive';
  connections.find(item => item.id === 'wire-paper-1').label = 'heater bias';
  connections.find(item => item.id === 'wire-paper-2').label = 'photocurrent';
  connections.find(item => item.id === 'wire-paper-3').label = 'TIA output';
  connections.find(item => item.id === 'ctrl-paper-1').label = 'automation';
  const settings = { ...baseSettings(), routingMode: 'schematic', figureMode: 'paper', showPortsInFigure: true, showGridInFigure: false, canvasZoom: .82, canvasPanX: 10, canvasPanY: -10 };
  return {
    version: 2,
    name: 'Hybrid PIC experiment — paper figure',
    settings,
    components,
    connections,
    lab: { measurements: [{ id: 'm-paper-det', kind: 'component', componentId: 'det-paper', metric: 'power', label: 'Integrated photodetector power' }] },
    parameterLinks: []
  };
}

export const CIRCUIT_TEMPLATES = Object.freeze([
  { id: 'paper-hybrid', name: 'Hybrid PIC paper figure', description: 'Chip, external optics, electrical/RF control, panels, and OpticalSetup bridges', create: makePaperFigureCircuit },
  { id: 'mzi', name: 'Mach–Zehnder interferometer', description: 'Interference, tuning, sweeps, and robustness', create: makeDemoCircuit },
  { id: 'ring', name: 'Add-drop ring filter', description: 'Resonance, FSR, linewidth, and group delay', create: makeRingCircuit },
  { id: 'delay', name: 'Pulsed delay interferometer', description: 'Temporal delay, overlap, and detector bandwidth', create: makeDelayCircuit },
  { id: 'filter-bank', name: 'Ring filter bank', description: 'Multi-channel system topology and spectra', create: makeFilterBankCircuit }
]);

export function makeTemplate(id) {
  return (CIRCUIT_TEMPLATES.find(template => template.id === id) ?? CIRCUIT_TEMPLATES[0]).create();
}

export function makeBlankCircuit() {
  return { version: 2, name: 'Untitled experiment', settings: baseSettings(), components: [], connections: [], lab: { measurements: [] } };
}

export function validateConnection(circuit, first, second) {
  if (!first || !second) return { ok: false, reason: 'Choose two compatible typed ports.' };
  if (first.component === second.component && first.port === second.port) return { ok: false, reason: 'A port cannot connect to itself.' };
  const aComponent = circuit.components.find(component => component.id === first.component);
  const bComponent = circuit.components.find(component => component.id === second.component);
  if (!aComponent || !bComponent) return { ok: false, reason: 'One endpoint no longer exists.' };
  const aPort = getPorts(aComponent).find(port => port.id === first.port);
  const bPort = getPorts(bComponent).find(port => port.id === second.port);
  if (!aPort || !bPort || aPort.role !== bPort.role) return { ok: false, reason: 'The port domains are incompatible.' };
  const keyA = endpointKey(first);
  const keyB = endpointKey(second);
  const occupied = circuit.connections.some(item => [endpointKey(item.a), endpointKey(item.b)].some(key => key === keyA || key === keyB));
  if (occupied) return { ok: false, reason: 'Each typed port can carry one connection in this model.' };
  return { ok: true };
}

export function nearestPort(circuit, point, maxDistance = 28, exclude = null) {
  let best = null;
  for (const component of circuit.components) {
    for (const port of componentPorts(component)) {
      if (exclude && exclude.component === component.id && exclude.port === port.id) continue;
      const distance = Math.hypot(point.x - port.x, point.y - port.y);
      if (distance <= maxDistance && (!best || distance < best.distance)) best = { component: component.id, port: port.id, x: port.x, y: port.y, distance };
    }
  }
  return best;
}

export function createHierarchicalBlock(circuit, componentIds, { id = `block-${Math.random().toString(36).slice(2, 8)}`, name = 'Functional block' } = {}) {
  const selected = new Set(componentIds);
  const chosen = circuit.components.filter(component => selected.has(component.id));
  if (chosen.length < 2) throw new Error('Select at least two components to create a block.');
  if (chosen.some(component => component.type === 'source')) throw new Error('Active sources cannot be collapsed into a passive block.');
  if (chosen.some(component => getDefinition(component.type).diagramOnly)) throw new Error('Publication-only figure objects cannot be collapsed into an optical compact-model block.');
  const touchingConnections = circuit.connections.filter(item => selected.has(item.a.component) || selected.has(item.b.component));
  if (touchingConnections.some(item => !isOpticalConnection(item, circuit.components))) {
    throw new Error('Disconnect electrical, RF, and control links before collapsing an optical hierarchy.');
  }

  const center = {
    x: chosen.reduce((sum, item) => sum + item.x, 0) / chosen.length,
    y: chosen.reduce((sum, item) => sum + item.y, 0) / chosen.length
  };
  const internalConnections = circuit.connections.filter(item => selected.has(item.a.component) && selected.has(item.b.component));
  const boundaryConnections = circuit.connections.filter(item => selected.has(item.a.component) !== selected.has(item.b.component));
  const internalOccupied = new Set(internalConnections.flatMap(item => [endpointKey(item.a), endpointKey(item.b)]));
  const boundaryInside = new Map();
  for (const item of boundaryConnections) {
    const inside = selected.has(item.a.component) ? item.a : item.b;
    boundaryInside.set(endpointKey(inside), inside);
  }

  const exposed = [];
  for (const chosenComponent of chosen) {
    for (const port of getPorts(chosenComponent)) {
      if ((port.role ?? 'optical') !== 'optical') continue;
      const endpoint = { component: chosenComponent.id, port: port.id };
      const key = endpointKey(endpoint);
      if (!internalOccupied.has(key)) exposed.push(endpoint);
    }
  }
  exposed.sort((a, b) => {
    const pa = portPosition(circuit.components.find(item => item.id === a.component), a.port);
    const pb = portPosition(circuit.components.find(item => item.id === b.component), b.port);
    return (pa?.x ?? 0) - (pb?.x ?? 0) || (pa?.y ?? 0) - (pb?.y ?? 0);
  });

  const left = [];
  const right = [];
  for (const endpoint of exposed) {
    const sourceComponent = circuit.components.find(item => item.id === endpoint.component);
    const position = portPosition(sourceComponent, endpoint.port) ?? center;
    (position.x < center.x ? left : right).push({ endpoint, position });
  }
  const arrange = (items, side) => items.map((item, index) => ({
    id: `p${side === 'left' ? 'l' : 'r'}${index + 1}`,
    label: `${side === 'left' ? 'L' : 'R'}${index + 1}`,
    role: 'optical', x: side === 'left' ? -62 : 62,
    y: (index - (items.length - 1) / 2) * 22,
    internalEndpoint: clone(item.endpoint)
  }));
  const ports = [...arrange(left, 'left'), ...arrange(right, 'right')];
  if (!ports.length) throw new Error('The selection has no external or open ports to expose.');

  const portForEndpoint = new Map(ports.map(port => [endpointKey(port.internalEndpoint), port.id]));
  const boundaryOriginals = Object.fromEntries(boundaryConnections.map(item => [item.id, clone(item)]));
  const externalConnections = boundaryConnections.map(item => {
    const copy = clone(item);
    const preservedLengthUm = connectionLengthUm(item, circuit.components, circuit.settings ?? {});
    if (selected.has(copy.a.component)) copy.a = { component: id, port: portForEndpoint.get(endpointKey(copy.a)) };
    if (selected.has(copy.b.component)) copy.b = { component: id, port: portForEndpoint.get(endpointKey(copy.b)) };
    copy.params ??= {};
    copy.params.routingMode = 'schematic';
    copy.params.schematicLengthUm = preservedLengthUm;
    copy.params.collapsedBoundary = true;
    return copy;
  });
  const boundaryIds = new Set(boundaryConnections.map(item => item.id));
  const internalIds = new Set(internalConnections.map(item => item.id));

  const block = {
    id, type: 'block', name, x: center.x, y: center.y, rotation: 0,
    params: {
      ...defaultParams('block'), ports,
      origin: clone(center),
      boundaryOriginals,
      subcircuit: {
        version: 2,
        name,
        settings: clone(circuit.settings ?? baseSettings()),
        components: clone(chosen),
        connections: clone(internalConnections)
      },
      provenance: 'Live hierarchical reduction'
    }
  };

  circuit.components = [...circuit.components.filter(item => !selected.has(item.id)), block];
  circuit.connections = [
    ...circuit.connections.filter(item => !boundaryIds.has(item.id) && !internalIds.has(item.id)),
    ...externalConnections
  ];
  return block;
}

export function expandHierarchicalBlock(circuit, blockId) {
  const block = circuit.components.find(component => component.id === blockId && component.type === 'block');
  if (!block?.params?.subcircuit) throw new Error('This block has no editable internal circuit.');
  const ports = getPorts(block);
  const mapping = new Map(ports.map(port => [port.id, port.internalEndpoint]));
  const originals = block.params?.boundaryOriginals ?? {};
  const origin = block.params?.origin ?? { x: block.x, y: block.y };
  const dx = Number(block.x ?? 0) - Number(origin.x ?? block.x ?? 0);
  const dy = Number(block.y ?? 0) - Number(origin.y ?? block.y ?? 0);
  const moved = Math.hypot(dx, dy) > 1e-8;

  circuit.connections = circuit.connections.map(connection => {
    if (connection.a.component !== blockId && connection.b.component !== blockId) return connection;
    const mapped = clone(connection);
    if (mapped.a.component === blockId) mapped.a = clone(mapping.get(mapped.a.port));
    if (mapped.b.component === blockId) mapped.b = clone(mapping.get(mapped.b.port));
    const original = originals[connection.id];
    if (original && !moved) {
      const restored = clone(original);
      // Preserve the outside endpoint in case it was edited while the block was collapsed.
      if (connection.a.component !== blockId) restored.a = clone(connection.a);
      if (connection.b.component !== blockId) restored.b = clone(connection.b);
      return restored;
    }
    // A moved block has no unique physical route back to its expanded boundary.
    // Keep the explicitly preserved optical length rather than silently changing phase.
    mapped.params ??= {};
    mapped.params.routingMode = 'schematic';
    mapped.params.collapsedBoundary = undefined;
    return mapped;
  });

  const internalComponents = clone(block.params.subcircuit.components).map(component => ({ ...component, x: component.x + dx, y: component.y + dy }));
  const internalConnections = clone(block.params.subcircuit.connections).map(connection => ({
    ...connection,
    waypoints: (connection.waypoints ?? []).map(point => ({ x: point.x + dx, y: point.y + dy }))
  }));
  circuit.components = [...circuit.components.filter(component => component.id !== blockId), ...internalComponents];
  circuit.connections.push(...internalConnections);
  return internalComponents.map(component => component.id);
}
