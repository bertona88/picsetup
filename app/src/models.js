import { C, add, div, expi, mul, scale, zeroMatrix, zeros, abs2 } from './complex.js';

export const DEFAULT_WAVELENGTH_NM = 1550;

const p = (key, label, unit, min, max, step, value, extra = {}) => ({
  key, label, unit, min, max, step, default: value, sweepable: true, ...extra
});
const f = (key, label, type, value, extra = {}) => ({ key, label, type, default: value, ...extra });

const twoPorts = Object.freeze([
  { id: 'left', x: -48, y: 0, role: 'optical', label: 'L' },
  { id: 'right', x: 48, y: 0, role: 'optical', label: 'R' }
]);
const fourBusPorts = Object.freeze([
  { id: 'lt', x: -50, y: -16, role: 'optical', label: 'L₁' },
  { id: 'lb', x: -50, y: 16, role: 'optical', label: 'L₂' },
  { id: 'rt', x: 50, y: -16, role: 'optical', label: 'R₁' },
  { id: 'rb', x: 50, y: 16, role: 'optical', label: 'R₂' }
]);

export function couplingCoefficient(gapUm, wavelengthNm = DEFAULT_WAVELENGTH_NM) {
  const kappaReference = Math.PI / 80;
  const gapFactor = Math.exp(-(gapUm - 0.2) / 0.14);
  const wavelengthFactor = Math.pow(DEFAULT_WAVELENGTH_NM / Math.max(1, wavelengthNm), 0.55);
  return kappaReference * gapFactor * wavelengthFactor;
}

export function couplerCoefficients(params, wavelengthNm = DEFAULT_WAVELENGTH_NM) {
  const gapUm = Math.max(0.04, Number(params?.gapUm ?? 0.2));
  const interactionLengthUm = Math.max(0, Number(params?.interactionLengthUm ?? 20));
  const kappa = couplingCoefficient(gapUm, wavelengthNm);
  const theta = kappa * interactionLengthUm;
  const amp = Math.pow(10, -Math.max(0, Number(params?.insertionLossDb ?? 0)) / 20);
  return {
    gapUm, interactionLengthUm, kappa, theta,
    t: amp * Math.cos(theta),
    k: amp * Math.sin(theta),
    amplitudeTransmission: amp,
    throughPower: amp * amp * Math.cos(theta) ** 2,
    crossPower: amp * amp * Math.sin(theta) ** 2
  };
}

function passiveModel(ports) {
  return { ports, scattering: zeroMatrix(ports.length), s: zeros(ports.length) };
}

function reciprocalTwoPort(component, environment, { phaseRad = 0, lossDb = 0, lengthUm = 0, neff = 2.42 } = {}) {
  const model = passiveModel(twoPorts);
  const wavelengthUm = Math.max(1e-9, environment.wavelengthNm / 1000);
  const propagation = -2 * Math.PI * neff * Math.max(0, lengthUm) / wavelengthUm;
  const amplitude = Math.pow(10, -Math.max(0, lossDb) / 20);
  const transfer = scale(expi(phaseRad + propagation), amplitude);
  model.scattering[0][1] = transfer;
  model.scattering[1][0] = transfer;
  return model;
}

function pairTransferModel(ports, t, k) {
  const model = passiveModel(ports);
  model.scattering[0][2] = t;
  model.scattering[0][3] = k;
  model.scattering[1][2] = k;
  model.scattering[1][3] = t;
  model.scattering[2][0] = t;
  model.scattering[2][1] = k;
  model.scattering[3][0] = k;
  model.scattering[3][1] = t;
  return model;
}

function interpolateComplexS(params, wavelengthNm, portCount) {
  const fallback = zeroMatrix(portCount);
  if (portCount === 2) {
    fallback[0][1] = C(1, 0);
    fallback[1][0] = C(1, 0);
  }
  const wavelengths = Array.isArray(params?.sParameters?.wavelengthsNm) ? params.sParameters.wavelengthsNm.map(Number) : [];
  const matrices = Array.isArray(params?.sParameters?.matrices) ? params.sParameters.matrices : [];
  if (!wavelengths.length || matrices.length !== wavelengths.length) return fallback;
  const asComplex = value => Array.isArray(value) ? C(Number(value[0] ?? 0), Number(value[1] ?? 0)) : C(Number(value?.re ?? value ?? 0), Number(value?.im ?? 0));
  const normalize = matrix => Array.from({ length: portCount }, (_, row) => Array.from({ length: portCount }, (_, col) => asComplex(matrix?.[row]?.[col])));
  if (wavelengthNm <= wavelengths[0]) return normalize(matrices[0]);
  if (wavelengthNm >= wavelengths.at(-1)) return normalize(matrices.at(-1));
  let hi = wavelengths.findIndex(value => value >= wavelengthNm);
  if (hi <= 0) hi = 1;
  const lo = hi - 1;
  const f = (wavelengthNm - wavelengths[lo]) / Math.max(1e-12, wavelengths[hi] - wavelengths[lo]);
  const a = normalize(matrices[lo]);
  const b = normalize(matrices[hi]);
  return a.map((row, i) => row.map((z, j) => C(z.re + (b[i][j].re - z.re) * f, z.im + (b[i][j].im - z.im) * f)));
}

const registry = new Map();
function register(definition) {
  registry.set(definition.type, Object.freeze(definition));
  return definition;
}

register({
  type: 'source', category: 'Sources', label: 'Laser', shortLabel: 'Laser', glyph: '✦', prefix: 'src',
  description: 'Coherent scalar source with CW or transform-limited Gaussian pulse settings.',
  ports: [{ id: 'out', x: 42, y: 0, role: 'optical', label: 'OUT' }],
  bounds: { x: -42, y: -42, width: 84, height: 84, rx: 18 },
  parameters: [
    p('powerMw', 'Power', 'mW', 0, 10, 0.01, 1, { tolerance: 0.01 }),
    p('wavelengthNm', 'Wavelength λ', 'nm', 1200, 1700, 1, DEFAULT_WAVELENGTH_NM, { target: 'global', tolerance: 0.1 }),
    p('phaseRad', 'Initial phase', 'rad', -Math.PI, Math.PI, 0.005, 0, { tolerance: 0.005 }),
    p('repetitionRateMHz', 'Repetition rate', 'MHz', 1, 2000, 1, 80, { scope: 'pulse', tolerance: 0.1 }),
    p('pulseDurationPs', 'Intensity FWHM', 'ps', 0.2, 500, 0.1, 12, { scope: 'pulse', tolerance: 0.05 })
  ],
  defaults: { sourceMode: 'cw', cwVisualization: 'solid', spectralSamples: 192 },
  assumptions: ['single coherent scalar mode', 'transform-limited Gaussian pulse when pulsed'],
  provenance: 'Analytical source boundary condition',
  model(component) {
    const ports = getDefinition('source').ports;
    const model = passiveModel(ports);
    const power = Math.max(0, Number(component.params?.powerMw ?? 0));
    model.s[0] = scale(expi(Number(component.params?.phaseRad ?? 0)), Math.sqrt(power));
    return model;
  }
});

