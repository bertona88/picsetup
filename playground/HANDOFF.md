# SiEPIC experiments — 11 October 2026

Branch: `rebuild/playground-m1`. This iteration extends the fresh M0/M1 workbench with early M2/M3 experiments; it is not full milestone completion. No production replacement was made.

## Current implementation

- Bundled real SiEPIC directional-coupler data: fixed 200 nm gap, 10 µm coupling length, TE mode 1; all sixteen complex S entries at 101 frequency samples, including reflection and back-coupling.
- New `siepic-coupler` component version `1` permanently references dataset `siepic-dc-200nm-10um` version `1.0.0` and its exact source hash. It can be placed, wired and saved with the analytical parts.
- Three experiments: single-coupler spectrum; SiEPIC MZI; ideal MZI. Both unequal-arm MZIs use explicit 80/100 µm arms and a controllable phase shifter. The previous balanced MZI remains available.
- Spectral explorer: 2–1001 uniform wavelength samples in a worker; progress, matching-request cancellation, superseded-job isolation, stale-response filtering, invalid-sample gaps and full-precision CSV with provenance, SI circuit state, diagnostics and power budgets. Selecting the spectrum changes the current wavelength.
- Power accounting separates imported component absorption from apparent model-supplied power. Passivity violations and the experimental status stay visible; no values are clipped to make the result passive.
- Structurally valid scenes with out-of-band wavelengths remain importable/exportable and editable. The solver reports failure with unavailable powers until the wavelength is repaired; it never extrapolates.

Existing editing supports palette placement, port connections, move/rotate, independent curve geometry, pan/zoom, duplicate/delete, undo/redo, explicit phase/wavelength/length/index/loss controls, detector powers/phases, JSON export/import and recoverable local autosave. Drawn geometry remains independent of physical path length.

## Data provenance and limitations

Raw Simphony revision: `5a5e826fb58b2b5ce0355189b3e3b33e2bd8828c`. Direct upstream SiEPIC revision: `363fbb52eefa8669100499ab531d3fe7befc4867`. Both contain identical source blob `2b56aff1c525be81eb1ea374f9e0107cdb59e356`, SHA-256 `945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371`. Exact bytes, MIT notices and primary convention references are bundled in [the manifest and audit](models/siepic-dc-200nm-10um/README.md).

Source S parameters use the documented Ansys `exp(−iωt)` convention; conversion conjugates them once to the playground's `exp(+iωt)`. Native source port planes are preserved, but their spatial coordinates and de-embedding are unknown. Added guide lengths refer to abstract source boundaries. Physical modal matching, process corner, temperature and uncertainty are unqualified.

Only the original approximately 1500–1600 nm band is supported. Frequency-domain Cartesian interpolation is explicit, with no extrapolation. It can introduce apparent attenuation between rotating complex samples: at 1550 nm, interpolated single-port total output is approximately 0.9716 versus 0.9834 for weighted neighboring sampled powers. That difference is interpolation error, not measured extra loss.

Raw full-matrix `σmax` ranges from 0.9852978180 to 1.0022352696; 17/101 points slightly violate passivity. Runtime uses a checked exact-symmetry Hadamard norm for this fixed matrix family. Original apparent gain remains in the circuit solve and budgets. No calibrated-device, passive-certified-network or fabrication claim is made. These comparisons evaluate declared models, not physical ground truth.

## Reproduce

From `playground/`, with Node.js 24:

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Development opens at http://localhost:4175. Static output is `dist/`; `npm run preview` serves it. Linux browser dependencies may require `npx playwright install --with-deps chromium` when system installation is allowed. The GitHub Actions validation workflow uploads review artifacts without deploying production.

From the repository root:

```sh
python scripts/convert_siepic.py --check
python scripts/verify_siepic.py --check
python scripts/verify_siepic_mzi.py
```

The converter is standard-library-only. Independent verification needs NumPy. `--write` on either verification script regenerates its report/fixture.

## Fresh evidence

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

M2 is not complete: the interactive ring journey and full intended spectral acceptance remain open. M3 is not complete: this is one pinned dataset, not general custom-model import or broad qualified libraries. SiPANN and SAX integrations remain unimplemented. M4 reusable modules and M5 cross-browser/accessibility/performance qualification remain open. No throughput or offline-reload claim. Probe/module/external-bridge work remains deferred.

Dense solver caps remain 100 components, 256 optical ports and 128 links; JSON import limit is 1 MiB. No production deployment, DNS change, live OpticalSetup bridge or modification of the legacy applications is part of this iteration. Source licenses are preserved; no repository-wide license was selected. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Historical preserved tree identities: `prototype/` is `4d72604f67ffea9a7a7bc6b675d8b5e83306d8b5`, `app/` is `7266a6656f54c4e72d723bace45820a42d4a5f23`. The task branch preserves changes without replacing production on `main`.
