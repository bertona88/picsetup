# Reproducible two-output design studies

A study asks whether each saved circuit meets explicit two-output targets on a shared wavelength grid, then repeats that question for declared phase offsets. It preserves the decision criteria with the circuits. The result is a sampled comparison under stated assumptions, not an optimizer or a fabrication qualification.

## Start with the three-MZI study

`createMziDesignStudy()` returns an immutable `picsetup-notebook/2` containing:

| Variant | Guide propagation | Lower-minus-upper arm length |
| --- | --- | --- |
| A, the baseline | Constant index, `neff = 2.44553` | 20 µm |
| B | Bundled dispersive SiEPIC strip guide | 20 µm |
| C | Bundled dispersive SiEPIC strip guide | 10 µm |

All three use the same bundled SiEPIC coupler model, a 1 mW source, an 80 µm upper arm, and explicitly assumed propagation loss of 100 dB/m. The phase settings align the intended interference condition at 1550 nm; the imported couplers' actual complex responses are still evaluated. Changing the arm difference in C also changes that phase setting, and both changes appear in the semantic diff.

The shared sweep has 101 wavelength samples from 1545 to 1555 nm, including endpoints. The desired detector is `desired`; the unwanted detector is `unwanted`. Targets are worst sampled insertion loss **≤ 1.5 dB** and worst sampled unwanted/desired crosstalk **≤ −8 dB**. The nominal circuit and two assumed phase errors, −0.08 and +0.08 rad applied to `mzi__phase` in every variant, produce nine curves and 909 solves. These errors are chosen scenarios, not measured process tolerances.

From the `playground/` directory, build the distributed API with `npm run build:api`, then run:

```js
// Save as run-study.mjs beside package.json; run with node run-study.mjs.
import { writeFileSync } from 'node:fs';
import {
  createMziDesignStudy, evaluateStudy, exportStudyCsv,
  serializeNotebook, formatDbMetric, setStudy,
} from './dist-api/api.mjs';

const notebook = createMziDesignStudy();
const result = await evaluateStudy({ id: 1, notebook });
writeFileSync('mzi-study.json', serializeNotebook(notebook));
writeFileSync('mzi-study.csv', exportStudyCsv(result));

for (const curve of result.curves) {
  console.log(curve.variantName, curve.scenarioName, curve.metrics.status,
    formatDbMetric(curve.metrics.worstInsertionLossDb),
    formatDbMetric(curve.metrics.worstCrosstalkDb));
}
```

The CLI uses the same implementation. `design-study` creates the notebook; `study` evaluates it. CLI responses wrap results in `{ "ok": true, "result": ... }`, so pass the returned notebook, not the wrapper, to the second command:

```sh
printf '%s\n' '{"command":"design-study"}' | node dist-api/cli.mjs > design-study-response.json

node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const response = JSON.parse(readFileSync('design-study-response.json', 'utf8'));
if (!response.ok) throw new Error(response.error);
writeFileSync('study-command.json', JSON.stringify({
  command: 'study', notebook: response.result,
}));
JS

node dist-api/cli.mjs study-command.json > study-result.json
```

## Preserve the question with the circuits

Classic notebooks retain schema `picsetup-notebook/1` and their existing export format. A study notebook uses `picsetup-notebook/2`, with the same title, sweep and variants plus a required `study` object of schema `picsetup-study/1`. Its five fields are:

- `schema`: the study schema identifier.
- `baselineVariantId`: the exact saved variant used for semantic differences.
- `outputs`: one explicit `{ variantId, desiredDetectorId, unwantedDetectorId }` mapping for every variant. The two detector IDs must be distinct and exist in that variant.
- `targets`: `{ maxInsertionLossDb, maxCrosstalkDb }`, finite dB thresholds within ±1000 dB.
- `phaseScenarios`: named scenarios with explicit `{ variantId, componentId, phaseOffsetRad }` offsets. Every binding must refer to an existing `phase` component; the component phase is increased by the given offset.

The nominal scenario is always evaluated first and has reserved ID `nominal`. A scenario changes only its listed phase components. An unlisted variant or phase component keeps its nominal value. Offsets within a scenario are simultaneous, and the same wavelength grid is used for every case.

Use `setStudy(notebook, spec)` to attach or replace validated intent. For example, preserve all mappings and scenarios while tightening a target:

```js
const revised = setStudy(notebook, {
  ...notebook.study,
  targets: { ...notebook.study.targets, maxCrosstalkDb: -12 },
});
```

The notebook helpers clone and freeze snapshots. `serializeNotebook` and `parseNotebook` round-trip circuits, drawing, authoring context, mappings, targets and offsets; results are recomputed after reopening. Edits that leave a study with missing output or phase bindings fail validation. Rebuild the explicit intent for the edited variants, or call `clearStudy` to return to a classic notebook before changing its structure. There is no silent detector substitution in the study mapping.

