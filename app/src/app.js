import { CircuitRenderer, componentBounds } from './circuit.js';
import {
  DEFAULT_WORLD_TO_UM, solveCircuit, makeDemoCircuit, makeBlankCircuit, makeTemplate, CIRCUIT_TEMPLATES,
  validateConnection, nearestPort, componentPorts, portPosition, getConnectionPoints,
  connectionLengthUm, waveguideTransmission, couplerCoefficients, localCouplerState,
  createHierarchicalBlock, expandHierarchicalBlock, connectionDomain, isOpticalConnection
} from './physics.js';
import {
  getDefinition, listDefinitions, getPorts, defaultParams, formatParameterValue
} from './models.js';
import { abs2, formatPhase } from './complex.js';
import { CouplerView, couplerViewMeta } from './coupler-view.js';
import {
  defaultMeasurementSpecs, measurementLabel, readMeasurement, pinMeasurement,
  listSweepParameters, resolveParameter, parameterLinkFor, createParameterLink, unlinkParameter,
  sweepCircuitAsync, optimizeCircuit, runTolerance, simulatePulse
} from './analysis.js';
import { LabPlot } from './plot.js';
import {
  semanticNetlist, toSaxYAML, toGdsfactoryPython, downloadText,
  parseSParameterData, makeSParameterComponent, autoLayoutCircuit, importSemanticNetlist
} from './export.js';
import { buildOpticalBridgePayload, opticalSetupBridgeUrl, bridgeManifest } from './bridge.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const deepClone = value => structuredClone(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const escapeHTML = value => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const humanNumber = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

const dom = {
  app: $('#app'), svg: $('#circuitSvg'), viewport: $('#viewport'), projectName: $('#projectName'),
  undoButton: $('#undoButton'), redoButton: $('#redoButton'), shareButton: $('#shareButton'), menuButton: $('#menuButton'), moreButton: $('#moreButton'),
  labButton: $('#labButton'), labPinCount: $('#labPinCount'),
  modelBadge: $('#modelBadge'), routingButton: $('#routingButton'), routingBadge: $('#routingBadge'), routingDetail: $('#routingDetail'), figureButton: $('#figureButton'),
  solverHealth: $('#solverHealth'), solverMeta: $('#solverMeta'), sourceReadout: $('#sourceReadout'), detectedReadout: $('#detectedReadout'),
  balanceReadout: $('#balanceReadout'), powerBudgetReadout: $('#powerBudgetReadout'), powerBudgetButton: $('#powerBudgetButton'),
  transportModeLabel: $('#transportModeLabel'), transportModeDetail: $('#transportModeDetail'),
  emptyHint: $('#emptyHint'), loadDemoInline: $('#loadDemoInline'), inspector: $('#inspector'), inspectorEmpty: $('#inspectorEmpty'), inspectorContent: $('#inspectorContent'),
  componentTray: $('#componentTray'), componentCatalog: $('#componentCatalog'), zoomOut: $('#zoomOut'), zoomIn: $('#zoomIn'), zoomReset: $('#zoomReset'),
  zoomReadout: $('#zoomReadout'), fitButton: $('#fitButton'), pauseButton: $('#pauseButton'), timeKnob: $('#timeKnob'), speedReadout: $('#speedReadout'),
  transportIcon: $('#transportIcon'), scaleRuler: $('#scaleRuler'), scaleReadout: $('#scaleReadout'), toast: $('#toast'),
  physicsDialog: $('#physicsDialog'), closePhysics: $('#closePhysics'), couplerCanvas: $('#couplerCanvas'), miniMapSvg: $('#miniMapSvg'), depthBadge: $('#depthBadge'),
  fieldScaleLabel: $('#fieldScaleLabel'), couplerModelName: $('#couplerModelName'), couplerInputLabel: $('#couplerInputLabel'), couplerThroughLabel: $('#couplerThroughLabel'),
  couplerCrossLabel: $('#couplerCrossLabel'), gapRange: $('#gapRange'), gapOutput: $('#gapOutput'), lengthRange: $('#lengthRange'), lengthOutput: $('#lengthOutput'),
  wavelengthRange: $('#wavelengthRange'), wavelengthOutput: $('#wavelengthOutput'), couplingAngleMetric: $('#couplingAngleMetric'), crossPowerMetric: $('#crossPowerMetric'),
  throughPhaseMetric: $('#throughPhaseMetric'), crossPhaseMetric: $('#crossPhaseMetric'), physicsInfoButton: $('#physicsInfoButton'), equationCard: $('#equationCard'),
  sheetDialog: $('#sheetDialog'), sheetTitle: $('#sheetTitle'), sheetSubtitle: $('#sheetSubtitle'), sheetContent: $('#sheetContent'),
  labPanel: $('#labPanel'), labClose: $('#labClose'), labMinimize: $('#labMinimize'), labTabs: $('#labTabs'), labSubtitle: $('#labSubtitle'), labPlot: $('#labPlot'), labPlotToolbar: $('#labPlotToolbar'),
  labControls: $('#labControls'), labStatus: $('#labStatus'), labProgressText: $('#labProgressText'), labProgress: $('#labProgress'), labProgressBar: $('#labProgressBar'),
  labStatusDot: $('#labStatusDot'), labMetrics: $('#labMetrics')
};

const renderer = new CircuitRenderer(dom.svg);
const couplerView = new CouplerView(dom.couplerCanvas, { onViewChange: view => setPhysicsView(view, false) });

const runtime = {
  circuit: null,
  solve: null,
  selection: null,
  tool: 'select',
  placeType: 'source',
  connectStart: null,
  previewPoints: [],
  previewValid: null,
  interaction: null,
  pointers: new Map(),
  pinch: null,
  history: [],
  future: [],
  continuousSnapshot: null,
  toastTimer: null,
  paused: false,
  speed: 1,
  animationStart: performance.now(),
  selectedCouplerId: null,
  physicsView: 'power',
  dirty: false,
  lastSavedAt: 0,
  pendingAutosave: null,
  operationToken: 0,
  highlightIds: [],
  lab: {
    open: false,
    compact: false,
    tab: 'sweep',
    busy: false,
    result: null,
    resultTab: null,
    baselines: [],
    cursorIndex: null,
    selectedMeasurementId: null,
    sweep: { parameterId: 'global:wavelengthNm', start: 1500, stop: 1600, points: 301, scale: 'linear' },
    tune: { goal: 'maximize', targetValue: 0.5, robustWindowNm: 0, parameterIds: [], secondaryMeasurementId: null },
    tolerance: { samples: 500, threshold: null, criterion: 'min', seed: 24681357, parameters: [] },
    pulse: { durationPs: 12, repetitionRateMHz: 80, samples: 192 },
    optimizationResult: null,
    toleranceResult: null,
    pulseResult: null
  }
};

const labPlot = new LabPlot(dom.labPlot, {
  onCursor(index, pinned) {
    runtime.lab.cursorIndex = index;
    if (!pinned || runtime.lab.result?.kind !== 'sweep') return;
    applySweepPoint(index);
  }
});

function labelForType(type) { return getDefinition(type).label ?? type; }
function iconForType(type) { return getDefinition(type).glyph ?? '•'; }
function primarySource() { return runtime.circuit?.components?.find(component => component.type === 'source' || (getDefinition(component.type).sourceBoundary && ['input', 'bidirectional'].includes(component.params?.direction))) ?? null; }
function currentSourceMode(source = primarySource()) { return source?.params?.sourceMode === 'pulsed' ? 'pulsed' : 'cw'; }
function currentCwVisualization(source = primarySource()) { return source?.params?.cwVisualization === 'tracers' ? 'tracers' : 'solid'; }
function snapWorldPoint(point, circuit = runtime.circuit) {
  const settings = circuit?.settings ?? {};
  if (settings.routingMode !== 'physical' || !settings.snapToGrid) return { x: point.x, y: point.y };
  const spacing = Math.max(1e-6, finite(settings.gridUm, 5) / Math.max(1e-6, finite(settings.worldToUm, DEFAULT_WORLD_TO_UM)));
  return { x: Math.round(point.x / spacing) * spacing, y: Math.round(point.y / spacing) * spacing };
}

function formatPower(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= .1) return `${value.toFixed(3)} mW`;
  if (value >= .001) return `${(value * 1000).toFixed(2)} µW`;
  return `${(value * 1e6).toFixed(1)} nW`;
}
function formatResidual(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return value.toExponential(1).replace('e-', 'e−').replace('e+', 'e+');
}
function modeSummary(source = primarySource()) {
  if (!source) return { label: 'No source', detail: 'Place a laser to launch a coherent field.' };
  if (currentSourceMode(source) === 'pulsed') {
    return {
      label: 'Pulse-envelope view',
      detail: `${finite(source.params?.pulseDurationPs, 12).toFixed(1)} ps envelope · ${finite(source.params?.repetitionRateMHz, 80).toFixed(0)} MHz train · animation timing compressed`
    };
  }
  if (currentCwVisualization(source) === 'tracers') return { label: 'CW steady state + tracers', detail: 'Tracers show direction only; they are not physical pulses.' };
  return { label: 'CW steady state', detail: 'Continuous single-color field. Use Lab → Pulse for spectral temporal reconstruction.' };
}

function sanitizedSettings(input = {}) {
  const routingMode = input.routingMode === 'schematic' ? 'schematic' : 'physical';
  return {
    wavelengthNm: clamp(finite(input.wavelengthNm, 1550), 200, 10000),
    canvasZoom: clamp(finite(input.canvasZoom, 1), .35, 4),
    canvasPanX: clamp(finite(input.canvasPanX, 0), -4000, 4000),
    canvasPanY: clamp(finite(input.canvasPanY, 0), -4000, 4000),
    routingMode,
    worldToUm: clamp(finite(input.worldToUm, DEFAULT_WORLD_TO_UM), 1e-4, 100),
    gridUm: clamp(finite(input.gridUm, 5), .01, 10000),
    snapToGrid: Boolean(input.snapToGrid),
    minBendRadiusUm: clamp(finite(input.minBendRadiusUm, 0), 0, 100000),
    figureMode: input.figureMode === 'paper' ? 'paper' : 'workbench',
    paperBackground: input.paperBackground === 'transparent' ? 'transparent' : 'white',
    showPortsInFigure: input.showPortsInFigure !== false,
    showGridInFigure: Boolean(input.showGridInFigure),
    figurePadding: clamp(finite(input.figurePadding, 36), 0, 300)
  };
}

function safeCircuit(input) {
  if (!input || typeof input !== 'object') return makeDemoCircuit();
  const definitions = new Set(listDefinitions().map(definition => definition.type));
  const components = [];
  const usedIds = new Set();
  for (const [index, raw] of (Array.isArray(input.components) ? input.components.slice(0, 500) : []).entries()) {
    const type = definitions.has(raw?.type) ? raw.type : 'generic';
    let id = String(raw?.id ?? `${getDefinition(type).prefix ?? type}-${index + 1}`).slice(0, 100);
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    let params;
    try { params = { ...defaultParams(type), ...deepClone(raw?.params ?? {}) }; }
    catch { params = { ...defaultParams(type) }; }
    components.push({
      id, type,
      name: String(raw?.name ?? labelForType(type)).slice(0, 120),
      x: clamp(finite(raw?.x, 200), -5000, 5000),
      y: clamp(finite(raw?.y, 200), -5000, 5000),
      rotation: clamp(finite(raw?.rotation, 0), -3600, 3600),
      params
    });
  }
  const byId = new Map(components.map(component => [component.id, component]));
  const occupied = new Set();
  const connections = [];
  for (const [index, raw] of (Array.isArray(input.connections) ? input.connections.slice(0, 1000) : []).entries()) {
    const a = { component: String(raw?.a?.component ?? ''), port: String(raw?.a?.port ?? '') };
    const b = { component: String(raw?.b?.component ?? ''), port: String(raw?.b?.port ?? '') };
    const aComponent = byId.get(a.component), bComponent = byId.get(b.component);
    if (!aComponent || !bComponent) continue;
    const aPort = getPorts(aComponent).find(port => port.id === a.port);
    const bPort = getPorts(bComponent).find(port => port.id === b.port);
    if (!aPort || !bPort || (aPort.role ?? 'optical') !== (bPort.role ?? 'optical')) continue;
    const domain = ['optical', 'electrical', 'rf', 'control', 'annotation'].includes(raw?.domain) ? raw.domain : (aPort.role ?? 'optical');
    const keyA = `${a.component}:${a.port}`, keyB = `${b.component}:${b.port}`;
    if (occupied.has(keyA) || occupied.has(keyB) || keyA === keyB) continue;
    occupied.add(keyA); occupied.add(keyB);
    let params;
    const defaults = domain === 'optical' ? { lossDbPerCm: 2, neff: 2.42 } : {};
    try { params = { ...defaults, ...deepClone(raw?.params ?? {}) }; }
    catch { params = { ...defaults }; }
    const waypoints = Array.isArray(raw?.waypoints) ? raw.waypoints.slice(0, 500).map(point => ({ x: clamp(finite(point?.x), -5000, 5000), y: clamp(finite(point?.y), -5000, 5000) })) : [];
    const prefix = domain === 'optical' ? 'wg' : domain === 'electrical' ? 'wire' : domain === 'rf' ? 'rf' : domain === 'control' ? 'ctrl' : 'link';
    connections.push({ id: String(raw?.id ?? `${prefix}-${index + 1}`).slice(0, 100), domain, label: String(raw?.label ?? '').slice(0, 120), a, b, waypoints, params });
  }
  let lab;
  try { lab = deepClone(input.lab ?? { measurements: [] }); }
  catch { lab = { measurements: [] }; }
  if (!Array.isArray(lab.measurements)) lab.measurements = [];
  const circuit = {
    version: 2,
    name: String(input.name ?? 'Imported experiment').slice(0, 160),
    settings: sanitizedSettings(input.settings),
    components, connections, lab,
    parameterLinks: []
  };
  let links = [];
  try { links = deepClone(Array.isArray(input.parameterLinks) ? input.parameterLinks : []); } catch { links = []; }
  const validParameterIds = new Set(listSweepParameters(circuit).map(parameter => parameter.id));
  circuit.parameterLinks = links.slice(0, 200).map((link, index) => ({
    id: String(link?.id ?? `link-${index + 1}`).slice(0, 100),
    name: String(link?.name ?? `Parameter link ${index + 1}`).slice(0, 120),
    unit: String(link?.unit ?? '').slice(0, 30), scope: String(link?.scope ?? 'cw').slice(0, 30),
    members: [...new Set(Array.isArray(link?.members) ? link.members.map(String).filter(id => validParameterIds.has(id)) : [])]
  })).filter(link => link.members.length >= 2);
  return circuit;
}