register({
  type: 'detector', category: 'Detectors', label: 'Photodetector', shortLabel: 'Detector', glyph: '◖', prefix: 'det',
  description: 'Matched optical termination with optical-power and photocurrent readout.',
  ports: [
    { id: 'in', x: -42, y: 0, role: 'optical', medium: 'guided', label: 'OPT' },
    { id: 'elec', x: 42, y: 0, role: 'electrical', medium: 'wire', label: 'I' }
  ],
  bounds: { x: -42, y: -42, width: 84, height: 84, rx: 18 },
  parameters: [
    p('responsivity', 'Responsivity', 'A/W', 0.05, 2, 0.01, 1, { tolerance: 0.02 }),
    p('bandwidthGhz', 'Electrical bandwidth', 'GHz', 0.1, 200, 0.1, 20, { scope: 'pulse', tolerance: 0.05 }),
    p('darkCurrentNa', 'Dark current', 'nA', 0, 10000, 1, 0, { scope: 'electrical', tolerance: 0.1 })
  ],
  assumptions: ['matched optical termination', 'linear square-law readout'],
  provenance: 'Analytical matched detector',
  detector: true,
  model() { return passiveModel(getDefinition('detector').ports); }
});

register({
  type: 'probe', category: 'Detectors', label: 'Optical probe', shortLabel: 'Probe', glyph: '⊙', prefix: 'probe',
  description: 'Transparent two-port monitor for complex field, power, and phase.',
  ports: twoPorts, bounds: { x: -40, y: -32, width: 80, height: 64, rx: 15 },
  parameters: [p('tapLossDb', 'Tap loss', 'dB', 0, 1, 0.005, 0)],
  assumptions: ['ideal non-perturbing monitor at zero tap loss'], provenance: 'Analytical transparent monitor', probe: true,
  model(component, env) { return reciprocalTwoPort(component, env, { lossDb: Number(component.params?.tapLossDb ?? 0) }); }
});

register({
  type: 'termination', category: 'Detectors', label: 'Termination', shortLabel: 'Termination', glyph: '⊣', prefix: 'term',
  description: 'Matched port termination used to close unused paths.',
  ports: [{ id: 'in', x: -40, y: 0, role: 'optical', label: 'IN' }],
  bounds: { x: -40, y: -32, width: 80, height: 64, rx: 15 }, parameters: [],
  assumptions: ['perfectly matched', 'all incident power absorbed'], provenance: 'Ideal boundary condition', termination: true,
  model() { return passiveModel(getDefinition('termination').ports); }
});

register({
  type: 'phase', category: 'Tuning', label: 'Phase shifter', shortLabel: 'Phase', glyph: 'φ', prefix: 'phase',
  description: 'Reciprocal phase shifter with physical propagation length, loss, and an explicit electrical heater/control terminal.',
  ports: [...twoPorts, { id: 'heater', x: 0, y: -39, role: 'electrical', medium: 'wire', label: 'HEAT' }], bounds: { x: -48, y: -39, width: 96, height: 78, rx: 17 },
  parameters: [
    p('phaseRad', 'Controlled phase φ', 'rad', -Math.PI, Math.PI, 0.005, 0, { tolerance: 0.01 }),
    p('lossDb', 'Insertion loss', 'dB', 0, 5, 0.01, 0.03, { tolerance: 0.02 }),
    p('lengthUm', 'Physical length', 'µm', 0, 2000, 1, 20, { tolerance: 0.01 }),
    p('neff', 'Effective index', '', 1, 4.5, 0.001, 2.42, { tolerance: 0.002 })
  ],
  assumptions: ['reciprocal', 'single-mode', 'uniform effective index'], provenance: 'Analytical two-port transfer',
  model(component, env) {
    const q = component.params ?? {};
    return reciprocalTwoPort(component, env, { phaseRad: Number(q.phaseRad ?? 0), lossDb: Number(q.lossDb ?? 0), lengthUm: Number(q.lengthUm ?? 0), neff: Number(q.neff ?? 2.42) });
  }
});

register({
  type: 'modulator', category: 'Tuning', label: 'EO modulator', shortLabel: 'Modulator', glyph: 'Vπ', prefix: 'mod',
  description: 'Compact phase modulator driven by V/Vπ with optical loss, physical delay, and an explicit RF terminal.',
  ports: [...twoPorts, { id: 'rf', x: 0, y: -39, role: 'rf', medium: 'rf', label: 'RF' }], bounds: { x: -50, y: -39, width: 100, height: 78, rx: 17 },
  parameters: [
    p('voltageV', 'Drive voltage', 'V', -10, 10, 0.01, 0, { tolerance: 0.01 }),
    p('vpiV', 'Vπ', 'V', 0.1, 20, 0.01, 4, { tolerance: 0.03 }),
    p('biasRad', 'Bias phase', 'rad', -Math.PI, Math.PI, 0.005, 0),
    p('lossDb', 'Insertion loss', 'dB', 0, 10, 0.01, 1),
    p('lengthUm', 'Active length', 'µm', 1, 10000, 1, 1000),
    p('neff', 'Effective index', '', 1, 4.5, 0.001, 2.42),
    p('bandwidthGhz', 'Electrical bandwidth', 'GHz', 0.1, 200, 0.1, 40, { scope: 'electrical' })
  ],
  assumptions: ['linear V/Vπ phase law', 'small-signal electrical bandwidth is metadata for temporal drive'], provenance: 'Analytical compact EO model',
  model(component, env) {
    const q = component.params ?? {};
    const phase = Number(q.biasRad ?? 0) + Math.PI * Number(q.voltageV ?? 0) / Math.max(1e-9, Number(q.vpiV ?? 4));
    return reciprocalTwoPort(component, env, { phaseRad: phase, lossDb: Number(q.lossDb ?? 0), lengthUm: Number(q.lengthUm ?? 0), neff: Number(q.neff ?? 2.42) });
  }
});

register({
  type: 'attenuator', category: 'Tuning', label: 'Attenuator', shortLabel: 'Attenuator', glyph: '−dB', prefix: 'att',
  description: 'Reciprocal variable optical attenuator.', ports: twoPorts,
  bounds: { x: -46, y: -34, width: 92, height: 68, rx: 16 },
  parameters: [p('lossDb', 'Attenuation', 'dB', 0, 60, 0.05, 3, { tolerance: 0.02 }), p('lengthUm', 'Physical length', 'µm', 0, 1000, 1, 10), p('neff', 'Effective index', '', 1, 4.5, 0.001, 2.42)],
  assumptions: ['reciprocal', 'flat loss across the local sweep'], provenance: 'Analytical two-port transfer',
  model(component, env) { const q = component.params ?? {}; return reciprocalTwoPort(component, env, { lossDb: Number(q.lossDb ?? 0), lengthUm: Number(q.lengthUm ?? 0), neff: Number(q.neff ?? 2.42) }); }
});

register({
  type: 'coupler', category: 'Coupling', label: 'Directional coupler', shortLabel: 'Coupler', glyph: '≈', prefix: 'dc',
  description: 'Four-port reciprocal directional coupler driven by gap, interaction length, and wavelength.',
  ports: fourBusPorts, bounds: { x: -56, y: -42, width: 112, height: 84, rx: 19 },
  parameters: [
    p('gapUm', 'Gap g', 'µm', 0.05, 1.2, 0.005, 0.2, { tolerance: 0.02 }),
    p('interactionLengthUm', 'Interaction length Lc', 'µm', 0, 200, 0.25, 20, { tolerance: 0.01 }),
    p('insertionLossDb', 'Insertion loss', 'dB', 0, 5, 0.01, 0.04, { tolerance: 0.02 })
  ],
  assumptions: ['uniform weak coupling', 'reflectionless', 'single scalar mode per port'], provenance: 'Calibrated coupled-mode approximation', deepView: 'coupler',
  model(component, env) {
    const coeff = couplerCoefficients(component.params, env.wavelengthNm);
    return pairTransferModel(fourBusPorts, C(coeff.t, 0), C(0, coeff.k));
  }
});

