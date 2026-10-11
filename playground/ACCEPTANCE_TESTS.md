# Acceptance tests — idea workbench and retained numerical baselines

From `playground/`: `npm ci`, `npm test`, `npm run build`, `node scripts/check-api.mjs`, `npm run test:browser`. Development: `npm run dev -- --host 0.0.0.0`. The build generates both the static application and distributed Node API/CLI. From the repository root, reproduce source/reference evidence with `python scripts/convert_siepic.py --check`, `python scripts/verify_siepic.py --check` and `python scripts/verify_siepic_mzi.py` (NumPy required for the latter two).

## Review-response gates

- Independently check pinned waveguide hashes, equation, complex propagation, delay and MZI fringe roots; reject unknown model versions, mismatched reference index and out-of-window evaluation.
- Prevent a coarse sampled goal from replacing a better baseline; reject the reproduced power-imbalance winner while preserving raw values and diagnostics.
- Verify current/stale source by recompilation, including forged records, layout-only changes and JSON replay.
- Check explicit desired/unwanted mappings, IL/XT, exact-zero states, complete eligible-grid decisions, bounded phase scenarios and semantic diffs against independent numerical oracles.
- Resolve both reviewed known-model rings against independent complex transfer/half-depth references; withhold metrics on inadequate budget/quality and keep extinction cutoff language separate from accuracy.
- In Chromium, launch the shipped A/B/C study, inspect targets/differences, export/reload and reproduce metrics; test rejected goals; run unresolved→resolved ring and load its exact circuit. Capture fresh screenshots and metadata.

## Idea workbench gates

- **Named-port recipes:** exact versioned data schema, explicit SI/defaults, unique safe IDs, exposed ports, single connection per port and deterministic block namespaces. Reject unknown keys/models/versions, expressions, nonfinite values, invalid domains, ambiguous endpoints and over-cap expansion before replacing a scene. Preserve editable out-of-band documents and exact bundled dataset identity.
- **Compilation references:** compare full complex detector fields and all budget terms against an independently wired SiEPIC MZI at multiple phases/wavelengths. Reverse reciprocal link notation and reorder parts without changing physics. Compile and solve every starter.
- **Source-free templates:** MZI, ring, splitter tree and delay line expose actual free native ports; insertion adds no source. Check MZI flattening equivalence, ring closed forms, splitter losses and reciprocal delay phase/loss. Repeated instances remain independent, editable and portable without hidden nested state.
- **Arrangement:** preserve the entire circuit and complex solution, leave input snapshots unchanged, and handle reordered, disconnected and feedback topology. Pixel coordinates never infer link lengths.
- **Catalog/API/CLI:** report mode labels, domain, parameters/defaults/units, provenance and limitations. Query by mode/band/kind. Execute built Node ESM/CLI commands via file and stdin, reject unsupported command envelopes, enforce input bounds and ship source notices with both distributions.
- **Immutable notebooks:** retain exact variant documents, names, selected detectors and shared sweep settings through capture/fork/export/reopen. Reject malformed/over-cap notebooks. Normalize with each variant's actual source power; preserve invalid samples as gaps. Test cancellation, supersession and frozen in-flight inputs.
- **Comparison CSV:** export all detector rows with exact SI wavelengths, raw powers, per-variant identities, circuit replay state and dataset provenance. Reopened notebooks must reproduce the same numerical rows.
- **Bounded goals:** agree with the known ideal-MZI phase response and sample declared phase/coupling/length domains, including endpoints. Report boundary hits and failed candidates; retain immutable inputs and a separate best document. Reject unsupported targets and excess work, and isolate cancelled/stale requests. Never claim continuous/global convergence.
- **Browser workflow:** insert/edit a source-free block; compile a recipe atomically; arrange without changing physics; capture three independent variants; run/export/reopen their overlay; restore an exact snapshot. Run a goal through the browser bridge/UI, apply the best candidate and undo to the prior scene. Capture evidence of the visible workbench controls.

## Retained M1 gates

