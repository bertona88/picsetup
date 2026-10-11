# PICSetup — agent implementation brief

**Version:** 1.0 · **Date:** 11 October 2026  
**Purpose:** A self-contained handoff for rebuilding a free, open-source, browser-based photonic circuit playground.  
**Status:** Implementation instructions and proposed defaults, not an implementation report. No new simulator, numerical validation, or deployment is claimed by this document.

> Build a visual sandbox where people drop photonic components, draw connections, explore the resulting circuit, and save their own circuits as reusable modules. Model known components and their connections; do not pretend to solve arbitrary drawn geometry.

## 1. Read this first

The owner's clarified intent is a free scientific toy in the positive sense: approachable, visually appealing, useful for sketching ideas, and honest about its physics. The philosophy is like OpticalSetup, not an enterprise design product. Success means a person can quickly ask, “Does this circuit behave as I expected under these component assumptions?”

There is no requirement for a foundry PDK, commercialization strategy, subscription, account system, paid API, or fabrication-ready output. Do not turn this assignment back into a market study or a full electromagnetic platform.

Implement a fresh architecture. Existing PICSetup code is reference material, not the mandatory foundation. Reuse a small piece only after inspecting its correctness, license, and fit; document that choice. Do not spend the first milestone expanding the old prototype or copying its broad feature inventory.

### Confirmed direction versus working defaults

| Item | Status and instruction |
| --- | --- |
| Free, open source, browser-first, visual exploration | Owner direction; preserve it. |
| Drop components and connect them with editable paths | Owner direction. Nodes and curves remain useful interaction tools. |
| Analytical models plus available open component data | Agreed direction; a foundry PDK is not a prerequisite. |
| Fresh implementation, not continued investment in the current prototype | Owner preference. Preserve the old work rather than deleting it. |
| Dragging changes the sketch, not physical length | **Provisional default proposed in discussion, not explicitly confirmed by the owner.** Adopt it for v1 and make it reversible in the architecture. |
| TypeScript, SVG canvas, Vite, Vitest, Playwright | Recommended implementation defaults, not owner mandates. Record justified substitutions. |
| New repository name, final project license, production cutover | Not settled. Do not invent authorization for destructive changes or deployment. |

Proceed with the reversible defaults; do not block implementation with another long discovery questionnaire. Ask only when permission, unavailable data, or an irreversible action genuinely requires it.

## 2. Workspace, preservation, and authority

If the owner supplies a new empty repository, use it. Otherwise work on a new task branch in the available `bertona88/picsetup` repository, with the new app isolated in `playground/`. This fallback is a staging location, not a decision against eventually moving to a fresh repository. Do not create or delete a remote repository merely because the owner discussed starting again.

Before editing, read `AGENTS.md`, applicable nested instructions, current status documents, remotes, branch state, and deployment workflows. Preserve unrelated work and the immutable `prototype/` snapshot. No force-pushes, history rewrites, branch deletion, DNS changes, production deployment, or changes to OpticalSetup are authorized by this brief alone.

The existing Pages workflow inspected on 11 October deploys on pushes to `main`; therefore push implementation work to a task branch, not `main`. Recheck the workflow before acting. Older documents contain broader priorities and conflicting deployment descriptions; do not infer live deployment state from them. [R1]

On the task branch, establish the rebuild's `VISION.md`, `PHOTONICS_MODEL_CONTRACT.md`, `INTERFACE_CONTRACT.md`, `CLAIMS_AND_VALIDATION.md`, and `ACCEPTANCE_TESTS.md` before substantial implementation, as required by the repository. Keep them concise and scoped to the new workspace. Explain that this brief captures the later, narrower owner direction; retain operational safeguards. The previous feasibility and OpenLight notes are background, not requirements to build their full scope.

**Persistence is a requirement:** commit coherent checkpoints and push the task branch during the work. Before reporting completion, verify the remote commit. Do not leave the only copy in an ephemeral VM. If a push is blocked, report it and provide a patch or bundle; never claim the work is saved remotely without evidence.