register({
  type: 'mmi', category: 'Coupling', label: '2×2 MMI', shortLabel: 'MMI', glyph: '⋈', prefix: 'mmi',
  description: 'Compact reciprocal 2×2 multimode-interference coupler with specified cross ratio.',
  ports: fourBusPorts, bounds: { x: -56, y: -42, width: 112, height: 84, rx: 14 },
  parameters: [p('crossPower', 'Cross power', '%', 0, 100, 0.1, 50, { tolerance: 0.01 }), p('insertionLossDb', 'Insertion loss', 'dB', 0, 5, 0.01, 0.2), p('phaseErrorRad', 'Quadrature error', 'rad', -0.5, 0.5, 0.001, 0)],
  assumptions: ['compact 2×2 transfer', 'no back-reflection'], provenance: 'Analytical compact MMI model',
  model(component) {
    const q = component.params ?? {};
    const ratio = Math.max(0, Math.min(1, Number(q.crossPower ?? 50) / 100));
    const amp = Math.pow(10, -Math.max(0, Number(q.insertionLossDb ?? 0)) / 20);
    const t = C(amp * Math.sqrt(1 - ratio), 0);
    const k = scale(expi(Math.PI / 2 + Number(q.phaseErrorRad ?? 0)), amp * Math.sqrt(ratio));
    return pairTransferModel(fourBusPorts, t, k);
  }
});

register({
  type: 'splitter', category: 'Coupling', label: 'Y splitter', shortLabel: 'Y splitter', glyph: 'Y', prefix: 'ys',
  description: 'Three-port splitter/combiner with configurable power ratio.',
  ports: [
    { id: 'in', x: -48, y: 0, role: 'optical', label: 'IN' },
    { id: 'top', x: 48, y: -18, role: 'optical', label: 'O₁' },
    { id: 'bottom', x: 48, y: 18, role: 'optical', label: 'O₂' }
  ],
  bounds: { x: -52, y: -42, width: 104, height: 84, rx: 18 },
  parameters: [p('topPower', 'Top-arm power', '%', 0, 100, 0.1, 50, { tolerance: 0.01 }), p('excessLossDb', 'Excess loss', 'dB', 0, 5, 0.01, 0.15)],
  assumptions: ['ideal compact split/combination', 'simultaneous reverse inputs may dissipate the antisymmetric mode'], provenance: 'Analytical compact splitter',
  model(component) {
    const ports = getDefinition('splitter').ports;
    const model = passiveModel(ports);
    const ratio = Math.max(0, Math.min(1, Number(component.params?.topPower ?? 50) / 100));
    const amp = Math.pow(10, -Math.max(0, Number(component.params?.excessLossDb ?? 0)) / 20);
    const t1 = C(amp * Math.sqrt(ratio), 0);
    const t2 = C(amp * Math.sqrt(1 - ratio), 0);
    model.scattering[0][1] = t1; model.scattering[1][0] = t1;
    model.scattering[0][2] = t2; model.scattering[2][0] = t2;
    return model;
  }
});

register({
  type: 'ring', category: 'Resonant', label: 'Add-drop ring', shortLabel: 'Ring', glyph: '○', prefix: 'ring',
  description: 'Four-port add-drop ring resonator with wavelength-dependent complex response.',
  ports: fourBusPorts, bounds: { x: -58, y: -48, width: 116, height: 96, rx: 20 },
  parameters: [
    p('radiusUm', 'Ring radius', 'µm', 2, 200, 0.1, 10, { tolerance: 0.01 }),
    p('couplingPower', 'Coupling per coupler', '%', 0.1, 99, 0.1, 12, { tolerance: 0.02 }),
    p('roundTripLossDb', 'Round-trip loss', 'dB', 0, 20, 0.01, 0.3, { tolerance: 0.03 }),
    p('neff', 'Effective index', '', 1, 4.5, 0.001, 2.42, { tolerance: 0.002 })
  ],
  assumptions: ['single ring mode', 'identical lossless bus couplers apart from declared loss', 'no back-scattering doublet'], provenance: 'Analytical add-drop resonator',
  model(component, env) {
    const q = component.params ?? {};
    const kPower = Math.max(1e-6, Math.min(0.999999, Number(q.couplingPower ?? 12) / 100));
    const t = Math.sqrt(1 - kPower);
    const a = Math.pow(10, -Math.max(0, Number(q.roundTripLossDb ?? 0)) / 20);
    const circumference = 2 * Math.PI * Math.max(0.01, Number(q.radiusUm ?? 10));
    const phase = -2 * Math.PI * Number(q.neff ?? 2.42) * circumference / Math.max(1e-9, env.wavelengthNm / 1000);
    const e = expi(phase);
    const denominator = add(C(1, 0), scale(e, -a * t * t));
    const through = div(add(C(t, 0), scale(e, -a * t)), denominator);
    const drop = div(scale(expi(phase / 2 - Math.PI / 2), Math.sqrt(a) * kPower), denominator);
    const total = abs2(through) + abs2(drop);
    const normalization = total > 1 ? 1 / Math.sqrt(total) : 1;
    return pairTransferModel(fourBusPorts, scale(through, normalization), scale(drop, normalization));
  }
});

register({
  type: 'bragg', category: 'Resonant', label: 'Bragg filter', shortLabel: 'Bragg', glyph: '≋', prefix: 'bragg',
  description: 'Reflective Gaussian-notch compact filter.', ports: twoPorts,
  bounds: { x: -50, y: -36, width: 100, height: 72, rx: 15 },
  parameters: [p('centerNm', 'Bragg wavelength', 'nm', 1200, 1700, 0.1, 1550, { tolerance: 0.02 }), p('bandwidthNm', 'Reflection FWHM', 'nm', 0.05, 100, 0.05, 5), p('peakReflectivity', 'Peak reflectivity', '%', 0, 100, 0.1, 90), p('insertionLossDb', 'Insertion loss', 'dB', 0, 10, 0.01, 0.2)],
  assumptions: ['Gaussian spectral envelope', 'lumped symmetric reflector'], provenance: 'Analytical compact spectral filter',
  model(component, env) {
    const q = component.params ?? {};
    const x = (env.wavelengthNm - Number(q.centerNm ?? 1550)) / Math.max(1e-9, Number(q.bandwidthNm ?? 5));
    const reflection = Math.max(0, Math.min(1, Number(q.peakReflectivity ?? 90) / 100 * Math.exp(-4 * Math.log(2) * x * x)));
    const amp = Math.pow(10, -Math.max(0, Number(q.insertionLossDb ?? 0)) / 20);
    const model = passiveModel(twoPorts);
    const r = C(0, amp * Math.sqrt(reflection));
    const t = C(amp * Math.sqrt(1 - reflection), 0);
    model.scattering[0][0] = r; model.scattering[1][1] = r;
    model.scattering[0][1] = t; model.scattering[1][0] = t;
    return model;
  }
});

