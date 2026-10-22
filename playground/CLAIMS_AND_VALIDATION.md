# Claims and validation — playground only

This iteration adds an **idea workbench** to the verified M0/M1 and early SiEPIC experiments: strict named-port recipes, a headless API/CLI, six starters, four source-free circuit templates, automatic arrangement, immutable variant notebooks with spectral overlays, and bounded one-parameter design goals. It does not close all M2–M5 requirements or claim full milestone completion.

The 22 October IQ starter adds a static, ideal, single-channel nested-MZI
composition using existing primitives. Independent algebra checks complex
fields and complete output accounting. The [assessment](docs/INFINERA_PIC_MAP.md)
separates this supported behavior from active laser/SOA, polarization, RF,
receiver-DSP and chip-image mapping extensions. Validation details are in the
latest section of [HANDOFF.md](HANDOFF.md).

The supported scientific claim is numerical evaluation of the declared scalar-mode CW equations and the bundled table under documented interpolation. Recipe/block expansion preserves explicit primitive models and physical parameters; automatic arrangement changes drawing coordinates only. Physical mode matching, reference-plane coordinates, process variation and measured accuracy remain unqualified. Native SiEPIC **TE mode 1** is a source mode identifier, not an asserted transverse-order TE1 mode. No calibrated-device, fabrication, passive-network certification, production deployment, offline reload or external receiver integration is claimed.

Comparison notebooks retain exact independent assumptions; their normalized curves are divided by each variant's actual emitted source power, with unavailable results left unavailable. Goal search reports the best of 2–201 sampled candidates and whether it lies on a declared bound. It does not establish continuous/global optimality, manufacturing tolerance or adaptive resonance resolution. Applying a result is a separate undoable scene edit. Recipes and the browser bridge provide structured authoring, not natural-language interpretation or an autonomous AI design service.

SiPANN and SAX runtime integrations, arbitrary custom-model imports, user-defined nested modules and persisted hierarchy remain open. The four implemented templates expand into ordinary primitives. Firefox/WebKit, accessibility and performance qualification remain open.

## Review-response scope

The new controlled dispersion study reports explicit sampled IL/XT targets for both outputs, actual circuit differences, source status and declared phase offsets. An imported TE guide coefficient model is audited against exact upstream bytes/equation and independent high-precision references. Its 1500–1600 nm application window is not a source-qualified fit band. No mode/reference-plane qualification follows from shared provenance.

Goals retain the original result and reject numerical-quality failures before choosing a recommendation. A coarse grid cannot displace a better baseline. The ring lab resolves one known-model ideal single-bus notch using a physical seed and sampled convergence checks; it does not guarantee discovery in arbitrary circuits. Extinction reporting thresholds are display policies, not accuracy bounds.