Supported work is bounded to six variants, 2–1001 wavelength points, and at most five explicit phase scenarios in addition to nominal: at most 36,036 solves. Each scenario permits 1–600 distinct phase bindings, with each offset within ±2π rad. Notebook JSON is bounded to 6 MiB + 64 KiB. Evaluation accepts `isCancelled`, `onProgress(completed, total)`, `chunkSize` and `yieldControl` options; the browser uses a worker with request-specific cancellation and stale-result isolation.

## Read the measurements and decisions

For each variant and scenario, let `Psrc` be that variant's actual source emission, `Pd` desired detector power, and `Pu` unwanted detector power:

| Quantity | Definition |
| --- | --- |
| Desired or unwanted normalized output | `Pd/Psrc` or `Pu/Psrc` |
| Desired or unwanted output in dB | `10 log10(P/Psrc)` |
| Desired insertion loss, IL | `−10 log10(Pd/Psrc)` |
| Unwanted/desired crosstalk, XT | `10 log10(Pu/Pd)` |

`worstInsertionLossDb` is the maximum IL over the declared wavelength samples; `worstCrosstalkDb` is the maximum XT. A complete eligible curve is `sampled-pass` exactly when **both** `worstInsertionLossDb <= maxInsertionLossDb` and `worstCrosstalkDb <= maxCrosstalkDb`; otherwise it is `sampled-fail`. Each scenario receives its own decision. There is no hidden ranking or assertion about unsampled errors between scenarios.

`DbMetric` uses `{ value, status }`, with `status` equal to `finite`, `positive-infinity`, `negative-infinity`, or `unavailable`. Nonfinite statuses have `value: null`, keeping JSON portable. Exact zero output means −∞ output dB and +∞ insertion loss. Zero unwanted power with positive desired power means −∞ XT; positive unwanted power with zero desired power means +∞ XT. The ratio 0/0 is unavailable. Very small nonzero solver powers remain nonzero; they are not rounded into exact extinction.

Solver errors, failed solves, `POWER_IMBALANCE`, `SMALL_PIVOT`, missing/nonfinite required measurements, invalid normalization and negative power exclude a sample from decision metrics. Zero source power makes normalization unavailable. Any incomplete grid or unavailable required band metric yields `unresolved`. Raw sample powers, residuals, budgets and diagnostics remain available; excluded values are not clipped or repaired. Dataset passivity and model-supplied-power warnings remain visible model qualifications even where the numerical sample is eligible.

`evaluateStudy({ id, notebook })` returns a frozen `StudyResult`: the exact request, raw and derived curves, baseline differences, sampling caveat and cancellation state. `summarizeStudy(request, comparisonResults)` computes nominal metrics from existing same-grid comparison results without another solve. `exportStudyCsv(result)` includes every evaluated scenario, full request, differences, model provenance where applicable, raw budgets/diagnostics and explicit metric statuses.

Uniform wavelength samples can miss narrow features. A sampled pass does not establish a continuous-band bound, resolved resonance extinction, a worst case over all phase errors, manufacturing yield or measured accuracy. The separate ring-resolution experiment addresses a different sampling question.

## Interpret differences and authoring context

Differences are derived from saved physical state, never from variant names. They include component models, versions and parameters; reciprocal connection topology; explicit length, loss, index and optional waveguide identity; and circuit wavelength. Component IDs align corresponding components. Drawing coordinates, labels, title, array order, connection IDs and reciprocal endpoint storage direction are ignored. Adding or removing topology appears as a real difference; an empty difference list means the compared represented physics is unchanged under these rules.

Recipe compilation may retain the original recipe and its semantic key in `authoring`. `getAuthoringStatus(document)` recompiles that recipe and returns `current`, `stale` or `none`. `current` means its saved semantic key and newly compiled circuit agree with the present circuit. `stale` preserves useful historical intent after a physical edit; it does not silently override the edited circuit. `getAuthoringRecipe` returns retained recipe text without asserting that it is current. Drawing and label edits do not invalidate otherwise matching authoring context.

The dispersive guide is the pinned `siepic-strip-500x220-te` version `1`, a frequency-quadratic propagation model from audited source coefficients. Its 1500–1600 nm evaluation window is an **application assumption**, not a source-validated fit band. Temperature, process corner, uncertainty, spatial fields and physical mode matching to the coupler remain unqualified; propagation loss is independently user-declared. See the [waveguide manifest](../models/siepic-strip-500x220-te/manifest.json) and [model contract](../PHOTONICS_MODEL_CONTRACT.md). Source provenance does not turn the study into a calibrated-device prediction.