register({
  type: 'crossing', category: 'Routing', label: 'Waveguide crossing', shortLabel: 'Crossing', glyph: '×', prefix: 'x',
  description: 'Four-port crossing with insertion loss and declared crosstalk.',
  ports: [
    { id: 'left', x: -46, y: 0, role: 'optical', label: 'L' },
    { id: 'right', x: 46, y: 0, role: 'optical', label: 'R' },
    { id: 'top', x: 0, y: -46, role: 'optical', label: 'T' },
    { id: 'bottom', x: 0, y: 46, role: 'optical', label: 'B' }
  ],
  bounds: { x: -48, y: -48, width: 96, height: 96, rx: 18 },
  parameters: [p('insertionLossDb', 'Insertion loss', 'dB', 0, 10, 0.01, 0.1), p('crosstalkDb', 'Crosstalk', 'dB', -80, -3, 0.1, -35)],
  assumptions: ['symmetric crossing', 'equal crosstalk into the two orthogonal directions'], provenance: 'Analytical compact crossing',
  model(component) {
    const ports = getDefinition('crossing').ports;
    const model = passiveModel(ports);
    const amp = Math.pow(10, -Math.max(0, Number(component.params?.insertionLossDb ?? 0)) / 20);
    const xPower = Math.max(0, Math.min(0.5, Math.pow(10, Number(component.params?.crosstalkDb ?? -35) / 10)));
    const main = C(amp * Math.sqrt(Math.max(0, 1 - 2 * xPower)), 0);
    const cross = C(0, amp * Math.sqrt(xPower));
    model.scattering[0][1] = main; model.scattering[1][0] = main;
    model.scattering[2][3] = main; model.scattering[3][2] = main;
    for (const [i, j] of [[0,2],[0,3],[1,2],[1,3]]) { model.scattering[i][j] = cross; model.scattering[j][i] = cross; }
    return model;
  }
});

register({
  type: 'grating', category: 'I/O', label: 'Grating coupler', shortLabel: 'Grating', glyph: '⌁', prefix: 'gc',
  description: 'Two-port compact wavelength-selective I/O coupler.', ports: twoPorts,
  bounds: { x: -48, y: -38, width: 96, height: 76, rx: 18 },
  parameters: [p('centerNm', 'Center wavelength', 'nm', 1200, 1700, 0.1, 1550), p('bandwidthNm', 'Power FWHM', 'nm', 1, 200, 0.1, 40), p('peakEfficiency', 'Peak efficiency', '%', 0, 100, 0.1, 60), p('backReflectionDb', 'Back-reflection', 'dB', -80, -3, 0.1, -30)],
  assumptions: ['Gaussian coupling spectrum', 'single effective free-space/fiber channel'], provenance: 'Analytical compact grating response',
  model(component, env) {
    const q = component.params ?? {};
    const x = (env.wavelengthNm - Number(q.centerNm ?? 1550)) / Math.max(1e-9, Number(q.bandwidthNm ?? 40));
    const efficiency = Math.max(0, Math.min(1, Number(q.peakEfficiency ?? 60) / 100 * Math.exp(-4 * Math.log(2) * x * x)));
    const reflection = Math.max(0, Math.min(1 - efficiency, Math.pow(10, Number(q.backReflectionDb ?? -30) / 10)));
    const model = passiveModel(twoPorts);
    const t = C(Math.sqrt(efficiency), 0);
    const r = C(0, Math.sqrt(reflection));
    model.scattering[0][1] = t; model.scattering[1][0] = t;
    model.scattering[0][0] = r; model.scattering[1][1] = r;
    return model;
  }
});


register({
  type: 'edge-coupler', category: 'I/O & Bridges', label: 'Edge coupler', shortLabel: 'Edge coupler', glyph: '▷', prefix: 'ec',
  description: 'Reciprocal chip-edge or butt-coupling interface between a guided PIC mode and a fiber-side optical mode.',
  ports: [
    { id: 'external', x: -52, y: 0, role: 'optical', medium: 'fiber', label: 'FIBER' },
    { id: 'pic', x: 52, y: 0, role: 'optical', medium: 'guided', label: 'PIC' }
  ],
  bounds: { x: -52, y: -38, width: 104, height: 76, rx: 16 },
  parameters: [
    p('peakEfficiency', 'Coupling efficiency', '%', 0, 100, 0.1, 72, { tolerance: 0.02 }),
    p('backReflectionDb', 'Back-reflection', 'dB', -80, -3, 0.1, -35),
    p('alignmentLossDb', 'Alignment loss', 'dB', 0, 20, 0.01, 0.3)
  ],
  fields: [
    f('facetKind', 'Interface', 'select', 'fiber-array', { options: [['fiber-array', 'Fiber array / lensed fiber'], ['free-space', 'Free-space objective'], ['butt-coupled', 'Butt-coupled facet']] })
  ],
  assumptions: ['single effective fiber/free-space channel', 'lumped alignment loss', 'no transverse overlap solve'],
  provenance: 'Analytical reciprocal I/O boundary',
  model(component) {
    const ports = getDefinition('edge-coupler').ports;
    const model = passiveModel(ports);
    const q = component.params ?? {};
    const efficiency = Math.max(0, Math.min(1, Number(q.peakEfficiency ?? 72) / 100 * Math.pow(10, -Math.max(0, Number(q.alignmentLossDb ?? 0.3)) / 10)));
    const reflection = Math.max(0, Math.min(1 - efficiency, Math.pow(10, Number(q.backReflectionDb ?? -35) / 10)));
    const transfer = C(Math.sqrt(efficiency), 0);
    const reflect = C(0, Math.sqrt(reflection));
    model.scattering[0][1] = transfer; model.scattering[1][0] = transfer;
    model.scattering[0][0] = reflect; model.scattering[1][1] = reflect;
    return model;
  }
});

