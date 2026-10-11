import { add, complex, div, finite, magnitude, mul, polar, power, sub } from '../model/complex';
import { defaultParams, evaluate, MODEL_IDS, portNames } from '../model/registry';
import { datasetMetadata, datasetSigmaMax } from '../model/dataset';
import { evaluatePropagation, validatePropagation, waveguideMetadata } from '../model/propagation';
import type { Circuit, Complex, Component, Diagnostic, Endpoint, ModelId, PowerBudget, SolveResult } from '../model/types';

export const MAX_COMPONENTS = 100;
export const MAX_PORTS = 256;
export const MAX_CONNECTIONS = 128;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const idValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const endpointKey = (endpoint: Endpoint): string => JSON.stringify([endpoint.component, endpoint.port]);
const emptyBudget = (): PowerBudget => ({ emittedW: 0, modelSuppliedW: 0, detectedW: 0, escapedW: 0, componentAbsorbedW: 0, returnedToSourceW: 0, propagationLossW: 0, imbalanceW: 0 });
const failure = (diagnostics: Diagnostic[], residual = 0): SolveResult => ({ ok: false, ports: [], detectors: {}, budget: emptyBudget(), residual, diagnostics });

/** Structural and model-domain validation only: a valid document may still be singular. */
export function validateCircuit(circuit: Circuit): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, message: string, extra: Partial<Diagnostic> = {}) => diagnostics.push({ severity: 'error', code, message, ...extra });
  if (!record(circuit) || !Array.isArray(circuit.components) || !Array.isArray(circuit.connections)) {
    error('INVALID_CIRCUIT', 'Circuit must contain component and connection arrays.');
    return diagnostics;
  }
  if (!isNumber(circuit.wavelengthM) || circuit.wavelengthM <= 0) error('INVALID_WAVELENGTH', 'Vacuum wavelength must be finite and greater than zero metres.');
  if (circuit.components.length > MAX_COMPONENTS || circuit.connections.length > MAX_CONNECTIONS) {
    error('CIRCUIT_TOO_LARGE', `Interactive limit is ${MAX_COMPONENTS} components, ${MAX_PORTS} ports and ${MAX_CONNECTIONS} connections.`);
    return diagnostics;
  }
  const components = new Map<string, Component>();
  let sources = 0;
  let totalPorts = 0;
  for (const item of circuit.components) {
    if (!record(item) || !idValid(item.id) || typeof item.label !== 'string') {
      error('INVALID_COMPONENT', 'Components need a nonempty ID (at most 256 characters) and a text label.');
      continue;
    }
    const extra = { componentId: item.id };
    if (components.has(item.id)) error('DUPLICATE_COMPONENT', `Duplicate component ID: ${item.id}.`, extra);
    if (!MODEL_IDS.includes(item.model as ModelId)) { error('UNSUPPORTED_MODEL', `Unsupported model: ${String(item.model)}.`, extra); continue; }
    if (item.version !== '1') error('UNSUPPORTED_MODEL_VERSION', 'Only bundled model version 1 is supported.', extra);
    const model = item.model as ModelId;
    totalPorts += portNames(model).length;
    if (model === 'source') sources++;
    components.set(item.id, item as unknown as Component);
    const expected = Object.keys(defaultParams(model));
    const params = item.params;
    if (!record(params) || Object.keys(params).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(params, key) || !isNumber(params[key]))) {
      error('INVALID_PARAMETERS', `Model ${model} needs exactly these finite numeric parameters: ${expected.join(', ') || '(none)'}.`, extra);
      continue;
    }
    if (model === 'source' && (params.powerW as number) < 0) error('INVALID_POWER', 'Source power must be nonnegative watts.', extra);
    if (model === 'coupler' && ((params.coupling as number) < 0 || (params.coupling as number) > 1)) error('INVALID_COUPLING', 'Power coupling must be between zero and one.', extra);
    if (model === 'attenuator' && (params.attenuationDb as number) < 0) error('INVALID_ATTENUATION', 'Attenuation must be nonnegative dB.', extra);
    if (model === 'siepic-coupler' && isNumber(circuit.wavelengthM) && circuit.wavelengthM > 0) {
      try {
        const sigma = datasetSigmaMax(circuit.wavelengthM);
        if (sigma > 1 + 1e-6) diagnostics.push({ severity: 'warning', code: 'DATASET_PASSIVITY', message: `Interpolated dataset is not passive at this wavelength (σmax=${sigma.toFixed(6)}). Apparent gain is retained and accounted for.`, ...extra });
      } catch (err) { error('DATASET_OUT_OF_BAND', (err as Error).message, extra); }
    }
  }
  if (circuit.components.some(component => component?.model === 'siepic-coupler')) diagnostics.push({ severity: 'warning', code: 'EXPERIMENTAL_DATASET', message: `${datasetMetadata.title}: experimental interpolated response. Raw data has slight passivity violations; native port-plane locations are unknown. Cartesian interpolation may add apparent loss. No calibrated-device claim.` });
  if (totalPorts > MAX_PORTS) error('CIRCUIT_TOO_LARGE', `Interactive limit is ${MAX_PORTS} optical ports.`);
  if (sources > 1) error('MULTIPLE_SOURCES', 'M1 supports at most one coherent source per circuit.');
  const occupied = new Set<string>();
  const connectionIds = new Set<string>();
  for (const item of circuit.connections) {
    if (!record(item) || !idValid(item.id)) { error('INVALID_CONNECTION', 'Connections need a nonempty ID (at most 256 characters).'); continue; }
    const extra = { connectionId: item.id };
    if (connectionIds.has(item.id)) error('DUPLICATE_CONNECTION', `Duplicate connection ID: ${item.id}.`, extra);
    connectionIds.add(item.id);
    const endpoints = [item.from, item.to];
    const valid = endpoints.every(endpoint => record(endpoint) && typeof endpoint.component === 'string' && Number.isInteger(endpoint.port) && components.has(endpoint.component) && (endpoint.port as number) >= 0 && (endpoint.port as number) < portNames(components.get(endpoint.component)!.model).length);
    if (!valid) error('INVALID_ENDPOINT', 'Every connection endpoint must reference an existing component port.', extra);
    else {
      const keys = endpoints.map(endpoint => endpointKey(endpoint as Endpoint));
      if (keys[0] === keys[1]) error('SELF_CONNECTION', 'A connection must join two distinct ports.', extra);
      for (const key of keys) {
        if (occupied.has(key)) error('PORT_ALREADY_CONNECTED', 'Each optical port can have only one connection.', extra);
        occupied.add(key);
      }
    }
    diagnostics.push(...validatePropagation(item, circuit.wavelengthM));
  }
  if (circuit.connections.some(line => line?.waveguide !== undefined)) diagnostics.push({ severity: 'warning', code: 'EXPERIMENTAL_WAVEGUIDE', message: `${waveguideMetadata.title}: reduced-order dispersion. 1500–1600 nm is a declared evaluation assumption, not a source-validated fit band. Loss is user-declared; physical mode matching and port-plane registration are unqualified.` });
  if (circuit.components.length === 0) diagnostics.push({ severity: 'info', code: 'EMPTY_CIRCUIT', message: 'Place a source and connect components to begin.' });
  else if (sources === 0) diagnostics.push({ severity: 'info', code: 'NO_SOURCE', message: 'No source is present; a uniquely solvable passive circuit has zero fields.' });
  if (!diagnostics.some(d => d.severity === 'error') && totalPorts > occupied.size) diagnostics.push({ severity: 'warning', code: 'MATCHED_BOUNDARIES', message: `${totalPorts - occupied.size} unconnected port(s) use matched boundaries (zero incoming field); outgoing power escapes.` });
  return diagnostics;
}