- Ideal coupler routing, symmetry and complete unitarity at K=0, 0.5 and 1; independently calculated line phase/loss.
- MZI powers, complex phases, arbitrary coupler ratios and unequal arms against independent algebraic formulas; source return, matched-boundary and loss accounting.
- Layout changes preserve complex results; explicitly wired zero-phase insertion preserves length/results.
- Portable round trips and malformed, nonfinite, oversized or unsupported imports preserve the prior scene.
- Real Chromium construction from blank, parameter edits, undo/redo, save/reopen and warnings without third-party runtime requests.

## Early dataset and spectral gates

- **Provenance and conversion:** verify exact raw source hash and complete 16×101 coefficient conversion against an independent parser. Preserve source bytes, licenses and unknown physical metadata.
- **Evaluation:** match every source grid sample and independently calculated frequency-interpolated matrices. Exercise exact band endpoints, just-outside rejection, nonfinite wavelengths, matrix orientation and phasor sign. No gain clipping or reciprocity fabrication.
- **Repairable scenes:** supported-model documents with finite out-of-band wavelengths round-trip intact; solving them returns explicit unavailable results, and editing wavelength back into band restores a valid solve. Unsupported model identities still fail document validation.
- **Passivity:** compare the fixed-dataset Hadamard norm with independent complete-matrix NumPy SVD, including all 17 source violations. Require exact symmetry before using the specialized norm.
- **Composition:** compare full complex detector fields and power budgets of the 80/100 µm imported MZI against the independent NumPy oracle across five wavelengths. Include reflected source power, escaped power, component absorption and model-supplied apparent gain. No physical ground-truth claim follows.
- **Sweeps:** validate finite increasing ranges and 2–1001 sample limits; preserve exact endpoints. Verify direct-solve agreement, chunked progress, cancellation, superseded jobs and stale-response rejection. Invalid samples remain unavailable rather than zero.
- **CSV:** verify units, circuit replay state, exact dataset identity, request/sample counts, diagnostics, full-precision powers, explicit model-supplied power and blank unavailable measurements.
- **Browser:** exercise the coupler/SiEPIC MZI/ideal MZI experiments, spectral interaction, model controls, cancel/restart, stale-result invalidation, invalid ranges, CSV export and dataset JSON save/reopen. Capture fresh screenshots and browser/commit metadata.

## Observed evidence

Final workbench checkpoint `af4db0a84e5ff228035c5ae4c7cb37611990c6b3` passed **206 tests in 11 files**, the TypeScript/static/API builds, distributed API/CLI packaging check and **five Chromium journeys** with zero failures/skips. [Run](https://github.com/bertona88/picsetup/actions/runs/38139054935) and [review artifact](https://github.com/bertona88/picsetup/actions/runs/38139054935/artifacts/11702228545) establish the integrated workflow and include dedicated Sketch, Compare and Tune screenshots. Visual inspection and browser dialog-bound assertions passed. Exact evidence and the first integrated checkpoint are recorded in [HANDOFF.md](HANDOFF.md).

The three Python conversion/reference commands passed in the retained dataset evidence. Historical implementation `9e10b2063d8747c423ad2eee088ec9e272ae5484` passed 125 unit/model/editor tests in five files, TypeScript/Vite build and three Chromium journeys with zero failures/skips. [Run](https://github.com/bertona88/picsetup/actions/runs/38136961539) verified dataset/spectral controls, CSV, model swaps, portability, unsupported wavelength failures, cancellation and stale state; screenshot bounds checks covered the zero axis, wavelength labels and status. Environment and historical evidence links are retained in the handoff.

Historical M1: 87 unit/model/editor tests and one Chromium journey passed at implementation commit `0ddecde64e030d93f4bb854ab6dcca2157d5d722`, with no failures/skips. Historical links are retained in the handoff.

Full M2–M5 gates remain open: general adaptive resonance discovery, broader external-library metadata qualification/import, arbitrary nested-module interfaces/equivalence, cross-browser/accessibility and performance evidence. A ring starter and four flat source-free templates are implemented and tested; those do not close the broader milestones. Preserve `app/`, `prototype/` and production Pages configuration. This workbench iteration does not perform a production replacement.