register({
  type: 'optical-bridge', category: 'I/O & Bridges', label: 'OpticalSetup port', shortLabel: 'OpticalSetup', glyph: '↗', prefix: 'os',
  description: 'Versioned free-space/fiber handoff boundary for opening this optical interface in OpticalSetup.',
  ports: [{ id: 'pic', x: 52, y: 0, role: 'optical', medium: 'guided', label: 'PIC' }],
  bounds: { x: -58, y: -44, width: 116, height: 88, rx: 20 },
  parameters: [
    p('powerMw', 'Declared input power', 'mW', 0, 1000, 0.01, 1, { tolerance: 0.02 }),
    p('couplingEfficiency', 'Coupling efficiency', '', 0, 1, 0.001, 0.7, { tolerance: 0.02 }),
    p('phaseRad', 'Boundary phase', 'rad', -Math.PI, Math.PI, 0.005, 0),
    p('repetitionRateMHz', 'Repetition rate', 'MHz', 0.001, 100000, 1, 80, { scope: 'pulse' }),
    p('pulseDurationPs', 'Pulse duration', 'ps', 0.05, 10000, 0.1, 12, { scope: 'pulse' })
  ],
  defaults: {
    direction: 'output', interfaceKind: 'free-space', polarization: 'TE', guidedMode: 'TE0', sourceMode: 'cw',
    bridgeId: '', targetUrl: 'https://opticalsetup.com/sketch/'
  },
  fields: [
    f('direction', 'Bridge direction', 'select', 'output', { options: [['input', 'OpticalSetup → PicSetup'], ['output', 'PicSetup → OpticalSetup'], ['bidirectional', 'Bidirectional boundary']] }),
    f('interfaceKind', 'Physical interface', 'select', 'free-space', { options: [['free-space', 'Free-space beam'], ['fiber', 'Fiber mode'], ['edge', 'Chip edge'], ['grating', 'Vertical grating']] }),
    f('polarization', 'Polarization', 'select', 'TE', { options: [['TE', 'TE'], ['TM', 'TM'], ['linear', 'Linear'], ['circular', 'Circular'], ['elliptical', 'Elliptical'], ['unpolarized', 'Unpolarized / mixed']] }),
    f('guidedMode', 'Guided mode', 'text', 'TE0', { placeholder: 'TE0' }),
    f('sourceMode', 'Temporal mode', 'select', 'cw', { options: [['cw', 'Continuous wave'], ['pulsed', 'Pulsed']] }),
    f('bridgeId', 'Bridge ID', 'text', '', { placeholder: 'auto from component ID' }),
    f('targetUrl', 'OpticalSetup URL', 'url', 'https://opticalsetup.com/sketch/')
  ],
  assumptions: ['scalar guided mode at the PicSetup boundary', 'coupling efficiency is explicit', 'spatial beam profile is reconstructed downstream'],
  provenance: 'Setup Port Contract setup-port/1', bridge: true, sourceBoundary: true,
  model(component) {
    const ports = getDefinition('optical-bridge').ports;
    const model = passiveModel(ports);
    const q = component.params ?? {};
    if (q.direction === 'input' || q.direction === 'bidirectional') {
      const power = Math.max(0, Number(q.powerMw ?? 0)) * Math.max(0, Math.min(1, Number(q.couplingEfficiency ?? 0.7)));
      model.s[0] = scale(expi(Number(q.phaseRad ?? 0)), Math.sqrt(power));
    }
    return model;
  }
});

register({
  type: 'spiral', category: 'Routing', label: 'Spiral delay line', shortLabel: 'Spiral', glyph: '§', prefix: 'spiral',
  description: 'Compact two-port delay line with explicit optical length, loss, and effective index.',
  ports: twoPorts, bounds: { x: -54, y: -44, width: 108, height: 88, rx: 18 },
  parameters: [
    p('lengthUm', 'Optical length', 'µm', 10, 1000000, 10, 5000, { tolerance: 0.01 }),
    p('lossDbPerCm', 'Propagation loss', 'dB/cm', 0, 100, 0.01, 2, { tolerance: 0.05 }),
    p('neff', 'Effective index', '', 1, 4.5, 0.001, 2.42, { tolerance: 0.002 })
  ],
  assumptions: ['uniform single-mode delay', 'bend loss included only in declared aggregate loss'], provenance: 'Analytical reciprocal delay',
  model(component, env) {
    const q = component.params ?? {};
    const lossDb = Math.max(0, Number(q.lossDbPerCm ?? 2)) * Math.max(0, Number(q.lengthUm ?? 5000)) / 10000;
    return reciprocalTwoPort(component, env, { lossDb, lengthUm: Number(q.lengthUm ?? 5000), neff: Number(q.neff ?? 2.42) });
  }
});

const awgPorts = Object.freeze([
  { id: 'in', x: -58, y: 0, role: 'optical', medium: 'guided', label: 'IN' },
  { id: 'ch1', x: 58, y: -30, role: 'optical', medium: 'guided', label: 'λ₁' },
  { id: 'ch2', x: 58, y: -10, role: 'optical', medium: 'guided', label: 'λ₂' },
  { id: 'ch3', x: 58, y: 10, role: 'optical', medium: 'guided', label: 'λ₃' },
  { id: 'ch4', x: 58, y: 30, role: 'optical', medium: 'guided', label: 'λ₄' }
]);
register({
  type: 'awg', category: 'Filtering & Routing', label: 'Arrayed waveguide grating', shortLabel: 'AWG', glyph: '≋', prefix: 'awg',
  description: 'Four-channel wavelength router with Gaussian channel envelopes and explicit insertion loss.',
  ports: awgPorts, bounds: { x: -62, y: -52, width: 124, height: 104, rx: 18 },
  parameters: [
    p('centerNm', 'Center wavelength', 'nm', 400, 5000, 0.1, 1550, { tolerance: 0.01 }),
    p('channelSpacingNm', 'Channel spacing', 'nm', 0.1, 100, 0.1, 8),
    p('channelBandwidthNm', 'Channel FWHM', 'nm', 0.05, 100, 0.05, 4),
    p('insertionLossDb', 'Insertion loss', 'dB', 0, 20, 0.01, 2)
  ],
  assumptions: ['four Gaussian channels', 'no channel-to-channel reflection', 'single scalar mode'], provenance: 'Analytical compact wavelength router',
  model(component, env) {
    const q = component.params ?? {};
    const model = passiveModel(awgPorts);
    const center = Number(q.centerNm ?? 1550), spacing = Math.max(1e-9, Number(q.channelSpacingNm ?? 8));
    const bandwidth = Math.max(1e-9, Number(q.channelBandwidthNm ?? 4));
    const amp = Math.pow(10, -Math.max(0, Number(q.insertionLossDb ?? 2)) / 20);
    const weights = [0, 1, 2, 3].map(index => {
      const channelCenter = center + (index - 1.5) * spacing;
      const x = (env.wavelengthNm - channelCenter) / bandwidth;
      return Math.exp(-4 * Math.log(2) * x * x);
    });
    const total = Math.max(1, weights.reduce((sum, value) => sum + value, 0));
    weights.forEach((weight, index) => {
      const transfer = C(amp * Math.sqrt(weight / total), 0);
      model.scattering[0][index + 1] = transfer;
      model.scattering[index + 1][0] = transfer;
    });
    return model;
  }
});

register({
  type: 'heater', category: 'Tuning', label: 'Thermo-optic heater', shortLabel: 'Heater', glyph: '≈', prefix: 'heat',
  description: 'Two-port thermo-optic phase element with an explicit electrical control terminal.',
  ports: [...twoPorts, { id: 'drive', x: 0, y: 40, role: 'electrical', medium: 'wire', label: 'V' }],
  bounds: { x: -50, y: -42, width: 100, height: 84, rx: 17 },
  parameters: [
    p('voltageV', 'Heater voltage', 'V', -20, 20, 0.01, 0, { tolerance: 0.02 }),
    p('phasePerV', 'Phase efficiency', 'rad/V', -10, 10, 0.001, 0.5, { tolerance: 0.03 }),
    p('biasRad', 'Static phase', 'rad', -Math.PI, Math.PI, 0.005, 0),
    p('lossDb', 'Insertion loss', 'dB', 0, 10, 0.01, 0.1),
    p('lengthUm', 'Heated length', 'µm', 1, 10000, 1, 100),
    p('neff', 'Effective index', '', 1, 4.5, 0.001, 2.42)
  ],
  assumptions: ['static linear voltage-to-phase law', 'thermal dynamics are metadata only'], provenance: 'Analytical thermo-optic phase model',
  model(component, env) {
    const q = component.params ?? {};
    const phase = Number(q.biasRad ?? 0) + Number(q.voltageV ?? 0) * Number(q.phasePerV ?? 0.5);
    return reciprocalTwoPort(component, env, { phaseRad: phase, lossDb: Number(q.lossDb ?? 0.1), lengthUm: Number(q.lengthUm ?? 100), neff: Number(q.neff ?? 2.42) });
  }
});

