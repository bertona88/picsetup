export const CAPABILITIES = Object.freeze({
  INTENSITY: "intensity",
  LOW_LIGHT: "low-light-intensity",
  POWER: "power",
  SPATIAL: "spatial-intensity",
  DIAMETER: "beam-diameter",
  IMAGE: "image",
  WAVEFRONT: "wavefront",
  POLARIZATION: "polarization",
  SPECTRUM: "spectrum",
  PULSE: "pulse-timing",
});

const C = CAPABILITIES;

export const DETECTORS = Object.freeze([
  { id: "camera", name: "Camera", symbol: "▦", description: "Spatially resolved intensity, beam diameter, and images formed on the sensor plane.", capabilities: [C.SPATIAL, C.DIAMETER, C.IMAGE] },
  { id: "photodetector", name: "Photodetector", symbol: "◉", description: "Single-channel optical intensity readout.", capabilities: [C.INTENSITY] },
  { id: "photomultiplier", name: "Photomultiplier (PMT)", symbol: "✦", description: "High-gain intensity readout for fluorescence, microscopy samples, and weak point sources.", capabilities: [C.LOW_LIGHT] },
  { id: "power-meter", name: "Power meter", symbol: "P", description: "Total optical power incident on the active area.", capabilities: [C.POWER] },
  { id: "wavefront-detector", name: "Wavefront detector", symbol: "⌁", description: "Intensity plus collimation, divergence, and wavefront curvature.", capabilities: [C.INTENSITY, C.WAVEFRONT] },
  { id: "polarimeter", name: "Polarimeter", symbol: "↻", description: "Stokes parameters and linear, circular, elliptical, or unpolarized state.", capabilities: [C.POLARIZATION] },
  { id: "spectrometer", name: "Spectrometer", symbol: "λ", description: "Center wavelength and spectral bandwidth.", capabilities: [C.SPECTRUM] },
  { id: "general-detector", name: "General detector", symbol: "◎", description: "Idealized all-in-one optical diagnostic, including pulse timing.", capabilities: Object.values(C), idealized: true },
]);

const byId = new Map(DETECTORS.map((detector) => [detector.id, detector]));
export function getDetector(id) {
  const detector = byId.get(id);
  if (!detector) throw new RangeError(`Unknown detector: ${id}`);
  return detector;
}