function base64UrlEncode(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function circuitHash() {
  const clean = deepClone(runtime.circuit);
  clean.settings.canvasPanX = 0;
  clean.settings.canvasPanY = 0;
  return `#c=${base64UrlEncode(new TextEncoder().encode(JSON.stringify(clean)))}`;
}
function loadInitialCircuit() {
  const hash = location.hash.match(/^#c=([A-Za-z0-9_-]+)$/);
  if (hash) {
    try { return safeCircuit(JSON.parse(new TextDecoder().decode(base64UrlDecode(hash[1])))); }
    catch (error) { console.warn('Could not decode circuit from URL.', error); }
  }
  try {
    const stored = localStorage.getItem('picsetup.autosave');
    if (stored) return safeCircuit(JSON.parse(stored));
  } catch (error) { console.warn('Could not read autosave.', error); }
  return makeDemoCircuit();
}

runtime.circuit = loadInitialCircuit();

function snapshot() { return JSON.stringify(runtime.circuit); }
function pushSnapshot(serialized = snapshot()) {
  if (runtime.history.at(-1) === serialized) return;
  runtime.history.push(serialized);
  if (runtime.history.length > 100) runtime.history.shift();
  runtime.future.length = 0;
}
function beginContinuousEdit() { if (!runtime.continuousSnapshot) runtime.continuousSnapshot = snapshot(); }
function endContinuousEdit() {
  if (!runtime.continuousSnapshot) return;
  if (runtime.continuousSnapshot !== snapshot()) pushSnapshot(runtime.continuousSnapshot);
  runtime.continuousSnapshot = null;
  runtime.dirty = true;
  refresh();
  scheduleAutosave();
}
function cleanParameterLinks(circuit) {
  const valid = new Set(listSweepParameters(circuit).map(parameter => parameter.id));
  circuit.parameterLinks = (circuit.parameterLinks ?? []).map(link => ({ ...link, members: [...new Set((link.members ?? []).filter(id => valid.has(id)))] })).filter(link => link.members.length >= 2);
}
function mutateCircuit(mutator, { history = true, inspector = true, lab = false, autosave = true } = {}) {
  if (history) pushSnapshot();
  mutator(runtime.circuit);
  cleanParameterLinks(runtime.circuit);
  runtime.dirty = true;
  refresh({ inspector, lab });
  if (autosave) scheduleAutosave();
}
function replaceCircuit(circuit, { history = true, toast = null } = {}) {
  if (history) pushSnapshot();
  runtime.circuit = safeCircuit(circuit);
  runtime.selection = null;
  runtime.connectStart = null;
  runtime.previewPoints = [];
  runtime.future.length = 0;
  runtime.highlightIds = [];
  runtime.lab.result = null;
  runtime.lab.baselines = [];
  runtime.lab.optimizationResult = null;
  runtime.lab.toleranceResult = null;
  runtime.lab.pulseResult = null;
  runtime.lab.selectedMeasurementId = null;
  runtime.dirty = true;
  refresh({ lab: true });
  fitCircuit();
  scheduleAutosave();
  if (toast) showToast(toast);
}
function undo() {
  if (!runtime.history.length) return;
  runtime.future.push(snapshot());
  runtime.circuit = safeCircuit(JSON.parse(runtime.history.pop()));
  runtime.selection = null;
  runtime.connectStart = null;
  runtime.previewPoints = [];
  runtime.highlightIds = [];
  refresh({ lab: true });
  scheduleAutosave();
}
function redo() {
  if (!runtime.future.length) return;
  runtime.history.push(snapshot());
  runtime.circuit = safeCircuit(JSON.parse(runtime.future.pop()));
  runtime.selection = null;
  runtime.connectStart = null;
  runtime.previewPoints = [];
  runtime.highlightIds = [];
  refresh({ lab: true });
  scheduleAutosave();
}
function scheduleAutosave() {
  clearTimeout(runtime.pendingAutosave);
  runtime.pendingAutosave = setTimeout(() => {
    try {
      localStorage.setItem('picsetup.autosave', JSON.stringify(runtime.circuit));
      runtime.lastSavedAt = Date.now();
      runtime.dirty = false;
    } catch (error) { console.warn('Autosave failed.', error); }
  }, 300);
}

function pinnedMeasurements() {
  runtime.circuit.lab ??= {};
  runtime.circuit.lab.measurements ??= [];
  if (!runtime.circuit.lab.measurements.length) runtime.circuit.lab.measurements = defaultMeasurementSpecs(runtime.circuit);
  return runtime.circuit.lab.measurements;
}
function selectedMeasurement() {
  const measurements = pinnedMeasurements();
  const selected = measurements.find(item => item.id === runtime.lab.selectedMeasurementId) ?? measurements[0];
  runtime.lab.selectedMeasurementId = selected?.id ?? null;
  return selected;
}
function measurementKey(spec) { return `${spec.kind}:${spec.componentId ?? spec.connectionId ?? ''}:${spec.portId ?? ''}:${spec.metric ?? ''}:${spec.direction ?? ''}`; }
function isPinned(spec) { return pinnedMeasurements().some(item => measurementKey(item) === measurementKey(spec)); }
function removeMeasurement(id) {
  runtime.circuit.lab.measurements = pinnedMeasurements().filter(item => item.id !== id);
  if (runtime.lab.selectedMeasurementId === id) runtime.lab.selectedMeasurementId = runtime.circuit.lab.measurements[0]?.id ?? null;
  runtime.dirty = true;
  refresh({ lab: true });
  scheduleAutosave();
}
function addMeasurement(spec, { openLab = true } = {}) {
  pinMeasurement(runtime.circuit, spec);
  const actual = pinnedMeasurements().find(item => measurementKey(item) === measurementKey(spec));
  runtime.lab.selectedMeasurementId = actual?.id ?? runtime.lab.selectedMeasurementId;
  runtime.dirty = true;
  if (openLab) openLabPanel('sweep');
  refresh({ lab: true });
  scheduleAutosave();
}

function renderCanvas() {
  renderer.render(runtime.circuit, runtime.solve, {
    selection: runtime.selection,
    connectStart: runtime.connectStart,
    previewPoints: runtime.previewPoints,
    previewValid: runtime.previewValid,
    pinnedMeasurements: pinnedMeasurements(),
    highlightIds: runtime.highlightIds
  });
}
function refresh({ inspector = true, lab = false } = {}) {
  runtime.solve = solveCircuit(runtime.circuit);
  renderCanvas();
  updateChrome();
  if (inspector) renderInspector();
  if (lab && runtime.lab.open) renderLab();
  if (dom.physicsDialog.open && runtime.selectedCouplerId) updatePhysicsPanel();
}

function updateChrome() {
  const solve = runtime.solve;
  const budget = solve.powerBudget;
  const mode = modeSummary();
  const settings = runtime.circuit.settings;
  dom.projectName.textContent = runtime.circuit.name;
  dom.undoButton.disabled = runtime.history.length === 0;
  dom.redoButton.disabled = runtime.future.length === 0;
  dom.emptyHint.hidden = runtime.circuit.components.length > 0;
  dom.zoomReadout.textContent = `${Math.round((settings.canvasZoom ?? 1) * 100)}%`;
  dom.sourceReadout.textContent = formatPower(solve.sourcePowerMw ?? 0);
  dom.detectedReadout.textContent = formatPower(solve.detectedPowerMw ?? 0);
  dom.balanceReadout.textContent = solve.ok ? formatResidual(solve.residual) : '—';
  const accounted = budget && budget.launchedMw > 0 ? 100 * budget.accountedMw / budget.launchedMw : 100;
  dom.powerBudgetReadout.textContent = `${accounted.toFixed(Math.abs(100 - accounted) < .05 ? 2 : 1)}%`;
  dom.transportModeLabel.textContent = mode.label;
  dom.transportModeDetail.textContent = mode.detail;
  dom.solverHealth.dataset.state = solve.ok ? (solve.warnings?.length || (budget?.balanceErrorFraction ?? 0) > 1e-4 ? 'warning' : 'ok') : 'error';
  dom.solverHealth.querySelector('b').textContent = solve.ok ? (solve.warnings?.length ? 'Check model' : 'Converged') : 'Not solved';
  dom.solverMeta.textContent = `${solve.elapsedMs.toFixed(1)} ms`;
  const routing = settings.routingMode === 'schematic' ? 'schematic' : 'physical';
  dom.routingBadge.textContent = routing === 'physical' ? 'Physical' : 'Schematic';
  dom.routingDetail.textContent = routing === 'physical' ? 'curve = optical length' : 'drawing ≠ optical length';
  const worldToUm = finite(settings.worldToUm, DEFAULT_WORLD_TO_UM);
  const zoom = finite(settings.canvasZoom, 1);
  const scaleWorld = 100 / Math.max(.1, zoom);
  const scaleUm = scaleWorld * worldToUm;
  dom.scaleReadout.textContent = `${scaleUm >= 100 ? scaleUm.toFixed(0) : scaleUm.toFixed(1)} µm`;
  dom.labPinCount.textContent = String(pinnedMeasurements().length);
  dom.labButton.classList.toggle('active', runtime.lab.open);
  dom.figureButton?.classList.toggle('active', settings.figureMode === 'paper');
  updateToolUI();
  updateTimeUI();
}
function updateToolUI() {
  dom.app.dataset.tool = runtime.tool;
  $$('.tool-rail [data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === runtime.tool));
  dom.componentTray.hidden = runtime.tool !== 'place';
  $$('[data-place-type]', dom.componentCatalog).forEach(button => button.classList.toggle('active', button.dataset.placeType === runtime.placeType));
}
function updateTimeUI() {
  const speed = runtime.speed;
  dom.timeKnob.style.setProperty('--angle', `${270 * clamp(speed / 4, 0, 1)}deg`);
  dom.timeKnob.setAttribute('aria-valuenow', String(speed));
  dom.speedReadout.textContent = runtime.paused ? 'Paused' : `${speed.toFixed(1)}×`;
  dom.transportIcon.innerHTML = runtime.paused ? '<path d="m9 7 8 5-8 5z"/>' : '<path d="M9 7v10M15 7v10"/>';
  dom.pauseButton.querySelector('svg').innerHTML = runtime.paused ? '<path d="m9 7 8 5-8 5z"/>' : '<path d="M9 7v10M15 7v10"/>';
  dom.pauseButton.querySelector('span').textContent = runtime.paused ? 'Play' : 'Pause';
}

function buildComponentCatalog() {
  const excluded = new Set(['block']);
  const groups = new Map();
  for (const definition of listDefinitions()) {
    if (excluded.has(definition.type)) continue;
    const category = definition.category ?? 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(definition);
  }
  dom.componentCatalog.innerHTML = [...groups.entries()].map(([category, definitions]) => `<section class="catalog-group">
    <h3>${escapeHTML(category)}</h3>
    ${definitions.map(definition => `<button class="component-card" type="button" data-place-type="${escapeHTML(definition.type)}" title="${escapeHTML(definition.description ?? '')}">
      <span class="component-glyph">${escapeHTML(definition.glyph ?? '•')}</span><b>${escapeHTML(definition.shortLabel ?? definition.label)}</b><small>${escapeHTML((definition.description ?? '').split('.')[0])}</small>
    </button>`).join('')}
  </section>`).join('');
}

function inspectorHead(type, name, subtitle) {
  return `<div class="inspector-head">
    <span class="type-icon ${escapeHTML(type)}"><b>${escapeHTML(iconForType(type))}</b></span>
    <div><h2>${escapeHTML(name)}</h2><p>${escapeHTML(subtitle)}</p></div>
    <button class="icon-button" type="button" data-inspector-action="close" aria-label="Close inspector"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
  </div>`;
}
function parameterScopeCopy(parameter) {
  if (parameter.scope === 'pulse') return 'Used by Lab pulse reconstruction or pulse-train visualization; not part of the CW network solve.';
  if (parameter.scope === 'electrical') return 'Electrical or RF metadata/control; it does not enter the optical CW scattering matrix.';
  if (parameter.scope === 'visual') return 'Figure geometry only; it changes composition and export, not the optical solve.';
  return 'Active in the coherent CW compact model and available as a sweep/tuning knob.';
}
function parameterControl(component, parameter) {
  const targetGlobal = parameter.target === 'global';
  const value = targetGlobal ? runtime.circuit.settings.wavelengthNm : finite(component.params?.[parameter.key], parameter.default);
  const inactive = ['pulse', 'electrical', 'visual'].includes(parameter.scope);
  const parameterId = targetGlobal ? 'global:wavelengthNm' : `component:${component.id}:${parameter.key}`;
  const link = parameterLinkFor(runtime.circuit, parameterId);
  return `<div class="inspector-parameter ${inactive ? 'inactive-model' : ''} ${link ? 'linked-parameter' : ''}">
    <div class="parameter-head"><div><b>${escapeHTML(parameter.label)}</b><small>${escapeHTML(parameterScopeCopy(parameter))}</small></div><output data-param-output="${escapeHTML(parameter.key)}">${escapeHTML(formatParameterValue(parameter, value))}</output></div>
    <input type="range" min="${parameter.min}" max="${parameter.max}" step="${parameter.step}" value="${value}" data-param-key="${escapeHTML(parameter.key)}" data-param-global="${targetGlobal ? 'true' : 'false'}" />
    <div class="parameter-actions">
      <button type="button" data-inspector-action="sweep-parameter" data-parameter-id="${escapeHTML(parameterId)}">∿ Sweep</button>
      <button type="button" data-inspector-action="tolerance-parameter" data-parameter-id="${escapeHTML(parameterId)}">± Tolerance</button>
      <button type="button" data-inspector-action="link-parameter" data-parameter-id="${escapeHTML(parameterId)}">${link ? '⛓ Linked' : '⛓ Link'}</button>
      <span class="scope-pill ${inactive ? (parameter.scope ?? '') : 'active'}">${escapeHTML(parameter.scope ?? 'CW')}</span>
    </div>
  </div>`;
}
function customFieldControl(component, field) {
  const value = component.params?.[field.key] ?? field.default ?? '';
  const common = `data-field-key="${escapeHTML(field.key)}"`;
  let control = '';
  if (field.type === 'select') {
    control = `<select ${common}>${(field.options ?? []).map(([optionValue, label]) => `<option value="${escapeHTML(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    control = `<textarea ${common} rows="4" placeholder="${escapeHTML(field.placeholder ?? '')}">${escapeHTML(value)}</textarea>`;
  } else {
    control = `<input ${common} type="${field.type === 'url' ? 'url' : 'text'}" value="${escapeHTML(value)}" placeholder="${escapeHTML(field.placeholder ?? '')}" />`;
  }
  return `<label class="custom-field"><span>${escapeHTML(field.label)}</span>${control}</label>`;
}
function componentIdentitySection(component) {
  const placement = ['auto','above','below','left','right','hidden'].includes(component.params?.labelPosition) ? component.params.labelPosition : 'auto';
  const subtitleVisibility = component.params?.subtitleVisibility === 'hide' ? 'hide' : 'show';
  return `<section class="inspector-section"><div class="section-title"><b>Figure identity</b><small>Labels and orientation export with the scene</small></div>
    <label class="custom-field"><span>Name / figure label</span><input type="text" data-component-name value="${escapeHTML(component.name ?? '')}" maxlength="120" /></label>
    <div class="identity-grid">
      <label class="custom-field"><span>Label placement</span><select data-component-label-position>
        ${[['auto','Auto'],['above','Above'],['below','Below'],['left','Left'],['right','Right'],['hidden','Hidden']].map(([value,label]) => `<option value="${value}" ${placement===value?'selected':''}>${label}</option>`).join('')}
      </select></label>
      <label class="custom-field"><span>Metadata line</span><select data-component-subtitle-visibility><option value="show" ${subtitleVisibility==='show'?'selected':''}>Show</option><option value="hide" ${subtitleVisibility==='hide'?'selected':''}>Hide</option></select></label>
    </div>
    <div class="identity-grid">
      <label class="custom-field"><span>Label X offset</span><div class="input-row"><input type="number" data-component-label-x min="-1000" max="1000" step="1" value="${finite(component.params?.labelOffsetX,0)}"/><span class="unit">px</span></div></label>
      <label class="custom-field"><span>Label Y offset</span><div class="input-row"><input type="number" data-component-label-y min="-1000" max="1000" step="1" value="${finite(component.params?.labelOffsetY,0)}"/><span class="unit">px</span></div></label>
    </div>
    <label class="custom-field"><span>Rotation</span><div class="input-row"><input type="number" data-component-rotation min="-3600" max="3600" step="1" value="${finite(component.rotation,0)}"/><span class="unit">deg</span></div></label>
  </section>`;
}

function measurementPinButton(spec, label = 'Pin') {
  const payload = encodeURIComponent(JSON.stringify(spec));
  return `<button type="button" class="pin-button ${isPinned(spec) ? 'active' : ''}" data-inspector-action="pin-measurement" data-measurement="${payload}">${isPinned(spec) ? '✓ Pinned' : `＋ ${escapeHTML(label)}`}</button>`;
}
function componentMeasurementSection(component, result) {
  const definition = getDefinition(component.type);
  const ports = getPorts(component).filter(port => (port.role ?? 'optical') === 'optical');
  if (!ports.length) return `<section class="inspector-section"><div class="model-warning"><b>Figure-only typed component</b><p>This object and its non-optical ports are exported but intentionally excluded from the coherent optical solve.</p></div></section>`;
  const rows = ports.map(port => {
    const solved = result?.ports?.[port.id];
    const spec = { kind: 'port', componentId: component.id, portId: port.id, direction: 'incoming', metric: 'power', label: `${component.name}:${port.label} incoming power` };
    return `<div class="port-measurement"><div><b>${escapeHTML(port.label)} · incoming</b><small>phase ${formatPhase(solved?.incomingPhaseRad ?? 0)} · outgoing ${formatPower(solved?.outgoingPowerMw ?? 0)}</small></div><output>${formatPower(solved?.incomingPowerMw ?? 0)}</output>${measurementPinButton(spec)}</div>`;
  }).join('');
  const componentSpecs = [];
  if (definition.detector || definition.probe || definition.bridge) componentSpecs.push({ kind: 'component', componentId: component.id, metric: 'power', label: `${component.name} power` });
  if (definition.detector) componentSpecs.push({ kind: 'component', componentId: component.id, metric: 'current', label: `${component.name} photocurrent` });
  return `<section class="inspector-section">
    <div class="section-title"><b>Measurements</b><small>Pin outputs to Lab</small></div>
    ${componentSpecs.length ? `<div class="measurement-chips">${componentSpecs.map(spec => measurementPinButton(spec, spec.metric === 'current' ? 'Current' : 'Power')).join('')}</div>` : ''}
    <div class="port-measurements" style="margin-top:${componentSpecs.length ? '9px' : '0'}">${rows}</div>
  </section>`;
}
function componentMetrics(component, result) {
  const definition = getDefinition(component.type);
  const opticalPorts = Object.values(result?.ports ?? {}).filter(port => (port.domain ?? 'optical') === 'optical');
  const incoming = opticalPorts.reduce((sum, port) => sum + finite(port.incomingPowerMw), 0);
  const outgoing = opticalPorts.reduce((sum, port) => sum + finite(port.outgoingPowerMw), 0);
  const cells = definition.diagramOnly && !opticalPorts.length ? [
    ['Solver status', 'Figure only'], ['Typed ports', String(getPorts(component).length)], ['Domain owner', component.type.includes('rf') ? 'Electrical' : 'System figure'], ['Export', 'SVG / PNG']
  ] : [
    ['Incident power', formatPower(incoming)],
    ['Outgoing power', formatPower(outgoing)],
    ['Model loss', formatPower(Math.max(0, result?.power?.netDissipationMw ?? 0))],
    ['Ports', String(getPorts(component).length)]
  ];
  if (definition.detector) {
    cells[0] = ['Optical power', formatPower(result?.measurementMw ?? 0)];
    cells[1] = ['Photocurrent', `${finite(result?.photocurrentMa).toFixed(4)} mA`];
  } else if (component.type === 'coupler') {
    const coefficient = couplerCoefficients(component.params, runtime.solve.wavelengthNm);
    cells[2] = ['Cross fraction', `${(100 * coefficient.crossPower).toFixed(2)}%`];
    cells[3] = ['Coupling angle', `${coefficient.theta.toFixed(3)} rad`];
  }
  return `<section class="inspector-section"><div class="inspector-metrics">${cells.map(([label, value]) => `<span><small>${escapeHTML(label)}</small><b>${escapeHTML(value)}</b></span>`).join('')}</div></section>`;
}
function renderComponentInspector(id) {
  const component = runtime.circuit.components.find(item => item.id === id);
  if (!component) { runtime.selection = null; return renderInspector(); }
  const definition = getDefinition(component.type);
  const result = runtime.solve.components?.get(component.id);
  const sourceSpecial = component.type === 'source' ? `<section class="inspector-section">
    <div class="section-title"><b>Source behavior</b><small>Model and visual layer are explicit</small></div>
    <div class="mode-switch"><button type="button" data-source-mode="cw" class="${currentSourceMode(component) === 'cw' ? 'active' : ''}">CW</button><button type="button" data-source-mode="pulsed" class="${currentSourceMode(component) === 'pulsed' ? 'active' : ''}">Pulsed</button></div>
    <div class="mode-switch"><button type="button" data-source-visualization="solid" class="${currentCwVisualization(component) === 'solid' ? 'active' : ''}">Solid field</button><button type="button" data-source-visualization="tracers" class="${currentCwVisualization(component) === 'tracers' ? 'active' : ''}">Direction tracers</button></div>
    <small class="source-note">The canvas animation is explanatory. Lab → Pulse reconstructs the linear temporal response from the complex spectrum.</small>
  </section>` : '';
  const specialActions = [
    component.type === 'optical-bridge' ? `<button class="inspector-action" type="button" data-inspector-action="open-opticalsetup"><span><b>Open this port in OpticalSetup</b><small>Versioned setup-port/1 payload · wavelength, power, polarization, timing</small></span><span class="arrow">↗</span></button><button class="inspector-action" type="button" data-inspector-action="copy-bridge"><span><b>Copy bridge JSON</b><small>Portable typed boundary contract</small></span><span class="arrow">{ }</span></button><button class="inspector-action" type="button" data-inspector-action="export-bridge"><span><b>Export bridge manifest</b><small>Share with another setup or preserve with a paper</small></span><span class="arrow">⇩</span></button>` : '',
    component.type === 'image-panel' ? `<button class="inspector-action" type="button" data-inspector-action="attach-image"><span><b>Attach local image</b><small>Microscope, SEM, simulation rendering, or photograph</small></span><span class="arrow">▧</span></button>${component.params?.imageDataUrl ? `<button class="inspector-action" type="button" data-inspector-action="clear-image"><span><b>Clear image</b><small>Keep the resizable panel placeholder</small></span><span class="arrow">×</span></button>` : ''}` : '',
    component.type === 'coupler' ? `<button class="inspector-action" type="button" data-inspector-action="open-physics"><span><b>Open the black box</b><small>Power → phase → field → supermodes</small></span><span class="arrow">↗</span></button>` : '',
    component.type === 'block' ? `<button class="inspector-action" type="button" data-inspector-action="open-block"><span><b>Inspect hierarchy</b><small>${component.params?.subcircuit?.components?.length ?? 0} internal components · live reduced S matrix</small></span><span class="arrow">↗</span></button><button class="inspector-action" type="button" data-inspector-action="expand-block"><span><b>Expand onto canvas</b><small>Restore the editable internal graph</small></span><span class="arrow">↘</span></button>` : '',
    component.type === 'generic' ? `<button class="inspector-action" type="button" data-inspector-action="import-sparams"><span><b>Replace S-parameter table</b><small>JSON or CSV · complex wavelength-indexed matrix</small></span><span class="arrow">⇧</span></button>` : ''
  ].join('');
  const parameters = (definition.parameters ?? []).map(parameter => parameterControl(component, parameter)).join('');
  const fields = (definition.fields ?? []).map(field => customFieldControl(component, field)).join('');
  const provenance = component.params?.provenance ?? definition.provenance ?? 'Analytical compact model';
  dom.inspectorContent.innerHTML = `${inspectorHead(component.type, component.name, `${definition.label} · ${component.id}`)}
    ${sourceSpecial}
    ${componentIdentitySection(component)}
    ${fields ? `<section class="inspector-section"><div class="section-title"><b>Figure / interface fields</b><small>Typed metadata travels with exports and bridges</small></div><div class="custom-fields">${fields}</div></section>` : ''}
    ${parameters ? `<section class="inspector-section"><div class="section-title"><b>Model parameters</b><small>Every control declares its active scope</small></div>${parameters}</section>` : ''}
    ${specialActions ? `<section class="inspector-section">${specialActions}</section>` : ''}
    ${componentMetrics(component, result)}
    ${componentMeasurementSection(component, result)}
    <section class="inspector-section"><div class="section-title"><b>Model contract</b><span class="provenance-pill">${escapeHTML(definition.diagramOnly ? 'Figure only' : component.type === 'generic' ? 'Imported' : component.type === 'block' ? 'Hierarchical' : definition.bridge ? 'Bridge' : 'Analytical')}</span></div>
      <div class="provenance-card"><b>${escapeHTML(provenance)}</b><p>${escapeHTML(definition.description ?? '')}</p></div>
      <div style="margin-top:8px">${(definition.assumptions ?? []).map(assumption => `<span class="assumption-chip">${escapeHTML(assumption)}</span>`).join('')}</div>
    </section>
    <section class="inspector-section"><button class="danger-button" type="button" data-inspector-action="delete">Delete ${escapeHTML(component.name)}</button></section>`;
}
function connectionFigureSection(connection) {
  const arrow = ['none','start','end','both'].includes(connection.params?.arrow) ? connection.params.arrow : 'none';
  return `<section class="inspector-section"><div class="section-title"><b>Figure annotation</b><small>Rendered on canvas and in SVG / PNG</small></div>
    <label class="custom-field"><span>Connection label</span><input type="text" data-connection-label value="${escapeHTML(connection.label ?? '')}" placeholder="clock, bias, CH1, heater drive…" /></label>
    <label class="custom-field"><span>Direction arrow</span><select data-connection-arrow>
      ${[['none','No arrow'],['end','A → B'],['start','A ← B'],['both','Bidirectional']].map(([value,label]) => `<option value="${value}" ${arrow===value?'selected':''}>${label}</option>`).join('')}
    </select></label>
    <div class="identity-grid">
      <label class="custom-field"><span>Label X offset</span><div class="input-row"><input type="number" data-connection-label-x min="-1000" max="1000" step="1" value="${finite(connection.params?.labelOffsetX,0)}"/><span class="unit">px</span></div></label>
      <label class="custom-field"><span>Label Y offset</span><div class="input-row"><input type="number" data-connection-label-y min="-1000" max="1000" step="1" value="${finite(connection.params?.labelOffsetY,-11)}"/><span class="unit">px</span></div></label>
    </div>
  </section>`;
}

function renderConnectionInspector(id) {
  const connection = runtime.circuit.connections.find(item => item.id === id);
  if (!connection) { runtime.selection = null; return renderInspector(); }
  const solved = runtime.solve.connections?.get(connection.id);
  const aComponent = runtime.circuit.components.find(item => item.id === connection.a.component);
  const bComponent = runtime.circuit.components.find(item => item.id === connection.b.component);
  const domain = connectionDomain(connection, runtime.circuit.components);
  if (domain !== 'optical') {
    const domainLabel = domain === 'rf' ? 'RF / coax' : domain === 'electrical' ? 'Electrical signal' : domain === 'control' ? 'Control / logic' : 'Typed connection';
    dom.inspectorContent.innerHTML = `${inspectorHead('waveguide', domainLabel, `${aComponent?.name ?? '?'}:${connection.a.port} ↔ ${bComponent?.name ?? '?'}:${connection.b.port}`)}
      <section class="inspector-section"><div class="section-title"><b>Domain contract</b><small>Preserved in paper figures and semantic exports</small></div><div class="model-warning"><b>Not an optical waveguide</b><p>This ${escapeHTML(domain)} connection is intentionally excluded from the coherent photonic solver. Its owning simulator can consume it through a future typed bridge.</p></div></section>
      ${connectionFigureSection(connection)}
      <section class="inspector-section"><div class="inspector-metrics"><span><small>Domain</small><b>${escapeHTML(domain)}</b></span><span><small>Endpoints</small><b>2 typed ports</b></span><span><small>Optical solve</small><b>Excluded</b></span><span><small>Export</small><b>Included</b></span></div></section>
      <section class="inspector-section"><button class="danger-button" type="button" data-inspector-action="delete">Delete ${escapeHTML(domainLabel.toLowerCase())}</button></section>`;
    return;
  }
  const transmission = waveguideTransmission(connection, runtime.circuit.components, runtime.solve.wavelengthNm, runtime.circuit.settings);
  const mode = connection.params?.routingMode ?? runtime.circuit.settings.routingMode ?? 'physical';
  const powerSpec = { kind: 'connection', connectionId: connection.id, direction: 'forward', metric: 'power', label: `${connection.id} forward power` };
  const opticalLengthId = `connection:${connection.id}:length`;
  const lengthControl = mode === 'schematic' ? `<div class="inspector-parameter"><div class="parameter-head"><div><b>Explicit optical length</b><small>Independent of the drawn route in schematic mode.</small></div><output data-connection-output="schematicLengthUm">${transmission.lengthUm.toFixed(2)} µm</output></div><input type="range" min="0" max="10000" step="0.1" value="${transmission.lengthUm}" data-connection-param="schematicLengthUm"/><div class="parameter-actions"><button type="button" data-inspector-action="sweep-parameter" data-parameter-id="${opticalLengthId}">∿ Sweep</button><button type="button" data-inspector-action="tolerance-parameter" data-parameter-id="${opticalLengthId}">± Tolerance</button><button type="button" data-inspector-action="link-parameter" data-parameter-id="${opticalLengthId}">${parameterLinkFor(runtime.circuit, opticalLengthId) ? '⛓ Linked' : '⛓ Link'}</button><span class="scope-pill active">CW</span></div></div>` : '';
  dom.inspectorContent.innerHTML = `${inspectorHead('waveguide', 'Waveguide', `${aComponent?.name ?? '?'}:${connection.a.port} ↔ ${bComponent?.name ?? '?'}:${connection.b.port}`)}
    ${connectionFigureSection(connection)}
    <section class="inspector-section"><div class="section-title"><b>Routing contract</b><small>${mode === 'physical' ? 'Rendered curve is measured' : 'Drawing is topology only'}</small></div>
      <div class="mode-switch"><button type="button" data-connection-routing="physical" class="${mode === 'physical' ? 'active' : ''}">Physical path</button><button type="button" data-connection-routing="schematic" class="${mode === 'schematic' ? 'active' : ''}">Schematic</button></div>
      <small class="source-note">Physical mode numerically integrates the exact cubic path that is rendered. Schematic mode stores an independent optical length.</small>
      ${lengthControl}
    </section>
    <section class="inspector-section"><div class="section-title"><b>Propagation</b><small>Complex bidirectional transmission</small></div>
      ${connectionParameterControl(connection, 'neff', 'Effective index nₑff', '', 1, 4.5, .001, opticalLengthId.replace(':length', ':neff'))}
      ${connectionParameterControl(connection, 'lossDbPerCm', 'Propagation loss', 'dB/cm', 0, 50, .05, opticalLengthId.replace(':length', ':lossDbPerCm'))}
    </section>
    <section class="inspector-section"><div class="inspector-metrics">
      <span><small>Exact optical length</small><b>${transmission.lengthUm.toFixed(3)} µm</b></span><span><small>Phase delay</small><b>${formatPhase(transmission.phase)}</b></span>
      <span><small>Forward power</small><b>${formatPower(solved?.powerFromAMw ?? 0)}</b></span><span><small>Waveguide loss</small><b>${formatPower(solved?.lossMw ?? 0)}</b></span>
      <span><small>Minimum bend radius</small><b>${Number.isFinite(transmission.minimumBendRadiusUm) ? `${transmission.minimumBendRadiusUm.toFixed(2)} µm` : 'straight'}</b></span><span><small>Declared minimum</small><b>${transmission.requiredBendRadiusUm.toFixed(2)} µm</b></span>
    </div>${transmission.bendViolation ? `<div class="model-warning"><b>Bend-radius declaration violated</b><p>The compact waveguide model continues with straight-section loss only; PicSetup does not silently invent a bend-loss coefficient.</p></div>` : ''}</section>
    <section class="inspector-section"><div class="section-title"><b>Measurement</b><small>Pin the complex path response</small></div>${measurementPinButton(powerSpec, 'Forward power')}</section>
    <section class="inspector-section"><button class="danger-button" type="button" data-inspector-action="delete">Delete waveguide</button></section>`;
}
function connectionParameterControl(connection, key, label, unit, min, max, step, parameterId) {
  const value = finite(connection.params?.[key], key === 'neff' ? 2.42 : 2);
  const digits = step >= 1 ? 0 : step >= .1 ? 1 : step >= .01 ? 2 : 3;
  return `<div class="inspector-parameter"><div class="parameter-head"><div><b>${escapeHTML(label)}</b><small>Active in the waveguide complex transmission model.</small></div><output data-connection-output="${key}">${value.toFixed(digits)}${unit ? ` ${escapeHTML(unit)}` : ''}</output></div><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-connection-param="${key}" data-unit="${escapeHTML(unit)}"/><div class="parameter-actions"><button type="button" data-inspector-action="sweep-parameter" data-parameter-id="${escapeHTML(parameterId)}">∿ Sweep</button><button type="button" data-inspector-action="tolerance-parameter" data-parameter-id="${escapeHTML(parameterId)}">± Tolerance</button><button type="button" data-inspector-action="link-parameter" data-parameter-id="${escapeHTML(parameterId)}">${parameterLinkFor(runtime.circuit, parameterId) ? '⛓ Linked' : '⛓ Link'}</button><span class="scope-pill active">CW</span></div></div>`;
}
function renderMultiInspector(ids) {
  const components = ids.map(id => runtime.circuit.components.find(item => item.id === id)).filter(Boolean);
  if (components.length < 2) { runtime.selection = components[0] ? { kind: 'component', id: components[0].id } : null; return renderInspector(); }
  dom.inspectorContent.innerHTML = `${inspectorHead('block', `${components.length} components`, 'Multi-selection · reusable hierarchy')}
    <section class="inspector-section"><div class="selection-summary"><h3>Create a functional block</h3><p>PicSetup will preserve the selected passive graph, expose every boundary/open port, and reduce it to a live wavelength-dependent external scattering model.</p></div>
      <div class="input-row"><input id="blockNameInput" type="text" value="Functional block" maxlength="80"/><span class="unit">name</span></div>
      <button class="inspector-action" type="button" data-inspector-action="create-block"><span><b>Collapse into reusable block</b><small>${components.map(component => component.name).join(' · ')}</small></span><span class="arrow">▣</span></button>
    </section>
    <section class="inspector-section"><div class="section-title"><b>Selected objects</b><small>Shift-tap to add or remove</small></div>${components.map(component => `<div class="port-measurement"><div><b>${escapeHTML(component.name)}</b><small>${escapeHTML(labelForType(component.type))} · ${escapeHTML(component.id)}</small></div><output>${escapeHTML(iconForType(component.type))}</output><button class="small-action" type="button" data-inspector-action="remove-multi" data-id="${escapeHTML(component.id)}">Remove</button></div>`).join('')}</section>
    <section class="inspector-section"><button class="danger-button" type="button" data-inspector-action="delete">Delete ${components.length} components</button></section>`;
}
function renderInspector() {
  const selection = runtime.selection;
  if (!selection) {
    dom.inspectorEmpty.hidden = false;
    dom.inspectorContent.hidden = true;
    dom.inspector.classList.remove('open');
    return;
  }
  dom.inspectorEmpty.hidden = true;
  dom.inspectorContent.hidden = false;
  dom.inspector.classList.add('open');
  if (selection.kind === 'component') renderComponentInspector(selection.id);
  else if (selection.kind === 'connection') renderConnectionInspector(selection.id);
  else if (selection.kind === 'multi') renderMultiInspector(selection.ids ?? []);
}

function updateSelectedComponentParameter(component, key, value, global = false) {
  if (global) {
    runtime.circuit.settings.wavelengthNm = value;
    runtime.circuit.components.filter(item => item.type === 'source').forEach(source => { source.params.wavelengthNm = value; });
  } else component.params[key] = value;
}
function bindInspectorDelegation() {
  dom.inspectorContent.addEventListener('pointerdown', event => {
    if (event.target.matches('input[type="range"]')) beginContinuousEdit();
  });
  dom.inspectorContent.addEventListener('input', event => {
    const selection = runtime.selection;
    if (event.target.matches('[data-param-key]') && selection?.kind === 'component') {
      const component = runtime.circuit.components.find(item => item.id === selection.id);
      if (!component) return;
      const key = event.target.dataset.paramKey;
      const global = event.target.dataset.paramGlobal === 'true';
      const definition = getDefinition(component.type).parameters?.find(parameter => parameter.key === key);
      const parameterId = global ? 'global:wavelengthNm' : `component:${component.id}:${key}`;
      resolveParameter(runtime.circuit, parameterId).set(runtime.circuit, finite(event.target.value));
      const output = dom.inspectorContent.querySelector(`[data-param-output="${CSS.escape(key)}"]`);
      if (output) output.textContent = formatParameterValue(definition, event.target.value);
      runtime.solve = solveCircuit(runtime.circuit);
      renderCanvas(); updateChrome();
      if (dom.physicsDialog.open) updatePhysicsPanel();
    } else if (event.target.matches('[data-connection-param]') && selection?.kind === 'connection') {
      const connection = runtime.circuit.connections.find(item => item.id === selection.id);
      if (!connection) return;
      const key = event.target.dataset.connectionParam;
      const parameterId = `connection:${connection.id}:${key === 'schematicLengthUm' ? 'length' : key}`;
      resolveParameter(runtime.circuit, parameterId).set(runtime.circuit, finite(event.target.value));
      if (key === 'schematicLengthUm') connection.params.routingMode = 'schematic';
      const output = dom.inspectorContent.querySelector(`[data-connection-output="${CSS.escape(key)}"]`);
      if (output) output.textContent = key === 'schematicLengthUm' ? `${finite(event.target.value).toFixed(2)} µm` : `${finite(event.target.value).toFixed(key === 'neff' ? 3 : 2)}${event.target.dataset.unit ? ` ${event.target.dataset.unit}` : ''}`;
      runtime.solve = solveCircuit(runtime.circuit); renderCanvas(); updateChrome();
    }
  });
  dom.inspectorContent.addEventListener('change', event => {
    const selection = runtime.selection;
    if (event.target.matches('input[type="range"]')) { endContinuousEdit(); return; }
    if (selection?.kind === 'component' && event.target.matches('[data-field-key], [data-component-name], [data-component-rotation], [data-component-label-position], [data-component-subtitle-visibility], [data-component-label-x], [data-component-label-y]')) {
      const componentId = selection.id;
      mutateCircuit(circuit => {
        const component = circuit.components.find(item => item.id === componentId);
        if (!component) return;
        if (event.target.matches('[data-component-name]')) component.name = String(event.target.value || getDefinition(component.type).label).slice(0,120);
        else if (event.target.matches('[data-component-rotation]')) component.rotation = clamp(finite(event.target.value,0),-3600,3600);
        else if (event.target.matches('[data-component-label-position]')) component.params.labelPosition = ['auto','above','below','left','right','hidden'].includes(event.target.value) ? event.target.value : 'auto';
        else if (event.target.matches('[data-component-subtitle-visibility]')) component.params.subtitleVisibility = event.target.value === 'hide' ? 'hide' : 'show';
        else if (event.target.matches('[data-component-label-x]')) component.params.labelOffsetX = clamp(finite(event.target.value,0),-1000,1000);
        else if (event.target.matches('[data-component-label-y]')) component.params.labelOffsetY = clamp(finite(event.target.value,0),-1000,1000);
        else component.params[event.target.dataset.fieldKey] = String(event.target.value).slice(0,1000000);
      });
      return;
    }
    if (selection?.kind === 'connection' && event.target.matches('[data-connection-label], [data-connection-arrow], [data-connection-label-x], [data-connection-label-y]')) {
      const id = selection.id;
      mutateCircuit(circuit => {
        const connection = circuit.connections.find(item => item.id === id);
        if (!connection) return;
        connection.params ??= {};
        if (event.target.matches('[data-connection-label]')) connection.label = String(event.target.value).slice(0,120);
        else if (event.target.matches('[data-connection-arrow]')) connection.params.arrow = ['none','start','end','both'].includes(event.target.value) ? event.target.value : 'none';
        else if (event.target.matches('[data-connection-label-x]')) connection.params.labelOffsetX = clamp(finite(event.target.value,0),-1000,1000);
        else connection.params.labelOffsetY = clamp(finite(event.target.value,-11),-1000,1000);
      });
    }
  });
  dom.inspectorContent.addEventListener('click', event => {
    const sourceMode = event.target.closest('[data-source-mode]');
    if (sourceMode && runtime.selection?.kind === 'component') {
      mutateCircuit(circuit => { const component = circuit.components.find(item => item.id === runtime.selection.id); if (component) component.params.sourceMode = sourceMode.dataset.sourceMode; });
      return;
    }
    const sourceVisual = event.target.closest('[data-source-visualization]');
    if (sourceVisual && runtime.selection?.kind === 'component') {
      mutateCircuit(circuit => { const component = circuit.components.find(item => item.id === runtime.selection.id); if (component) component.params.cwVisualization = sourceVisual.dataset.sourceVisualization; });
      return;
    }
    const routing = event.target.closest('[data-connection-routing]');
    if (routing && runtime.selection?.kind === 'connection') {
      mutateCircuit(circuit => {
        const connection = circuit.connections.find(item => item.id === runtime.selection.id);
        if (!connection) return;
        if (routing.dataset.connectionRouting === 'schematic' && !Number.isFinite(Number(connection.params.schematicLengthUm))) connection.params.schematicLengthUm = connectionLengthUm(connection, circuit.components, { ...circuit.settings, routingMode: 'physical' });
        connection.params.routingMode = routing.dataset.connectionRouting;
      });
      return;
    }
    const action = event.target.closest('[data-inspector-action]');
    if (!action) return;
    handleInspectorAction(action);
  });
}
function handleInspectorAction(button) {
  const action = button.dataset.inspectorAction;
  if (action === 'close') { runtime.selection = null; refresh(); return; }
  if (action === 'delete') { deleteSelection(); return; }
  if (action === 'open-physics' && runtime.selection?.kind === 'component') { openPhysics(runtime.selection.id); return; }
  if (action === 'open-block' && runtime.selection?.kind === 'component') { openBlockSheet(runtime.selection.id); return; }
  if (action === 'expand-block' && runtime.selection?.kind === 'component') {
    const id = runtime.selection.id;
    mutateCircuit(circuit => { const ids = expandHierarchicalBlock(circuit, id); runtime.selection = { kind: 'multi', ids }; }, { lab: true });
    showToast('Block expanded. Its internal graph is editable again.');
    return;
  }
  if (action === 'import-sparams') { importSParameters(runtime.selection?.kind === 'component' ? runtime.selection.id : null); return; }
  if (action === 'open-opticalsetup' && runtime.selection?.kind === 'component') {
    const component = runtime.circuit.components.find(item => item.id === runtime.selection.id);
    if (!component) return;
    const payload = buildOpticalBridgePayload(runtime.circuit, component, runtime.solve, { returnUrl: location.href });
    const url = opticalSetupBridgeUrl(payload, component.params?.targetUrl);
    window.open(url, '_blank', 'noopener');
    showToast('OpticalSetup opened with a setup-port/1 handoff. Its editor must support incomingBridge to instantiate it automatically.');
    return;
  }
  if ((action === 'copy-bridge' || action === 'export-bridge') && runtime.selection?.kind === 'component') {
    const component = runtime.circuit.components.find(item => item.id === runtime.selection.id);
    if (!component) return;
    const payload = buildOpticalBridgePayload(runtime.circuit, component, runtime.solve, { returnUrl: location.href });
    const json = JSON.stringify(payload, null, 2);
    if (action === 'copy-bridge') navigator.clipboard?.writeText(json).then(() => showToast('Typed optical bridge JSON copied.')).catch(() => downloadText(`${slug(component.name)}-bridge.json`, json, 'application/json'));
    else downloadText(`${slug(component.name)}-bridge.json`, json, 'application/json');
    return;
  }
  if (action === 'attach-image' && runtime.selection?.kind === 'component') {
    const id = runtime.selection.id;
    chooseFile('image/png,image/jpeg,image/webp,image/svg+xml', file => {
      if (file.size > 8 * 1024 * 1024) return showToast('Use an image smaller than 8 MB for portable figure files.');
      const reader = new FileReader();
      reader.onload = () => mutateCircuit(circuit => { const component = circuit.components.find(item => item.id === id); if (component) component.params.imageDataUrl = String(reader.result); });
      reader.onerror = () => showToast('Could not read that image.');
      reader.readAsDataURL(file);
    });
    return;
  }
  if (action === 'clear-image' && runtime.selection?.kind === 'component') {
    const id = runtime.selection.id;
    mutateCircuit(circuit => { const component = circuit.components.find(item => item.id === id); if (component) component.params.imageDataUrl = ''; });
    return;
  }
  if (action === 'pin-measurement') {
    try { addMeasurement(JSON.parse(decodeURIComponent(button.dataset.measurement))); }
    catch { showToast('Could not pin that measurement.'); }
    return;
  }
  if (action === 'sweep-parameter') { configureSweepParameter(button.dataset.parameterId); openLabPanel('sweep'); return; }
  if (action === 'tolerance-parameter') { configureToleranceParameter(button.dataset.parameterId); openLabPanel('tolerance'); return; }
  if (action === 'link-parameter') { openParameterLinkSheet(button.dataset.parameterId); return; }
  if (action === 'create-block' && runtime.selection?.kind === 'multi') {
    const name = $('#blockNameInput', dom.inspectorContent)?.value?.trim() || 'Functional block';
    const ids = [...runtime.selection.ids];
    try {
      mutateCircuit(circuit => { const block = createHierarchicalBlock(circuit, ids, { id: uniqueId('block'), name }); runtime.selection = { kind: 'component', id: block.id }; }, { lab: true });
      showToast(`${name} created with a live reduced external model.`);
    } catch (error) { showToast(error.message); }
    return;
  }
  if (action === 'remove-multi' && runtime.selection?.kind === 'multi') {
    runtime.selection.ids = runtime.selection.ids.filter(id => id !== button.dataset.id);
    refresh();
  }
}

function deleteSelection() {
  const selection = runtime.selection;
  if (!selection) return;
  mutateCircuit(circuit => {
    if (selection.kind === 'connection') circuit.connections = circuit.connections.filter(item => item.id !== selection.id);
    else {
      const ids = new Set(selection.kind === 'multi' ? selection.ids : [selection.id]);
      circuit.components = circuit.components.filter(item => !ids.has(item.id));
      circuit.connections = circuit.connections.filter(item => !ids.has(item.a.component) && !ids.has(item.b.component));
      circuit.lab.measurements = pinnedMeasurements().filter(item => !ids.has(item.componentId));
    }
    runtime.selection = null;
  }, { lab: true });
}
function setTool(tool) {
  runtime.tool = tool;
  runtime.connectStart = null;
  runtime.previewPoints = [];
  runtime.previewValid = null;
  runtime.interaction = null;
  updateToolUI();
}
function uniqueId(prefix) {
  const existing = new Set([...runtime.circuit.components.map(item => item.id), ...runtime.circuit.connections.map(item => item.id)]);
  let index = 1;
  while (existing.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}
function placeComponent(type, point) {
  const definition = getDefinition(type);
  const component = {
    id: uniqueId(definition.prefix ?? type), type,
    name: `${definition.shortLabel ?? definition.label} ${runtime.circuit.components.filter(item => item.type === type).length + 1}`,
    x: point.x, y: point.y, rotation: 0, params: defaultParams(type)
  };
  if (type === 'source') component.params.wavelengthNm = runtime.circuit.settings.wavelengthNm;
  mutateCircuit(circuit => { circuit.components.push(component); runtime.selection = { kind: 'component', id: component.id }; });
  runtime.tool = 'select';
  updateToolUI();
}
function simplifyPoints(points, tolerance = 5) {
  if (points.length <= 2) return points;
  const output = [points[0]];
  let last = points[0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= tolerance) { output.push(point); last = point; }
  }
  output.push(points.at(-1));
  if (output.length <= 3) return output;
  const smoothed = [output[0]];
  for (let index = 1; index < output.length - 1; index += 1) {
    const a = smoothed.at(-1), b = output[index], c = output[index + 1];
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const length = Math.max(1, Math.hypot(c.x - a.x, c.y - a.y));
    if (area / length > 2.5) smoothed.push(b);
  }
  smoothed.push(output.at(-1));
  return smoothed;
}
function startConnection(endpoint, point, pointerId) {
  runtime.connectStart = endpoint;
  runtime.previewPoints = [point];
  runtime.previewValid = null;
  runtime.interaction = { mode: 'draw-connection', pointerId, start: endpoint, candidate: null };
  dom.svg.setPointerCapture?.(pointerId);
  refresh({ inspector: false });
}
function completeConnection(point) {
  const interaction = runtime.interaction;
  if (!interaction || interaction.mode !== 'draw-connection') return cancelConnection();
  const candidate = interaction.candidate ?? nearestPort(runtime.circuit, point, 34 / (runtime.circuit.settings.canvasZoom ?? 1), interaction.start);
  const validation = validateConnection(runtime.circuit, interaction.start, candidate);
  if (!validation.ok) { showToast(validation.reason); return cancelConnection(); }
  const startComponent = runtime.circuit.components.find(item => item.id === interaction.start.component);
  const endComponent = runtime.circuit.components.find(item => item.id === candidate.component);
  const startPort = portPosition(startComponent, interaction.start.port);
  const endPort = portPosition(endComponent, candidate.port);
  let points = simplifyPoints(runtime.previewPoints, 7);
  points[0] = { x: startPort.x, y: startPort.y };
  points[points.length - 1] = { x: endPort.x, y: endPort.y };
  const waypoints = points.slice(1, -1);
  const declaredPort = getPorts(startComponent).find(port => port.id === interaction.start.port);
  const domain = declaredPort?.role ?? 'optical';
  const prefix = domain === 'optical' ? 'wg' : domain === 'electrical' ? 'wire' : domain === 'rf' ? 'rf' : domain === 'control' ? 'ctrl' : 'link';
  const connection = {
    id: uniqueId(prefix), domain,
    a: { component: interaction.start.component, port: interaction.start.port },
    b: { component: candidate.component, port: candidate.port },
    waypoints,
    params: domain === 'optical' ? { lossDbPerCm: 2, neff: 2.42 } : {}
  };
  mutateCircuit(circuit => { circuit.connections.push(connection); runtime.selection = { kind: 'connection', id: connection.id }; });
  cancelConnection(false);
}
function cancelConnection(render = true) {
  runtime.connectStart = null;
  runtime.previewPoints = [];
  runtime.previewValid = null;
  runtime.interaction = null;
  if (render) refresh();
}
function toggleMultiSelection(id) {
  if (runtime.selection?.kind === 'multi') {
    const ids = runtime.selection.ids.includes(id) ? runtime.selection.ids.filter(item => item !== id) : [...runtime.selection.ids, id];
    runtime.selection = ids.length > 1 ? { kind: 'multi', ids } : ids.length === 1 ? { kind: 'component', id: ids[0] } : null;
  } else if (runtime.selection?.kind === 'component' && runtime.selection.id !== id) runtime.selection = { kind: 'multi', ids: [runtime.selection.id, id] };
  else if (runtime.selection?.kind === 'component' && runtime.selection.id === id) runtime.selection = null;
  else runtime.selection = { kind: 'component', id };
}

function handleCanvasPointerDown(event) {
  runtime.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (runtime.pointers.size === 2) {
    const [first, second] = [...runtime.pointers.values()];
    runtime.pinch = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      centerX: (first.x + second.x) / 2, centerY: (first.y + second.y) / 2,
      zoom: runtime.circuit.settings.canvasZoom,
      panX: runtime.circuit.settings.canvasPanX, panY: runtime.circuit.settings.canvasPanY
    };
    runtime.interaction = null;
    return;
  }
  const target = event.target.closest?.('[data-kind], [data-action]');
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const action = target?.dataset.action;
  if (action === 'open-physics') { event.stopPropagation(); openPhysics(target.dataset.id); return; }
  if (action === 'open-block') { event.stopPropagation(); openBlockSheet(target.dataset.id); return; }
  if (action === 'open-lab') { event.stopPropagation(); openLabPanel('sweep'); return; }
  if (runtime.tool === 'erase') {
    if (target?.dataset.kind === 'component') runtime.selection = { kind: 'component', id: target.dataset.id };
    else if (target?.dataset.kind === 'connection') runtime.selection = { kind: 'connection', id: target.dataset.id };
    deleteSelection();
    return;
  }
  if (runtime.tool === 'place' && runtime.placeType && !target?.dataset.kind) { placeComponent(runtime.placeType, snapWorldPoint(point)); return; }
  if (target?.dataset.kind === 'port' && (runtime.tool === 'draw' || runtime.tool === 'select')) {
    startConnection({ component: target.dataset.component, port: target.dataset.port }, point, event.pointerId);
    return;
  }
  if (target?.dataset.kind === 'component') {
    const id = target.dataset.id;
    if (event.shiftKey || event.metaKey || event.ctrlKey) { toggleMultiSelection(id); refresh(); return; }
    runtime.selection = { kind: 'component', id };
    const component = runtime.circuit.components.find(item => item.id === id);
    runtime.interaction = { mode: 'drag-component', pointerId: event.pointerId, id, startPoint: point, startX: component.x, startY: component.y, snapshot: snapshot(), moved: false };
    dom.svg.setPointerCapture?.(event.pointerId);
    refresh();
    return;
  }
  if (target?.dataset.kind === 'connection') { runtime.selection = { kind: 'connection', id: target.dataset.id }; refresh(); return; }
  runtime.selection = null;
  runtime.interaction = { mode: 'pan', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPanX: runtime.circuit.settings.canvasPanX ?? 0, startPanY: runtime.circuit.settings.canvasPanY ?? 0, moved: false };
  dom.svg.setPointerCapture?.(event.pointerId);
  refresh();
}
function handlePinchMove(event) {
  const pointer = runtime.pointers.get(event.pointerId);
  if (!pointer) return false;
  pointer.x = event.clientX; pointer.y = event.clientY;
  if (runtime.pointers.size < 2 || !runtime.pinch) return false;
  const [first, second] = [...runtime.pointers.values()];
  const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
  const centerX = (first.x + second.x) / 2, centerY = (first.y + second.y) / 2;
  const newZoom = clamp(runtime.pinch.zoom * distance / Math.max(1, runtime.pinch.distance), .35, 4);
  const rect = dom.svg.getBoundingClientRect();
  const viewScaleX = 1100 / Math.max(1, rect.width), viewScaleY = 720 / Math.max(1, rect.height);
  runtime.circuit.settings.canvasZoom = newZoom;
  runtime.circuit.settings.canvasPanX = runtime.pinch.panX + (centerX - runtime.pinch.centerX) * viewScaleX / newZoom;
  runtime.circuit.settings.canvasPanY = runtime.pinch.panY + (centerY - runtime.pinch.centerY) * viewScaleY / newZoom;
  renderer.setTransform({ zoom: newZoom, panX: runtime.circuit.settings.canvasPanX, panY: runtime.circuit.settings.canvasPanY });
  updateChrome();
  return true;
}
function handleCanvasPointerMove(event) {
  if (handlePinchMove(event)) return;
  const interaction = runtime.interaction;
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  if (interaction.mode === 'draw-connection') {
    const routePoint = snapWorldPoint(point);
    const last = runtime.previewPoints.at(-1);
    if (!last || Math.hypot(routePoint.x - last.x, routePoint.y - last.y) > 5) runtime.previewPoints.push(routePoint);
    else runtime.previewPoints[runtime.previewPoints.length - 1] = routePoint;
    const candidate = nearestPort(runtime.circuit, point, 34 / (runtime.circuit.settings.canvasZoom ?? 1), interaction.start);
    const validation = validateConnection(runtime.circuit, interaction.start, candidate);
    interaction.candidate = candidate;
    runtime.previewValid = candidate ? validation.ok : null;
    if (candidate) runtime.previewPoints[runtime.previewPoints.length - 1] = { x: candidate.x, y: candidate.y };
    renderCanvas();
  } else if (interaction.mode === 'drag-component') {
    const component = runtime.circuit.components.find(item => item.id === interaction.id);
    if (!component) return;
    const snapped = snapWorldPoint({ x: interaction.startX + point.x - interaction.startPoint.x, y: interaction.startY + point.y - interaction.startPoint.y });
    component.x = clamp(snapped.x, -1000, 2200);
    component.y = clamp(snapped.y, -1000, 1600);
    interaction.moved ||= Math.hypot(point.x - interaction.startPoint.x, point.y - interaction.startPoint.y) > 2;
    runtime.solve = solveCircuit(runtime.circuit); renderCanvas(); updateChrome();
    if (dom.physicsDialog.open) updatePhysicsPanel();
  } else if (interaction.mode === 'pan') {
    const rect = dom.svg.getBoundingClientRect();
    const viewScaleX = 1100 / Math.max(1, rect.width), viewScaleY = 720 / Math.max(1, rect.height);
    runtime.circuit.settings.canvasPanX = interaction.startPanX + (event.clientX - interaction.startClientX) * viewScaleX / (runtime.circuit.settings.canvasZoom ?? 1);
    runtime.circuit.settings.canvasPanY = interaction.startPanY + (event.clientY - interaction.startClientY) * viewScaleY / (runtime.circuit.settings.canvasZoom ?? 1);
    interaction.moved ||= Math.hypot(event.clientX - interaction.startClientX, event.clientY - interaction.startClientY) > 3;
    renderer.setTransform({ zoom: runtime.circuit.settings.canvasZoom, panX: runtime.circuit.settings.canvasPanX, panY: runtime.circuit.settings.canvasPanY });
  }
}
function handleCanvasPointerUp(event) {
  runtime.pointers.delete(event.pointerId);
  if (runtime.pointers.size < 2) runtime.pinch = null;
  const interaction = runtime.interaction;
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.mode === 'draw-connection') completeConnection(renderer.screenToWorld(event.clientX, event.clientY));
  else if (interaction.mode === 'drag-component') {
    if (interaction.moved && interaction.snapshot !== snapshot()) { pushSnapshot(interaction.snapshot); runtime.dirty = true; scheduleAutosave(); }
    runtime.interaction = null; refresh();
  } else if (interaction.mode === 'pan') {
    runtime.interaction = null;
    if (!interaction.moved) runtime.selection = null;
    refresh();
  }
}
function zoomCanvas(delta, center = null) {
  const oldZoom = runtime.circuit.settings.canvasZoom ?? 1;
  const newZoom = clamp(oldZoom * delta, .35, 4);
  if (Math.abs(newZoom - oldZoom) < 1e-8) return;
  if (center) {
    const before = renderer.screenToWorld(center.x, center.y);
    runtime.circuit.settings.canvasZoom = newZoom;
    renderer.setTransform({ zoom: newZoom, panX: runtime.circuit.settings.canvasPanX, panY: runtime.circuit.settings.canvasPanY });
    const after = renderer.screenToWorld(center.x, center.y);
    runtime.circuit.settings.canvasPanX += after.x - before.x;
    runtime.circuit.settings.canvasPanY += after.y - before.y;
  } else runtime.circuit.settings.canvasZoom = newZoom;
  renderer.setTransform({ zoom: newZoom, panX: runtime.circuit.settings.canvasPanX, panY: runtime.circuit.settings.canvasPanY });
  updateChrome();
}
function fitCircuit() {
  if (!runtime.circuit.components.length) {
    runtime.circuit.settings.canvasZoom = 1; runtime.circuit.settings.canvasPanX = 0; runtime.circuit.settings.canvasPanY = 0; refresh(); return;
  }
  const xs = runtime.circuit.components.map(component => component.x), ys = runtime.circuit.components.map(component => component.y);
  const minX = Math.min(...xs) - 110, maxX = Math.max(...xs) + 110, minY = Math.min(...ys) - 100, maxY = Math.max(...ys) + 100;
  const zoom = clamp(Math.min(1000 / Math.max(200, maxX - minX), 620 / Math.max(180, maxY - minY)), .35, 1.55);
  runtime.circuit.settings.canvasZoom = zoom;
  runtime.circuit.settings.canvasPanX = 550 / zoom - (minX + maxX) / 2;
  runtime.circuit.settings.canvasPanY = 360 / zoom - (minY + maxY) / 2;
  refresh();
}
function focusComponent(id) {
  const component = runtime.circuit.components.find(item => item.id === id);
  if (!component) return;
  const zoom = Math.max(1.55, runtime.circuit.settings.canvasZoom ?? 1);
  runtime.circuit.settings.canvasZoom = clamp(zoom, .35, 4);
  runtime.circuit.settings.canvasPanX = 550 / runtime.circuit.settings.canvasZoom - component.x;
  runtime.circuit.settings.canvasPanY = 360 / runtime.circuit.settings.canvasZoom - component.y;
  runtime.selection = { kind: 'component', id };
  refresh();
}

function openPhysics(componentId) {
  const component = runtime.circuit.components.find(item => item.id === componentId && item.type === 'coupler');
  if (!component) return;
  runtime.selectedCouplerId = componentId;
  runtime.selection = { kind: 'component', id: componentId };
  runtime.physicsView = 'power';
  couplerView.setView('power', false);
  if (!dom.physicsDialog.open) dom.physicsDialog.showModal();
  updatePhysicsPanel(); setPhysicsView('power', false);
}
function setPhysicsView(view, setCanvas = true) {
  runtime.physicsView = view;
  if (setCanvas) couplerView.setView(view, false);
  $$('.physics-tabs [data-view]').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  const meta = couplerViewMeta(view);
  dom.depthBadge.textContent = meta.depth; dom.fieldScaleLabel.textContent = meta.scale; dom.couplerModelName.textContent = meta.model;
}
function updatePhysicsPanel() {
  const coupler = runtime.circuit.components.find(item => item.id === runtime.selectedCouplerId && item.type === 'coupler');
  if (!coupler) { dom.physicsDialog.close(); return; }
  runtime.solve = solveCircuit(runtime.circuit);
  couplerView.setData(runtime.circuit, coupler, runtime.solve);
  renderer.renderMiniMap(dom.miniMapSvg, runtime.circuit, coupler.id);
  dom.gapRange.value = coupler.params.gapUm; dom.lengthRange.value = coupler.params.interactionLengthUm; dom.wavelengthRange.value = runtime.circuit.settings.wavelengthNm;
  updatePhysicsMetricsOnly(); renderCanvas(); updateChrome();
}
function updatePhysicsMetricsOnly() {
  const coupler = runtime.circuit.components.find(item => item.id === runtime.selectedCouplerId);
  if (!coupler) return;
  const coefficient = couplerCoefficients(coupler.params, runtime.circuit.settings.wavelengthNm);
  dom.gapOutput.textContent = `${finite(coupler.params.gapUm).toFixed(3)} µm`;
  dom.lengthOutput.textContent = `${finite(coupler.params.interactionLengthUm).toFixed(2)} µm`;
  dom.wavelengthOutput.textContent = `${finite(runtime.circuit.settings.wavelengthNm).toFixed(0)} nm`;
  dom.couplingAngleMetric.textContent = `${coefficient.theta.toFixed(3)} rad`;
  dom.crossPowerMetric.textContent = `${(coefficient.crossPower * 100).toFixed(1)}%`;
  dom.throughPhaseMetric.textContent = coefficient.t < 0 ? '3.14 rad' : '0.00 rad';
  dom.crossPhaseMetric.textContent = coefficient.k < 0 ? '+1.57 rad' : '−1.57 rad';
  const local0 = localCouplerState(coupler, runtime.solve, 0), local1 = localCouplerState(coupler, runtime.solve, 1);
  dom.couplerInputLabel.querySelector('b').textContent = formatPower(abs2(local0.in1) + abs2(local0.in2));
  dom.couplerThroughLabel.querySelector('b').textContent = formatPower(local1.p1);
  dom.couplerCrossLabel.querySelector('b').textContent = formatPower(local1.p2);
}
function bindPhysicsRange(input, apply) {
  input.addEventListener('pointerdown', beginContinuousEdit);
  input.addEventListener('input', () => {
    apply(finite(input.value)); runtime.solve = solveCircuit(runtime.circuit); renderCanvas(); updateChrome();
    const coupler = runtime.circuit.components.find(item => item.id === runtime.selectedCouplerId);
    couplerView.setData(runtime.circuit, coupler, runtime.solve); updatePhysicsMetricsOnly();
  });
  input.addEventListener('change', endContinuousEdit);
}

function suggestedSweepRange(parameter) {
  const current = parameter.get(runtime.circuit);
  if (parameter.id === 'global:wavelengthNm') return { start: Math.max(parameter.min, current - 50), stop: Math.min(parameter.max, current + 50), points: 401 };
  if (parameter.unit === 'rad') return { start: parameter.min, stop: parameter.max, points: 361 };
  const span = parameter.max - parameter.min;
  return { start: clamp(current - span * .18, parameter.min, parameter.max), stop: clamp(current + span * .18, parameter.min, parameter.max), points: 301 };
}
function configureSweepParameter(parameterId) {
  const parameter = resolveParameter(runtime.circuit, parameterId);
  const range = suggestedSweepRange(parameter);
  runtime.lab.sweep = { ...runtime.lab.sweep, parameterId: parameter.id, ...range };
}
function configureToleranceParameter(parameterId) {
  const parameter = resolveParameter(runtime.circuit, parameterId);
  const existing = runtime.lab.tolerance.parameters.find(item => item.id === parameter.id);
  if (!existing) runtime.lab.tolerance.parameters.push({ id: parameter.id, sigma: parameter.tolerance ?? .01, relative: true });
}
function openLabPanel(tab = runtime.lab.tab) {
  runtime.lab.open = true;
  runtime.lab.tab = tab;
  dom.labPanel.hidden = false;
  selectedMeasurement();
  renderLab(); updateChrome();
  requestAnimationFrame(() => labPlot.resize());
}
function closeLabPanel() {
  runtime.lab.open = false;
  dom.labPanel.hidden = true;
  runtime.highlightIds = [];
  renderCanvas(); updateChrome();
}
function setLabBusy(busy, title = 'Ready', detail = '', progress = 0) {
  runtime.lab.busy = busy;
  const status = dom.labStatus.closest('.lab-status');
  status.classList.toggle('busy', busy); status.classList.remove('error');
  dom.labStatus.textContent = title; dom.labProgressText.textContent = detail;
  dom.labProgress.hidden = !busy;
  dom.labProgressBar.style.width = `${clamp(progress, 0, 1) * 100}%`;
}
function setLabError(error) {
  runtime.lab.busy = false;
  const status = dom.labStatus.closest('.lab-status');
  status.classList.remove('busy'); status.classList.add('error');
  dom.labStatus.textContent = 'Analysis stopped'; dom.labProgressText.textContent = error?.message ?? String(error);
  dom.labProgress.hidden = true;
}
function updateLabProgress(fraction, detail = null) {
  dom.labProgressBar.style.width = `${clamp(fraction, 0, 1) * 100}%`;
  if (detail) dom.labProgressText.textContent = detail;
}
function measurementOptions(selectedId = runtime.lab.selectedMeasurementId) {
  return pinnedMeasurements().map(spec => `<option value="${escapeHTML(spec.id)}" ${spec.id === selectedId ? 'selected' : ''}>${escapeHTML(measurementLabel(runtime.circuit, spec))}</option>`).join('');
}
function parameterOptions(selectedId) {
  const groups = new Map();
  const active = listSweepParameters(runtime.circuit).filter(parameter => parameter.scope !== 'pulse' && parameter.scope !== 'electrical');
  for (const parameter of active) {
    const group = parameter.kind === 'global' ? 'Global' : parameter.kind === 'connection' ? 'Waveguides' : labelForType(parameter.componentType);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(parameter);
  }
  return [...groups.entries()].map(([label, parameters]) => `<optgroup label="${escapeHTML(label)}">${parameters.map(parameter => `<option value="${escapeHTML(parameter.id)}" ${parameter.id === selectedId ? 'selected' : ''}>${escapeHTML(parameter.label)}</option>`).join('')}</optgroup>`).join('');
}
function renderMeasurementChips() {
  return `<div class="measurement-chips">${pinnedMeasurements().map((spec, index) => `<span class="measurement-chip ${spec.id === runtime.lab.selectedMeasurementId ? 'active' : ''}" data-lab-action="select-measurement" data-id="${escapeHTML(spec.id)}"><i style="opacity:${.7 + .3 * (index % 2)}"></i>${escapeHTML(measurementLabel(runtime.circuit, spec))}<button type="button" data-lab-action="remove-measurement" data-id="${escapeHTML(spec.id)}">×</button></span>`).join('')}</div>`;
}
function renderSweepControls() {
  const activeParameters = listSweepParameters(runtime.circuit).filter(parameter => parameter.scope !== 'pulse' && parameter.scope !== 'electrical');
  if (activeParameters.length && !activeParameters.some(parameter => parameter.id === runtime.lab.sweep.parameterId)) configureSweepParameter(activeParameters[0].id);
  const sweep = runtime.lab.sweep;
  const result = runtime.lab.resultTab === 'sweep' ? runtime.lab.result : null;
  return `<section class="lab-section"><div class="lab-section-head"><b>Pinned measurements</b><small>Click a trace target to focus it</small></div>${renderMeasurementChips()}</section>
    <section class="lab-section"><div class="lab-section-head"><b>Sweep parameter</b><small>Complex circuit solve at every point</small></div>
      <label class="lab-field"><select data-lab-field="sweep.parameterId">${parameterOptions(sweep.parameterId)}</select></label>
      <div class="lab-grid three">
        <label class="lab-field"><span><b>Start</b></span><input type="number" step="any" data-lab-field="sweep.start" value="${sweep.start}"/></label>
        <label class="lab-field"><span><b>Stop</b></span><input type="number" step="any" data-lab-field="sweep.stop" value="${sweep.stop}"/></label>
        <label class="lab-field"><span><b>Points</b></span><input type="number" min="2" max="5001" step="1" data-lab-field="sweep.points" value="${sweep.points}"/></label>
      </div>
      <button class="lab-primary" type="button" data-lab-action="run-sweep" ${runtime.lab.busy ? 'disabled' : ''}>∿ Run wavelength / parameter sweep</button>
    </section>
    ${result ? `<section class="lab-section"><div class="lab-grid"><button class="lab-secondary" type="button" data-lab-action="keep-baseline">Keep as baseline</button><button class="lab-secondary" type="button" data-lab-action="export-sweep">Export CSV</button></div><div class="lab-result-card" style="margin-top:7px"><b>${result.x.length} operating points · ${result.elapsedMs.toFixed(1)} ms total</b><p>Mean solve ${result.solveTimeMeanMs.toFixed(3)} ms · ${result.failures} failed points. Click the plot to apply an operating point to the live circuit.</p></div></section>` : ''}`;
}
function defaultTuneKnobs() {
  const preferred = listSweepParameters(runtime.circuit).filter(parameter => parameter.id !== 'global:wavelengthNm' && (parameter.key === 'phaseRad' || parameter.key === 'gapUm' || parameter.key === 'interactionLengthUm' || parameter.key === 'schematicLengthUm'));
  return preferred.slice(0, 4).map(parameter => parameter.id);
}
function renderTuneControls() {
  const measurements = pinnedMeasurements();
  if (!runtime.lab.tune.parameterIds.length) runtime.lab.tune.parameterIds = defaultTuneKnobs();
  const parameters = listSweepParameters(runtime.circuit).filter(parameter => parameter.id !== 'global:wavelengthNm' && parameter.scope !== 'pulse' && parameter.scope !== 'electrical');
  const result = runtime.lab.optimizationResult;
  return `<section class="lab-section"><div class="lab-section-head"><b>Goal</b><small>Coordinate refinement · up to four knobs</small></div>
    <label class="lab-field"><span><b>Primary output</b></span><select data-lab-field="selectedMeasurementId">${measurementOptions()}</select></label>
    <div class="lab-grid"><label class="lab-field"><span><b>Objective</b></span><select data-lab-field="tune.goal"><option value="maximize" ${runtime.lab.tune.goal === 'maximize' ? 'selected' : ''}>Maximize</option><option value="minimize" ${runtime.lab.tune.goal === 'minimize' ? 'selected' : ''}>Minimize</option><option value="target" ${runtime.lab.tune.goal === 'target' ? 'selected' : ''}>Target value</option><option value="contrast" ${runtime.lab.tune.goal === 'contrast' ? 'selected' : ''}>Maximize contrast</option></select></label>
    <label class="lab-field"><span><b>Robust ± window</b><small>nm</small></span><input type="number" min="0" max="100" step="0.1" data-lab-field="tune.robustWindowNm" value="${runtime.lab.tune.robustWindowNm}"/></label></div>
    ${runtime.lab.tune.goal === 'target' ? `<label class="lab-field"><span><b>Target value</b></span><input type="number" step="any" data-lab-field="tune.targetValue" value="${runtime.lab.tune.targetValue}"/></label>` : ''}
    ${runtime.lab.tune.goal === 'contrast' ? `<label class="lab-field"><span><b>Secondary output</b></span><select data-lab-field="tune.secondaryMeasurementId">${measurements.map(spec => `<option value="${escapeHTML(spec.id)}" ${spec.id === runtime.lab.tune.secondaryMeasurementId ? 'selected' : ''}>${escapeHTML(measurementLabel(runtime.circuit, spec))}</option>`).join('')}</select></label>` : ''}
  </section>
  <section class="lab-section"><div class="lab-section-head"><b>Tuning knobs</b><small>Select 1–4</small></div><div class="knob-list">${parameters.map(parameter => `<label class="knob-row"><input type="checkbox" data-lab-knob="${escapeHTML(parameter.id)}" ${runtime.lab.tune.parameterIds.includes(parameter.id) ? 'checked' : ''}/><b>${escapeHTML(parameter.label)}</b><small>${escapeHTML(parameter.unit ?? '')}</small></label>`).join('')}</div>
    <button class="lab-primary" style="margin-top:9px" type="button" data-lab-action="run-tune" ${runtime.lab.busy ? 'disabled' : ''}>◎ Tune selected outputs</button></section>
  ${result ? `<section class="lab-section"><div class="lab-result-card"><b>Objective ${humanNumber(result.before.value)} → ${humanNumber(result.after.value)}</b><p>${result.evaluations} evaluations · ${result.settings.map(setting => `${setting.label} = ${humanNumber(setting.value)} ${setting.unit}`).join(' · ')}</p></div><button class="lab-primary" style="margin-top:7px" type="button" data-lab-action="apply-tune">Apply tuned design</button></section>` : ''}`;
}
function ensureToleranceDefaults() {
  if (runtime.lab.tolerance.parameters.length) return;
  const candidates = listSweepParameters(runtime.circuit).filter(parameter => parameter.id !== 'global:wavelengthNm' && parameter.scope !== 'pulse' && parameter.scope !== 'electrical');
  runtime.lab.tolerance.parameters = candidates.slice(0, 3).map(parameter => ({ id: parameter.id, sigma: parameter.tolerance ?? .01, relative: true }));
}
function renderToleranceControls() {
  ensureToleranceDefaults();
  const parameters = listSweepParameters(runtime.circuit).filter(parameter => parameter.scope !== 'pulse' && parameter.scope !== 'electrical');
  const selectedMap = new Map(runtime.lab.tolerance.parameters.map(item => [item.id, item]));
  const result = runtime.lab.toleranceResult;
  const nominal = readMeasurement(runtime.circuit, runtime.solve, selectedMeasurement()).value;
  const threshold = runtime.lab.tolerance.threshold ?? nominal * .9;
  return `<section class="lab-section"><div class="lab-section-head"><b>Yield measurement</b><small>Monte Carlo + ±3σ corners</small></div><label class="lab-field"><select data-lab-field="selectedMeasurementId">${measurementOptions()}</select></label>
    <div class="lab-grid"><label class="lab-field"><span><b>Samples</b></span><input type="number" min="20" max="10000" step="20" data-lab-field="tolerance.samples" value="${runtime.lab.tolerance.samples}"/></label><label class="lab-field"><span><b>Yield threshold</b></span><input type="number" step="any" data-lab-field="tolerance.threshold" value="${threshold}"/></label></div>
    <label class="lab-field"><span><b>Pass criterion</b></span><select data-lab-field="tolerance.criterion"><option value="min" ${runtime.lab.tolerance.criterion === 'min' ? 'selected' : ''}>Output ≥ threshold</option><option value="max" ${runtime.lab.tolerance.criterion === 'max' ? 'selected' : ''}>Output ≤ threshold</option></select></label>
  </section>
  <section class="lab-section"><div class="lab-section-head"><b>Fabrication / model variations</b><small>σ is relative unless marked absolute</small></div><div class="knob-list">${parameters.map(parameter => { const item = selectedMap.get(parameter.id); return `<label class="tolerance-row"><input type="checkbox" data-tolerance-enable="${escapeHTML(parameter.id)}" ${item ? 'checked' : ''}/><span><b>${escapeHTML(parameter.label)}</b><small>${escapeHTML(parameter.unit ?? '')} · nominal ${humanNumber(parameter.get(runtime.circuit))}</small></span><input type="number" min="0" step="any" data-tolerance-sigma="${escapeHTML(parameter.id)}" value="${item?.sigma ?? parameter.tolerance ?? .01}" title="1σ relative variation"/></label>`; }).join('')}</div><button class="lab-primary" style="margin-top:9px" type="button" data-lab-action="run-tolerance" ${runtime.lab.busy ? 'disabled' : ''}>± Run yield analysis</button></section>
  ${result ? `<section class="lab-section"><div class="lab-result-card"><b>${(100 * result.yield).toFixed(1)}% yield · σ ${humanNumber(result.std)}</b><p>P05 ${humanNumber(result.p05)} · median ${humanNumber(result.p50)} · P95 ${humanNumber(result.p95)} · worst ±3σ corner ${humanNumber(result.worstCorner?.value)}</p></div><div class="section-title" style="margin-top:10px"><b>Sensitivity ranking</b><small>Click to locate</small></div><div class="sensitivity-list">${result.sensitivities.map(item => `<button type="button" class="sensitivity-item" data-lab-action="highlight-parameter" data-id="${escapeHTML(item.id)}"><b>${escapeHTML(item.label)} · r ${item.correlation.toFixed(3)}</b><span class="sensitivity-bar"><i style="width:${Math.abs(item.correlation) * 100}%"></i></span></button>`).join('')}</div></section>` : ''}`;
}
function renderPulseControls() {
  const source = primarySource();
  const result = runtime.lab.pulseResult;
  return `<section class="lab-section"><div class="lab-section-head"><b>Temporal reconstruction</b><small>FFT-style frequency sweep of H(ω)</small></div>
    <label class="lab-field"><span><b>Output measurement</b></span><select data-lab-field="selectedMeasurementId">${measurementOptions()}</select></label>
    <div class="lab-grid"><label class="lab-field"><span><b>Intensity FWHM</b><small>ps</small></span><input type="number" min=".05" max="500" step=".1" data-lab-field="pulse.durationPs" value="${runtime.lab.pulse.durationPs ?? source?.params?.pulseDurationPs ?? 12}"/></label><label class="lab-field"><span><b>Repetition rate</b><small>MHz</small></span><input type="number" min=".001" max="100000" step="1" data-lab-field="pulse.repetitionRateMHz" value="${runtime.lab.pulse.repetitionRateMHz ?? source?.params?.repetitionRateMHz ?? 80}"/></label></div>
    <label class="lab-field"><span><b>Spectral / time samples</b><small>64–512</small></span><input type="number" min="64" max="512" step="32" data-lab-field="pulse.samples" value="${runtime.lab.pulse.samples}"/></label>
    <div class="lab-result-card"><b>What is solved</b><p>A transform-limited Gaussian spectrum is propagated through the complex circuit response, inverse-transformed, then filtered by detector bandwidth. Repetition rate sets train spacing, never optical velocity.</p></div>
    <button class="lab-primary" style="margin-top:9px" type="button" data-lab-action="run-pulse" ${runtime.lab.busy || !source ? 'disabled' : ''}>◌ Reconstruct pulse response</button>
  </section>
  ${result ? `<section class="lab-section"><div class="lab-result-card"><b>Delay ${result.metrics.delayPs.toFixed(3)} ps · FWHM ${result.metrics.outputFwhmPs.toFixed(3)} ps</b><p>Broadening ${result.metrics.broadening?.toFixed(3) ?? '—'}× · peak transmission ${(100 * result.metrics.peakTransmission).toFixed(2)}% · train period ${result.metrics.repetitionPeriodPs.toFixed(1)} ps${result.detectorBandwidthGhz ? ` · detector ${result.detectorBandwidthGhz.toFixed(1)} GHz` : ''}</p></div></section>` : ''}`;
}
function renderLabMetrics() {
  const result = runtime.lab.result;
  if (!result) { dom.labMetrics.innerHTML = ''; return; }
  if (result.kind === 'sweep') {
    const first = result.metrics?.[0] ?? {};
    const cells = [
      ['Max', humanNumber(first.max)], ['Extinction', first.extinctionDb == null ? '—' : `${first.extinctionDb.toFixed(2)} dB`],
      ['Insertion loss', first.insertionLossDb == null ? '—' : `${first.insertionLossDb.toFixed(2)} dB`], ['3 dB width', humanNumber(first.bandwidth3dB)],
      ['FSR', first.fsr == null ? '—' : humanNumber(first.fsr)],
      ['Group delay', first.groupDelayAtMaxPs == null ? '—' : `${first.groupDelayAtMaxPs.toFixed(3)} ps`],
      ['Phase span', first.phaseExcursionRad == null ? '—' : `${first.phaseExcursionRad.toFixed(2)} rad`],
      ...(result.comparison ? [['Crossover', humanNumber(result.comparison.crossoverX)]] : [])
    ];
    dom.labMetrics.innerHTML = cells.map(([label, value]) => `<span><small>${escapeHTML(label)}</small><b>${escapeHTML(value)}</b></span>`).join('');
  } else if (result.kind === 'tolerance') dom.labMetrics.innerHTML = `<span><small>Yield</small><b>${(100 * result.yield).toFixed(1)}%</b></span><span><small>P05</small><b>${humanNumber(result.p05)}</b></span><span><small>P95</small><b>${humanNumber(result.p95)}</b></span>`;
  else if (result.kind === 'pulse') dom.labMetrics.innerHTML = `<span><small>Delay</small><b>${result.metrics.delayPs.toFixed(3)} ps</b></span><span><small>Output FWHM</small><b>${result.metrics.outputFwhmPs.toFixed(3)} ps</b></span><span><small>Peak</small><b>${(100 * result.metrics.peakTransmission).toFixed(1)}%</b></span>`;
}
function renderLab() {
  dom.labPanel.hidden = !runtime.lab.open;
  dom.labPanel.classList.toggle('compact', runtime.lab.compact);
  dom.labMinimize?.setAttribute('aria-label', runtime.lab.compact ? 'Expand Lab' : 'Minimize Lab to live sparkline');
  if (!runtime.lab.open) return;
  $$('#labTabs [data-lab-tab]').forEach(button => { const active = button.dataset.labTab === runtime.lab.tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  dom.labSubtitle.textContent = ({ sweep: 'Measure across the design space', tune: 'Turn targets into settings', tolerance: 'See whether the design survives variation', pulse: 'Reconstruct temporal response from H(ω)' })[runtime.lab.tab];
  if (runtime.lab.tab === 'sweep') dom.labControls.innerHTML = renderSweepControls();
  else if (runtime.lab.tab === 'tune') dom.labControls.innerHTML = renderTuneControls();
  else if (runtime.lab.tab === 'tolerance') dom.labControls.innerHTML = renderToleranceControls();
  else dom.labControls.innerHTML = renderPulseControls();
  dom.labPlotToolbar.innerHTML = runtime.lab.result?.kind === 'sweep' ? `<button type="button" data-lab-action="apply-current-point">Apply cursor point</button>${runtime.lab.baselines.length ? `<button type="button" data-lab-action="clear-baselines">Clear ${runtime.lab.baselines.length} baseline${runtime.lab.baselines.length === 1 ? '' : 's'}</button>` : ''}` : '';
  if (runtime.lab.result && runtime.lab.resultTab === runtime.lab.tab) labPlot.setData(runtime.lab.result, { baselines: runtime.lab.result.kind === 'sweep' ? runtime.lab.baselines : [], cursorIndex: runtime.lab.cursorIndex });
  else labPlot.clear();
  renderLabMetrics();
}
function readLabField(path, value) {
  const parts = path.split('.');
  if (parts.length === 1) runtime.lab[parts[0]] = value;
  else runtime.lab[parts[0]][parts[1]] = value;
}
function getMeasurementById(id) { return pinnedMeasurements().find(spec => spec.id === id) ?? selectedMeasurement(); }
async function runSweepAnalysis() {
  if (runtime.lab.busy) return;
  const token = ++runtime.operationToken;
  setLabBusy(true, 'Sweeping', `Solving ${runtime.lab.sweep.points} operating points…`);
  renderLab();
  try {
    const result = await sweepCircuitAsync(runtime.circuit, runtime.lab.sweep, pinnedMeasurements(), fraction => updateLabProgress(fraction, `Sweep ${(100 * fraction).toFixed(0)}%`));
    if (token !== runtime.operationToken) return;
    runtime.lab.result = result; runtime.lab.resultTab = 'sweep'; runtime.lab.cursorIndex = result.currentIndex;
    setLabBusy(false, 'Sweep complete', `${result.x.length} points · ${result.elapsedMs.toFixed(1)} ms`);
    renderLab();
  } catch (error) { setLabError(error); renderLab(); }
}
async function runTuneAnalysis() {
  if (runtime.lab.busy) return;
  const measurement = selectedMeasurement();
  const secondary = getMeasurementById(runtime.lab.tune.secondaryMeasurementId);
  const token = ++runtime.operationToken;
  setLabBusy(true, 'Tuning', 'Exploring selected compact-model knobs…'); renderLab();
  try {
    const result = await optimizeCircuit(runtime.circuit, {
      measurement,
      secondaryMeasurement: runtime.lab.tune.goal === 'contrast' ? secondary : null,
      goal: runtime.lab.tune.goal,
      targetValue: runtime.lab.tune.targetValue,
      robustWindowNm: runtime.lab.tune.robustWindowNm,
      parameterIds: runtime.lab.tune.parameterIds,
      passes: 4, samplesPerPass: 33
    }, fraction => updateLabProgress(fraction, `Tune ${(100 * fraction).toFixed(0)}%`));
    if (token !== runtime.operationToken) return;
    runtime.lab.optimizationResult = result;
    setLabBusy(false, 'Target found', `${result.evaluations} compact-circuit evaluations`); renderLab();
  } catch (error) { setLabError(error); renderLab(); }
}
async function runToleranceAnalysis() {
  if (runtime.lab.busy) return;
  const token = ++runtime.operationToken;
  const threshold = runtime.lab.tolerance.threshold ?? readMeasurement(runtime.circuit, runtime.solve, selectedMeasurement()).value * .9;
  setLabBusy(true, 'Sampling variation', `${runtime.lab.tolerance.samples} Monte Carlo samples + corners…`); renderLab();
  try {
    const result = await runTolerance(runtime.circuit, {
      measurement: selectedMeasurement(), parameters: runtime.lab.tolerance.parameters,
      samples: runtime.lab.tolerance.samples, threshold, criterion: runtime.lab.tolerance.criterion,
      seed: runtime.lab.tolerance.seed
    }, fraction => updateLabProgress(fraction, `Yield analysis ${(100 * fraction).toFixed(0)}%`));
    if (token !== runtime.operationToken) return;
    runtime.lab.toleranceResult = result; runtime.lab.result = result; runtime.lab.resultTab = 'tolerance';
    setLabBusy(false, 'Yield calculated', `${(100 * result.yield).toFixed(1)}% pass rate · ${result.samples} samples`); renderLab();
  } catch (error) { setLabError(error); renderLab(); }
}
async function runPulseAnalysis() {
  if (runtime.lab.busy) return;
  const token = ++runtime.operationToken;
  setLabBusy(true, 'Reconstructing pulse', 'Sampling the complex spectral transfer function…'); renderLab();
  try {
    const result = await simulatePulse(runtime.circuit, selectedMeasurement(), runtime.lab.pulse, fraction => updateLabProgress(fraction, `Pulse reconstruction ${(100 * fraction).toFixed(0)}%`));
    if (token !== runtime.operationToken) return;
    runtime.lab.pulseResult = result; runtime.lab.result = result; runtime.lab.resultTab = 'pulse';
    setLabBusy(false, 'Pulse reconstructed', `${result.samples} spectral/time samples`); renderLab();
  } catch (error) { setLabError(error); renderLab(); }
}
function applySweepPoint(index = runtime.lab.cursorIndex) {
  const result = runtime.lab.result;
  if (result?.kind !== 'sweep' || !Number.isInteger(index)) return;
  const value = result.x[clamp(index, 0, result.x.length - 1)];
  const parameter = resolveParameter(runtime.circuit, result.parameter.id);
  mutateCircuit(circuit => parameter.set(circuit, value), { lab: false });
  runtime.lab.cursorIndex = index;
  showToast(`${result.parameter.label} set to ${humanNumber(value)} ${result.parameter.unit ?? ''}`.trim());
  labPlot.setData(result, { baselines: runtime.lab.baselines, cursorIndex: index });
}
function keepBaseline() {
  const result = runtime.lab.result;
  if (result?.kind !== 'sweep') return;
  runtime.lab.baselines.push({ name: `Baseline ${runtime.lab.baselines.length + 1}`, x: [...result.x], traces: result.traces.map(trace => ({ label: trace.label, unit: trace.unit, values: [...trace.values] })) });
  if (runtime.lab.baselines.length > 4) runtime.lab.baselines.shift();
  renderLab();
}
function exportSweepCSV() {
  const result = runtime.lab.result;
  if (result?.kind !== 'sweep') return;
  const rows = [[`${result.parameter.label} (${result.parameter.unit ?? ''})`, ...result.traces.map(trace => `${trace.label} (${trace.unit ?? ''})`)]];
  result.x.forEach((x, index) => rows.push([x, ...result.traces.map(trace => trace.values[index])]));
  downloadText(`${slug(runtime.circuit.name)}-sweep.csv`, rows.map(row => row.join(',')).join('\n'), 'text/csv');
}
function highlightParameter(parameterId) {
  const parameter = resolveParameter(runtime.circuit, parameterId);
  runtime.highlightIds = [parameter.componentId ?? parameter.connectionId].filter(Boolean);
  if (parameter.componentId) runtime.selection = { kind: 'component', id: parameter.componentId };
  else if (parameter.connectionId) runtime.selection = { kind: 'connection', id: parameter.connectionId };
  renderCanvas(); renderInspector();
}
function bindLabDelegation() {
  dom.labTabs.addEventListener('click', event => {
    const button = event.target.closest('[data-lab-tab]'); if (!button) return;
    runtime.lab.tab = button.dataset.labTab; runtime.highlightIds = []; renderCanvas(); renderLab();
  });
  const handler = event => {
    const field = event.target.closest('[data-lab-field]');
    if (field) {
      const path = field.dataset.labField;
      const numeric = field.type === 'number' || field.type === 'range';
      readLabField(path, numeric ? finite(field.value) : field.value);
      if (path === 'sweep.parameterId') configureSweepParameter(field.value);
      if (path === 'selectedMeasurementId') runtime.lab.selectedMeasurementId = field.value;
      if (event.type === 'change') renderLab();
      return;
    }
    const knob = event.target.closest('[data-lab-knob]');
    if (knob) {
      const id = knob.dataset.labKnob;
      if (knob.checked && !runtime.lab.tune.parameterIds.includes(id) && runtime.lab.tune.parameterIds.length < 4) runtime.lab.tune.parameterIds.push(id);
      else if (!knob.checked) runtime.lab.tune.parameterIds = runtime.lab.tune.parameterIds.filter(item => item !== id);
      else if (knob.checked && runtime.lab.tune.parameterIds.length >= 4) { knob.checked = false; showToast('Tune supports up to four simultaneous knobs.'); }
      return;
    }
    const toleranceEnable = event.target.closest('[data-tolerance-enable]');
    if (toleranceEnable) {
      const id = toleranceEnable.dataset.toleranceEnable;
      const descriptor = resolveParameter(runtime.circuit, id);
      if (toleranceEnable.checked && !runtime.lab.tolerance.parameters.some(item => item.id === id)) runtime.lab.tolerance.parameters.push({ id, sigma: descriptor.tolerance ?? .01, relative: true });
      else if (!toleranceEnable.checked) runtime.lab.tolerance.parameters = runtime.lab.tolerance.parameters.filter(item => item.id !== id);
      return;
    }
    const sigma = event.target.closest('[data-tolerance-sigma]');
    if (sigma) {
      const item = runtime.lab.tolerance.parameters.find(parameter => parameter.id === sigma.dataset.toleranceSigma);
      if (item) item.sigma = Math.max(0, finite(sigma.value));
    }
  };
  dom.labControls.addEventListener('input', handler);
  dom.labControls.addEventListener('change', handler);
  const clickHandler = event => {
    const action = event.target.closest('[data-lab-action]'); if (!action) return;
    const name = action.dataset.labAction;
    if (name === 'run-sweep') runSweepAnalysis();
    else if (name === 'run-tune') runTuneAnalysis();
    else if (name === 'run-tolerance') runToleranceAnalysis();
    else if (name === 'run-pulse') runPulseAnalysis();
    else if (name === 'apply-tune' && runtime.lab.optimizationResult) replaceCircuit(runtime.lab.optimizationResult.circuit, { toast: 'Tuned design applied to the canvas.' });
    else if (name === 'keep-baseline') keepBaseline();
    else if (name === 'export-sweep') exportSweepCSV();
    else if (name === 'apply-current-point') applySweepPoint();
    else if (name === 'clear-baselines') { runtime.lab.baselines = []; renderLab(); }
    else if (name === 'remove-measurement') { event.stopPropagation(); removeMeasurement(action.dataset.id); }
    else if (name === 'select-measurement') { runtime.lab.selectedMeasurementId = action.dataset.id; renderLab(); }
    else if (name === 'highlight-parameter') highlightParameter(action.dataset.id);
  };
  dom.labControls.addEventListener('click', clickHandler);
  dom.labPlotToolbar.addEventListener('click', clickHandler);
}

function showSheet(title, subtitle, html) {
  dom.sheetTitle.textContent = title; dom.sheetSubtitle.textContent = subtitle; dom.sheetContent.innerHTML = html;
  if (!dom.sheetDialog.open) dom.sheetDialog.showModal();
}
function openProjectMenu() {
  showSheet('Experiments', 'Start, save, import, or hand off', `<div class="sheet-menu">
    <button type="button" data-sheet-action="blank"><span class="menu-icon">＋</span><span><b>New blank circuit</b><small>Start from an empty semantic graph</small></span></button>
    ${CIRCUIT_TEMPLATES.map(template => `<button type="button" data-sheet-action="template" data-template-id="${escapeHTML(template.id)}"><span class="menu-icon">${template.id === 'mzi' ? '∿' : template.id === 'ring' ? '○' : template.id === 'delay' ? '↝' : '▦'}</span><span><b>${escapeHTML(template.name)}</b><small>${escapeHTML(template.description)}</small></span></button>`).join('')}
    <button type="button" data-sheet-action="save"><span class="menu-icon">↓</span><span><b>Save in this browser</b><small>Stores graph, models, pinned measurements, and hierarchy</small></span></button>
    <button type="button" data-sheet-action="load"><span class="menu-icon">↥</span><span><b>Load browser save</b><small>Restore the most recent explicit save</small></span></button>
  </div>`);
}
function openModelSheet() {
  const budget = runtime.solve.powerBudget;
  showSheet('Active physics model', 'Compact coherent network · explicit model contracts', `<div class="sheet-copy">
    <p>Every optical port carries incoming and outgoing complex amplitudes. Components supply <code>b = Sa + s</code>; connected waveguides add wavelength-dependent complex transmission. The whole graph is solved simultaneously, including coherent feedback and counter-propagating amplitudes.</p>
    <h3>Trust contract</h3><ul><li>The displayed solver residual is only the linear-system residual.</li><li>The optical power budget separately accounts for detectors, terminations, component loss, exact-curve waveguide loss, source absorption, open ports, and model gain.</li><li>In physical-routing mode, the solver integrates the same cubic route that is rendered. In schematic mode, optical length is an explicit parameter.</li><li>Every parameter states whether it affects the CW optical model, pulse analysis, or electrical readout.</li></ul>
    <h3>Scope</h3><ul><li>Scalar single-mode compact models; not a cross-section Maxwell solve.</li><li>Analytical, imported, and hierarchical model provenance remains visible.</li><li>Pulse Lab samples the complex frequency response and reconstructs the temporal envelope. Canvas packet motion is timing-compressed explanatory animation.</li></ul>
    ${budget ? `<h3>Current power closure</h3><p>Launched ${formatPower(budget.launchedMw)}; accounted ${formatPower(budget.accountedMw)}; balance error ${formatPower(Math.abs(budget.balanceErrorMw))}; solver residual ${formatResidual(runtime.solve.residual)}.</p>` : ''}
  </div>`);
}
function openPowerBudgetSheet() {
  const budget = runtime.solve.powerBudget;
  if (!budget) { showToast('No power budget is available for the current unsolved circuit.'); return; }
  const entries = [
    ['Detected', budget.detectedMw], ['Terminations', budget.terminationMw], ['Component loss', budget.componentLossMw], ['Waveguide loss', budget.waveguideLossMw],
    ['Source absorption', budget.sourceAbsorptionMw], ['Open ports', budget.openPortMw], ['Model gain', -budget.modelGainMw], ['Balance error', budget.balanceErrorMw]
  ];
  const positive = Math.max(budget.launchedMw, 1e-15);
  showSheet('Optical power budget', 'Conservation is separate from solver convergence', `<div class="sheet-copy"><p>The network solver residual is <code>${formatResidual(runtime.solve.residual)}</code>. The table below is the physical power accounting at ${runtime.solve.wavelengthNm.toFixed(2)} nm.</p>
    <div class="power-budget-bar"><i style="width:${100 * budget.detectedMw / positive}%"></i><i style="width:${100 * (budget.terminationMw + budget.openPortMw) / positive}%"></i><i style="width:${100 * budget.componentLossMw / positive}%"></i><i style="width:${100 * budget.waveguideLossMw / positive}%"></i></div>
    <div class="power-budget-grid"><span><small>Launched</small><b>${formatPower(budget.launchedMw)}</b></span><span><small>Accounted</small><b>${formatPower(budget.accountedMw)}</b></span>${entries.map(([label, value]) => `<span><small>${escapeHTML(label)}</small><b>${formatPower(value)}</b></span>`).join('')}</div>
    <h3>Interpretation</h3><p>A large balance error points to a non-passive or approximate compact model, an open path, or an imported S matrix that requires inspection. A small residual only says the assembled linear equations were solved accurately.</p></div>`);
}
function openParameterLinkSheet(parameterId) {
  const parameter = resolveParameter(runtime.circuit, parameterId);
  const link = parameterLinkFor(runtime.circuit, parameterId);
  const currentMembers = link?.members ?? [parameterId];
  const descriptors = new Map(listSweepParameters(runtime.circuit).map(item => [item.id, item]));
  const candidates = listSweepParameters(runtime.circuit).filter(item => item.id !== parameterId && !currentMembers.includes(item.id) && (item.unit ?? '') === (parameter.unit ?? '') && (item.scope ?? 'cw') === (parameter.scope ?? 'cw'));
  const memberList = currentMembers.map(id => descriptors.get(id)).filter(Boolean);
  showSheet('Linked parameter', `${parameter.label} · synchronized numeric value`, `<div class="sheet-copy"><p>Linked controls move together in the canvas, sweeps, tuning, and tolerance runs. PicSetup only offers parameters with the same unit and active model scope.</p>${link ? `<h3>${escapeHTML(link.name)}</h3><ul>${memberList.map(item => `<li>${escapeHTML(item.label)}</li>`).join('')}</ul>` : '<p>This parameter is not linked yet.</p>'}</div><div class="sheet-menu">
    ${candidates.length ? candidates.slice(0, 80).map(item => `<button type="button" data-sheet-action="link-parameter" data-source-id="${escapeHTML(parameterId)}" data-target-id="${escapeHTML(item.id)}"><span class="menu-icon">⛓</span><span><b>${escapeHTML(item.label)}</b><small>${escapeHTML(item.unit || 'unitless')} · ${escapeHTML(item.scope ?? 'cw')} model</small></span></button>`).join('') : '<div class="sheet-copy"><p>No other compatible parameters are available in this circuit.</p></div>'}
    ${link ? `<button type="button" data-sheet-action="unlink-parameter" data-source-id="${escapeHTML(parameterId)}"><span class="menu-icon">×</span><span><b>Unlink this parameter</b><small>Other members remain linked when at least two remain</small></span></button>` : ''}
  </div>`);
}

function openRoutingSheet() {
  const settings = runtime.circuit.settings;
  const violations = [...(runtime.solve?.connections?.values?.() ?? [])].filter(connection => connection.bendViolation);
  showSheet('Routing model', 'Choose what the drawing means physically', `<div class="sheet-copy"><h3>Physical routing</h3><p>The exact rendered cubic curve is numerically integrated. Moving components or changing a route changes physical length, phase, and loss. Grid snapping is stated in micrometres and converted through the visible canvas scale.</p><h3>Schematic routing</h3><p>Route shape communicates topology only. Every waveguide stores an independent optical length, so visual cleanup cannot silently change phase.</p>${violations.length ? `<p><b>${violations.length} route${violations.length === 1 ? '' : 's'} below the declared minimum bend radius.</b> They are highlighted on the canvas; bend loss is not silently invented by the compact model.</p>` : ''}</div><div class="sheet-menu">
    <button type="button" data-sheet-action="routing" data-routing="physical"><span class="menu-icon">⌁</span><span><b>Use physical routing</b><small>Rendered curve = modeled path</small></span></button>
    <button type="button" data-sheet-action="routing" data-routing="schematic"><span class="menu-icon">—</span><span><b>Use schematic routing</b><small>Independent per-waveguide optical lengths</small></span></button>
    <button type="button" data-sheet-action="scale"><span class="menu-icon">↔</span><span><b>Set physical scale</b><small>Current: ${finite(settings.worldToUm, DEFAULT_WORLD_TO_UM).toFixed(4)} µm per canvas unit</small></span></button>
    <button type="button" data-sheet-action="toggle-snap"><span class="menu-icon">${settings.snapToGrid ? '✓' : '·'}</span><span><b>${settings.snapToGrid ? 'Disable' : 'Enable'} physical grid snapping</b><small>Current grid: ${finite(settings.gridUm, 5).toFixed(2)} µm</small></span></button>
    <button type="button" data-sheet-action="grid"><span class="menu-icon">#</span><span><b>Set physical grid spacing</b><small>Current: ${finite(settings.gridUm, 5).toFixed(3)} µm</small></span></button>
    <button type="button" data-sheet-action="bend-radius"><span class="menu-icon">↪</span><span><b>Set minimum bend radius</b><small>Current: ${finite(settings.minBendRadiusUm, 0).toFixed(2)} µm · 0 disables validation</small></span></button>
  </div>`);
}

function rotatedPoint(component, x, y) {
  const angle = finite(component.rotation, 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: finite(component.x) + x * cos - y * sin, y: finite(component.y) + x * sin + y * cos };
}
function figureWorldBounds(circuit = runtime.circuit) {
  const points = [];
  for (const component of circuit.components ?? []) {
    const bounds = componentBounds(component);
    for (const [x, y] of [[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y],[bounds.x+bounds.width,bounds.y+bounds.height],[bounds.x,bounds.y+bounds.height]]) points.push(rotatedPoint(component,x,y));
  }
  for (const connection of circuit.connections ?? []) points.push(...getConnectionPoints(connection, circuit.components));
  if (!points.length) return { x: 0, y: 0, width: 1100, height: 720 };
  const padding = finite(circuit.settings?.figurePadding, 36);
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs)-padding, maxX=Math.max(...xs)+padding, minY=Math.min(...ys)-padding, maxY=Math.max(...ys)+padding;
  return { x:minX, y:minY, width:Math.max(1,maxX-minX), height:Math.max(1,maxY-minY) };
}
function embeddedStyles() {
  const chunks=[];
  for (const sheet of [...document.styleSheets]) {
    try { chunks.push([...sheet.cssRules].map(rule => rule.cssText).join('\n')); }
    catch { /* cross-origin styles are intentionally omitted */ }
  }
  return chunks.join('\n');
}
function buildPaperSvgText() {
  const bounds = figureWorldBounds();
  const clone = dom.svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  clone.setAttribute('width', String(Math.ceil(bounds.width)));
  clone.setAttribute('height', String(Math.ceil(bounds.height)));
  clone.dataset.figureMode = 'paper';
  clone.dataset.semantic = 'detail';
  clone.dataset.paperBackground = runtime.circuit.settings.paperBackground === 'transparent' ? 'transparent' : 'white';
  clone.dataset.showPorts = runtime.circuit.settings.showPortsInFigure === false ? 'false' : 'true';
  for (const id of ['gridLayer','backgroundLayer','connectionLayer','pulseLayer','componentLayer','interactionLayer']) clone.querySelector(`#${id}`)?.removeAttribute('transform');
  clone.querySelector('#pulseLayer')?.replaceChildren();
  clone.querySelector('#interactionLayer')?.replaceChildren();
  if (!runtime.circuit.settings.showGridInFigure) clone.querySelector('#gridLayer')?.remove();
  clone.querySelectorAll('.selection-ring,.component-inspect,.measurement-pin,.connection-hit,.port-hit,.bend-warning').forEach(node => node.remove());
  if (runtime.circuit.settings.showPortsInFigure === false) clone.querySelectorAll('.port,.port-label').forEach(node => node.remove());
  clone.querySelectorAll('[tabindex],[role],[aria-label],[data-kind],[data-action]').forEach(node => {
    node.removeAttribute('tabindex'); node.removeAttribute('role'); node.removeAttribute('aria-label'); node.removeAttribute('data-kind'); node.removeAttribute('data-action');
  });
  const bg=clone.querySelector('.canvas-bg');
  if (bg) {
    bg.setAttribute('x',String(bounds.x)); bg.setAttribute('y',String(bounds.y)); bg.setAttribute('width',String(bounds.width)); bg.setAttribute('height',String(bounds.height));
    bg.setAttribute('fill', runtime.circuit.settings.paperBackground === 'transparent' ? 'transparent' : '#fff');
  }
  const style=document.createElementNS('http://www.w3.org/2000/svg','style');
  style.textContent=embeddedStyles();
  (clone.querySelector('defs') ?? clone).append(style);
  return { text:`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`, bounds };
}
function downloadBlob(filename, blob) {
  const url=URL.createObjectURL(blob), anchor=document.createElement('a');
  anchor.href=url; anchor.download=filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportPaperSvg() {
  const { text }=buildPaperSvgText();
  downloadText(`${slug(runtime.circuit.name)}-paper.svg`, text, 'image/svg+xml');
  showToast('Publication SVG exported with embedded styles.');
}
async function exportPaperPng() {
  const { text, bounds }=buildPaperSvgText();
  const blob=new Blob([text],{type:'image/svg+xml'}), url=URL.createObjectURL(blob), image=new Image();
  try {
    await new Promise((resolve,reject)=>{ image.onload=resolve; image.onerror=()=>reject(new Error('SVG render failed')); image.src=url; });
    const scale=Math.min(3, Math.max(1.5, 2400/Math.max(bounds.width,bounds.height)));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bounds.width*scale)); canvas.height=Math.max(1,Math.round(bounds.height*scale));
    const context=canvas.getContext('2d');
    if (runtime.circuit.settings.paperBackground !== 'transparent') { context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height); }
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));
    if (!png) throw new Error('PNG encoding failed');
    downloadBlob(`${slug(runtime.circuit.name)}-paper.png`,png);
    showToast('High-resolution publication PNG exported.');
  } catch (error) { showToast(error.message); }
  finally { URL.revokeObjectURL(url); }
}
function openFigureSheet() {
  const settings=runtime.circuit.settings;
  const bridges=bridgeManifest(runtime.circuit,runtime.solve,{returnUrl:location.href});
  showSheet('Paper figure studio','Compose complete experimental figures and export clean artwork',`<div class="sheet-copy"><p>Paper mode keeps simulated PIC components, external optical equipment, electrical/RF/control wiring, chip boundaries, image panels, plots, labels, and typed bridge metadata in one figure. Only optical connections enter the coherent solve.</p><p><b>${runtime.circuit.components.length}</b> objects · <b>${runtime.circuit.connections.length}</b> links · <b>${bridges.length}</b> OpticalSetup bridge${bridges.length===1?'':'s'}.</p></div><div class="sheet-menu">
    <button type="button" data-sheet-action="toggle-figure-mode"><span class="menu-icon">${settings.figureMode==='paper'?'✓':'P'}</span><span><b>${settings.figureMode==='paper'?'Return to neon workbench':'Preview paper mode'}</b><small>White, restrained, no optical glow; solver remains live</small></span></button>
    <button type="button" data-sheet-action="export-svg"><span class="menu-icon">SVG</span><span><b>Export publication SVG</b><small>Vector artwork with embedded styles and cropped viewBox</small></span></button>
    <button type="button" data-sheet-action="export-png"><span class="menu-icon">PNG</span><span><b>Export high-resolution PNG</b><small>Transparent or white background</small></span></button>
    <button type="button" data-sheet-action="toggle-figure-ports"><span class="menu-icon">${settings.showPortsInFigure===false?'○':'●'}</span><span><b>${settings.showPortsInFigure===false?'Show':'Hide'} port markers</b><small>Labels remain editable in the workbench</small></span></button>
    <button type="button" data-sheet-action="toggle-figure-grid"><span class="menu-icon">#</span><span><b>${settings.showGridInFigure?'Hide':'Show'} export grid</b><small>Usually hidden for journals and presentations</small></span></button>
    <button type="button" data-sheet-action="toggle-paper-background"><span class="menu-icon">◫</span><span><b>Use ${settings.paperBackground==='transparent'?'white':'transparent'} background</b><small>Current: ${escapeHTML(settings.paperBackground)}</small></span></button>
    <button type="button" data-sheet-action="export-bridges"><span class="menu-icon">↗</span><span><b>Export Setup Port manifest</b><small>All OpticalSetup boundaries as setup-port/1 JSON</small></span></button>
    <button type="button" data-sheet-action="template" data-template-id="paper-hybrid"><span class="menu-icon">a</span><span><b>Load hybrid paper-figure example</b><small>Chip + external optics + RF + electrical readout + figure panels</small></span></button>
  </div>`);
}

