import { CAPABILITIES, getDetector } from "./catalog.js";

const C = CAPABILITIES;
export const DEFAULT_SIGNAL = Object.freeze({
  powerW: 2.4e-3,
  wavelengthM: 532e-9,
  bandwidthM: 1.2e-9,
  beam: Object.freeze({ diameterXM: 1.2e-3, diameterYM: 0.9e-3, centroidXM: 0.08e-3, centroidYM: -0.04e-3 }),
  imagePresent: true,
  wavefront: Object.freeze({ divergenceRad: 1.1e-3, radiusM: 3.8, collimationToleranceRad: 0.2e-3 }),
  polarization: Object.freeze({ stokes: Object.freeze([1, 0.42, 0.31, 0.74]) }),
  pulse: Object.freeze({ isPulsed: true, repetitionRateHz: 80e6, durationS: 120e-15 }),
});

export const cloneDefaultSignal = () => structuredClone(DEFAULT_SIGNAL);

export function validateSignal(signal) {
  for (const [name, value] of [["powerW", signal?.powerW], ["wavelengthM", signal?.wavelengthM], ["bandwidthM", signal?.bandwidthM], ["beam.diameterXM", signal?.beam?.diameterXM], ["beam.diameterYM", signal?.beam?.diameterYM]]) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive and finite`);
  }
  const stokes = signal?.polarization?.stokes;
  if (!Array.isArray(stokes) || stokes.length !== 4 || stokes.some((v) => !Number.isFinite(v))) throw new TypeError("polarization.stokes must contain four finite values");
  return signal;
}

export function peakIrradiance(signal) {
  validateSignal(signal);
  return 8 * signal.powerW / (Math.PI * signal.beam.diameterXM * signal.beam.diameterYM);
}

export function classifyPolarization([s0, s1, s2, s3]) {
  if (s0 <= 0) return { label: "No light", degree: 0 };
  const p = Math.sqrt(s1 ** 2 + s2 ** 2 + s3 ** 2);
  const degree = Math.min(1, p / s0);
  const n3 = Math.max(-1, Math.min(1, s3 / Math.max(p, Number.EPSILON)));
  if (degree < 0.1) return { label: "Unpolarized", degree };
  if (Math.abs(Math.abs(n3) - 1) < 0.08) return { label: s3 >= 0 ? "Left circular" : "Right circular", degree };
  if (Math.abs(n3) < 0.08) return { label: "Linear", degree };
  return { label: s3 >= 0 ? "Left elliptical" : "Right elliptical", degree };
}

export function buildIntensityMap(signal, width = 33, height = 25) {
  validateSignal(signal);
  if (width < 3 || height < 3) throw new RangeError("map dimensions must be at least 3 × 3");
  const { diameterXM: dx, diameterYM: dy, centroidXM: cx = 0, centroidYM: cy = 0 } = signal.beam;
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const px = (x / (width - 1) - 0.5) * dx * 2.4 - cx;
    const py = (y / (height - 1) - 0.5) * dy * 2.4 - cy;
    return Math.exp(-2 * ((px / (dx / 2)) ** 2 + (py / (dy / 2)) ** 2));
  }));
}

export function buildSpectrum(signal, samples = 49) {
  validateSignal(signal);
  const sigma = signal.bandwidthM / (2 * Math.sqrt(2 * Math.log(2)));
  return Array.from({ length: samples }, (_, i) => {
    const wavelengthM = signal.wavelengthM + (i / (samples - 1) - 0.5) * signal.bandwidthM * 6;
    return { wavelengthM, intensity: Math.exp(-0.5 * ((wavelengthM - signal.wavelengthM) / sigma) ** 2) };
  });
}

const number = (id, label, value, unit, qualifier) => ({ id, label, value, unit, qualifier, kind: "number", available: true });
const status = (id, label, value, available = true) => ({ id, label, value, kind: "status", available });

export function measureSignal(detectorId, input = DEFAULT_SIGNAL) {
  const detector = getDetector(detectorId);
  const signal = validateSignal(input);
  const has = (capability) => detector.capabilities.includes(capability);
  const readouts = [];
  const visuals = {};
  const irradiance = peakIrradiance(signal);
  if (has(C.INTENSITY)) readouts.push(number("peak-intensity", "Peak intensity", irradiance, "W/m²"));
  if (has(C.LOW_LIGHT)) {
    const photonRate = signal.powerW / ((6.62607015e-34 * 299792458) / signal.wavelengthM);
    readouts.push(number("low-light-intensity", "Low-light intensity", irradiance, "W/m²"), number("photon-rate", "Estimated photon rate", photonRate, "photons/s"));
  }
  if (has(C.POWER)) readouts.push(number("power", "Optical power", signal.powerW, "W"));
  if (has(C.SPATIAL)) {
    visuals.intensityMap = buildIntensityMap(signal);
    readouts.push(status("spatial-map", "Spatial intensity", "2D map"), number("centroid-x", "Centroid X", signal.beam.centroidXM ?? 0, "m"), number("centroid-y", "Centroid Y", signal.beam.centroidYM ?? 0, "m"));
  }
  if (has(C.DIAMETER)) readouts.push(number("diameter-x", "Beam diameter X", signal.beam.diameterXM, "m"), number("diameter-y", "Beam diameter Y", signal.beam.diameterYM, "m"));
  if (has(C.IMAGE)) readouts.push(status("image", "Image plane", signal.imagePresent ? "Image resolved" : "No image"));
  if (has(C.WAVEFRONT)) {
    const collimated = Math.abs(signal.wavefront.divergenceRad) <= signal.wavefront.collimationToleranceRad;
    visuals.wavefront = { collimated, divergenceRad: signal.wavefront.divergenceRad };
    readouts.push(status("collimation", "Wavefront", collimated ? "Collimated" : "Diverging"), number("divergence", "Divergence", signal.wavefront.divergenceRad, "rad"), number("curvature", "Radius of curvature", collimated ? Infinity : signal.wavefront.radiusM, "m"));
  }
  if (has(C.POLARIZATION)) {
    const classification = classifyPolarization(signal.polarization.stokes);
    visuals.polarization = classification;
    readouts.push(status("polarization", "Polarization", classification.label), ...signal.polarization.stokes.map((value, i) => number(`s${i}`, `Stokes S${i}`, value, "")), number("dop", "Degree of polarization", classification.degree * 100, "%"));
  }
  if (has(C.SPECTRUM)) {
    visuals.spectrum = buildSpectrum(signal);
    readouts.push(number("wavelength", "Center wavelength", signal.wavelengthM, "m"), number("bandwidth", "Bandwidth", signal.bandwidthM, "m"));
  }
  if (has(C.PULSE)) {
    readouts.push(status("source-mode", "Temporal mode", signal.pulse.isPulsed ? "Pulsed" : "Continuous wave"), number("repetition-rate", "Repetition rate", signal.pulse.repetitionRateHz, "Hz"), number("pulse-duration", "Pulse duration", signal.pulse.durationS, "s"));
    if (!signal.pulse.isPulsed) readouts.slice(-2).forEach((item) => { item.available = false; });
  }
  return { detector, readouts, visuals, caveats: detector.idealized ? ["Idealized composite instrument; not a claim that one physical device performs every measurement simultaneously."] : [] };
}