## 3. What the first version does—and does not do

### Required experience

A user can start from a blank canvas, place a source and couplers, draw waveguide connections, insert a phase shifter, and attach output detectors. They can change phase, wavelength, coupling ratio, loss, or explicit waveguide length and inspect numerical power and phase results. They can sweep wavelength, save/reopen the experiment, and turn a source-free subcircuit into a reusable module.

Use a small component palette, a generous canvas, a contextual inspector, and a results panel. Components should look like photonic structures, not only generic workflow rectangles. Couplers can look like adjacent guides, phase shifters like highlighted sections, and rings like loops. Make ports evident during connection and selection without permanently cluttering the scene.

An animation is optional. Any motion is an explanatory visual overlay, not a calculated optical field or real-time propagation measurement. Numerical outputs and warnings must stand on their own.

### Accepted physics envelope

Linear, frequency-domain, steady-state operation; one declared guided mode per port; one coherent continuous-wave source per experiment initially. A wavelength sweep evaluates separate steady-state problems, not a pulse or automatically coherent broadband source. Include feedback and modeled reflections through a simultaneous network solve. Geometry has no implicit electromagnetic meaning.

### Explicitly outside v1

No full-wave/device solver, arbitrary polygon-to-physics conversion, fabrication layout/DRC, proprietary PDK requirement, quantum state simulation, nonlinear dynamics, laser rate equations, thermal fields, electrical/RF dynamics, inverse design, or manufacturing yield predictions. Also defer a figure-publication suite, cloud collaboration, and live OpticalSetup co-simulation. Do not silently carry these features over from the prototype.

## 4. Drawing and interaction rules

**Separate presentation from physical state.** Store component positions, rotation, viewport, path handles, and visual curve shape separately from the circuit netlist and model parameters.

- A curve handle is an editing point, not an optical junction. Moving it does not change the solver's unknown count.
- Drawing between compatible ports creates a waveguide connection with an explicit physical length. Default new links to a declared zero-length ideal connection, visibly labeled `L = 0 µm`; never infer length from pixels. Example circuits can supply meaningful nonzero lengths.
- Ordinary dragging, rotation, and path reshaping preserve physical parameters and results. An inspector edits length in physical units. A later explicit geometry-linked mode may change this behavior, but is not required now.
- Each physical port has at most one connection. Splitting requires a splitter/coupler model. Crossing lines do not connect or couple automatically. Nearby guides do not interact unless an explicit component describes that interaction.
- Dropping a phase shifter onto a link must split the connection while preserving its total specified length; test that the initial zero-phase insertion leaves results unchanged. Equally acceptable initially: connect the phase shifter explicitly between two links.
- Deleting or reconnecting a component updates the semantic graph atomically. Prevent incompatible modes, duplicate connections, dangling identifiers, and recursive module definitions.

Provide pan/zoom, selection, duplicate/delete, undo/redo, and keyboard-accessible parameter editing. A click-to-place alternative to drag-and-drop is required. Show warnings near the relevant part and explain the remedy. Use text or symbols as well as color for model status and errors.

## 5. Starter component library

Do not wait for a large database. Ship a small useful library with three visibly distinct categories.

| Category | Initial content | Meaning |
| --- | --- | --- |
| Analytical | Waveguide connection, reciprocal 2×2 coupler, phase shifter, attenuator; ideal source, matched detector/termination, nonloading probe | Equations with explicit assumptions, not foundry calibration. |
| Open dataset | One fully inspected SiEPIC-derived directional-coupler dataset, then additional models only when ingestion and attribution are sound | Response derived from an identified external dataset; not automatically validated against fabricated hardware. |
| User modules | Source-free subcircuits with named external ports and retained internal definitions | New components assembled from existing models, not new EM simulations. |

Analytical models are a first-class feature, not a fallback to hide. Simphony provides analytical examples, and SAX demonstrates building a circuit whose resulting response is itself another component model. [R2, R3]

Start the data pipeline with this candidate:

```text
Repository: BYUCamachoLab/simphony
Path: simphony/libraries/siepic/source_data/ebeam_dc_te1550/
      dc_gap=200nm_Lc=10um.sparam
Verified Git blob: 2b56aff1c525be81eb1ea374f9e0107cdb59e356
```

The file header and existence were checked for this brief; the full dataset was not numerically audited. Simphony documents the directional-coupler geometry choices, including this 200 nm gap / 10 µm coupling length, and identifies its SiEPIC upstream as MIT-licensed. The upstream repository's license was also inspected. Neither observation substitutes for checking the exact files and notices being redistributed. [R4–R6]

### Model-ingestion contract

Write a reproducible, development-time conversion script for this specific source format into a browser-native data format. Do not promise a universal `.cml` or arbitrary S-parameter importer. Python reference tooling is acceptable during development; the shipped browser application must not require Python/JAX, a model server, or a runtime GitHub fetch.

Preserve source bytes or a reproducible retrieval recipe with a pinned revision/checksum, applicable license notices, conversion version, geometry, port order, modal basis, normalization, frequency units, phase convention, reference planes, and valid ranges. Distinguish simulated, measured, analytical, and unknown provenance; do not invent missing metadata. Verify the full matrix, including reflection terms, rather than extracting only a convenient transmission curve.

At original sample points, compare converted complex values with an independent parsing/reference path. Interpolation must be explicit and tested; start with complex real/imaginary interpolation within the sampled frequency band, with warnings that between-sample behavior is interpolated. Do not interpolate across unsupported geometries, silently extrapolate, clip gain, force reciprocity, or renormalize data to look passive. Check passivity over the evaluated range and flag material violations.

Unknown phase or power normalization that prevents a meaningful coherent connection is a real ingestion blocker. Label such a candidate preview-only; continue the analytical work rather than fabricating a verified library item. Conversion correctness is not hardware validation.

Keep public and imported model versions stable. Opening a saved experiment must never silently replace its model with a newer upstream version. Include `THIRD_PARTY_NOTICES.md`; do not change the existing repository's license. Propose a compatible open-source license for newly authored code for maintainer approval before release, and inspect licenses before copying external implementation code.

## 6. Numerical contract for the new implementation

The following conventions are proposed for this fresh engine. Document them in code and fixtures. An alternative is acceptable only if implemented consistently and explicitly converted at every import/export boundary.

### State and units

Use complex, power-normalized modal amplitudes in `sqrt(W)`, with power `|a|²` or `|b|²` in watts. UI controls may display nm, µm, mW, radians/degrees, and dB/cm; convert once at the boundary into meters, watts, radians, and dB/m. Fix the time convention to `Re{E exp(+iωt)}`. Index scattering matrices as `S[outputPort][inputPort]`.

For all component ports:

```text
b = S a + s       component response and ideal-source injection
a = C b           connections, including their propagation factors
(I − S C) b = s   simultaneous network solve
```

`S` is block diagonal before connections are applied. Each connection links the two corresponding ports bidirectionally. Put waveguide propagation in `C` exactly once; do not also apply the same length inside adjacent components. An imported component includes its own internal propagation up to its declared reference planes.

A matched ideal source is a one-port block with `S = 0` and `s = sqrt(P) exp(iφ)`. Returned light is absorbed, not reflected or used to modify its emission. A matched detector has `S = 0`, no source term, and reads incident power. A nonloading probe observes existing amplitudes and is not a physical tap. Unconnected ports have zero incoming field, equivalent to ideal matched external boundaries; visibly state this, rather than implying a real open waveguide facet has zero reflection.

### Reference analytical blocks

For a waveguide with length `L`, power attenuation `α` in dB/m, and declared effective-index model:

```text
h(λ) = 10^(−αL/20) exp(−i 2π n_eff(λ)L/λ)
```

A constant effective index is acceptable initially when labeled nondispersive. Do not expose an independent group index while using an inconsistent phase model. A later first-order option may use `n_eff(λ) = n0 + (n0 − ng0)(λ − λ0)/λ0` within an explicit local band.

