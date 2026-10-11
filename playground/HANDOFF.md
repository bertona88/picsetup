# Idea workbench — 11 October 2026

Branch: `rebuild/playground-m1`. This iteration turns the M0/M1 and early SiEPIC experiments into a sketch → change → compare workflow. It is not full M0–M5 milestone completion. No production replacement was made.

## Review-response implementation

The four [independent reviews](docs/reviews/2026-10-11/README.md) now have concrete responses: pinned dispersive guides with an independent source/equation audit; an A/B/C MZI study with two output metrics, editable targets, sample markers, diagnostics and explicit phase scenarios; baseline-aware goals that exclude numerical artifacts; retained recipe source with current/stale checks; complete notebook bridge/replay; and a known-model ring refinement lab. The new waveguide licenses and manifest ship in both distributions.

At nominal phase, the shipped study gives sampled worst IL/XT of A **0.607/−11.289 dB**, B **1.209/−6.298 dB**, C **0.524/−12.673 dB**. Targets are IL ≤1.5 dB and XT ≤−8 dB over 1545–1555 nm, 101 points. A and C also pass the two assumed ±0.08 rad scenarios; B fails them. These are declared-model results, not calibrated hardware performance.

The default ring's broad 101-point scan has minimum transmission about 0.99899. Local refinement resolves the modeled notch at **1550.05 nm**, half-depth linewidth **3.1848 pm**, Q about **486,703**, in **209 evaluations**. Extinction below the display cutoff is withheld; 120 dB is not an accuracy claim. A focused follow-up numerical review accepted the scoped algorithm and requested this explicit reporting-cutoff wording.

