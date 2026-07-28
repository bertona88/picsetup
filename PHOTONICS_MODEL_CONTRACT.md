# Photonics model contract

## Status and ownership

This contract governs the greenfield candidate under `app/`. It does not describe or modify the immutable production snapshot under `prototype/`.

PicSetup owns guided photonic topology and reduced-order circuit behavior. OpticalSetup owns free-space optical geometry and propagation. ElectricalSetup owns electrical drive and readout dynamics. A typed boundary may exchange declared state between those domains; it does not transfer model ownership.

## State and governing equation

Each modeled optical port carries an incoming complex amplitude `a` and outgoing complex amplitude `b`. Amplitudes are power normalized, so `|a|²` and `|b|²` are optical powers in milliwatts.

Every compact component contributes a wavelength-dependent scattering relation:

```text
b = S a + s
```

Waveguide connections contribute the propagation operator `C`. The complete connected optical network is solved simultaneously:

```text
(I - S C) b = s
```

The reported linear-system residual and the optical power budget are separate diagnostics. A small algebraic residual is not evidence of a physically complete loss model.

## Units and conventions

- Vacuum wavelength is expressed in nanometres.
- Geometric and optical path lengths are expressed in micrometres.
- Optical powers are expressed in milliwatts.
- Phase values in solver state are radians. Display controls may expose degrees when labeled.
- A port represents one declared scalar guided mode, TE0-like by default.
- Component port reference planes are the component connection points represented in the semantic graph.
- Connection direction and component port roles determine the sign and source/sink interpretation; visual arrow direction alone has no solver authority.

Physical routing numerically integrates the rendered path to obtain geometric length. Schematic routing uses the connection's explicit optical length. The interface must identify which mode is active.

## Solver admission

Only connections whose declared domain is `optical` and whose ports are optically compatible enter `C`.

`electrical`, `rf`, `control`, and `annotation` connections remain part of the semantic document and publication figure, but they do not enter the coherent optical solve. Diagram-only objects never acquire a compact optical model merely because they are visually connected.

The modeled registry includes analytical or imported reduced-order components such as sources, couplers, splitters, phase and amplitude elements, resonators, filters, detectors, crossings, terminations, grating/edge interfaces, delay lines, imported S-parameter blocks, and reducible passive hierarchy. Each definition must declare its ports, parameters, active-model scope, provenance, assumptions, and rendering metadata.

## Power accounting

The solver reports launched, detected, terminated, component-loss, waveguide-loss, and unaccounted power where the selected models expose enough state. Conservation tests use passive, lossless fixtures with declared matched boundaries. Lossy or incomplete circuits must not be described as conservative merely because the numerical residual is small.

## Validity domain

The candidate is an interactive compact-model workbench. It is not:

- a cross-section or full-chip Maxwell solver;
- a fabrication-ready mask-layout or DRC tool;
- a calibrated foundry model library;
- a polarization-resolved or multimode solver unless an imported model explicitly supplies those channels;
- a nonlinear, thermal-crosstalk, RF, SPICE, PCB, control-system, or full-wave time-domain simulator;
- proof of passivity, causality, reference-plane correctness, or fabrication validity for user-imported S-parameters.

Pulse analysis reconstructs a linear response from sampled frequency-domain compact models. Detector bandwidth may shape the electrical pulse readout but does not alter the CW optical network.

## Required validation

Changes to the model layer must retain:

- finite complex amplitudes and bounded numerical residuals for supported connected fixtures;
- lossless passive power conservation within the tolerance recorded in the test;
- complementary Mach–Zehnder outputs under wavelength or phase variation;
- physical/schematic route-length semantics;
- hierarchy collapse/expand response preservation;
- deterministic seeded tolerance results;
- isolation of non-optical connection domains from the coherent solve;
- explicit warnings for invalid, disconnected, unsupported, or numerically problematic states.

Passing these checks validates the declared reduced-order behavior only. It does not establish fabrication accuracy, live deployment, or public acceptance.