For the ideal coupler, use ordered ports `[L0, L1, R0, R1]`, power cross-coupling `K ∈ [0,1]`, `t = sqrt(1−K)`, and `q = i sqrt(K)`:

```text
S = [[0, 0, t, q],
     [0, 0, q, t],
     [t, q, 0, 0],
     [q, t, 0, 0]]
```

The reference phase shifter is a reflectionless reciprocal two-port with transmission `exp(−iφ)`. The attenuator uses `10^(−A_dB/20)`. Treat these as our declared reference models; do not claim they were calibrated to a particular process. S-parameter model composition is established practice; the specific conventions above are implementation choices. [R2, R3]

### Solver and diagnostics

Use double-precision complex arithmetic and a tested pivoted factorization/linear solve. Do not explicitly invert the matrix. A dense implementation is acceptable for small circuits; measure before pursuing sparse methods, GPU acceleration, or WebAssembly.

Separate input validation, model-domain checks, matrix assembly, solve diagnostics, and power accounting. A small residual verifies algebra, not component fidelity. Detect singular/near-singular cases with scale-aware diagnostics; do not quietly add damping or fabricate a result.

For ideal lossless components test `S†S = I`; for passive normalized blocks test that the largest singular value is at most one within the documented numerical tolerance. Individual column-power checks alone are insufficient for all coherent excitations. These tests are algebraic properties of the declared model, not proof of causality or fabrication accuracy.

Account for source output, external escape, absorption, propagation loss, detector absorption, and absorption of returning light at ideal sources. Internal circulating power is not additional generated power. Do not sum every internal port as an output-energy balance.

## 7. Architecture and saved documents

Recommended default: TypeScript with a small UI layer and SVG-based editing; Vite for static builds, Vitest for unit/model tests, and Playwright for browser journeys. Pin compatible versions and record the actual runtime used. These are tool choices, not a requirement to use a particular UI framework. [R7–R9]

Keep these modules independent:

```text
src/model/        circuit schema, registry, model evaluators, units
src/solver/       graph compilation, complex algebra, solve, diagnostics
src/editor/       commands, selection, layout, connection and hit testing
src/ui/           palette, inspector, numerical plots, accessible controls
src/workers/      simulation and sweep messages, cancellation
src/io/           document validation, persistence, model import/export
models/           redistributable data, manifests, notices
examples/         model-bearing editable circuit documents
scripts/          pinned conversions and independent reference fixtures
tests/            numerical, import, serialization, browser, performance
```

The solver must run headlessly without a DOM or rendering library. The editor must not derive physics by reading SVG geometry. Put nontrivial sweeps in a worker; use request IDs so stale results cannot overwrite a newer edit, and keep computations cancelable. Cache only with explicit topology, parameter, wavelength, and model-version keys.

### Document schema

Use a versioned JSON format. Preserve stable IDs; component model ID/version/parameters; connection endpoints and explicit propagation settings; source and sweep settings; probes; reusable module definitions; required model manifests/data; and an independent layout section. Specify types, units, ordering, and defaults in the schema. Reject unsupported schema versions rather than silently guessing.

Use local autosave with recoverable storage/quota errors, plus explicit JSON export/import. A portable document must include custom models or resolve them from exact bundled versions; a missing dependency is an error, not permission to substitute a generic component. Validate file size, matrix dimensions, finite numbers, nesting depth, and references before solving. Imported data is data, never executable JavaScript.

Export numerical plots as CSV with units, sweep settings, and model identity. Do not require URL-based sharing or a server for v1. Bundle runtime dependencies and starter data; normal interaction must make no mandatory third-party network calls. Full offline reload/PWA installation is optional and must not be claimed until tested.

## 8. Reusable modules and the later OpticalSetup bridge

Support “Save selection as module” for source-free subnetworks. Let users name boundary ports, reopen the internals, and instantiate the module more than once. Initially flatten the saved subgraph for solving; an externally reduced S-matrix is an optimization, not a prerequisite. Preserve the source definition and model dependencies rather than exporting only a raster drawing or frozen plot. Hierarchical circuit composition is also demonstrated in SAX. [R2]

