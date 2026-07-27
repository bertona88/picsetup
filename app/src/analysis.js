import { C, abs, abs2, arg, mul, expi } from './complex.js';
import { defaultParams, getDefinition, listDefinitions, parameterDefinition } from './models.js';
import { connectionLengthUm, solveCircuit, isOpticalConnection } from './physics.js';

const clone = value => structuredClone(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const EPS = 1e-15;

export function defaultMeasurementSpecs(circuit) {
  const saved = Array.isArray(circuit.lab?.measurements) ? circuit.lab.measurements : [];
  if (saved.length) return clone(saved);
  const detectors = circuit.components.filter(component => getDefinition(component.type).detector || getDefinition(component.type).probe);
  if (detectors.length) return detectors.map((component, index) => ({
    id: `m-${component.id}-${index}`,
    kind: 'component', componentId: component.id, metric: 'power',
    label: `${component.name} power`
  }));
  return [{ id: 'm-total-detected', kind: 'circuit', metric: 'detectedPower', label: 'Detected power' }];
}

export function measurementLabel(circuit, spec) {
  if (spec.label) return spec.label;
  if (spec.kind === 'component') {
    const component = circuit.components.find(item => item.id === spec.componentId);
    return `${component?.name ?? spec.componentId} ${spec.metric ?? 'power'}`;
  }
  if (spec.kind === 'port') {
    const component = circuit.components.find(item => item.id === spec.componentId);
    return `${component?.name ?? spec.componentId}:${spec.portId} ${spec.direction ?? 'incoming'} ${spec.metric ?? 'power'}`;
  }
  if (spec.kind === 'connection') return `${spec.connectionId} ${spec.metric ?? 'power'}`;
  return spec.metric ?? 'Measurement';
}

export function readMeasurement(circuit, solve, spec) {
  const fallback = { value: 0, complex: C(), unit: '', label: measurementLabel(circuit, spec) };
  if (!solve?.ok) return fallback;
  if (spec.kind === 'circuit') {
    if (spec.metric === 'sourcePower') return { ...fallback, value: solve.sourcePowerMw, unit: 'mW' };
    if (spec.metric === 'solverResidual') return { ...fallback, value: solve.residual, unit: '' };
    if (spec.metric === 'balanceError') return { ...fallback, value: solve.powerBudget?.balanceErrorFraction ?? 0, unit: '' };
    return { ...fallback, value: solve.detectedPowerMw, unit: 'mW' };
  }
  if (spec.kind === 'connection') {
    const connection = solve.connections?.get(spec.connectionId);
    if (!connection) return fallback;
    if (spec.metric === 'phase') return { ...fallback, value: arg(connection.deliveredToB ?? C()), complex: connection.deliveredToB ?? C(), unit: 'rad' };
    if (spec.metric === 'loss') return { ...fallback, value: connection.lossMw ?? 0, unit: 'mW' };
    const direction = spec.direction === 'reverse' ? 'B' : 'A';
    const complex = direction === 'A' ? (connection.deliveredToB ?? C()) : (connection.deliveredToA ?? C());
    return { ...fallback, value: direction === 'A' ? connection.deliveredToBMw : connection.deliveredToAMw, complex, unit: 'mW' };
  }
  const result = solve.components?.get(spec.componentId);
  if (!result) return fallback;
  if (spec.kind === 'port') {
    const port = result.ports?.[spec.portId];
    if (!port) return fallback;
    const direction = spec.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const complex = port[direction] ?? C();
    if (spec.metric === 'phase') return { ...fallback, value: arg(complex), complex, unit: 'rad' };
    if (spec.metric === 'amplitude') return { ...fallback, value: abs(complex), complex, unit: '√mW' };
    return { ...fallback, value: abs2(complex), complex, unit: 'mW' };
  }

  const ports = Object.values(result.ports ?? {});
  const preferredPort = result.ports?.in ?? ports[0];
  const complex = preferredPort?.incoming ?? C();
  if (spec.metric === 'phase') return { ...fallback, value: arg(complex), complex, unit: 'rad' };
  if (spec.metric === 'amplitude') return { ...fallback, value: abs(complex), complex, unit: '√mW' };
  if (spec.metric === 'current') return { ...fallback, value: result.photocurrentMa ?? 0, complex, unit: 'mA' };
  return { ...fallback, value: result.measurementMw ?? result.opticalPowerMw ?? 0, complex, unit: 'mW' };
}

export function pinMeasurement(circuit, spec) {
  circuit.lab ??= {};
  circuit.lab.measurements ??= [];
  const key = `${spec.kind}:${spec.componentId ?? spec.connectionId ?? ''}:${spec.portId ?? ''}:${spec.metric ?? ''}:${spec.direction ?? ''}`;
  const exists = circuit.lab.measurements.some(item => `${item.kind}:${item.componentId ?? item.connectionId ?? ''}:${item.portId ?? ''}:${item.metric ?? ''}:${item.direction ?? ''}` === key);
  if (!exists) circuit.lab.measurements.push({ id: spec.id ?? `m-${Math.random().toString(36).slice(2, 8)}`, ...clone(spec) });
  return circuit.lab.measurements;
}

function globalParameter(circuit) {
  return {
    id: 'global:wavelengthNm', kind: 'global', key: 'wavelengthNm', label: 'Global wavelength λ', unit: 'nm',
    min: 1200, max: 1700, step: 0.1, tolerance: 0.02,
    get: target => Number(target.settings?.wavelengthNm ?? 1550),
    set: (target, value) => {
      target.settings ??= {};
      target.settings.wavelengthNm = value;
      target.components.filter(component => component.type === 'source').forEach(source => { source.params.wavelengthNm = value; });
    }
  };
}

function rawSweepParameters(circuit) {
  const parameters = [globalParameter(circuit)];
  for (const component of circuit.components) {
    const definition = getDefinition(component.type);
    for (const parameter of definition.parameters ?? []) {
      if (parameter.sweepable === false || parameter.scope === 'visual' || parameter.target === 'global') continue;
      parameters.push({
        id: `component:${component.id}:${parameter.key}`,
        kind: 'component', componentId: component.id, componentType: component.type, key: parameter.key,
        label: `${component.name} · ${parameter.label}`, unit: parameter.unit ?? '',
        min: Number(parameter.min), max: Number(parameter.max), step: Number(parameter.step),
        tolerance: Number(parameter.tolerance ?? 0.01), scope: parameter.scope ?? 'cw',
        get: target => Number(target.components.find(item => item.id === component.id)?.params?.[parameter.key] ?? parameter.default),
        set: (target, value) => {
          const item = target.components.find(candidate => candidate.id === component.id);
          if (item) item.params[parameter.key] = value;
          if (component.type === 'source' && parameter.key === 'wavelengthNm') globalParameter(target).set(target, value);
        }
      });
    }
  }
  for (const connection of circuit.connections) {
    if (!isOpticalConnection(connection, circuit.components)) continue;
    parameters.push({
      id: `connection:${connection.id}:neff`, kind: 'connection', connectionId: connection.id, key: 'neff',
      label: `${connection.id} · effective index`, unit: '', min: 1, max: 4.5, step: 0.001, tolerance: 0.002,
      get: target => Number(target.connections.find(item => item.id === connection.id)?.params?.neff ?? 2.42),
      set: (target, value) => { const item = target.connections.find(candidate => candidate.id === connection.id); if (item) item.params.neff = value; }
    });
    parameters.push({
      id: `connection:${connection.id}:lossDbPerCm`, kind: 'connection', connectionId: connection.id, key: 'lossDbPerCm',
      label: `${connection.id} · propagation loss`, unit: 'dB/cm', min: 0, max: 50, step: 0.05, tolerance: 0.05,
      get: target => Number(target.connections.find(item => item.id === connection.id)?.params?.lossDbPerCm ?? 2),
      set: (target, value) => { const item = target.connections.find(candidate => candidate.id === connection.id); if (item) item.params.lossDbPerCm = value; }
    });
    parameters.push({
      id: `connection:${connection.id}:length`, kind: 'connection', connectionId: connection.id, key: 'schematicLengthUm',
      label: `${connection.id} · optical length`, unit: 'µm', min: 0, max: 10000, step: 0.1, tolerance: 0.01,
      get: target => {
        const item = target.connections.find(candidate => candidate.id === connection.id);
        return connectionLengthUm(item, target.components, target.settings);
      },
      set: (target, value) => {
        const item = target.connections.find(candidate => candidate.id === connection.id);
        if (item) { item.params.routingMode = 'schematic'; item.params.schematicLengthUm = value; }
      }
    });
  }
  return parameters;
}

export function parameterLinkFor(circuit, parameterId) {
  return (circuit.parameterLinks ?? []).find(link => (link.members ?? []).includes(parameterId)) ?? null;
}

function directParameter(circuit, parameterId) {
  return rawSweepParameters(circuit).find(parameter => parameter.id === parameterId) ?? globalParameter(circuit);
}

function setParameterWithLinks(circuit, parameterId, value) {
  const descriptors = new Map(rawSweepParameters(circuit).map(parameter => [parameter.id, parameter]));
  const parameter = descriptors.get(parameterId) ?? globalParameter(circuit);
  const numeric = Number(value);
  const bounded = Number.isFinite(numeric) ? clamp(numeric, Number.isFinite(parameter.min) ? parameter.min : numeric, Number.isFinite(parameter.max) ? parameter.max : numeric) : numeric;
  parameter.set(circuit, bounded);
  const link = parameterLinkFor(circuit, parameterId);
  if (!link) return;
  for (const memberId of link.members ?? []) {
    if (memberId === parameterId) continue;
    const member = descriptors.get(memberId);
    if (!member) continue;
    const mapped = clamp(bounded, Number.isFinite(member.min) ? member.min : bounded, Number.isFinite(member.max) ? member.max : bounded);
    member.set(circuit, mapped);
  }
}

export function createParameterLink(circuit, memberIds, { name = null } = {}) {
  const unique = [...new Set(memberIds ?? [])];
  if (unique.length < 2) throw new Error('Choose at least two parameters to link.');
  const descriptors = new Map(rawSweepParameters(circuit).map(parameter => [parameter.id, parameter]));
  const members = unique.map(id => descriptors.get(id));
  if (members.some(parameter => !parameter)) throw new Error('One linked parameter is no longer available.');
  const unit = members[0].unit ?? '';
  const scope = members[0].scope ?? 'cw';
  if (members.some(parameter => (parameter.unit ?? '') !== unit || (parameter.scope ?? 'cw') !== scope)) throw new Error('Linked parameters must share the same unit and active model scope.');
  circuit.parameterLinks ??= [];
  circuit.parameterLinks = circuit.parameterLinks.map(link => ({ ...link, members: (link.members ?? []).filter(id => !unique.includes(id)) })).filter(link => link.members.length >= 2);
  const id = `link-${Math.random().toString(36).slice(2, 8)}`;
  const link = { id, name: name ?? `Linked ${members[0].label}`, unit, scope, members: unique };
  circuit.parameterLinks.push(link);
  setParameterWithLinks(circuit, unique[0], members[0].get(circuit));
  return link;
}

export function unlinkParameter(circuit, parameterId) {
  circuit.parameterLinks = (circuit.parameterLinks ?? []).map(link => ({ ...link, members: (link.members ?? []).filter(id => id !== parameterId) })).filter(link => link.members.length >= 2);
}

export function listSweepParameters(circuit) {
  return rawSweepParameters(circuit).map(parameter => {
    const link = parameterLinkFor(circuit, parameter.id);
    return {
      ...parameter,
      linkId: link?.id ?? null,
      linkName: link?.name ?? null,
      set: (target, value) => setParameterWithLinks(target, parameter.id, value)
    };
  });
}

export function resolveParameter(circuit, parameterId) {
  return listSweepParameters(circuit).find(parameter => parameter.id === parameterId) ?? globalParameter(circuit);
}

function axisValues(start, stop, points, scaleMode = 'linear') {
  const n = clamp(Math.round(points), 2, 5001);
  if (scaleMode === 'log' && start > 0 && stop > 0) {
    const a = Math.log(start), b = Math.log(stop);
    return Array.from({ length: n }, (_, index) => Math.exp(a + (b - a) * index / (n - 1)));
  }
  return Array.from({ length: n }, (_, index) => start + (stop - start) * index / (n - 1));
}

export function sweepCircuit(circuit, sweep, measurements = defaultMeasurementSpecs(circuit)) {
  const started = performance.now();
  const parameter = resolveParameter(circuit, sweep.parameterId);
  const values = axisValues(Number(sweep.start ?? parameter.min), Number(sweep.stop ?? parameter.max), Number(sweep.points ?? 301), sweep.scale ?? 'linear');
  const working = clone(circuit);
  const traces = measurements.map(spec => ({ spec: clone(spec), label: measurementLabel(circuit, spec), unit: '', values: [], complex: [] }));
  const solveTimes = [];
  let failures = 0;
  for (const value of values) {
    parameter.set(working, value);
    const solve = solveCircuit(working);
    solveTimes.push(solve.elapsedMs ?? 0);
    if (!solve.ok) failures += 1;
    traces.forEach(trace => {
      const measurement = readMeasurement(working, solve, trace.spec);
      trace.values.push(measurement.value);
      trace.complex.push(measurement.complex);
      trace.unit = measurement.unit;
    });
  }
  const currentValue = parameter.get(circuit);
  return {
    kind: 'sweep', parameter: { ...parameter, get: undefined, set: undefined }, x: values, traces,
    currentValue, currentIndex: values.reduce((best, value, index) => Math.abs(value - currentValue) < Math.abs(values[best] - currentValue) ? index : best, 0),
    metrics: traces.map(trace => analyzeTrace(values, trace.values, { sourcePowerMw: solveCircuit(circuit).sourcePowerMw, unit: trace.unit, complex: trace.complex, xParameterId: parameter.id })),
    comparison: traces.length >= 2 ? analyzePair(values, traces[0].values, traces[1].values) : null,
    failures, elapsedMs: performance.now() - started, solveTimeMeanMs: solveTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, solveTimes.length)
  };
}

