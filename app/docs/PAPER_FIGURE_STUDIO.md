# Paper Figure Studio and OpticalSetup bridges

## Why this layer exists

PIC papers often combine several visual domains in one figure: the on-chip circuit, free-space or fiber coupling, electrical/RF drive and readout, control software, plots, and microscope/SEM panels. PicSetup now represents that complete composition while preserving a strict boundary between simulation and illustration.

## Simulated versus diagram-only objects

Simulated photonic objects participate in the coherent compact-model network. Diagram-only objects carry typed ports and publication metadata, render and export normally, but do not enter the optical solver. This prevents an RF cable, controller, image panel, or generic instrument from silently becoming a waveguide.

## Figure workflow

1. Open **Paper** from the top bar.
2. Load **Hybrid PIC paper figure**, or add elements from the component library.
3. Select a component to edit its figure label, label placement, metadata visibility, offsets, and rotation.
4. Select a typed connection to edit its label, direction arrow, and label offsets.
5. Attach a local image to a micrograph/image panel from its inspector.
6. Export a cropped SVG or high-resolution PNG.

The plot panel is a composition placeholder. Quantitative plots should be exported from PicSetup Lab and inserted as images or reconstructed downstream.

## OpticalSetup handoff

An OpticalSetup port emits `setup-port/1`, containing:

- stable bridge ID and source document/component identity;
- target application and return URL;
- direction and physical interface kind;
- wavelength, explicit PicSetup-side and OpticalSetup-side powers, coupling efficiency, polarization, guided mode, phase, and CW/pulsed timing;
- supported capabilities and unsupported properties.

The URL uses `incomingBridge` plus `bridgeSchema`. The companion receiver parser is in `integrations/opticalsetup/receiver-adapter.js`.

The contract is intentionally narrower than a universal simulator. PicSetup owns the scalar guided-mode boundary. OpticalSetup owns beam waist, numerical aperture, wavefront, spatial coordinates, and free-space propagation.