Final implementation `f51433e43a9d982e9d954e49b138ffc12a83c3f8` passed **268 tests in 16 files**, TypeScript/static/API builds, the independent coefficient/equation check, distributed CLI replay/notices checks, and **eight real Chromium journeys**, with zero failures or skips. [Validation run](https://github.com/bertona88/picsetup/actions/runs/38143314798); [static/API build and evidence](https://github.com/bertona88/picsetup/actions/runs/38143314798/artifacts/11703861693) (artifact retention applies). The [validation record](evidence/review-response-validation.json) and [handoff](HANDOFF.md) preserve screenshots and the precise accepted scope.

## Historical workbench evidence

Final implementation `af4db0a84e5ff228035c5ae4c7cb37611990c6b3` passed **206 tests in 11 files**, TypeScript/static/API builds, distributed API/CLI packaging checks and **five real Chromium journeys**, with zero failures/skips. [Run](https://github.com/bertona88/picsetup/actions/runs/38139054935) and [review artifact](https://github.com/bertona88/picsetup/actions/runs/38139054935/artifacts/11702228545) include fresh Sketch, Compare and Tune screenshots. All three were visually inspected, with browser assertions for dialog bounds. [HANDOFF.md](HANDOFF.md) preserves the first integrated checkpoint and exact evidence links.

- Recipe validation rejects unsupported schemas/models/versions, ambiguous or occupied ports, malformed parameters, nonfinite values and oversized expansion. Imported model version and fixed geometry remain exact.
- Separate manually wired SiEPIC MZI fixtures match recipe-expanded complex detector fields and complete budgets across three phases and five wavelengths. Part ordering and reversed storage of reciprocal links preserve results through JSON.
- Source-free block tests verify exposed-port occupancy, repeated-instance independence, MZI flattening equivalence, ring closed forms, splitter power/loss and reciprocal delay phase/loss. Arrangement preserves complete semantic state and complex fields, including feedback/disconnected topology.
- Notebook tests check immutable capture/fork, exact round trips, per-variant normalization, invalid-model gaps, cancellation and stale-worker isolation. Goal tests check the known MZI sinusoid, length/coupling searches, boundary hits, malformed domains, unsupported-band failures and superseded runs.
- New Chromium journeys verify recipe construction, editable block insertion, A/B/C overlay and CSV, notebook export/reopen/autosave, exact snapshot restore, and applying/undoing a bounded phase search. The earlier three editor/dataset/spectrum journeys remain in the same run.
- Packaging checks run the distributed Node CLI with file/stdin commands for catalog, compile, solve, sweep and compare, reject unknown commands and check bundled notices. Goal command dispatch is also covered by unit tests and the local CLI verification.

## Retained dataset evidence

- Exact source provenance: the SiEPIC/Simphony raw blob, both MIT notices, pinned revisions, checksums and primary convention references are committed with [the dataset](models/siepic-dc-200nm-10um/manifest.json).
- `python scripts/convert_siepic.py --check` passed. Conversion preserves all 1,616 complex values after the declared phasor conjugation.
- `python scripts/verify_siepic.py --check` passed using an independent regex/NumPy parser. Complete raw matrices match canonical values with maximum observed absolute error 0. NumPy SVD records `σmax` from 0.9852978180 to 1.0022352696, including 17/101 slight passivity violations; reciprocity is exact at source precision.
- `python scripts/verify_siepic_mzi.py` passed. A separate reduced eight-port incident-wave NumPy solve produces complex detector fields and complete budgets at 1500, 1525, 1550, 1575 and 1600 nm for the 80/100 µm SiEPIC MZI. Maximum reference equation residual is `7.67e−18`; maximum budget imbalance is `4.34e−19 W`. This is an independent numerical oracle, not physical ground truth.
- Source interpolation is explicitly audited: at 1550 nm Cartesian interpolation yields approximately 0.9716 total output fraction, while weighted neighboring sample powers are approximately 0.9837416. The difference is an interpolation effect. No clipping, passivity correction or artificial damping hides it.

Historical dataset implementation `9e10b2063d8747c423ad2eee088ec9e272ae5484` passed 125 unit/model/editor tests in five files, TypeScript/Vite build and three real Chromium journeys with zero failures/skips. The browser checks include imported-model spectra/CSV/reopen, model swaps, invalid-band gaps, cancellation/stale requests and plot clipping. [Run](https://github.com/bertona88/picsetup/actions/runs/38136961539) and its screenshot/metadata are retained in [HANDOFF.md](HANDOFF.md). The numerical fixture tests compare all complex imported MZI detector fields and budgets at five wavelengths.

## Historical baseline

M0/M1 was verified with 87 numerical/editor tests and one passing real Chromium construction/save/reopen journey. See the historical section of [HANDOFF.md](HANDOFF.md). Analytical oracles cover complete complex matrices, MZI phase/power, line propagation, conservation and ring closed forms. Ring solver fixtures alone do not establish a complete interactive ring milestone.

Every milestone requires its own evidence. A successful build establishes neither browser behavior nor scientific fidelity; a source conversion check establishes neither calibrated device performance nor the correctness of every composed circuit.