const fiberArrayPorts = Object.freeze(Array.from({ length: 4 }, (_, index) => ([
  { id: `fiber${index + 1}`, x: -62, y: -30 + index * 20, role: 'optical', medium: 'fiber', label: `F${index + 1}` },
  { id: `pic${index + 1}`, x: 62, y: -30 + index * 20, role: 'optical', medium: 'guided', label: `P${index + 1}` }
])).flat());
register({
  type: 'fiber-array', category: 'I/O & Bridges', label: 'Fiber array', shortLabel: 'Fiber array', glyph: '▥', prefix: 'fa',
  description: 'Four-channel fiber-array representation for system and characterization figures.',
  ports: fiberArrayPorts, bounds: { x: -66, y: -54, width: 132, height: 108, rx: 18 },
  parameters: [p('insertionLossDb', 'Per-channel loss', 'dB', 0, 20, 0.01, 1)],
  assumptions: ['independent channels', 'identical per-channel loss', 'alignment geometry is diagrammatic'], provenance: 'Analytical parallel I/O channels',
  model(component) {
    const model = passiveModel(fiberArrayPorts);
    const transfer = C(Math.pow(10, -Math.max(0, Number(component.params?.insertionLossDb ?? 1)) / 20), 0);
    for (let channel = 0; channel < 4; channel += 1) {
      const a = channel * 2, b = a + 1;
      model.scattering[a][b] = transfer; model.scattering[b][a] = transfer;
    }
    return model;
  }
});

register({
  type: 'polarization-controller', category: 'External optics', label: 'Polarization controller', shortLabel: 'Pol. controller', glyph: '◒', prefix: 'pc',
  description: 'External polarization-controller symbol; scalar PicSetup propagation treats it as a reciprocal pass-through.',
  ports: [
    { id: 'in', x: -48, y: 0, role: 'optical', medium: 'fiber', label: 'IN' },
    { id: 'out', x: 48, y: 0, role: 'optical', medium: 'fiber', label: 'OUT' }
  ],
  bounds: { x: -50, y: -38, width: 100, height: 76, rx: 18 },
  parameters: [p('lossDb', 'Insertion loss', 'dB', 0, 10, 0.01, 0.2)],
  fields: [f('state', 'Displayed state', 'select', 'linear', { options: [['linear', 'Linear'], ['circular', 'Circular'], ['elliptical', 'Elliptical']] })],
  assumptions: ['polarization state is figure metadata in the scalar solver'], provenance: 'Diagram symbol with scalar insertion loss',
  model(component) {
    const ports = getDefinition('polarization-controller').ports;
    const model = passiveModel(ports);
    const transfer = C(Math.pow(10, -Math.max(0, Number(component.params?.lossDb ?? 0.2)) / 20), 0);
    model.scattering[0][1] = transfer; model.scattering[1][0] = transfer;
    return model;
  }
});

register({
  type: 'optical-instrument', category: 'External optics', label: 'Optical instrument', shortLabel: 'Instrument', glyph: '▣', prefix: 'oi',
  description: 'Publication symbol for a camera, spectrometer, power meter, polarimeter, or generic optical detector.',
  ports: [{ id: 'in', x: -52, y: 0, role: 'optical', medium: 'free-space', label: 'OPT' }],
  bounds: component => ({ x: -Math.max(92, Number(component.params?.width ?? 150)) / 2, y: -Math.max(64, Number(component.params?.height ?? 88)) / 2, width: Math.max(92, Number(component.params?.width ?? 150)), height: Math.max(64, Number(component.params?.height ?? 88)), rx: 16 }),
  parameters: [p('width', 'Figure width', 'px', 92, 420, 1, 150, { scope: 'visual', sweepable: false }), p('height', 'Figure height', 'px', 64, 260, 1, 88, { scope: 'visual', sweepable: false })],
  defaults: { instrumentKind: 'spectrometer', subtitle: 'measurement' },
  fields: [
    f('instrumentKind', 'Instrument', 'select', 'spectrometer', { options: [['camera', 'Camera'], ['photodetector', 'Photodetector'], ['pmt', 'PMT'], ['power-meter', 'Power meter'], ['wavefront', 'Wavefront sensor'], ['polarimeter', 'Polarimeter'], ['spectrometer', 'Spectrometer'], ['general', 'General detector']] }),
    f('subtitle', 'Subtitle', 'text', 'measurement')
  ],
  detector: true, diagramOnly: true, assumptions: ['instrument symbol is a matched optical boundary', 'readout capabilities are figure metadata'], provenance: 'Publication-only matched boundary',
  model() { return passiveModel(getDefinition('optical-instrument').ports); }
});

register({
  type: 'rf-source', category: 'Electrical & control', label: 'RF generator', shortLabel: 'RF generator', glyph: '∿', prefix: 'rf',
  description: 'Publication-only RF signal generator with a typed RF output port.',
  ports: [{ id: 'out', x: 52, y: 0, role: 'rf', medium: 'coax', label: 'RF' }],
  bounds: { x: -52, y: -38, width: 104, height: 76, rx: 16 },
  parameters: [p('frequencyGhz', 'Frequency', 'GHz', 0, 500, 0.01, 10, { scope: 'electrical' }), p('amplitudeV', 'Amplitude', 'V', 0, 20, 0.01, 1, { scope: 'electrical' })],
  diagramOnly: true, assumptions: ['not part of the optical network solve'], provenance: 'Typed publication symbol'
});

register({
  type: 'electrical-amplifier', category: 'Electrical & control', label: 'Electrical amplifier', shortLabel: 'Amplifier', glyph: '▷', prefix: 'amp',
  description: 'Publication-only electrical/RF amplifier block.',
  ports: [{ id: 'in', x: -52, y: 0, role: 'electrical', medium: 'wire', label: 'IN' }, { id: 'out', x: 52, y: 0, role: 'electrical', medium: 'wire', label: 'OUT' }],
  bounds: { x: -52, y: -38, width: 104, height: 76, rx: 16 },
  parameters: [p('gainDb', 'Displayed gain', 'dB', -40, 80, 0.1, 20, { scope: 'electrical' }), p('bandwidthGhz', 'Bandwidth', 'GHz', 0.001, 500, 0.01, 20, { scope: 'electrical' })],
  diagramOnly: true, assumptions: ['not part of the optical network solve'], provenance: 'Typed publication symbol'
});

register({
  type: 'oscilloscope', category: 'Electrical & control', label: 'Oscilloscope', shortLabel: 'Oscilloscope', glyph: '▱', prefix: 'scope',
  description: 'Publication-only oscilloscope with two typed electrical inputs.',
  ports: [{ id: 'ch1', x: -58, y: -14, role: 'electrical', medium: 'wire', label: 'CH1' }, { id: 'ch2', x: -58, y: 14, role: 'electrical', medium: 'wire', label: 'CH2' }],
  bounds: { x: -60, y: -46, width: 120, height: 92, rx: 18 },
  defaults: { subtitle: 'time trace' }, fields: [f('subtitle', 'Subtitle', 'text', 'time trace')],
  diagramOnly: true, assumptions: ['not part of the optical network solve'], provenance: 'Typed publication symbol'
});