function openMoreSheet() {
  showSheet('Workflow', 'Explain, share, and hand off', `<div class="sheet-menu">
    <button type="button" data-sheet-action="lab"><span class="menu-icon">∿</span><span><b>Open PicSetup Lab</b><small>Sweeps, metrics, tuning, tolerance, and pulse response</small></span></button>
    <button type="button" data-sheet-action="figure"><span class="menu-icon">a</span><span><b>Open Paper Figure Studio</b><small>System blocks, panels, typed wiring, SVG/PNG, OpticalSetup bridges</small></span></button>
    <button type="button" data-sheet-action="export-json"><span class="menu-icon">{ }</span><span><b>Export PicSetup experiment</b><small>Portable semantic state, model parameters, and hierarchy</small></span></button>
    <button type="button" data-sheet-action="export-netlist"><span class="menu-icon">N</span><span><b>Export semantic netlist</b><small>Model provenance and explicit endpoints</small></span></button>
    <button type="button" data-sheet-action="export-sax"><span class="menu-icon">λ</span><span><b>Export SAX-oriented YAML</b><small>Compact-model handoff scaffold</small></span></button>
    <button type="button" data-sheet-action="export-gdsfactory"><span class="menu-icon">G</span><span><b>Generate gdsfactory starter</b><small>Readable topology code with declared mapping warnings</small></span></button>
    <button type="button" data-sheet-action="import-json"><span class="menu-icon">⇧</span><span><b>Import experiment / semantic netlist</b><small>PicSetup JSON or exported semantic JSON</small></span></button>
    <button type="button" data-sheet-action="import-sparams"><span class="menu-icon">S</span><span><b>Import S-parameter block</b><small>JSON or CSV wavelength-indexed complex matrix</small></span></button>
    <button type="button" data-sheet-action="guide"><span class="menu-icon">?</span><span><b>Interaction guide</b><small>Direct manipulation, semantic zoom, hierarchy, and keyboard</small></span></button>
  </div>`);
}
function openGuideSheet() {
  showSheet('Interaction guide', 'Think through a circuit, then hand it off', `<div class="sheet-copy"><h3>Build</h3><p>Place any compact model from the categorized library. Draw between compatible free optical ports. Hold Shift/Ctrl/Cmd while selecting components to create a reusable hierarchical block.</p><h3>Measure</h3><p>Pin a detector, probe, port, or waveguide measurement. Open Lab to sweep any parameter, derive metrics, tune a target, test yield, or reconstruct pulses.</p><h3>Navigate</h3><p>Pinch or scroll to zoom; drag empty canvas to pan. Labels and port details appear automatically at deeper semantic zoom. Double-click a component to focus it.</p><h3>Keyboard</h3><p><code>Delete</code> removes selection; <code>Ctrl/Cmd+Z</code> undoes; <code>Space</code> pauses visualization; <code>L</code> opens Lab; <code>Esc</code> cancels or closes the active layer.</p></div>`);
}
function openBlockSheet(id) {
  const block = runtime.circuit.components.find(item => item.id === id && item.type === 'block');
  if (!block) return;
  const sub = block.params?.subcircuit;
  const ports = getPorts(block);
  showSheet(block.name, 'Hierarchical compact model · live reduction', `<div class="sheet-copy"><p>This external ${ports.length}-port scattering model is extracted from the stored passive subcircuit at every wavelength solve.</p><h3>External ports</h3><ul>${ports.map(port => `<li><code>${escapeHTML(port.label)}</code> → ${escapeHTML(port.internalEndpoint?.component ?? '?')}:${escapeHTML(port.internalEndpoint?.port ?? '?')}</li>`).join('')}</ul><h3>Internal graph</h3><p>${sub?.components?.length ?? 0} components · ${sub?.connections?.length ?? 0} waveguides. ${sub?.components?.map(component => component.name).join(', ') ?? ''}</p></div><div class="sheet-menu"><button type="button" data-sheet-action="expand-block" data-id="${escapeHTML(id)}"><span class="menu-icon">↘</span><span><b>Expand and edit internals</b><small>Restore the internal graph to the main canvas</small></span></button><button type="button" data-sheet-action="export-block" data-id="${escapeHTML(id)}"><span class="menu-icon">{ }</span><span><b>Export block JSON</b><small>Reusable semantic subcircuit</small></span></button></div>`);
}
function slug(value) { return String(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'picsetup'; }
async function shareCircuit() {
  const hash = circuitHash();
  const url = `${location.href.split('#')[0]}${hash}`;
  try { await navigator.clipboard.writeText(url); showToast('Exact semantic circuit link copied.'); }
  catch { history.replaceState(null, '', hash); showToast('Share state placed in the address bar.'); }
}
function exportJSON(data = runtime.circuit, suffix = '') { downloadText(`${slug(runtime.circuit.name)}${suffix}.json`, JSON.stringify(data, null, 2), 'application/json'); }
function chooseFile(accept, handler) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
  input.addEventListener('change', async () => { const file = input.files?.[0]; if (file) await handler(file); }); input.click();
}
function importJSON() {
  chooseFile('application/json,.json', async file => {
    try {
      const data = JSON.parse(await file.text());
      const circuit = data.schema?.startsWith?.('picsetup.semantic') ? importSemanticNetlist(data) : data;
      replaceCircuit(circuit, { toast: 'Experiment imported.' });
    } catch (error) { showToast(`Import failed: ${error.message}`); }
  });
}
function importSParameters(replaceComponentId = null) {
  chooseFile('.json,.csv,application/json,text/csv', async file => {
    try {
      const params = parseSParameterData(await file.text(), file.name);
      mutateCircuit(circuit => {
        const existing = replaceComponentId ? circuit.components.find(item => item.id === replaceComponentId && item.type === 'generic') : null;
        if (existing) existing.params = { ...existing.params, ...params };
        else {
          const component = makeSParameterComponent(params, { x: 550, y: 360 });
          component.id = uniqueId('sblock'); circuit.components.push(component); runtime.selection = { kind: 'component', id: component.id };
        }
      }, { lab: true });
      showToast('S-parameter model imported with provenance and wavelength table.');
    } catch (error) { showToast(`S-parameter import failed: ${error.message}`); }
  });
}
function setPhysicalScale() {
  const current = finite(runtime.circuit.settings.worldToUm, DEFAULT_WORLD_TO_UM);
  const value = prompt('Physical scale in micrometres per canvas unit:', String(current));
  if (value === null) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return showToast('Scale must be a positive number.');
  mutateCircuit(circuit => { circuit.settings.worldToUm = clamp(parsed, 1e-4, 100); });
  showToast('Physical canvas scale updated. Existing physical paths now use the new scale.');
}
function setGridSpacing() {
  const current = finite(runtime.circuit.settings.gridUm, 5);
  const value = prompt('Physical grid spacing in micrometres:', String(current));
  if (value === null) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return showToast('Grid spacing must be a positive number.');
  mutateCircuit(circuit => { circuit.settings.gridUm = clamp(parsed, .01, 10000); });
  showToast('Physical snap grid updated.');
}
function setMinimumBendRadius() {
  const current = finite(runtime.circuit.settings.minBendRadiusUm, 0);
  const value = prompt('Declared minimum bend radius in micrometres (validation only):', String(current));
  if (value === null) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return showToast('Minimum bend radius must be zero or positive.');
  mutateCircuit(circuit => { circuit.settings.minBendRadiusUm = clamp(parsed, 0, 100000); });
  showToast('Minimum bend-radius validation updated.');
}
function handleSheetAction(event) {
  const button = event.target.closest('[data-sheet-action]'); if (!button) return;
  const action = button.dataset.sheetAction;
  dom.sheetDialog.close();
  if (action === 'blank') replaceCircuit(makeBlankCircuit(), { toast: 'Blank circuit ready.' });
  else if (action === 'template') replaceCircuit(makeTemplate(button.dataset.templateId), { toast: `${button.querySelector('b')?.textContent ?? 'Template'} loaded.` });
  else if (action === 'save') { localStorage.setItem('picsetup.explicit-save', JSON.stringify(runtime.circuit)); showToast('Experiment saved in this browser.'); }
  else if (action === 'load') { const stored = localStorage.getItem('picsetup.explicit-save'); stored ? replaceCircuit(JSON.parse(stored), { toast: 'Saved experiment restored.' }) : showToast('No explicit browser save exists yet.'); }
  else if (action === 'lab') openLabPanel();
  else if (action === 'figure') openFigureSheet();
  else if (action === 'toggle-figure-mode') mutateCircuit(circuit => { circuit.settings.figureMode = circuit.settings.figureMode === 'paper' ? 'workbench' : 'paper'; });
  else if (action === 'export-svg') exportPaperSvg();
  else if (action === 'export-png') exportPaperPng();
  else if (action === 'toggle-figure-ports') mutateCircuit(circuit => { circuit.settings.showPortsInFigure = circuit.settings.showPortsInFigure === false; });
  else if (action === 'toggle-figure-grid') mutateCircuit(circuit => { circuit.settings.showGridInFigure = !circuit.settings.showGridInFigure; });
  else if (action === 'toggle-paper-background') mutateCircuit(circuit => { circuit.settings.paperBackground = circuit.settings.paperBackground === 'transparent' ? 'white' : 'transparent'; });
  else if (action === 'export-bridges') downloadText(`${slug(runtime.circuit.name)}-setup-ports.json`, JSON.stringify({ schema: 'setup-project/1', bridges: bridgeManifest(runtime.circuit, runtime.solve, { returnUrl: location.href }) }, null, 2), 'application/json');
  else if (action === 'export-json') exportJSON();
  else if (action === 'export-netlist') downloadText(`${slug(runtime.circuit.name)}-netlist.json`, JSON.stringify(semanticNetlist(runtime.circuit), null, 2), 'application/json');
  else if (action === 'export-sax') downloadText(`${slug(runtime.circuit.name)}-sax.yml`, toSaxYAML(runtime.circuit), 'text/yaml');
  else if (action === 'export-gdsfactory') downloadText(`${slug(runtime.circuit.name)}-gdsfactory.py`, toGdsfactoryPython(runtime.circuit), 'text/x-python');
  else if (action === 'import-json') importJSON();
  else if (action === 'import-sparams') importSParameters();
  else if (action === 'guide') openGuideSheet();
  else if (action === 'link-parameter') {
    const sourceId = button.dataset.sourceId, targetId = button.dataset.targetId;
    const existing = parameterLinkFor(runtime.circuit, sourceId);
    try {
      mutateCircuit(circuit => createParameterLink(circuit, [...(existing?.members ?? [sourceId]), targetId], { name: existing?.name ?? `Linked ${resolveParameter(circuit, sourceId).label}` }), { lab: true });
      showToast('Parameters linked across canvas and Lab analyses.');
    } catch (error) { showToast(error.message); }
  } else if (action === 'unlink-parameter') {
    mutateCircuit(circuit => unlinkParameter(circuit, button.dataset.sourceId), { lab: true });
    showToast('Parameter unlinked.');
  }
  else if (action === 'routing') {
    mutateCircuit(circuit => {
      if (button.dataset.routing === 'schematic') circuit.connections.filter(connection => isOpticalConnection(connection, circuit.components)).forEach(connection => { if (!Number.isFinite(Number(connection.params.schematicLengthUm))) connection.params.schematicLengthUm = connectionLengthUm(connection, circuit.components, { ...circuit.settings, routingMode: 'physical' }); });
      circuit.settings.routingMode = button.dataset.routing;
    });
    showToast(`${button.dataset.routing === 'physical' ? 'Physical' : 'Schematic'} routing active.`);
  } else if (action === 'scale') setPhysicalScale();
  else if (action === 'toggle-snap') { mutateCircuit(circuit => { circuit.settings.snapToGrid = !circuit.settings.snapToGrid; }); showToast(runtime.circuit.settings.snapToGrid ? 'Physical grid snapping enabled.' : 'Physical grid snapping disabled.'); }
  else if (action === 'grid') setGridSpacing();
  else if (action === 'bend-radius') setMinimumBendRadius();
  else if (action === 'expand-block') {
    const id = button.dataset.id;
    mutateCircuit(circuit => { const ids = expandHierarchicalBlock(circuit, id); runtime.selection = { kind: 'multi', ids }; }, { lab: true });
    showToast('Block expanded.');
  } else if (action === 'export-block') {
    const block = runtime.circuit.components.find(item => item.id === button.dataset.id);
    if (block) exportJSON(block.params?.subcircuit ?? block, `-${slug(block.name)}`);
  }
}
function showToast(message) {
  clearTimeout(runtime.toastTimer); dom.toast.textContent = message; dom.toast.classList.add('show');
  runtime.toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 3100);
}
function setPaused(value = !runtime.paused) { runtime.paused = value; updateTimeUI(); }
function bindTimeKnob() {
  let drag = null;
  const update = event => {
    const rect = dom.timeKnob.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let angle = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI + 90; if (angle < 0) angle += 360;
    const mapped = clamp(angle <= 315 && angle >= 225 ? 0 : angle > 315 ? (angle - 315) / 270 : (angle + 45) / 270, 0, 1);
    runtime.speed = Math.max(.1, Math.round(Math.pow(mapped, 1.25) * 40) / 10); updateTimeUI();
  };
  dom.timeKnob.addEventListener('pointerdown', event => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; dom.timeKnob.setPointerCapture?.(event.pointerId); });
  dom.timeKnob.addEventListener('pointermove', event => { if (!drag || drag.id !== event.pointerId) return; drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4; if (drag.moved) update(event); });
  dom.timeKnob.addEventListener('pointerup', event => { if (!drag || drag.id !== event.pointerId) return; if (!drag.moved) setPaused(); drag = null; });
}