Final implementation `f51433e43a9d982e9d954e49b138ffc12a83c3f8` passed **268 tests in 16 files**, TypeScript/static/API builds, the independent coefficient/equation check, distributed CLI replay/notices checks, and **eight real Chromium journeys**, with zero failures or skips. [Validation run](https://github.com/bertona88/picsetup/actions/runs/38143314798); [static/API build and evidence](https://github.com/bertona88/picsetup/actions/runs/38143314798/artifacts/11703861693) (artifact retention applies).

Fresh screenshots: [design study](evidence/study-chromium.png), [resolved ring](evidence/resolved-ring-chromium.png), [excluded goal candidates](evidence/trust-goal-chromium.png). All were visually inspected. The study verifies 909 scenario/wavelength rows, exact notebook handoff and JSON/CSV replay; the ring verifies budget-limited unresolved state then resolution and exact canvas load; the goals reject both a worse coarse-grid result and all 201 numerical-artifact candidates. No page errors or external runtime requests occurred in the three new journeys. Browser metadata and [validation record](evidence/review-response-validation.json) identify the exact commit.

The six-agent implementation and focused follow-up numerical review are summarized in [the review response](docs/reviews/2026-10-11/response.md). Start with **Design study** or **Resolve ring** from the toolbar. The previous five browser journeys remain passing.

## Current implementation

- **Sketch from data:** strict `picsetup-recipe/1` JSON names components, source-free blocks and exposed ports in SI units. Compilation expands blocks, validates the complete flat scene and arranges the drawing atomically. The five starters are imported MZI, ideal MZI, ring, 1 × 4 splitter and delay line. The sketch panel also offers a 10/20/30 µm arm-difference study.
- **Reusable structures:** MZI, single-bus ring, splitter tree and delay line insert as independently editable primitives. They add no source or hidden solver state. Supported coupler-based blocks can use the fixed SiEPIC dataset. Automatic arrangement preserves all physical parameters and complex results.
- **Headless authoring:** the bundled ESM API, JSON CLI and `window.picsetup` browser bridge expose named-port construction, catalog queries and numerical experiments. The catalog declares defaults, units, parameter bounds, wavelength band, source mode labels and provenance. [API documentation and examples](docs/API.md) describe the exact schemas. Recipe text is data, never executed code; no natural-language AI service is implemented.
- **Comparison notebook:** capture, fork, rename, restore or remove up to six immutable circuit variants; choose a detector per variant; run a shared wavelength sweep and overlay normalized powers. Saved notebook JSON retains each exact document and sampling settings; CSV retains all detector rows, raw powers, diagnostics and provenance. Notebook autosave/reopen recomputes curves from saved assumptions.
- **Bounded design goals:** sample one phase-shifter phase, ideal-coupler ratio or physical link length at a chosen wavelength to minimize/maximize a detector output. Searches use 2–201 candidates, retain failures, report boundary hits, support cancellation and produce a separate best document. Applying that candidate is explicit and undoable. This is finite sampling, not guaranteed continuous/global optimization.
- Bundled real SiEPIC directional-coupler data: fixed 200 nm gap, 10 µm coupling length, TE mode 1; all sixteen complex S entries at 101 frequency samples, including reflection and back-coupling.
- New `siepic-coupler` component version `1` permanently references dataset `siepic-dc-200nm-10um` version `1.0.0` and its exact source hash. It can be placed, wired and saved with the analytical parts.
- Three experiments: single-coupler spectrum; SiEPIC MZI; ideal MZI. Both unequal-arm MZIs use explicit 80/100 µm arms and a controllable phase shifter. The previous balanced MZI remains available.
- Spectral explorer: 2–1001 uniform wavelength samples in a worker; progress, matching-request cancellation, superseded-job isolation, stale-response filtering, invalid-sample gaps and full-precision CSV with provenance, SI circuit state, diagnostics and power budgets. Selecting the spectrum changes the current wavelength.
- Power accounting separates imported component absorption from apparent model-supplied power. Passivity violations and the experimental status stay visible; no values are clipped to make the result passive.
- Structurally valid scenes with out-of-band wavelengths remain importable/exportable and editable. The solver reports failure with unavailable powers until the wavelength is repaired; it never extrapolates.

Existing editing supports palette placement, port connections, move/rotate, independent curve geometry, pan/zoom, duplicate/delete, undo/redo, explicit phase/wavelength/length/index/loss controls, detector powers/phases, JSON export/import and recoverable local autosave. Drawn geometry remains independent of physical path length. The original three spectral experiments remain available alongside the new sketch starters.

## Final workbench evidence

Implementation `af4db0a84e5ff228035c5ae4c7cb37611990c6b3` passed **206 tests in 11 files**, TypeScript/static/API builds, the distributed CLI packaging check, deterministic dataset conversion and **five Chromium journeys**, with zero failures or skips. [Validation run](https://github.com/bertona88/picsetup/actions/runs/38139054935); [review build and evidence](https://github.com/bertona88/picsetup/actions/runs/38139054935/artifacts/11702228545) (artifact retention applies). The artifact includes `dist/` and `dist-api/`.

Fresh screenshots show [Sketch](evidence/sketch-chromium.png), [Compare](evidence/workbench-chromium.png) and [Tune](evidence/goal-chromium.png). All three were visually inspected; the dialogs, plot axes, readouts and action controls are visible without clipping at 1440 × 1000. The browser also asserts the new dialog bounds. [Browser metadata](evidence/workbench-browser-run.json) and [validation metadata](evidence/workbench-validation.json) record the tested commit, runtime and scope.

The comparison captures three phase variants across 101 wavelengths from 1500–1600 nm and exports 606 full-precision detector rows. No page errors or external runtime requests were observed in that journey. The goal journey samples 21 phases, selects the zero-power boundary candidate in the ideal MZI, applies it and verifies undo. CI used Node 24.21.0, npm 11.19.0, Ubuntu 24.04 and Chromium 141.0.7390.37.

Start with **Sketch → Compare three arm lengths** for a ready-to-run SiEPIC study, or edit a recipe and choose **Build this idea**. The command-line equivalent is documented in [API.md](docs/API.md).

## First integrated workbench checkpoint

Implementation `c8825aa46557d1010fa516e51537a7ad602fb40d` passed **206 tests in 11 files**, the TypeScript/static/API builds, distributed API/CLI packaging checks and **five real Chromium journeys**, with zero failures or skips. [Validation run](https://github.com/bertona88/picsetup/actions/runs/38138574207); [review artifact](https://github.com/bertona88/picsetup/actions/runs/38138574207/artifacts/11701333137) (artifact retention applies).

The new journeys build a SiEPIC MZI from a recipe, edit an inserted source-free block, verify arrangement leaves physics unchanged, capture three phase variants, compare/export/reopen their exact notebook and apply/undo a bounded phase-search result. Independent numerical tests compare recipe-expanded circuits with separately wired fixtures; block tests cover MZI, ring, splitter and delay-line responses. The distributed CLI check executes the built Node entry point rather than importing TypeScript test code.

The final evidence pass above adds dedicated Sketch and Goal screenshots. The earlier dataset and M1 evidence below remains historical and is not relabeled as verification of new controls.

## Data provenance and limitations

Raw Simphony revision: `5a5e826fb58b2b5ce0355189b3e3b33e2bd8828c`. Direct upstream SiEPIC revision: `363fbb52eefa8669100499ab531d3fe7befc4867`. Both contain identical source blob `2b56aff1c525be81eb1ea374f9e0107cdb59e356`, SHA-256 `945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371`. Exact bytes, MIT notices and primary convention references are bundled in [the manifest and audit](models/siepic-dc-200nm-10um/README.md).

Source S parameters use the documented Ansys `exp(−iωt)` convention; conversion conjugates them once to the playground's `exp(+iωt)`. Native source port planes are preserved, but their spatial coordinates and de-embedding are unknown. Added guide lengths refer to abstract source boundaries. Physical modal matching, process corner, temperature and uncertainty are unqualified.

Only the original approximately 1500–1600 nm band is supported. Frequency-domain Cartesian interpolation is explicit, with no extrapolation. It can introduce apparent attenuation between rotating complex samples: at 1550 nm, interpolated single-port total output is approximately 0.9716 versus 0.9837416 for weighted neighboring sampled powers. That difference is interpolation error, not measured extra loss.

Raw full-matrix `σmax` ranges from 0.9852978180 to 1.0022352696; 17/101 points slightly violate passivity. Runtime uses a checked exact-symmetry Hadamard norm for this fixed matrix family. Original apparent gain remains in the circuit solve and budgets. No calibrated-device, passive-certified-network or fabrication claim is made. These comparisons evaluate declared models, not physical ground truth.

## Reproduce

From `playground/`, with Node.js 24:

```sh
npm ci
npm run dev
npm test
npm run build
node scripts/check-api.mjs
node dist-api/cli.mjs examples/commands/solve-mzi.json
npx playwright install chromium
npm run test:browser
```

Development opens at http://localhost:4175. Static output is `dist/`; `npm run preview` serves it. The same build produces `dist-api/api.mjs` and `dist-api/cli.mjs` with bundled notices. Additional catalog, spectrum, comparison and goal commands are in `examples/commands/`. Linux browser dependencies may require `npx playwright install --with-deps chromium` when system installation is allowed. The GitHub Actions validation workflow uploads review artifacts without deploying production.

From the repository root:

```sh
python scripts/convert_siepic.py --check
python scripts/verify_siepic.py --check
python scripts/verify_siepic_mzi.py
python scripts/verify_siepic_waveguide.py --check
```

The converter is standard-library-only. Independent verification needs NumPy. `--write` on either verification script regenerates its report/fixture.

## Historical SiEPIC data and spectral evidence

The Python conversion and independent verification commands passed. All 1,616 canonical complex values match an independent raw parser with observed maximum absolute error 0. Full SVD and reciprocity audit are in [verification.json](models/siepic-dc-200nm-10um/verification.json).

The independent eight-port incident-wave NumPy MZI oracle at five wavelengths has maximum equation residual `7.67e−18` and maximum power-budget imbalance `4.34e−19 W`. Full complex detector fields, component exchanges and budgets are in [mzi-reference.json](models/siepic-dc-200nm-10um/mzi-reference.json). It parses original source data independently and does not execute the production TypeScript solver.

Implementation checkpoint `9e10b2063d8747c423ad2eee088ec9e272ae5484` passed **125 unit/model/editor tests in 5 files**, TypeScript/Vite build, deterministic data conversion and **3 real Chromium journeys**, with zero failures or skips. [Validation run](https://github.com/bertona88/picsetup/actions/runs/38136961539); [static review build](https://github.com/bertona88/picsetup/actions/runs/38136961539/artifacts/11701920467) (artifact retention applies). CI: Node 24.21.0, npm 11.19.0, Ubuntu 24.04, Chromium 141.0.7390.37.

The browser journeys cover blank-canvas MZI construction; imported MZI spectra, CSV and exact model swaps; JSON reopen and autosave; unsupported wavelengths with unavailable powers; cancellation and stale-result isolation. New [screenshot](evidence/library-experiments-chromium.png) and [browser metadata](evidence/library-browser-run.json) were captured from that tested commit. The 201-point imported MZI sweep spans 1500–1600 nm; its first detector spans approximately 0.11705–0.95464 mW for 1 mW input. No page errors or mandatory external requests were observed. [Validation metadata](evidence/library-validation.json) records the check counts and scope.

Visual inspection caught the chart growing beyond its drawer. The fixed layout and a browser regression assertion now keep its zero axis, wavelength labels and status visible. Bundled source license notices are included in the static build. Historical `evidence/mzi-chromium.png` and `evidence/browser-run.json` remain the previous M1 record.

## Historical M1 evidence

Implementation checkpoint `0ddecde64e030d93f4bb854ab6dcca2157d5d722`; previous delivery checkpoint `810f537`. The historical local run passed 87 unit/model/editor tests and the TypeScript/Vite build. A real Chromium journey passed with no failures/skips, Chromium 141.0.7390.37 on Ubuntu 24.04 GitHub runner, Node 24.21.0 and npm 11.19.0. It built topology, checked phase 0/π/π/2 outputs, undo/redo, layout invariance, JSON save/reopen and invalid imports, with no page errors or required third-party requests. At π/2 and 1 mW launch, both detector outputs were 0.5000000000000001 mW.

Historical [screenshot](evidence/mzi-chromium.png), [browser metadata](evidence/browser-run.json), [validation run](https://github.com/bertona88/picsetup/actions/runs/38134741263), and [review artifact](https://github.com/bertona88/picsetup/actions/runs/38134741263/artifacts/11700088432) are preserved; artifact retention applies.

Analytical oracles include MZI complex fields `e(t2*t1*hu − sqrt(K2*K1)*hl)` and `i*e(sqrt(K2)*t1*hu + t2*sqrt(K1)*hl)`, equal-coupler reductions, and ring formula `(t−A)/(1−tA)`. Ring solver fixtures do not establish a complete interactive ring milestone.

## Remaining boundaries

M2 is not fully complete: the known-model ring lab adds a dedicated refinement workflow; general adaptive resonance discovery and broader spectral acceptance remain open. Uniform wavelength grids may miss narrow resonances. M3 is not complete: this includes a pinned coupler table and guide coefficient model, not general custom-model import or broad qualified libraries. SiPANN and SAX integrations remain unimplemented. Four reusable source-free templates are implemented; arbitrary user-defined nested modules, persisted hierarchy and general module-interface equivalence remain deferred. M5 cross-browser/accessibility/performance qualification remains open. No throughput or offline-reload claim. Probe and external-bridge work remains deferred.

Dense solver caps remain 100 components, 256 optical ports and 128 links per expanded circuit; document/recipe JSON is capped at 1 MiB. Notebooks hold at most six variants, with a bounded approximately 6 MiB import; the CLI streams at most 7 MiB per command envelope. No production deployment, DNS change, live OpticalSetup bridge or modification of the legacy applications is part of this iteration. Source licenses are preserved; no repository-wide license was selected. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Historical preserved tree identities: `prototype/` is `4d72604f67ffea9a7a7bc6b675d8b5e83306d8b5`, `app/` is `7266a6656f54c4e72d723bace45820a42d4a5f23`. The task branch preserves changes without replacing production on `main`.