Explicitly reject module selections with sources initially; source-containing networks need an affine response, not merely a passive S-matrix. Port probes can remain observational. Show internal loss/terminations when a module contains them.

Make the model/port schema bridge-ready, but do not implement a fictional OpticalSetup receiver. After the core playground works, propose a separate versioned handoff containing wavelengths, declared ports/modes, reference planes, normalization and phasor conventions, solved complex response or boundary amplitudes, model identity, and explicitly unknown spatial information. A configured phase knob is not the same thing as solved output phase.

PICSetup owns guided-network behavior. OpticalSetup owns its independent free-space and instrument implementation. Keep any coupling efficiency assumption visible. No arbitrary beam-to-chip alignment prediction, shared optical feedback solve, or live bidirectional synchronization is claimed by a file export. Receiver adoption needs a focused proposal and the other maintainer's review.

## 9. Milestones—deliver one working slice at a time

| Milestone | Deliverable | Exit condition |
| --- | --- | --- |
| M0 — Safe fresh workspace | Task branch, concise contracts, scoped scaffold, recorded provisional choices | Reproducible build and test commands; old application and deployment untouched. |
| M1 — Real editable interferometer | Blank canvas, source, two couplers, arms, phase control, detectors, live numbers, undo, save/reopen | Construct the MZI through ordinary editing, not just a hard-coded template; phase sweep and power accounting tests pass. |
| M2 — Spectral and feedback behavior | Explicit link lengths/loss, wavelength sweep, ring example, diagnostics and worker responsiveness | Ring/reference and wavelength-refinement tests pass; cancellation works. |
| M3 — Real open-data ingestion | Pinned conversion script, one eligible dataset, model metadata panel, native-format import | Complex sample agreement, attribution, range rejection, deterministic conversion and portable round trip. Report any blocked metadata honestly. |
| M4 — User-created modules | Save/open a source-free selection, instance parameters and nested document storage | Flattened/module results agree; instances are independent; unsupported recursion rejected. |
| M5 — Coherent public-ready candidate | Examples, help, notices, accessible controls, documented limitations and performance evidence | All claimed acceptance gates pass; no paid/runtime service dependency. Produce a reviewable build, not an automatic production replacement. |

Do M1 before broadening the palette. Seed examples should include an MZI, a lossy ring, and a small circuit using the checked external model. Add a reusable-module example after M4. The bridge is a separate later milestone, not a reason to delay these.

## 10. Acceptance tests with actual expected behavior

Use the conventions in section 6. For well-conditioned, unit-scale analytical fixtures, begin with approximately `1e−9` absolute complex/power agreement and normalized residual below `1e−10`; document any justified adjustment. These are numerical targets, not physical-model uncertainties or blanket guarantees near singularities.

| ID | Test | Required observation |
| --- | --- | --- |
| A1 | Ideal coupler at K = 0, 0.5, 1 | Correct routing; coherent superposition; symmetric and unitary matrix. |
| A2 | Waveguide length and loss | Phase matches the declared propagation factor; power ratio is `10^(−αL/10)`. |
| A3 | Two 50/50 couplers, matched MZI arms, one driven input | With the stated port ordering, outputs are `sin²(Δφ/2)` and `cos²(Δφ/2)` times input power; sum equals input for the lossless case. |
| A4 | Visual rearrangement | Move/rotate components and curve handles without changing physical parameters: netlist physics and complex results remain identical. |
| A5 | Phase shifter insertion | Zero-phase insertion that preserves total link length leaves the response unchanged. |
| A6 | Ring built from coupler and feedback path | Through response agrees with `H = (t − A)/(1 − tA)`, where `A = a_loop exp(−iθ)`. A lossless all-pass ring has unit through-power magnitude and varying phase; a notch requires suitable loss/coupling, not a fabricated dip. |
| A7 | Spectral resolution and failure cases | Refining a ring sweep converges on sampled features; singular or invalid networks return diagnostics, not plausible fabricated plots. |
| A8 | Open dataset | Original samples match independent complex values after explicit unit/port/phase conversion; unsupported band/geometry rejected; no silent data repair. |
| A9 | General power accounting | A lossy/reflected network balances sources, escaped power, absorption and line loss; internal circulation is not counted as generated output. |
| A10 | Module equivalence | Original, flattened, saved/reopened and multiply instantiated subcircuits agree; independent instances do not leak parameter changes. |
| A11 | Persistence and hostile input | Round trip preserves models and physics; malformed/oversized/nonfinite/unsupported documents fail safely without destroying the current scene. |
| A12 | Browser journey and compute isolation | Build from blank, edit, undo, sweep, cancel, save, reload and inspect warnings. Newer edits supersede stale worker results. No required third-party runtime calls. |