export async function sweepCircuitAsync(circuit, sweep, measurements = defaultMeasurementSpecs(circuit), onProgress = null) {
  const started = performance.now();
  const parameter = resolveParameter(circuit, sweep.parameterId);
  const values = axisValues(Number(sweep.start ?? parameter.min), Number(sweep.stop ?? parameter.max), Number(sweep.points ?? 301), sweep.scale ?? 'linear');
  const working = clone(circuit);
  const traces = measurements.map(spec => ({ spec: clone(spec), label: measurementLabel(circuit, spec), unit: '', values: [], complex: [] }));
  let failures = 0;
  let solveTime = 0;
  for (let index = 0; index < values.length; index += 1) {
    parameter.set(working, values[index]);
    const solve = solveCircuit(working);
    solveTime += solve.elapsedMs ?? 0;
    if (!solve.ok) failures += 1;
    traces.forEach(trace => {
      const measurement = readMeasurement(working, solve, trace.spec);
      trace.values.push(measurement.value);
      trace.complex.push(measurement.complex);
      trace.unit = measurement.unit;
    });
    if (index % 32 === 31) {
      onProgress?.((index + 1) / values.length);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  const baseSolve = solveCircuit(circuit);
  const currentValue = parameter.get(circuit);
  const result = {
    kind: 'sweep', parameter: { ...parameter, get: undefined, set: undefined }, x: values, traces,
    currentValue, currentIndex: values.reduce((best, value, index) => Math.abs(value - currentValue) < Math.abs(values[best] - currentValue) ? index : best, 0),
    metrics: traces.map(trace => analyzeTrace(values, trace.values, { sourcePowerMw: baseSolve.sourcePowerMw, unit: trace.unit, complex: trace.complex, xParameterId: parameter.id })),
    comparison: traces.length >= 2 ? analyzePair(values, traces[0].values, traces[1].values) : null,
    failures, elapsedMs: performance.now() - started, solveTimeMeanMs: solveTime / Math.max(1, values.length)
  };
  onProgress?.(1);
  return result;
}

function peakIndices(values) {
  const peaks = [];
  for (let index = 1; index < values.length - 1; index += 1) {
    if (values[index] > values[index - 1] && values[index] >= values[index + 1]) peaks.push(index);
  }
  return peaks;
}

function crossingX(x0, y0, x1, y1, threshold) {
  if (Math.abs(y1 - y0) < EPS) return (x0 + x1) / 2;
  return x0 + (threshold - y0) * (x1 - x0) / (y1 - y0);
}

function unwrapPhase(values) {
  if (!values.length) return [];
  const out = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    let delta = values[index] - values[index - 1];
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    out.push(out[index - 1] + delta);
  }
  return out;
}

function derivative(x, y) {
  return y.map((_value, index) => {
    const left = Math.max(0, index - 1);
    const right = Math.min(y.length - 1, index + 1);
    if (left === right) return 0;
    const dx = x[right] - x[left];
    return Math.abs(dx) < EPS ? 0 : (y[right] - y[left]) / dx;
  });
}

export function analyzeTrace(x, y, { sourcePowerMw = 1, unit = 'mW', complex = null, xParameterId = '' } = {}) {
  if (!x.length || x.length !== y.length) return {};
  let maxIndex = 0, minIndex = 0;
  for (let index = 1; index < y.length; index += 1) {
    if (y[index] > y[maxIndex]) maxIndex = index;
    if (y[index] < y[minIndex]) minIndex = index;
  }
  const max = y[maxIndex], min = y[minIndex];
  const threshold = max / 2;
  let left = x[0], right = x.at(-1);
  for (let index = maxIndex; index > 0; index -= 1) {
    if ((y[index] - threshold) * (y[index - 1] - threshold) <= 0) { left = crossingX(x[index], y[index], x[index - 1], y[index - 1], threshold); break; }
  }
  for (let index = maxIndex; index < y.length - 1; index += 1) {
    if ((y[index] - threshold) * (y[index + 1] - threshold) <= 0) { right = crossingX(x[index], y[index], x[index + 1], y[index + 1], threshold); break; }
  }
  const peaks = peakIndices(y).filter(index => y[index] > min + 0.25 * (max - min));
  const spacings = peaks.slice(1).map((index, i) => x[index] - x[peaks[i]]).filter(Number.isFinite);
  const fsr = spacings.length ? spacings.sort((a, b) => a - b)[Math.floor(spacings.length / 2)] : null;
  const extinctionDb = unit === 'mW' ? 10 * Math.log10(Math.max(max, EPS) / Math.max(min, EPS)) : null;
  const insertionLossDb = unit === 'mW' ? -10 * Math.log10(Math.max(max, EPS) / Math.max(sourcePowerMw, EPS)) : null;
  const hasComplex = Array.isArray(complex) && complex.length === x.length;
  const phaseRad = hasComplex ? unwrapPhase(complex.map(value => arg(value ?? C()))) : [];
  let groupDelayPs = null;
  if (phaseRad.length && /wavelengthNm$/.test(xParameterId)) {
    const speedOfLight = 299792458;
    const omega = x.map(wavelengthNm => 2 * Math.PI * speedOfLight / Math.max(1e-18, wavelengthNm * 1e-9));
    groupDelayPs = derivative(omega, phaseRad).map(value => -value * 1e12);
  }
  const finiteGroupDelay = groupDelayPs?.filter(Number.isFinite) ?? [];
  return {
    max, min, maxX: x[maxIndex], minX: x[minIndex], maxIndex, minIndex,
    extinctionDb, insertionLossDb, bandwidth3dB: right - left, bandwidthLeft: left, bandwidthRight: right,
    fsr, peakCount: peaks.length,
    mean: y.reduce((sum, value) => sum + value, 0) / y.length,
    rms: Math.sqrt(y.reduce((sum, value) => sum + value * value, 0) / y.length),
    phaseRad,
    phaseAtMaxRad: phaseRad[maxIndex] ?? null,
    phaseExcursionRad: phaseRad.length ? Math.max(...phaseRad) - Math.min(...phaseRad) : null,
    groupDelayPs,
    groupDelayAtMaxPs: groupDelayPs?.[maxIndex] ?? null,
    groupDelayMeanPs: finiteGroupDelay.length ? finiteGroupDelay.reduce((sum, value) => sum + value, 0) / finiteGroupDelay.length : null,
    groupDelayMinPs: finiteGroupDelay.length ? Math.min(...finiteGroupDelay) : null,
    groupDelayMaxPs: finiteGroupDelay.length ? Math.max(...finiteGroupDelay) : null
  };
}

export function analyzePair(x, first, second) {
  const total = first.map((value, index) => value + (second[index] ?? 0));
  const imbalance = first.map((value, index) => (value - (second[index] ?? 0)) / Math.max(total[index], EPS));
  const contrast = first.map((value, index) => 10 * Math.log10((value + EPS) / ((second[index] ?? 0) + EPS)));
  return {
    totalMin: Math.min(...total), totalMax: Math.max(...total),
    imbalanceMax: Math.max(...imbalance.map(Math.abs)),
    contrastMaxDb: Math.max(...contrast), contrastMinDb: Math.min(...contrast),
    crossoverX: x[imbalance.reduce((best, value, index) => Math.abs(value) < Math.abs(imbalance[best]) ? index : best, 0)]
  };
}

function objectiveAt(circuit, config) {
  const wavelengths = [];
  const center = Number(circuit.settings?.wavelengthNm ?? 1550);
  const window = Math.max(0, Number(config.robustWindowNm ?? 0));
  const count = window > 0 ? 7 : 1;
  for (let index = 0; index < count; index += 1) wavelengths.push(center + (count === 1 ? 0 : -window + 2 * window * index / (count - 1)));
  const primary = [];
  const secondary = [];
  for (const wavelengthNm of wavelengths) {
    const solve = solveCircuit(circuit, { wavelengthNm });
    primary.push(readMeasurement(circuit, solve, config.measurement).value);
    if (config.secondaryMeasurement) secondary.push(readMeasurement(circuit, solve, config.secondaryMeasurement).value);
  }
  if (config.goal === 'minimize') return { score: -Math.max(...primary), value: primary.reduce((sum, value) => sum + value, 0) / primary.length };
  if (config.goal === 'target') {
    const error = primary.reduce((sum, value) => sum + Math.abs(value - Number(config.targetValue ?? 0)), 0) / primary.length;
    return { score: -error, value: primary.reduce((sum, value) => sum + value, 0) / primary.length };
  }
  if (config.goal === 'contrast' && secondary.length) {
    const contrasts = primary.map((value, index) => 10 * Math.log10((value + EPS) / (secondary[index] + EPS)));
    return { score: Math.min(...contrasts), value: contrasts.reduce((sum, value) => sum + value, 0) / contrasts.length };
  }
  return { score: Math.min(...primary), value: primary.reduce((sum, value) => sum + value, 0) / primary.length };
}

export async function optimizeCircuit(circuit, config, onProgress = null) {
  const working = clone(circuit);
  const knobs = (config.parameterIds ?? []).slice(0, 4).map(id => resolveParameter(working, id));
  if (!knobs.length) throw new Error('Choose at least one tunable parameter.');
  const before = objectiveAt(working, config);
  let best = before;
  let evaluations = 1;
  const passes = clamp(Number(config.passes ?? 4), 1, 8);
  const samples = clamp(Number(config.samplesPerPass ?? 33), 9, 101);

  for (let pass = 0; pass < passes; pass += 1) {
    for (let knobIndex = 0; knobIndex < knobs.length; knobIndex += 1) {
      const knob = knobs[knobIndex];
      const current = knob.get(working);
      const fullRange = knob.max - knob.min;
      const localHalf = pass === 0 ? fullRange / 2 : fullRange / (2 * 3 ** pass);
      const start = pass === 0 ? knob.min : clamp(current - localHalf, knob.min, knob.max);
      const stop = pass === 0 ? knob.max : clamp(current + localHalf, knob.min, knob.max);
      let localBest = { ...best, knobValue: current };
      for (let index = 0; index < samples; index += 1) {
        const value = start + (stop - start) * index / (samples - 1);
        knob.set(working, value);
        const candidate = objectiveAt(working, config);
        evaluations += 1;
        if (candidate.score > localBest.score) localBest = { ...candidate, knobValue: value };
        if (evaluations % 24 === 0) {
          onProgress?.((pass * knobs.length + knobIndex + index / samples) / (passes * knobs.length));
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }
      knob.set(working, localBest.knobValue);
      best = localBest;
    }
  }
  const after = objectiveAt(working, config);
  onProgress?.(1);
  return {
    circuit: working,
    before, after,
    settings: knobs.map(knob => ({ id: knob.id, label: knob.label, value: knob.get(working), unit: knob.unit })),
    evaluations
  };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function normal(random) {
  const u = Math.max(EPS, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function correlation(x, y) {
  const mx = x.reduce((sum, value) => sum + value, 0) / x.length;
  const my = y.reduce((sum, value) => sum + value, 0) / y.length;
  let xy = 0, xx = 0, yy = 0;
  for (let index = 0; index < x.length; index += 1) {
    const dx = x[index] - mx, dy = y[index] - my;
    xy += dx * dy; xx += dx * dx; yy += dy * dy;
  }
  return xy / Math.sqrt(Math.max(EPS, xx * yy));
}
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index), hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
function histogram(values, binCount = 24) {
  const min = Math.min(...values), max = Math.max(...values);
  const width = Math.max(EPS, (max - min) / binCount);
  const bins = Array.from({ length: binCount }, (_, index) => ({ x0: min + index * width, x1: min + (index + 1) * width, count: 0 }));
  values.forEach(value => bins[Math.min(binCount - 1, Math.floor((value - min) / width))].count += 1);
  return bins;
}

export async function runTolerance(circuit, config, onProgress = null) {
  const parameters = (config.parameters ?? []).slice(0, 8).map(item => {
    const descriptor = resolveParameter(circuit, item.id ?? item.parameterId);
    return { descriptor, sigma: Number(item.sigma ?? descriptor.tolerance ?? 0.01), relative: item.relative !== false };
  });
  if (!parameters.length) throw new Error('Choose at least one tolerance parameter.');
  const samples = clamp(Number(config.samples ?? 500), 20, 10000);
  const random = mulberry32(Number(config.seed ?? 24681357));
  const values = [];
  const deviations = parameters.map(() => []);
  const nominalSolve = solveCircuit(circuit);
  const nominal = readMeasurement(circuit, nominalSolve, config.measurement).value;

  for (let sample = 0; sample < samples; sample += 1) {
    const working = clone(circuit);
    parameters.forEach((item, index) => {
      const base = item.descriptor.get(circuit);
      const z = normal(random);
      const delta = item.relative ? base * item.sigma * z : item.sigma * z;
      item.descriptor.set(working, clamp(base + delta, item.descriptor.min, item.descriptor.max));
      deviations[index].push(delta);
    });
    const solve = solveCircuit(working);
    values.push(readMeasurement(working, solve, config.measurement).value);
    if (sample % 40 === 39) {
      onProgress?.((sample + 1) / samples);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  const sensitivities = parameters.map((item, index) => ({
    id: item.descriptor.id,
    label: item.descriptor.label,
    correlation: correlation(deviations[index], values),
    sigma: item.sigma,
    relative: item.relative
  })).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  const threshold = Number(config.threshold ?? nominal * 0.9);
  const pass = config.criterion === 'max' ? values.filter(value => value <= threshold).length : values.filter(value => value >= threshold).length;

  const cornerParameters = parameters.slice(0, 7);
  const corners = [];
  const cornerCount = 2 ** cornerParameters.length;
  for (let mask = 0; mask < cornerCount; mask += 1) {
    const working = clone(circuit);
    const corner = [];
    cornerParameters.forEach((item, index) => {
      const base = item.descriptor.get(circuit);
      const sign = mask & (1 << index) ? 1 : -1;
      const delta = item.relative ? base * item.sigma * 3 * sign : item.sigma * 3 * sign;
      const value = clamp(base + delta, item.descriptor.min, item.descriptor.max);
      item.descriptor.set(working, value);
      corner.push({ id: item.descriptor.id, value });
    });
    const solve = solveCircuit(working);
    corners.push({ value: readMeasurement(working, solve, config.measurement).value, settings: corner });
  }
  corners.sort((a, b) => a.value - b.value);
  onProgress?.(1);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const std = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1));
  return {
    kind: 'tolerance', nominal, values, mean, std,
    p05: quantile(values, 0.05), p50: quantile(values, 0.5), p95: quantile(values, 0.95),
    min: Math.min(...values), max: Math.max(...values),
    threshold, criterion: config.criterion ?? 'min', yield: pass / values.length,
    sensitivities, histogram: histogram(values, Number(config.bins ?? 24)),
    worstCorner: corners[0], bestCorner: corners.at(-1), samples
  };
}

function dftAt(spectrum, frequencies, timePs) {
  let re = 0, im = 0;
  for (let index = 0; index < spectrum.length; index += 1) {
    const phase = 2 * Math.PI * frequencies[index] * timePs;
    const c = Math.cos(phase), s = Math.sin(phase);
    re += spectrum[index].re * c - spectrum[index].im * s;
    im += spectrum[index].re * s + spectrum[index].im * c;
  }
  return C(re / spectrum.length, im / spectrum.length);
}
function centroid(time, intensity) {
  const total = intensity.reduce((sum, value) => sum + value, 0);
  return time.reduce((sum, value, index) => sum + value * intensity[index], 0) / Math.max(EPS, total);
}
function fwhm(time, intensity) {
  const max = Math.max(...intensity);
  const threshold = max / 2;
  const indices = intensity.map((value, index) => value >= threshold ? index : -1).filter(index => index >= 0);
  if (indices.length < 2) return 0;
  return time[indices.at(-1)] - time[indices[0]];
}
function lowPassIntensity(intensity, dtPs, bandwidthGhz) {
  const bandwidthPerPs = Math.max(0, bandwidthGhz) * 0.001;
  if (bandwidthPerPs <= 0) return intensity.map(() => 0);
  const alpha = 1 - Math.exp(-2 * Math.PI * bandwidthPerPs * dtPs);
  const out = [];
  let state = 0;
  for (const value of intensity) { state += alpha * (value - state); out.push(state); }
  return out;
}

export async function simulatePulse(circuit, measurement, options = {}, onProgress = null) {
  const source = circuit.components.find(component => component.type === 'source');
  if (!source) throw new Error('A source is required for pulse analysis.');
  const durationPs = Math.max(0.05, Number(options.durationPs ?? source.params?.pulseDurationPs ?? 12));
  const repetitionRateMHz = Math.max(0.001, Number(options.repetitionRateMHz ?? source.params?.repetitionRateMHz ?? 80));
  const centerWavelengthNm = Number(circuit.settings?.wavelengthNm ?? source.params?.wavelengthNm ?? 1550);
  const samples = clamp(Math.round(Number(options.samples ?? source.params?.spectralSamples ?? 192)), 64, 512);
  const cUmPerPs = 299.792458;
  const centerFrequencyThz = cUmPerPs / (centerWavelengthNm / 1000);
  const spanThz = Math.max(0.08, Math.min(centerFrequencyThz * 0.2, Number(options.spanThz ?? 8 / durationPs)));
  const df = spanThz / samples;
  const offsets = Array.from({ length: samples }, (_, index) => (index - samples / 2) * df);
  const inputSpectrum = [];
  const outputSpectrum = [];

  for (let index = 0; index < samples; index += 1) {
    const offset = offsets[index];
    const frequency = centerFrequencyThz + offset;
    const wavelengthNm = cUmPerPs / frequency * 1000;
    const solve = solveCircuit(circuit, { wavelengthNm });
    const transfer = readMeasurement(circuit, solve, measurement).complex;
    const envelope = Math.exp(-(Math.PI ** 2) * durationPs ** 2 * offset ** 2 / (2 * Math.log(2)));
    const input = C(envelope, 0);
    inputSpectrum.push(input);
    outputSpectrum.push(mul(input, transfer));
    if (index % 24 === 23) {
      onProgress?.((index + 1) / (samples * 2));
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  const timeWindowPs = 1 / df;
  const dtPs = timeWindowPs / samples;
  const timePs = Array.from({ length: samples }, (_, index) => (index - samples / 2) * dtPs);
  const inputField = [];
  const outputField = [];
  for (let index = 0; index < samples; index += 1) {
    inputField.push(dftAt(inputSpectrum, offsets, timePs[index]));
    outputField.push(dftAt(outputSpectrum, offsets, timePs[index]));
    if (index % 32 === 31) {
      onProgress?.(0.5 + (index + 1) / (samples * 2));
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  const inputIntensityRaw = inputField.map(abs2);
  const normalization = Math.max(EPS, Math.max(...inputIntensityRaw));
  const inputIntensity = inputIntensityRaw.map(value => value / normalization);
  const outputIntensity = outputField.map(abs2).map(value => value / normalization);
  const detector = measurement.kind === 'component' ? circuit.components.find(component => component.id === measurement.componentId && getDefinition(component.type).detector) : null;
  const electricalIntensity = detector ? lowPassIntensity(outputIntensity, dtPs, Number(detector.params?.bandwidthGhz ?? 20)) : [...outputIntensity];
  const inputCenter = centroid(timePs, inputIntensity);
  const outputCenter = centroid(timePs, outputIntensity);
  const inputFwhm = fwhm(timePs, inputIntensity);
  const outputFwhm = fwhm(timePs, outputIntensity);
  onProgress?.(1);
  return {
    kind: 'pulse', timePs, inputIntensity, outputIntensity, electricalIntensity,
    offsetsThz: offsets, inputSpectrum: inputSpectrum.map(abs2), outputSpectrum: outputSpectrum.map(abs2),
    metrics: {
      delayPs: outputCenter - inputCenter,
      inputFwhmPs: inputFwhm,
      outputFwhmPs: outputFwhm,
      broadening: inputFwhm > 0 ? outputFwhm / inputFwhm : null,
      peakTransmission: Math.max(...outputIntensity),
      electricalPeak: Math.max(...electricalIntensity),
      repetitionPeriodPs: 1e6 / repetitionRateMHz,
      spectralSpanThz: spanThz
    },
    centerWavelengthNm, durationPs, repetitionRateMHz, samples, detectorBandwidthGhz: detector ? Number(detector.params?.bandwidthGhz ?? 20) : null
  };
}