function bindEvents() {
  $$('.tool-rail [data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  dom.componentCatalog.addEventListener('click', event => {
    const button = event.target.closest('[data-place-type]'); if (!button) return;
    runtime.placeType = button.dataset.placeType; updateToolUI(); showToast(`Tap the canvas to place ${labelForType(runtime.placeType)}.`);
  });
  dom.svg.addEventListener('pointerdown', handleCanvasPointerDown);
  dom.svg.addEventListener('pointermove', handleCanvasPointerMove);
  dom.svg.addEventListener('pointerup', handleCanvasPointerUp);
  dom.svg.addEventListener('pointercancel', event => { runtime.pointers.delete(event.pointerId); cancelConnection(); });
  dom.svg.addEventListener('dblclick', event => {
    const componentNode = event.target.closest?.('[data-kind="component"]');
    const component = runtime.circuit.components.find(item => item.id === componentNode?.dataset.id);
    if (!component) return;
    if (component.type === 'coupler') openPhysics(component.id);
    else if (component.type === 'block') openBlockSheet(component.id);
    else focusComponent(component.id);
  });
  dom.viewport.addEventListener('wheel', event => { if (dom.physicsDialog.open) return; event.preventDefault(); zoomCanvas(event.deltaY < 0 ? 1.1 : 1 / 1.1, { x: event.clientX, y: event.clientY }); }, { passive: false });
  dom.undoButton.addEventListener('click', undo); dom.redoButton.addEventListener('click', redo); dom.shareButton.addEventListener('click', shareCircuit);
  dom.menuButton.addEventListener('click', openProjectMenu); dom.moreButton.addEventListener('click', openMoreSheet); dom.modelBadge.addEventListener('click', openModelSheet);
  dom.routingButton.addEventListener('click', openRoutingSheet); dom.figureButton?.addEventListener('click', openFigureSheet); dom.powerBudgetButton.addEventListener('click', openPowerBudgetSheet); dom.scaleRuler.addEventListener('click', openRoutingSheet);
  dom.labButton.addEventListener('click', () => runtime.lab.open ? closeLabPanel() : openLabPanel()); dom.labClose.addEventListener('click', closeLabPanel); dom.labMinimize?.addEventListener('click', () => { runtime.lab.compact = !runtime.lab.compact; renderLab(); });
  dom.loadDemoInline.addEventListener('click', () => replaceCircuit(makeDemoCircuit(), { toast: 'Lab-ready MZI loaded.' }));
  dom.zoomOut.addEventListener('click', () => zoomCanvas(1 / 1.15)); dom.zoomIn.addEventListener('click', () => zoomCanvas(1.15));
  dom.zoomReset.addEventListener('click', () => { runtime.circuit.settings.canvasZoom = 1; runtime.circuit.settings.canvasPanX = 0; runtime.circuit.settings.canvasPanY = 0; refresh(); });
  dom.fitButton.addEventListener('click', fitCircuit); dom.pauseButton.addEventListener('click', () => setPaused()); bindTimeKnob();
  bindInspectorDelegation(); bindLabDelegation();
  dom.closePhysics.addEventListener('click', () => dom.physicsDialog.close());
  $$('.physics-tabs [data-view]').forEach(button => button.addEventListener('click', () => setPhysicsView(button.dataset.view)));
  dom.physicsInfoButton.addEventListener('click', () => matchMedia('(max-width: 980px)').matches ? dom.physicsDialog.classList.toggle('show-inspector') : openModelSheet());
  dom.equationCard.addEventListener('click', openModelSheet);
  bindPhysicsRange(dom.gapRange, value => { const coupler = runtime.circuit.components.find(item => item.id === runtime.selectedCouplerId); if (coupler) coupler.params.gapUm = value; });
  bindPhysicsRange(dom.lengthRange, value => { const coupler = runtime.circuit.components.find(item => item.id === runtime.selectedCouplerId); if (coupler) coupler.params.interactionLengthUm = value; });
  bindPhysicsRange(dom.wavelengthRange, value => { runtime.circuit.settings.wavelengthNm = value; runtime.circuit.components.filter(item => item.type === 'source').forEach(source => { source.params.wavelengthNm = value; }); });
  dom.sheetContent.addEventListener('click', handleSheetAction);
  window.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (typing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
    else if (event.key === ' ') { event.preventDefault(); setPaused(); }
    else if (event.key.toLowerCase() === 'l') { event.preventDefault(); runtime.lab.open ? closeLabPanel() : openLabPanel(); }
    else if (event.key === 'Escape') {
      if (runtime.connectStart) cancelConnection();
      else if (dom.physicsDialog.open) dom.physicsDialog.close();
      else if (runtime.lab.open) closeLabPanel();
      else { runtime.selection = null; refresh(); }
    }
  });
  window.addEventListener('hashchange', () => {
    const match = location.hash.match(/^#c=([A-Za-z0-9_-]+)$/); if (!match) return;
    try { replaceCircuit(JSON.parse(new TextDecoder().decode(base64UrlDecode(match[1]))), { history: false, toast: 'Shared circuit opened.' }); }
    catch { showToast('The shared circuit state could not be decoded.'); }
  });
}
function animate(now) {
  const elapsed = (now - runtime.animationStart) / 1000;
  renderer.animate(elapsed, runtime.speed, runtime.paused, runtime.solve?.sourcePowerMw ?? 1);
  if (dom.physicsDialog.open) couplerView.draw(elapsed, runtime.speed, runtime.paused);
  requestAnimationFrame(animate);
}
function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed.', error));
}

buildComponentCatalog();
bindEvents();
refresh({ lab: true });
fitCircuit();
requestAnimationFrame(animate);
registerServiceWorker();
window.picsetup = {
  runtime, solveCircuit, makeDemoCircuit, makeBlankCircuit, makeTemplate,
  listSweepParameters, createParameterLink, unlinkParameter,
  sweepCircuitAsync, optimizeCircuit, runTolerance, simulatePulse,
  semanticNetlist, toSaxYAML, toGdsfactoryPython, openLabPanel, openPhysics,
  autoLayoutCircuit
};