type LinearSolution = { values: Complex[]; minScaledPivot: number } | { error: string };

/** Scaled partial pivoting. Reject pivots below a dimension-scaled roundoff bound. */
function solveLinear(input: Complex[][], rhs: Complex[]): LinearSolution {
  const n = input.length;
  const a = input.map(row => row.map(value => ({ ...value })));
  const b = rhs.map(value => ({ ...value }));
  const scales = a.map(row => Math.max(...row.map(magnitude)));
  const pivotTolerance = 64 * Number.EPSILON * Math.max(1, n);
  let minScaledPivot = 1;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    let best = -1;
    for (let row = column; row < n; row++) {
      const scaled = scales[row] === 0 ? 0 : magnitude(a[row][column]) / scales[row];
      if (scaled > best) { best = scaled; pivot = row; }
    }
    if (!Number.isFinite(best) || best <= pivotTolerance) return { error: 'The network is singular or numerically unresolved at this wavelength. Add a modeled loss or matched boundary, or change the physical parameters; no artificial damping was added.' };
    minScaledPivot = Math.min(minScaledPivot, best);
    if (pivot !== column) {
      [a[column], a[pivot]] = [a[pivot], a[column]];
      [b[column], b[pivot]] = [b[pivot], b[column]];
      [scales[column], scales[pivot]] = [scales[pivot], scales[column]];
    }
    for (let row = column + 1; row < n; row++) {
      if (magnitude(a[row][column]) === 0) continue;
      const factor = div(a[row][column], a[column][column]);
      a[row][column] = complex();
      for (let col = column + 1; col < n; col++) a[row][col] = sub(a[row][col], mul(factor, a[column][col]));
      b[row] = sub(b[row], mul(factor, b[column]));
    }
  }
  const values = Array.from({ length: n }, () => complex());
  for (let row = n - 1; row >= 0; row--) {
    let value = b[row];
    for (let col = row + 1; col < n; col++) value = sub(value, mul(a[row][col], values[col]));
    values[row] = div(value, a[row][row]);
    if (!finite(values[row])) return { error: 'The solved field exceeded the finite numerical range.' };
  }
  return { values, minScaledPivot };
}

