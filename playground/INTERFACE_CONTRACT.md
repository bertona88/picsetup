# Interface contract — playground only

Versioned `picsetup-playground/1` JSON documents contain a semantic circuit (stable component IDs, exact model version, parameters, connections and SI propagation settings, wavelength), independent layout (positions, rotations, curve controls, viewport), and explicit schema identifier. Unsupported schemas/models and malformed references fail before replacing the current scene. Bound file bytes, component/connection counts, finite values and structural shape. Data is never evaluated as code.

Bundled `siepic-coupler` component version `1` is a permanent adapter identity for `siepic-dc-200nm-10um` dataset version `1.0.0` with raw source SHA-256 `945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371`. Its parameter object is empty: gap and coupling length are fixed by the dataset. This mapping cannot silently change under the same component version. Circuit files reference the bundle; they do not embed arbitrary model data or execute remote models. Existing analytical version-1 documents remain supported.

Document validity and model solvability are separate. A structurally valid scene using a supported model can carry an out-of-band wavelength, just as it can describe a singular network. Import/export preserves that scene so its wavelength can be repaired. Solving it returns explicit diagnostics and unavailable powers; the evaluator never extrapolates or invents a response.

Editor commands create validated atomic snapshots for undo/redo. Renderer never supplies physical lengths. Solver is headless and independent of DOM. Palette supports pointer and keyboard/click placement. Ports are explicit connection buttons. Local autosave is recoverable; JSON export/import remains portable. General external-model imports and arbitrary nested module documents remain deferred. Built-in source-free templates now expand into the same ordinary flat component/link document.

## Spectral requests and CSV

Worker requests contain a nonnegative safe-integer `id`, a cloned semantic `circuit`, `startM`, `stopM`, and integer `points` from **2 to 1001**. Endpoints are positive finite metres with `stopM > startM`. The grid is uniform in wavelength and includes both endpoints. Every sample invokes the same validated circuit model at its own wavelength.

Run, cancel, progress, complete, cancelled and error messages carry request IDs. A newer run supersedes the old job; cancellation targets only its matching ID. Work yields between chunks to process cancellation. The UI ignores stale responses and invalidates spectra when circuit physics changes. Changing the selected wavelength or purely visual layout does not alter the spectrum's underlying circuit parameters.

Each sample carries `ok`, detector powers/phases, a full power budget, residual and diagnostics. Failed samples carry an empty detector map plus null budget/residual, keeping unsupported wavelengths distinguishable from zero transmission. Charts break at invalid samples. Partial exports retain their actual sample count.

CSV schema `picsetup-spectrum/1` uses comment-prefixed metadata for units, time convention, component/model versions, imported dataset provenance, sweep request and full replayable SI circuit state. Records include wavelength in metres, powers/budgets in W, phase in radians, residual and JSON diagnostics. Blank measurements mean unavailable; blank detector phase means undefined. CSV values retain full numerical precision. `modelSuppliedW` is explicit and not folded into absorption.

No external bridge or mandatory runtime remote service exists. OpticalSetup ownership stays external. Later bridge work requires a separate versioned proposal with solved fields, units, conventions, reference planes and unknown spatial information.


## Authoring, notebooks and goals

`picsetup-recipe/1` carries a required title, wavelengthM, parts and links. Parts choose one exact bundled model or block; links name exposed ports as `instance.port`. Primitive parameters and every physical link quantity use SI units. Missing values resolve documented catalog defaults. Compilation is bounded by the same circuit caps, rejects unknown keys/versions/ports, expands blocks into namespaced primitives and applies deterministic visual arrangement. The semantic circuit is unchanged by subsequent arrangement. See [API.md](docs/API.md) for the full public surface.

The source-free templates are MZI, all-pass ring, 1→4 splitter and delay line. There is no hidden nested solver state after expansion. Their phase, propagation and loss are explicit and editable; templates do not contain sources or detectors.

`picsetup-notebook/1` contains a title, shared sweep settings and up to six named variants. Every variant contains an exact CircuitDocument and its selected detector identity. Snapshots are cloned and frozen. Capture/replace/remove/rename are explicit; live canvas changes do not rewrite saved variants. Export/import retains complete parameters, model versions, layout and sweep settings. Results are recomputed after reopen; `picsetup-comparison/1` CSV retains the result grid, full request snapshots, units, diagnostic gaps and provenance. Display normalization uses each variant's own emitted power; zero-input normalization is unavailable.

Comparison and goal workers use independent request IDs, immutable request snapshots, chunked execution, matching-request cancellation and stale-response rejection. A goal samples 2–201 values of phase, ideal coupling or explicit connection length at one wavelength. Its response includes the best sampled document, failures and a boundary flag. Applying the result is a separate atomic editor operation, rejects changed circuit physics and preserves the current labels/layout. The browser bridge is `window.picsetup`, schema `picsetup-browser/1`, version `1`; it is an explicit API with no natural-language service or remote code execution.
