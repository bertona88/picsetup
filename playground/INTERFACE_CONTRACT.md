# Interface contract — playground only

Versioned `picsetup-playground/1` JSON documents contain a semantic circuit (stable component IDs, exact model version, parameters, connections and SI propagation settings, wavelength), independent layout (positions, rotations, curve controls, viewport), and explicit schema identifier. Unsupported schemas/models and malformed references fail before replacing the current scene. Bound file bytes, component/connection counts, finite values and structural shape. Data is never evaluated as code.

Bundled `siepic-coupler` component version `1` is a permanent adapter identity for `siepic-dc-200nm-10um` dataset version `1.0.0` with raw source SHA-256 `945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371`. Its parameter object is empty: gap and coupling length are fixed by the dataset. This mapping cannot silently change under the same component version. Circuit files reference the bundle; they do not embed arbitrary model data or execute remote models. Existing analytical version-1 documents remain supported.

Document validity and model solvability are separate. A structurally valid scene using a supported model can carry an out-of-band wavelength, just as it can describe a singular network. Import/export preserves that scene so its wavelength can be repaired. Solving it returns explicit diagnostics and unavailable powers; the evaluator never extrapolates or invents a response.

Editor commands create validated atomic snapshots for undo/redo. Renderer never supplies physical lengths. Solver is headless and independent of DOM. Palette supports pointer and keyboard/click placement. Ports are explicit connection buttons. Local autosave is recoverable; JSON export/import remains portable. General external-model imports, reusable modules and source-free module documents remain deferred.

## Spectral requests and CSV

Worker requests contain a nonnegative safe-integer `id`, a cloned semantic `circuit`, `startM`, `stopM`, and integer `points` from **2 to 1001**. Endpoints are positive finite metres with `stopM > startM`. The grid is uniform in wavelength and includes both endpoints. Every sample invokes the same validated circuit model at its own wavelength.

Run, cancel, progress, complete, cancelled and error messages carry request IDs. A newer run supersedes the old job; cancellation targets only its matching ID. Work yields between chunks to process cancellation. The UI ignores stale responses and invalidates spectra when circuit physics changes. Changing the selected wavelength or purely visual layout does not alter the spectrum's underlying circuit parameters.

Each sample carries `ok`, detector powers/phases, a full power budget, residual and diagnostics. Failed samples carry an empty detector map plus null budget/residual, keeping unsupported wavelengths distinguishable from zero transmission. Charts break at invalid samples. Partial exports retain their actual sample count.

CSV schema `picsetup-spectrum/1` uses comment-prefixed metadata for units, time convention, component/model versions, imported dataset provenance, sweep request and full replayable SI circuit state. Records include wavelength in metres, powers/budgets in W, phase in radians, residual and JSON diagnostics. Blank measurements mean unavailable; blank detector phase means undefined. CSV values retain full numerical precision. `modelSuppliedW` is explicit and not folded into absorption.

No external bridge or mandatory runtime remote service exists. OpticalSetup ownership stays external. Later bridge work requires a separate versioned proposal with solved fields, units, conventions, reference planes and unknown spatial information.