Use analytical derivations as an independent oracle and SAX/Simphony reference fixtures where practical. Record version and convention conversions. Tests that call the same flawed evaluator twice are not independent validation. Do not copy external expected results without describing how they were generated.

Measure named circuits on identified hardware/browser versions. A sub-100 ms update on a small circuit is an aspirational interaction target, not a current performance claim. Report cold/warm behavior and sweep responsiveness; do not advertise “thousands of components” without benchmarks. Run at least a Chromium browser journey and, where tooling permits, Firefox/WebKit checks; list skipped runs explicitly.

## 11. Definition of done and agent reporting

The full candidate is ready for owner review when M0–M5 and every applicable acceptance gate are evidenced. A smaller milestone is still valuable; report it accurately without calling the whole simulator complete.

Each handoff must contain: branch and pushed commit; implemented milestone(s); exact install/run/test/build commands; test counts and failures/skips; at least one real UI screenshot or browser trace; numerical reference evidence; model sources/notices; known limitations; and the next unfinished gate. The screenshot is evidence of the running application, not a generated mock-up.

Do not report deployment, receiver integration, physical calibration, open-data qualification, or performance testing merely because source code for those features exists. Do not replace missing results with prewritten charts.

**First action for the receiving agent:** inspect the target repository safely, establish M0 with this narrower brief, and build M1. End the first coding session with a working, tested slice or an honest partial result, committed and pushed—not another large feasibility report.

## References and evidence scope

External documentation was checked on 11 October 2026. These references support the component-model approach and tooling choices, not validation of the new app. Only the specific source/header/license inspections stated above were performed for this brief. Equations, UI decisions, milestones and test targets are this project's proposed design/derivations.

- **R1 — Existing repository safeguards and workflow:** https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/AGENTS.md ; https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/.github/workflows/pages.yml
- **R2 — SAX: S-parameter circuits and reusable circuit models:** https://gdsfactory.github.io/sax/
- **R3 — Simphony analytical models:** https://simphonyphotonics.readthedocs.io/en/latest/libs/ideal.html
- **R4 — Simphony SiEPIC models and supported geometries:** https://simphonyphotonics.readthedocs.io/en/latest/libs/siepic.html
- **R5 — Candidate component data:** https://github.com/BYUCamachoLab/simphony/blob/master/simphony/libraries/siepic/source_data/ebeam_dc_te1550/dc_gap=200nm_Lc=10um.sparam ; file blob identity recorded in section 5. Pin the containing repository revision during ingestion.
- **R6 — Upstream SiEPIC license:** https://github.com/SiEPIC/SiEPIC_EBeam_PDK/blob/master/LICENSE.md ; inspected license blob `e5d16d71c2ff1f40c393ef23a2e01cb850aa9a4d`.
- **R7 — Vite guide:** https://vite.dev/guide/
- **R8 — Vitest guide:** https://vitest.dev/guide/
- **R9 — Playwright guide:** https://playwright.dev/docs/intro

Earlier context, optional rather than required reading: `docs/feasibility-study-2026-10-09.md` and `docs/s-parameter-libraries-and-openlight-2026-10-09.md` on the repository's `docs/feasibility-study-2026-10-09` branch. This brief is self-contained and replaces their broader product framing for this rebuild.