export function solveCircuit(circuit: Circuit): SolveResult {
  const diagnostics = validateCircuit(circuit);
  if (diagnostics.some(d => d.severity === 'error')) return failure(diagnostics);
  const indices = new Map<string, number>();
  const offsets = new Map<string, number>();
  let n = 0;
  for (const component of circuit.components) {
    offsets.set(component.id, n);
    portNames(component.model).forEach((_, port) => indices.set(endpointKey({ component: component.id, port }), n++));
  }
  if (n === 0) return { ok: true, ports: [], detectors: {}, budget: emptyBudget(), residual: 0, diagnostics };
  const neighbors: Array<{ index: number; h: Complex } | undefined> = Array(n);
  for (const line of circuit.connections) {
    const from = indices.get(endpointKey(line.from))!;
    const to = indices.get(endpointKey(line.to))!;
    const { h } = evaluatePropagation(line, circuit.wavelengthM);
    neighbors[from] = { index: to, h }; neighbors[to] = { index: from, h };
  }
  const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => complex(i === j ? 1 : 0)));
  const rhs = Array.from({ length: n }, () => complex());
  for (const component of circuit.components) {
    const offset = offsets.get(component.id)!;
    const s = evaluate(component, circuit.wavelengthM);
    s.forEach((row, output) => row.forEach((value, input) => {
      const neighbor = neighbors[offset + input];
      if (neighbor) matrix[offset + output][neighbor.index] = sub(matrix[offset + output][neighbor.index], mul(value, neighbor.h));
    }));
    if (component.model === 'source') rhs[offset] = polar(Math.sqrt(component.params.powerW), component.params.phaseRad);
  }
  const solved = solveLinear(matrix, rhs);
  if ('error' in solved) return failure([...diagnostics, { severity: 'error', code: 'SINGULAR_NETWORK', message: solved.error }]);
  const outgoing = solved.values;
  const incoming = Array.from({ length: n }, (_, i) => {
    const neighbor = neighbors[i];
    return neighbor ? mul(neighbor.h, outgoing[neighbor.index]) : complex();
  });
  const maxField = Math.max(...outgoing.map(magnitude));
  const rhsNorm = Math.max(...rhs.map(magnitude));
  const matrixNorm = Math.max(...matrix.map(row => row.reduce((sum, entry) => sum + magnitude(entry), 0)));
  let residualNorm = 0;
  matrix.forEach((row, i) => {
    const value = row.reduce((sum, entry, j) => add(sum, mul(entry, outgoing[j])), complex());
    residualNorm = Math.max(residualNorm, magnitude(sub(value, rhs[i])));
  });
  // Divide before adding to avoid overflow in ||A||∞ ||b||∞ + ||s||∞.
  const normScale = Math.max(maxField, rhsNorm);
  const residual = normScale === 0 ? 0 : (residualNorm / normScale) / (matrixNorm * (maxField / normScale) + rhsNorm / normScale);
  if (!Number.isFinite(residual) || residual > 1e-10) return failure([...diagnostics, { severity: 'error', code: 'LARGE_RESIDUAL', message: 'The normalized linear-system residual exceeds 1e−10; this result is not reliable.' }], Number.isFinite(residual) ? residual : 0);
  if (solved.minScaledPivot < 1e-8) diagnostics.push({ severity: 'warning', code: 'SMALL_PIVOT', message: `Small scaled pivot (${solved.minScaledPivot.toExponential(2)}); fields may be sensitive to parameter or floating-point perturbations. This is a diagnostic, not a condition-number estimate.` });
  const budget = emptyBudget();
  budget.emittedW = circuit.components.reduce((sum, component) => sum + (component.model === 'source' ? component.params.powerW : 0), 0);
  const detectorEntries: Array<[string, { powerW: number; phaseRad: number | null }]> = [];
  const ports = circuit.components.flatMap(component => {
    const offset = offsets.get(component.id)!;
    const names = portNames(component.model);
    const absorbed = names.reduce((sum, _, port) => sum + power(incoming[offset + port]), 0);
    if (component.model === 'source') budget.returnedToSourceW += absorbed;
    if (component.model === 'detector') {
      budget.detectedW += absorbed;
      // Phase of a numerically dark field is unresolved. This display threshold
      // (1e-12 of launched amplitude) never clamps the solved field or power.
      detectorEntries.push([component.id, { powerW: absorbed, phaseRad: absorbed <= budget.emittedW * 1e-24 ? null : Math.atan2(incoming[offset].im, incoming[offset].re) }]);
    }
    if (component.model === 'termination') budget.componentAbsorbedW += absorbed;
    if (component.model === 'attenuator') budget.componentAbsorbedW += -Math.expm1(-component.params.attenuationDb * Math.LN10 / 10) * absorbed;
    if (component.model === 'siepic-coupler') {
      const exchange = absorbed - names.reduce((sum, _, port) => sum + power(outgoing[offset + port]), 0);
      if (exchange >= 0) budget.componentAbsorbedW += exchange;
      else {
        budget.modelSuppliedW -= exchange;
        diagnostics.push({ severity: 'warning', code: 'MODEL_SUPPLIED_POWER', componentId: component.id, message: `Dataset supplies ${(-exchange).toExponential(3)} W for this excitation; the original apparent gain has not been clipped.` });
      }
    }
    return names.map((_, port) => ({ componentId: component.id, port, incoming: incoming[offset + port], outgoing: outgoing[offset + port] }));
  });
  for (let i = 0; i < n; i++) if (!neighbors[i]) budget.escapedW += power(outgoing[i]);
  for (const line of circuit.connections) {
    const from = indices.get(endpointKey(line.from))!;
    const to = indices.get(endpointKey(line.to))!;
    const lostFraction = -Math.expm1(-line.lossDbPerM * line.lengthM * Math.LN10 / 10);
    budget.propagationLossW += lostFraction * (power(outgoing[from]) + power(outgoing[to]));
  }
  budget.imbalanceW = budget.emittedW + budget.modelSuppliedW - budget.detectedW - budget.escapedW - budget.componentAbsorbedW - budget.returnedToSourceW - budget.propagationLossW;
  if (!Object.values(budget).every(Number.isFinite) || [...incoming, ...outgoing].some(value => !finite(value) || !Number.isFinite(power(value)))) return failure([...diagnostics, { severity: 'error', code: 'POWER_OVERFLOW', message: 'Field power exceeded the finite numerical range; no power result is reported.' }], residual);
  if (Math.abs(budget.imbalanceW) > Math.max(Number.MIN_VALUE, budget.emittedW * 1e-9)) diagnostics.push({ severity: 'warning', code: 'POWER_IMBALANCE', message: 'The power budget fails the relative 1e−9 accounting tolerance; interpret this result cautiously.' });
  return { ok: true, ports, detectors: Object.fromEntries(detectorEntries), budget, residual, diagnostics };
}