register({
  type: 'controller', category: 'Electrical & control', label: 'Controller / computer', shortLabel: 'Controller', glyph: '⌘', prefix: 'ctrl',
  description: 'Publication-only controller with electrical input and control output.',
  ports: component => {
    const width = Math.max(110, Number(component.params?.width ?? 150));
    const height = Math.max(70, Number(component.params?.height ?? 90));
    return [
      { id: 'sense', x: -width / 2, y: 0, role: 'electrical', medium: 'wire', label: 'SENSE' },
      { id: 'drive', x: width / 2, y: 0, role: 'electrical', medium: 'wire', label: 'DRIVE' },
      { id: 'logic', x: 0, y: -height / 2, role: 'control', medium: 'logic', label: 'CTRL' }
    ];
  },
  bounds: component => ({ x: -Math.max(110, Number(component.params?.width ?? 150)) / 2, y: -Math.max(70, Number(component.params?.height ?? 90)) / 2, width: Math.max(110, Number(component.params?.width ?? 150)), height: Math.max(70, Number(component.params?.height ?? 90)), rx: 17 }),
  parameters: [p('width', 'Figure width', 'px', 110, 420, 1, 150, { scope: 'visual', sweepable: false }), p('height', 'Figure height', 'px', 70, 260, 1, 90, { scope: 'visual', sweepable: false })],
  defaults: { subtitle: 'calibration · feedback · DSP' }, fields: [f('subtitle', 'Subtitle', 'text', 'calibration · feedback · DSP')],
  diagramOnly: true, assumptions: ['control behavior is not simulated here'], provenance: 'Typed publication symbol'
});

register({
  type: 'system-block', category: 'Paper figure', label: 'System block', shortLabel: 'System block', glyph: '□', prefix: 'sys',
  description: 'General publication block with typed optical, electrical, RF, and control terminals.',
  ports: component => {
    const width = Math.max(110, Number(component.params?.width ?? 170)), height = Math.max(70, Number(component.params?.height ?? 100));
    return [
      { id: 'opt-in', x: -width / 2, y: -height * .22, role: 'optical', medium: 'fiber', label: 'OPT IN' },
      { id: 'opt-out', x: width / 2, y: -height * .22, role: 'optical', medium: 'fiber', label: 'OPT OUT' },
      { id: 'elec-in', x: -width / 2, y: height * .22, role: 'electrical', medium: 'wire', label: 'ELEC' },
      { id: 'control', x: width / 2, y: height * .22, role: 'control', medium: 'logic', label: 'CTRL' },
      { id: 'rf', x: 0, y: -height / 2, role: 'rf', medium: 'coax', label: 'RF' }
    ];
  },
  bounds: component => ({ x: -Math.max(110, Number(component.params?.width ?? 170)) / 2, y: -Math.max(70, Number(component.params?.height ?? 100)) / 2, width: Math.max(110, Number(component.params?.width ?? 170)), height: Math.max(70, Number(component.params?.height ?? 100)), rx: 18 }),
  parameters: [p('width', 'Figure width', 'px', 110, 500, 1, 170, { scope: 'visual', sweepable: false }), p('height', 'Figure height', 'px', 70, 320, 1, 100, { scope: 'visual', sweepable: false })],
  defaults: { subtitle: 'subsystem', blockKind: 'generic' }, fields: [f('subtitle', 'Subtitle', 'text', 'subsystem'), f('blockKind', 'Block style', 'select', 'generic', { options: [['generic', 'Generic'], ['laser', 'Laser subsystem'], ['receiver', 'Receiver'], ['driver', 'Driver'], ['processor', 'Processor'], ['sample', 'Sample / device under test']] })],
  diagramOnly: true, assumptions: ['figure-only block', 'optical terminals act as matched boundaries unless a compact model is substituted'], provenance: 'Publication composition element'
});

register({
  type: 'chip-frame', category: 'Paper figure', label: 'Chip boundary', shortLabel: 'Chip frame', glyph: '▭', prefix: 'chip',
  description: 'Resizable background boundary for grouping on-chip components in a publication figure.', ports: [],
  bounds: component => ({ x: -Math.max(180, Number(component.params?.width ?? 620)) / 2, y: -Math.max(120, Number(component.params?.height ?? 340)) / 2, width: Math.max(180, Number(component.params?.width ?? 620)), height: Math.max(120, Number(component.params?.height ?? 340)), rx: 24 }),
  parameters: [p('width', 'Frame width', 'px', 180, 1600, 5, 620, { scope: 'visual', sweepable: false }), p('height', 'Frame height', 'px', 120, 1000, 5, 340, { scope: 'visual', sweepable: false })],
  defaults: { subtitle: 'photonic integrated circuit', fillStyle: 'tint' },
  fields: [f('subtitle', 'Subtitle', 'text', 'photonic integrated circuit'), f('fillStyle', 'Fill', 'select', 'tint', { options: [['none', 'Outline only'], ['tint', 'Subtle tint'], ['solid', 'Solid panel']] })],
  diagramOnly: true, layer: 'background', assumptions: ['figure-only grouping boundary'], provenance: 'Publication composition element'
});

register({
  type: 'image-panel', category: 'Paper figure', label: 'Micrograph / image', shortLabel: 'Image panel', glyph: '▧', prefix: 'img',
  description: 'Resizable figure panel that can embed a microscope image, SEM, rendering, or other local image.', ports: [],
  bounds: component => ({ x: -Math.max(100, Number(component.params?.width ?? 240)) / 2, y: -Math.max(80, Number(component.params?.height ?? 170)) / 2, width: Math.max(100, Number(component.params?.width ?? 240)), height: Math.max(80, Number(component.params?.height ?? 170)), rx: 12 }),
  parameters: [p('width', 'Panel width', 'px', 100, 900, 1, 240, { scope: 'visual', sweepable: false }), p('height', 'Panel height', 'px', 80, 700, 1, 170, { scope: 'visual', sweepable: false })],
  defaults: { caption: 'Microscope / SEM image', imageDataUrl: '', imageFit: 'cover' },
  fields: [f('caption', 'Caption', 'text', 'Microscope / SEM image'), f('imageFit', 'Image fit', 'select', 'cover', { options: [['cover', 'Crop to fill'], ['contain', 'Fit entire image']] })],
  diagramOnly: true, imagePanel: true, assumptions: ['embedded image is illustrative data, not part of the simulation'], provenance: 'Publication composition element'
});

register({
  type: 'plot-panel', category: 'Paper figure', label: 'Plot panel', shortLabel: 'Plot panel', glyph: '⌁', prefix: 'plot',
  description: 'Resizable stylized plot placeholder for assembling a multi-panel paper figure.', ports: [],
  bounds: component => ({ x: -Math.max(120, Number(component.params?.width ?? 250)) / 2, y: -Math.max(90, Number(component.params?.height ?? 180)) / 2, width: Math.max(120, Number(component.params?.width ?? 250)), height: Math.max(90, Number(component.params?.height ?? 180)), rx: 12 }),
  parameters: [p('width', 'Panel width', 'px', 120, 900, 1, 250, { scope: 'visual', sweepable: false }), p('height', 'Panel height', 'px', 90, 700, 1, 180, { scope: 'visual', sweepable: false })],
  defaults: { xLabel: 'Wavelength (nm)', yLabel: 'Transmission', caption: 'Measured / simulated response', traceStyle: 'resonance' },
  fields: [f('caption', 'Caption', 'text', 'Measured / simulated response'), f('xLabel', 'X axis', 'text', 'Wavelength (nm)'), f('yLabel', 'Y axis', 'text', 'Transmission'), f('traceStyle', 'Trace', 'select', 'resonance', { options: [['resonance', 'Resonance'], ['spectrum', 'Spectrum'], ['time', 'Time trace'], ['bars', 'Bars']] })],
  diagramOnly: true, assumptions: ['placeholder graphic; export real data separately from PicSetup Lab'], provenance: 'Publication composition element'
});

