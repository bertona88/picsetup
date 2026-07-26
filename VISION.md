# PicSetup Vision

## The product

PicSetup is a mobile-first scientific sketchpad for integrated photonics.

A user should be able to begin with a blank canvas, draw a photonic circuit as naturally as sketching on paper, and immediately see a physically grounded account of how light propagates through it. The interface should make circuit construction feel direct and expressive while keeping the underlying model explicit, inspectable, and honest about its limits.

PicSetup is not a fixed circuit demo, a dashboard wrapped around one topology, or a conventional CAD tool miniaturized for a phone. The circuit must emerge under the user's finger or pointer.

## The promise

**Sketch a photonic circuit. Watch it behave. Understand why.**

PicSetup should shorten the distance between an idea and a meaningful experiment:

1. Draw or place a source.
2. Sketch waveguides.
3. Add components directly on the paths.
4. Let compatible ports snap together.
5. Start the source and watch fields propagate.
6. Slow, freeze, or accelerate time.
7. Manipulate the circuit and see the model update.
8. Inspect powers, phases, spectra, loss, assumptions, and failure states.

The visual response must come from the circuit model. Animation may clarify the result, but it must never substitute for one.

## Who it is for

PicSetup is for people who think with photonic circuits:

- students building intuition;
- researchers testing topologies and communicating ideas;
- engineers exploring reduced-order behavior before moving to specialist tools;
- educators demonstrating interference, resonance, modulation, detection, and coupled optical systems;
- curious technical users who should not need prior knowledge of PicSetup to begin.

An expert should recognize the physical concepts and model boundaries. A newcomer should discover the interaction without reading a manual first.

## The experience

### A sketchpad, not a dashboard

The canvas is the product. It should occupy nearly the whole screen, especially on mobile.

Waveguides begin as strokes and resolve into clean, editable paths. Components can be dropped, drawn, or inserted onto a path. Ports advertise compatibility and snap without demanding pixel-perfect placement. After construction, geometry and topology remain directly editable: components move, paths bend, connections detach, and the circuit recomputes.

Controls are contextual. Selecting an object reveals only the parameters and measurements relevant to it. Knobs, faders, pads, and gestures should feel like manipulating an instrument rather than completing a form. A permanent wall of sliders is a failure mode.

The first-session experience should require no template:

> Start from a blank sheet and draw a working Mach–Zehnder interferometer.

That journey is the first product acceptance test, not merely a tutorial.

### Light that can be read

Optical behavior should be legible on the circuit itself. Depending on the active experiment, the canvas may reveal:

- propagation and arrival time;
- relative phase;
- optical power and loss;
- interference and resonance;
- wavelength-dependent response;
- reflections when supported by the selected model;
- electrical drive and detector response at declared interfaces;
- mechanical motion and optomechanical or phononic coupling when supported.

A prominent time control lets the user slow, pause, scrub, or accelerate dynamics. It must distinguish physical time, solver stepping, and visualization speed wherever those are not the same quantity.

The display should remain useful at phone scale. Detail should appear progressively rather than shrinking a desktop laboratory onto a small screen.

### A scientific sketchbook

Dark mode should feel like drawing with light on a black scientific notebook: deep background, restrained neon fields, high contrast, and minimal chrome. Light mode should share visual lineage with OpticalSetup while remaining legible and calm.

The visual language should be expressive, but not decorative at the expense of meaning. Color, motion, glow, and sound—if sound is later used—must encode state consistently or stay out of the way.

## Product principles

### 1. Direct manipulation before configuration

Users act on the circuit itself. Side panels and dialogs support the canvas; they do not become the main way to build.

### 2. Topology before polish

A draggable drawing of a fixed topology is still a fixed topology. Users must be able to create, connect, disconnect, move, and delete semantic circuit elements.

### 3. Semantic circuits, not painted pixels

Every visible circuit is backed by a graph:

- nodes are components with typed, directed or bidirectional ports;
- edges are waveguides or other connections with editable geometry and model parameters;
- domains distinguish optical, electrical, mechanical, thermal, and cross-domain behavior;
- every parameter has units or an explicit dimensionless convention;
- saved circuits preserve model versions and provenance needed to reopen the experiment.

The sketch layer converts gestures into graph edits. The solver consumes the graph. The renderer visualizes solver state. These responsibilities must remain separable.

### 4. Physics with declared fidelity

PicSetup should use the lightest model that is adequate for the question, not the most impressive animation and not the most expensive solver by default.

The initial hierarchy is expected to begin with coherent network and scattering models suitable for interactive use. More detailed modes may later add dispersion, reflections, polarization, nonlinear effects, thermal behavior, phononics, optomechanics, or external solvers.

Every experiment must make clear:

- what is being solved;
- which assumptions are active;
- the validity domain;
- units, sign conventions, timebase, and port reference planes;
- what has been reduced, approximated, or omitted;
- whether the output is qualitative, pedagogical, reduced-order, validated, or calibrated.

PicSetup must not imply fabrication readiness, layout signoff, or calibrated device prediction without the validation required for those claims.

### 5. Fast enough to think with

The core construction and reduced-order simulation loop should run locally and responsively on a modern phone. A backend may later support collaboration, persistence, large computations, or external solvers, but basic drawing, editing, saving, sharing, and first-order simulation must not depend on a network round trip.

When a model is too expensive for interactive execution, the product should degrade explicitly: reduce fidelity with consent, pause for computation, or hand off to a more capable solver. It must not silently replace the requested physics.

### 6. Progressive complexity

A new user sees a canvas and an obvious first action. An expert can inspect equations, parameters, reference planes, numerical settings, and validation evidence. Complexity is revealed when it becomes relevant rather than exposed all at once.

### 7. An open component system

The component catalog must be extensible without rewriting the editor or solver. Sources, splitters, directional couplers, crossings, resonators, gratings, phase shifters, modulators, detectors, AOMs, phononic structures, and future devices should enter through versioned component definitions and model contracts.

The vision is broad coverage of integrated photonics, including newly developed device classes. That breadth is a direction for the platform, not a claim that every device belongs in the first release or can share one fidelity model.

### 8. Interoperability without blurred ownership

PicSetup owns guided photonic networks.

OpticalSetup owns free-space optical instruments, propagation, and geometry. ElectricalSetup owns electronic drive and readout dynamics. Other Setup Universe tools retain their own state and authority.

Cross-setup exchange must use explicit, versioned, unit-aware interfaces. PicSetup should not copy another setup's private implementation state.

When light leaves the guided 2D plane, PicSetup may turn that transition into a spatial moment: a controlled glare or screen-facing flash that makes the out-of-plane event unmistakable, followed by an offer to continue in the corresponding OpticalSetup configuration. The transition should preserve the originating setup and encoded state client-side where practical. It must respect accessibility settings and never create an unsafe or unavoidable flash.

## First real version

The first real version is a narrow but complete scientific instrument, not a broad mock interface.

A user can:

- start with a blank canvas;
- draw and edit waveguides with touch, pen, mouse, or trackpad;
- insert and spatially move a source, two couplers or splitters, a phase shifter, and two detectors;
- connect compatible ports through forgiving snapping;
- construct an MZI rather than receive one preassembled;
- run a documented coherent scattering model;
- vary wavelength and phase and see both output powers respond;
- slow, pause, and accelerate the visualization;
- inspect relevant state, units, assumptions, and model caveats;
- undo, redo, erase, duplicate, save, reopen, and share the exact circuit;
- receive clear feedback for invalid, disconnected, unsupported, or numerically problematic states.

The implementation is accepted only when circuit connectivity, conservation behavior, reference planes, and save/reopen semantics are tested in addition to the interaction and browser experience.

## Beyond the first version

The architecture should leave deliberate room for:

- richer passive and active integrated-photonic components;
- spectral sweeps and experiment recording;
- polarization, reflections, dispersion, nonlinear and thermal models;
- electrical control and detector chains;
- phononic and optomechanical components with visible mechanical motion;
- layout-aware geometry and optional specialist-tool interchange;
- reusable component and experiment libraries;
- collaboration, annotations, and publication-ready sharing;
- composed experiments across the Setup Universe;
- external high-fidelity solvers and validated model packages.

These are expansion paths, not excuses to delay the first complete sketch-to-simulation loop.

## Non-goals for the first version

The first version is not:

- a mask-layout or fabrication-signoff tool;
- a full electromagnetic field solver;
- a replacement for every specialist photonics package;
- a marketplace-sized component catalog;
- a multi-user collaborative platform;
- a fixed MZI with movable controls;
- a visual effect presented as physical prediction.

## Product decision test

When deciding what to build, ask:

1. Does this help a user create or understand a photonic circuit directly?
2. Does it preserve the canvas as the primary surface?
3. Is the behavior backed by explicit semantic state and a declared model?
4. Will it remain understandable and responsive on a phone?
5. Does it expose uncertainty, unsupported states, and model limits honestly?
6. Does it keep PicSetup's ownership boundary and future interoperability clear?
7. Does it move the blank-canvas MZI journey closer to being complete?

If the answer is no, the feature should be reconsidered, deferred, or moved to a more appropriate Setup.

## Definition of success

PicSetup succeeds when someone can sketch an idea at the speed of a whiteboard, interrogate it with the discipline of a scientific model, and carry the resulting circuit forward without losing what was assumed, calculated, or observed.

The enduring product is not a particular demo or solver. It is the tight, trustworthy loop between drawing, physical behavior, and understanding.
