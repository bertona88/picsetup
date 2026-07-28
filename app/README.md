# PicSetup — PIC analysis and publication-figure workbench

PicSetup is a dependency-light, mobile-first environment for integrated photonics. It combines an editable semantic PIC canvas, a simultaneous complex scattering solver, an interactive analysis Lab, reusable hierarchy, and a **Paper Figure Studio** for building the system-level figures commonly used in papers: a chip schematic connected to external optics, RF/electrical instrumentation, control blocks, plots, micrographs, labels, and operating-condition callouts.

The product boundary is deliberate. PicSetup owns guided-wave photonic topology and compact models. Free-space laboratory optics remain the domain of [OpticalSetup](https://opticalsetup.com/sketch/), connected through explicit, versioned optical bridge ports rather than by pretending that every domain uses one solver.

Everything runs in the browser. A backend is not required.

## Run locally

Serve this directory with any static web server:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

Build the completely self-contained preview:

```bash
python build_single.py
```

The portable build is written to `dist/PicSetup-Lab-10x-preview.html`. The multi-file application remains the preferred form for development and PWA installation.

## Primary workflows

### Circuit analysis

1. Build or open a PIC on the canvas.
2. Pin a detector, optical probe, port, waveguide, or circuit-level measurement.
3. Open **PicSetup Lab**.
4. Sweep an active optical parameter, tune selected knobs toward a target, run tolerance analysis, or reconstruct a linear pulse response.
5. Apply an operating point back to the live circuit, preserve a baseline, or export the semantic state for another tool.

### Paper figures

1. Open **Paper** and load the included **Hybrid PIC paper figure** template, or add figure elements to an existing circuit.
2. Combine simulated PIC components with diagram-only instruments, system blocks, typed links, panel letters, text, plots, and image panels.
3. Edit component-label placement, metadata visibility, connection labels, direction arrows, panel dimensions, and the figure background.
4. Export a cropped publication SVG or high-resolution PNG. Semantic JSON remains available when the figure must stay editable.

## What is implemented

### Semantic circuit canvas

- Touch, pen, mouse, keyboard, and mobile-first interaction.
- Component placement, direct dragging, freehand waveguide routing, undo/redo, deletion, local save, autosave, JSON import/export, and URL sharing.
- Pinch/wheel zoom, pan, fit, component focus, larger invisible touch targets, and semantic zoom that reveals detail progressively.
- Explicit **Physical** and **Schematic** routing modes.
  - Physical: the rendered cubic curve is numerically integrated and used as optical length.
  - Schematic: the drawing is visual and each waveguide owns an explicit optical length.
- Optional physical snap grid, micrometre scale, exact route length, phase, minimum-curvature radius, and user-declared bend-radius validation.
- Solid single-color CW illumination, optional nonphysical direction tracers, and pulse-envelope packets whose length and spacing are controlled separately.

### Compact-model circuit engine

Every optical port carries incoming and outgoing complex, power-normalized modal amplitudes:

```text
b = S a + s
```

Waveguides form the wavelength-dependent connection operator `C`, and the complete optical circuit is solved simultaneously:

```text
(I - S C) b = s
```

The coherent model registry includes:

- laser source, photodetector, non-perturbing optical probe, and matched termination;
- phase shifter, electro-optic modulator, thermo-optic heater, and attenuator;
- directional coupler, 2×2 MMI, Y splitter, and waveguide crossing;
- add-drop ring, Bragg filter, arrayed waveguide grating, and spiral delay line;
- grating coupler, edge coupler, and OpticalSetup bridge boundary;
- wavelength-indexed generic complex S-parameter block;
- hierarchical block reduced live from a stored passive subcircuit.

Each simulated definition owns its ports, parameters, active-model scope, provenance, assumptions, compact scattering model, rendering metadata, and inspector contract.

### Paper Figure Studio

Paper Figure Studio adds a publication-composition layer without weakening the physics boundary.

- White or transparent paper canvas, optional grid and port visibility, content-aware export crop, SVG export, and high-resolution PNG export.
- Resizable chip boundary with background layering.
- Panel letters, free text annotations, operating-condition callouts, and movable/hideable component metadata.
- Configurable connection labels, label offsets, and start/end/bidirectional arrows.
- Image panels for local optical micrographs, SEMs, photographs, or renderings, with contain/crop controls.
- Stylized plot panels for figure composition; real numerical traces should still be exported from PicSetup Lab.
- External figure vocabulary including fiber arrays, polarization controllers, optical instruments, RF generators, amplifiers/TIAs, oscilloscopes, controllers, and generic laser/receiver/driver/processor/sample blocks.
- Included hybrid template combining free-space/fiber handoffs, a PIC transmitter/receiver, RF drive, thermal bias, photocurrent readout, control, a plot, a micrograph placeholder, and paper annotations.

Diagram-only figure objects are declared as such, excluded from hierarchy reduction, and never silently substituted for a compact optical model.

### Typed cross-domain graph

Connections carry a declared domain:

- `optical` — guided/fiber/free-space optical boundary links;
- `electrical` — voltage/current/readout wiring;
- `rf` — RF/coax drive links;
- `control` — logical control and automation;
- `annotation` — explanatory figure relationships.

Port compatibility is checked while wiring. Only optical links enter the coherent network solve. Electrical, RF, control, and annotation links remain editable, inspectable, and exportable, but cannot accidentally become optical waveguides.

### OpticalSetup bridge ports

The **OpticalSetup port** is a real typed boundary, not a decorative hyperlink. It supports:

- OpticalSetup → PicSetup, PicSetup → OpticalSetup, or bidirectional direction;
- free-space, fiber, chip-edge, or vertical-grating interface kind;
- wavelength, explicitly referenced power on both sides of the interface, coupling efficiency, polarization, guided mode, boundary phase, and CW/pulsed timing;
- bridge ID, target OpticalSetup URL, return URL, capabilities, and explicit omissions.

PicSetup serializes the handoff as the versioned `setup-port/1` contract and opens the target editor with:

```text
?incomingBridge=<base64url payload>&bridgeSchema=setup-port/1
```

It can also copy or download the bridge JSON and export a manifest containing every OpticalSetup bridge in the figure.

**Integration boundary:** this source completes the PicSetup sender/exporter side. The live OpticalSetup editor must add an `incomingBridge` adapter before the URL automatically creates a corresponding fiber/free-space boundary object. Until that receiver is deployed, the target opens with the complete payload preserved in the URL; this is not live synchronization or a distributed multi-physics solve.

### Trust and diagnostics

- Solver residual is reported separately from optical power accounting.
- Power budget distinguishes launched, detected, terminated, component loss, waveguide loss, and unaccounted power.
- Model warnings identify invalid parameters, unsupported operating conditions, and optional bend-radius violations.
- Inspector fields state whether a parameter is active in CW, pulse, electrical, global, visual, or diagram-only scope.
- Parameter links keep compatible knobs synchronized during direct edits, sweeps, tuning, and tolerance runs.
- No hidden geometry substitution: grouping, rendering, and solving preserve declared optical-length contracts.

### PicSetup Lab

#### Sweep

- Sweep wavelength or any active CW compact-model/waveguide parameter.
- Plot multiple pinned measurements simultaneously.
- Inspect a live operating-point cursor and apply it back to the circuit.
- Save baseline traces and export CSV.
- Derive maximum/minimum transmission, insertion loss, extinction ratio, 3 dB bandwidth, free spectral range, phase excursion, and group delay where the data support them.
- Compare paired outputs through imbalance and contrast metrics.

#### Tune

- Maximize, minimize, or target a pinned measurement.
- Select one to four compatible design knobs.
- Add a wavelength robustness window so tuning optimizes more than a single nominal point.
- Preview the proposed circuit and explicitly apply it to the canvas.

#### Tolerance

- Seeded Monte Carlo analysis with absolute or relative Gaussian variation.
- Yield against a threshold and criterion.
- Distribution histogram, best/worst sampled results, deterministic ±3σ corner search, and correlation-based sensitivity ranking.
- Click a sensitivity result to highlight the responsible component or route.

#### Pulse

For a linear circuit, PicSetup builds a transform-limited Gaussian source spectrum, solves the complex transfer function over frequency, reconstructs the temporal optical envelope, and applies detector bandwidth to produce an electrical response. It reports delay, output pulse width, peak transmission, and repetition period.

This is spectral compact-model reconstruction—not nonlinear propagation or a full-wave time-domain field solve.

### Hierarchy and reuse

- Multi-select passive optical components and collapse them into a reusable external scattering block.
- Expand the block back into its internal graph.
- Preserve circuit response across collapse and expansion, including boundary optical lengths.
- Export a block as semantic JSON.
- Non-optical links and publication-only objects are rejected from compact optical hierarchy rather than being dropped silently.
- Included templates: hybrid PIC paper figure, Mach–Zehnder interferometer, add-drop ring, delay interferometer, and filter bank.

### Workflow exports

- Portable PicSetup experiment JSON.
- Semantic netlist JSON with model provenance, assumptions, parameters, typed ports, endpoints, hierarchy, links, domain counts, figure-object counts, and bridge manifest.
- SAX-oriented YAML scaffold containing only physical optical topology.
- Starter gdsfactory Python topology containing only physical optical topology.
- Complex S-parameter import from JSON or CSV.
- Auto-layout for imported semantic netlists.

The SAX and gdsfactory outputs deliberately omit figure-only objects and non-optical wiring. They are handoff scaffolds, not a PDK-qualified layout, DRC-clean routing solution, or substitute for foundry compact models.

## Architecture

```text
src/models.js        simulated and diagram-only component/port registry
src/physics.js       typed network assembly, route contracts, templates, hierarchy
src/bridge.js        setup-port/1 OpticalSetup payloads, URLs, and manifests
src/geometry.js      shared cubic paths, adaptive length, curvature/radius
src/analysis.js      measurements, sweeps, metrics, tuning, tolerances, pulses
src/plot.js          interactive Canvas Lab plots
src/export.js        semantic/SAX/gdsfactory/S-parameter workflow exports
src/circuit.js       SVG renderer, paper layers, typed links, semantic zoom
src/coupler-view.js  progressive local directional-coupler physics views
src/app.js           interaction state, inspectors, Paper Studio, persistence/PWA
integrations/opticalsetup/  receiver parser and neutral boundary adapter
```

The application has no runtime package dependency. Browser modules are kept separate during development and converted to Blob-backed modules by `build_single.py` for the one-file preview.

## Declared physics and integration limits

- One scalar TE₀-like optical channel per declared port unless an imported model defines otherwise.
- Compact circuit models, not a cross-section or full-chip Maxwell solve.
- Directional-coupler local field views use compact transverse profiles and visibly magnify the carrier oscillation.
- Default compact models are analytical approximations intended for topology and system-level reasoning; provenance is shown in the inspector.
- Bend radius is validated only when the user supplies a minimum. PicSetup does not invent bend loss from an unspecified process stack.
- Detector bandwidth acts in pulse/electrical analysis; it does not alter the CW optical network.
- Pulse reconstruction assumes a linear time-invariant circuit over the sampled spectrum.
- Imported S-parameter quality, passivity, causality, and reference-plane correctness remain the user’s responsibility.
- Figure-only electrical/RF/control blocks are not SPICE, RF, PCB, or control-system simulations.
- The OpticalSetup bridge exchanges a typed boundary state; it does not transfer a transverse field, automatically infer beam waist/NA/wavefront, or synchronize two solvers in real time.
- Large embedded images are best shared through JSON/SVG or the source file rather than very long URL fragments.

## Tests

Run the complete test suite:

```bash
node --test tests/*.test.mjs
```

The suite covers complex-network conservation and residuals, exact rendered/model route length, curvature, physical/schematic routing, component registry dimensions, hierarchy response preservation, MZI and ring sweeps, phase/group-delay metrics, linked parameters, target tuning, deterministic Monte Carlo and corners, pulse reconstruction, semantic/SAX/gdsfactory exports, S-parameter import, auto-layout, typed-domain solver isolation, the hybrid paper template, and `setup-port/1` bridge round trips.

## PWA

When served over HTTP(S), the service worker caches the application shell and all source modules—including `src/bridge.js`—for offline reuse. Installability depends on normal browser PWA requirements and origin security rules.