register({
  type: 'annotation', category: 'Paper figure', label: 'Text annotation', shortLabel: 'Text', glyph: 'T', prefix: 'note',
  description: 'Free publication text for operating conditions, callouts, and explanatory notes.', ports: [],
  bounds: component => ({ x: -Math.max(80, Number(component.params?.width ?? 220)) / 2, y: -Math.max(36, Number(component.params?.height ?? 70)) / 2, width: Math.max(80, Number(component.params?.width ?? 220)), height: Math.max(36, Number(component.params?.height ?? 70)), rx: 8 }),
  parameters: [p('width', 'Text width', 'px', 80, 700, 1, 220, { scope: 'visual', sweepable: false }), p('height', 'Text height', 'px', 36, 400, 1, 70, { scope: 'visual', sweepable: false }), p('fontSize', 'Font size', 'px', 8, 48, 1, 15, { scope: 'visual', sweepable: false })],
  defaults: { text: 'λ = 1550 nm\nTE polarization', align: 'left' }, fields: [f('text', 'Text', 'textarea', 'λ = 1550 nm\nTE polarization'), f('align', 'Alignment', 'select', 'left', { options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] })],
  diagramOnly: true, assumptions: ['figure-only annotation'], provenance: 'Publication composition element'
});

register({
  type: 'panel-label', category: 'Paper figure', label: 'Panel label', shortLabel: 'Panel label', glyph: 'a', prefix: 'panel',
  description: 'Large panel letter for multi-panel figures.', ports: [], bounds: { x: -26, y: -26, width: 52, height: 52, rx: 10 },
  parameters: [p('fontSize', 'Font size', 'px', 14, 64, 1, 30, { scope: 'visual', sweepable: false })],
  defaults: { text: 'a' }, fields: [f('text', 'Panel letter', 'text', 'a')],
  diagramOnly: true, assumptions: ['figure-only annotation'], provenance: 'Publication composition element'
});

register({
  type: 'generic', category: 'Custom', label: 'S-parameter block', shortLabel: 'S block', glyph: 'S', prefix: 'sblock',
  description: 'User-supplied wavelength-indexed complex scattering matrix.',
  ports: component => {
    const custom = Array.isArray(component.params?.ports) ? component.params.ports : null;
    if (custom?.length) return custom.map((port, index) => ({ id: String(port.id ?? `p${index + 1}`), label: String(port.label ?? `P${index + 1}`), role: 'optical', x: Number(port.x ?? (index % 2 ? 48 : -48)), y: Number(port.y ?? (Math.floor(index / 2) * 24 - 12)) }));
    return twoPorts;
  },
  bounds: { x: -52, y: -42, width: 104, height: 84, rx: 15 },
  parameters: [], defaults: { modelName: 'Imported S matrix', provenance: 'User supplied', ports: twoPorts },
  assumptions: ['behavior is exactly the supplied interpolated table within its declared range'], provenance: 'User-supplied data', custom: true,
  model(component, env) {
    const ports = getPorts(component);
    return { ports, scattering: interpolateComplexS(component.params, env.wavelengthNm, ports.length), s: zeros(ports.length) };
  }
});

register({
  type: 'block', category: 'Custom', label: 'Hierarchical block', shortLabel: 'Block', glyph: '▣', prefix: 'block',
  description: 'Reusable subcircuit reduced to an external scattering model at solve time.',
  ports: component => Array.isArray(component.params?.ports) ? component.params.ports : twoPorts,
  bounds: { x: -62, y: -48, width: 124, height: 96, rx: 20 }, parameters: [],
  assumptions: ['external response is extracted from the stored passive subcircuit'], provenance: 'Live hierarchical reduction', hierarchy: true,
  model(component, env) {
    if (typeof env.extractBlockModel === 'function') return env.extractBlockModel(component, env.wavelengthNm);
    const ports = getPorts(component);
    return { ports, scattering: interpolateComplexS(component.params, env.wavelengthNm, ports.length), s: zeros(ports.length) };
  }
});

export function getDefinition(type) {
  return registry.get(type) ?? registry.get('generic');
}

export function listDefinitions({ includeCustom = true } = {}) {
  return [...registry.values()].filter(definition => includeCustom || !definition.custom);
}

export function getPorts(component) {
  const definition = getDefinition(component?.type);
  const ports = typeof definition.ports === 'function' ? definition.ports(component) : definition.ports;
  return (ports ?? []).map(port => ({ ...port }));
}

export function defaultParams(type) {
  const definition = getDefinition(type);
  const out = { ...(definition.defaults ?? {}) };
  for (const parameter of definition.parameters ?? []) out[parameter.key] = parameter.default;
  return out;
}

function alignModelPorts(model, declaredPorts) {
  const suppliedPorts = Array.isArray(model?.ports) ? model.ports : [];
  const suppliedIndex = new Map(suppliedPorts.map((port, index) => [port.id, index]));
  const aligned = passiveModel(declaredPorts);
  for (let row = 0; row < declaredPorts.length; row += 1) {
    const sourceRow = suppliedIndex.get(declaredPorts[row].id);
    if (sourceRow === undefined) continue;
    aligned.s[row] = model.s?.[sourceRow] ?? C();
    for (let col = 0; col < declaredPorts.length; col += 1) {
      const sourceCol = suppliedIndex.get(declaredPorts[col].id);
      if (sourceCol === undefined) continue;
      aligned.scattering[row][col] = model.scattering?.[sourceRow]?.[sourceCol] ?? C();
    }
  }
  return aligned;
}

export function buildModel(component, environment) {
  const definition = getDefinition(component.type);
  const merged = { ...component, params: { ...defaultParams(component.type), ...(component.params ?? {}) } };
  const declaredPorts = getPorts(merged);
  const raw = definition.model?.(merged, environment) ?? passiveModel(declaredPorts);
  const model = alignModelPorts(raw, declaredPorts);
  model.params = merged.params;
  model.definition = definition;
  return model;
}

export function parameterDefinition(type, key) {
  return getDefinition(type).parameters?.find(parameter => parameter.key === key) ?? null;
}

export function formatParameterValue(parameter, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const step = Number(parameter?.step ?? 0.001);
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  if (parameter?.unit === '%') return `${number.toFixed(digits)}%`;
  return `${number.toFixed(digits)}${parameter?.unit ? ` ${parameter.unit}` : ''}`;
}

export const COMPONENT_PORTS = new Proxy({}, {
  get(_target, type) {
    const definition = registry.get(type);
    return definition && typeof definition.ports !== 'function' ? definition.ports : [];
  },
  ownKeys() { return [...registry.keys()]; },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
});
