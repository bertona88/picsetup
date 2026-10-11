# Sketching circuits through the headless API

The same solver, bundled models and block definitions run in the browser and Node. A recipe is a small JSON description with named ports and explicit SI values. Compiling expands blocks into editable primitives, validates every connection, and arranges the drawing independently of its physical lengths. There is no language-model service, code evaluation, inferred geometry or remote model download in this API.

From `playground/`, build and run:

```sh
npm ci
npm run build
node dist-api/cli.mjs examples/commands/catalog-te.json
node dist-api/cli.mjs examples/commands/solve-mzi.json
node dist-api/cli.mjs examples/commands/sweep-mzi.json
```

The CLI accepts one JSON command from a file, stdin, or `-`. It writes one JSON envelope `{ "ok": true, "result": ... }`, or `{ "ok": false, "error": "..." }` with exit code 1 for malformed commands. A valid but unsolvable circuit returns a successful command envelope with `result.ok: false` and solver diagnostics; failure is not a fabricated zero response. Nonfinite numerical values are represented as null in CLI JSON. Input streaming stops at 7 MiB; individual recipes and documents remain limited to 1 MiB. There are at most 100 expanded components, 128 connections and 256 ports.

## Recipe schema

```json
{
  "schema": "picsetup-recipe/1",
  "title": "SiEPIC wavelength splitter",
  "wavelengthM": 0.00000155,
  "parts": [
    { "id": "laser", "model": "source", "params": { "powerW": 0.001 } },
    { "id": "mzi", "block": "mzi", "params": {
      "couplerModel": "siepic-coupler", "deltaLengthM": 0.00002, "phaseRad": 0
    } },
    { "id": "upper", "model": "detector" },
    { "id": "lower", "model": "detector" }
  ],
  "links": [
    { "from": "laser.out", "to": "mzi.in0" },
    { "from": "mzi.out0", "to": "upper.in" },
    { "from": "mzi.out1", "to": "lower.in" }
  ]
}
```

All five top-level fields are required. Each part requires `id` and exactly one of `model` or `block`. Optional part fields are `label`, `params`, and exact `version: "1"`. Missing parameters use the explicit catalog defaults; supplied parameters must be declared by the model or block. Source power defaults to 0.001 W, source and phase-shifter phase to 0 rad, ideal coupler power coupling to 0.5, and attenuator loss to 3 dB. Dataset couplers have an empty parameter object: their geometry cannot be adjusted. Block parameter defaults, units and domains are in `queryCatalog({kind: 'block'})`.

Recipe identifiers start with a letter and contain at most 40 letters, digits, underscores or hyphens. Reserved object keys are rejected. Port references use `instance.portName`; a port accepts only one connection. Each link requires `from` and `to`; optional fields are `id`, `lengthM`, `neff`, `lossDbPerM` and `waveguide`. Without a waveguide reference, propagation defaults are **0 m, 2.4, and 0 dB/m**, respectively. Generated link IDs are deterministic. Positions never supply physical lengths.

Physical distances and wavelengths are in metres, power in W, phase in radians, guide power loss in dB/m, and component attenuation in dB. Coupling and effective index are dimensionless. Unit strings such as `"1550 nm"` and mathematical expressions are rejected. Unknown fields, models, versions, enum values and parameters fail before a new scene is returned.

Block IDs are `mzi`, `ring`, `splitter-tree`, and `delay-line`. Their named ports are:

| Block | Exposed ports |
| --- | --- |
| `mzi` | `in0`, `in1`, `out0`, `out1` |
| `ring` | `in`, `out` |
| `splitter-tree` | `in`, `out0`, `out1`, `out2`, `out3` |
| `delay-line` | `in`, `out` |

Blocks are source-free. Expansion prefixes internal IDs with `instance__`, retains exact primitive model version 1, and leaves every primitive independently editable. It does not preserve a hidden nested block in the flat scene. Unsupported wavelengths remain editable and exportable; solving them produces explicit model-domain errors.

### Select dispersive propagation

`queryCatalog({ kind: 'waveguide' })` returns the bundled `siepic-strip-500x220-te` version `1` coefficient model, its geometry, reference/group indices, provenance and limitations. It is selected on a connection, not added as a scattering component. For example, a recipe link between already declared parts can be:

```json
{
  "from": "phase.R", "to": "detector.in", "lengthM": 0.0001,
  "lossDbPerM": 100,
  "waveguide": { "model": "siepic-strip-500x220-te", "version": "1" }
}
```

With this reference, omitted `neff` resolves to the fixed source reference value **2.44553**; supplying a different value is rejected. Length and loss remain explicit user inputs. Without `waveguide`, propagation uses the declared constant `neff` exactly as before.

All four blocks also accept `guideModel: 'constant-index'|'siepic-strip-500x220-te'`. For example, use MZI parameters `{ guideModel: 'siepic-strip-500x220-te', couplerModel: 'siepic-coupler', deltaLengthM: 20e-6 }`; omit `neff` or supply 2.44553 for that guide. The block's internal propagation connections retain the selected reference after expansion.

The guide's 1500–1600 nm evaluation window is an application assumption, **not a source-validated fit band**. Loss, modal matching to the coupler, temperature, process variation and physical reference-plane registration remain unqualified. `evaluatePropagation(connection, wavelengthM)` exposes complex transmission, propagation constant, effective/group indices and group delay under these assumptions; it does not turn them into measured quantities.

## JavaScript usage

```js
import {
  compileRecipe, starterRecipe, queryCatalog, solveCircuit, sweepCircuit,
  createNotebook, addVariant, setSweep, compareExperiments, runGoalSearch
} from './dist-api/api.mjs';

const supported = queryCatalog({ mode: 'TE', wavelengthM: 1550e-9 });
const document = compileRecipe(starterRecipe);
const selected = solveCircuit(document.circuit);
const spectrum = await sweepCircuit({
  id: 1, circuit: document.circuit, startM: 1500e-9, stopM: 1600e-9, points: 201
});

const alternate = structuredClone(starterRecipe);
alternate.parts.find(part => part.id === 'mzi').params.deltaLengthM = 30e-6;
let notebook = createNotebook(document);
notebook = addVariant(notebook, compileRecipe(alternate), '30 µm difference');
notebook = setSweep(notebook, { startM: 1500e-9, stopM: 1600e-9, points: 201 });
const comparison = await compareExperiments({ id: 2, notebook });

const search = await runGoalSearch({
  id: 3, document, wavelengthM: 1550e-9, detectorId: 'upper', objective: 'minimize',
  parameter: { kind: 'component', componentId: 'mzi__phase', name: 'phaseRad' },
  min: 0, max: 2 * Math.PI, points: 101
});
// A sampled best can still be worse than the current setting.
if (search.decision === 'improved' && search.best) {
  const candidate = search.best.document; // Applying this snapshot is explicit.
}
```

`parseRecipe(text)` compiles a JSON string. `compileRecipe(value)` accepts an object and returns a fresh arranged `CircuitDocument`. By default it retains the originating recipe and a semantic key in optional `authoring` metadata; `compileRecipe(value, { recordAuthoring: false })` omits it. `arrangeDocument(document)` also returns a fresh document with identical circuit physics. `parseDocument` and `serializeDocument` handle the portable flat schema. The build also exports block construction, immutable notebook operations, CSV exports, goal search and their TypeScript source types through `src/api/index.ts`.

`getAuthoringStatus(document)` returns `current`, `stale` or `none`. It recompiles retained recipe data and compares the saved key and current physical circuit before reporting `current`. Physical edits can leave useful historical recipe text marked `stale`; the solver still uses the edited circuit. Drawing and labels do not invalidate matching authoring context. `getAuthoringRecipe(document)` returns retained JSON text or null and does not assert that the recipe is current.

`queryCatalog` accepts optional `kind: 'model'|'block'|'waveguide'`, `modelKind: 'analytical'|'dataset'|'composition'|'coefficient-model'`, `mode: 'TE'|'TE0'|'TE mode 1'`, `wavelengthM`, and text `query`. It returns fresh metadata with ports, defaults, parameter units, declared mode, wavelength domain, provenance and limits. Block metadata describes its analytical default; selecting imported couplers or the dispersive guide imposes their respective evaluation limits. Native **TE mode 1** is a source mode ID, not a claim of transverse-order TE1. The analytical-to-imported modal overlap and physical reference planes remain unqualified.

## Design studies and ring resolution

```js
import {
  createMziDesignStudy, evaluateStudy, exportStudyCsv,
  runRingExperiment, ringPreset,
} from './dist-api/api.mjs';

const studyNotebook = createMziDesignStudy();
const study = await evaluateStudy({ id: 4, notebook: studyNotebook });
const csv = exportStudyCsv(study);
const ring = await runRingExperiment({ ...ringPreset, id: 5 });
```

`createMziDesignStudy()` supplies three explicit MZI alternatives: a constant-index baseline and dispersive guides with 20 µm and 10 µm arm differences. It uses imported couplers, a 1545–1555 nm/101-point grid, two-output targets, and assumed phase offsets of ±0.08 rad in addition to nominal. See [STUDIES.md](STUDIES.md) for the exact assumptions, formulas, CLI replay and customization.

`picsetup-notebook/2` adds a required `study` object to the classic notebook fields. `setStudy` attaches validated baseline identity, desired/unwanted detector mappings for every variant, insertion-loss/crosstalk targets and explicit phase scenarios; `clearStudy` explicitly returns to `/1`. `parseNotebook` and `serializeNotebook` preserve either schema and all intent. Structural edits that invalidate bindings fail rather than guessing replacement mappings.

`evaluateStudy` returns the frozen request, raw/derived curves for nominal and each declared scenario, actual semantic differences and sampling qualifications. Each complete eligible curve passes only if its **worst sampled desired insertion loss ≤ the IL target** and **worst sampled unwanted/desired crosstalk ≤ the XT target**. Both outputs are normalized by that variant's actual source power. Metrics distinguish exact zero, ±infinity and unavailable values with JSON-safe statuses. Numerical-accounting/pivot failures remain in raw results but cannot certify a sampled pass. Targets apply only to the declared samples and explicit scenario offsets; they do not establish continuous-band bounds, fabrication tolerance or yield.

`runRingExperiment` is a separate, restricted ideal single-bus constant-index ring measurement. Its `RingRequest` requires `id`, `coupling`, `roundTripLengthM`, `neff`, `lossDbPerM`, `phaseRad`, `centerM`, `startM`, `stopM`, `coarsePoints` and `maxEvaluations`, all in SI. Start with `ringPreset` and override explicit parameters. It uses a known optical-path resonance seed, local samples and crossing brackets checked against a closed form; it is not an arbitrary-circuit resonance finder. Results have `status: 'resolved'|'unresolved'|'cancelled'`, raw samples, convergence information, assumptions and optional resonance/linewidth/Q/extinction metrics. When the notch is below the declared numerical reporting floor, extinction is a lower-bound floor instead of a precise enormous dB number.

## Browser notebook bridge

The running playground exposes frozen `window.picsetup` with `version: '1'` and `schema: 'picsetup-browser/1'`. Circuit operations remain `getDocument()`, `loadRecipe(objectOrJson)`, `loadDocument(objectOrJson)`, `arrange()`, `catalog(filter)` and async `execute(command)`. Load/arrange operations are explicit editor changes; `execute` uses headless commands without changing the canvas.

| Method | Effect |
| --- | --- |
| `getNotebook()` | Return an independent copy of the current saved variants and study intent. |
| `loadNotebook(notebookOrJson)` | Validate and atomically replace the Compare notebook, persist it and open Compare; return a copy. Run in Compare to recompute results. The canvas is unchanged. |
| `startDesignStudy()` | Create the supplied three-MZI study, replace/open its notebook, start evaluation and load variant B on the canvas; return the notebook immediately. |
| `openRing()` | Open the ring experiment controls; run the measurement explicitly there. |

An agent can now hand its portable study directly to the human:

```js
const authored = await window.picsetup.execute({ command: 'design-study' });
window.picsetup.loadNotebook(authored); // Human can inspect assumptions, then Run.
const saved = window.picsetup.getNotebook();
const computed = await window.picsetup.execute({ command: 'study', notebook: saved });
```

`execute` returns the command result directly; only the Node CLI adds the `{ ok, result }` envelope. Loading notebook JSON does not execute code or automatically overwrite its snapshots from the canvas. Browser storage is a convenience; export the notebook or retain the returned JSON for portable replay.

## JSON command protocol

| Command | Fields besides `command` | Result |
| --- | --- | --- |
| `catalog` | optional `filter` | matching catalog entries |
| `compile` | `recipe` | arranged flat document |
| `solve` | exactly one of `recipe`, `document` | solver result and diagnostics |
| `sweep` | exactly one of `recipe`, `document`; `startM`, `stopM`, `points` | request plus samples and cancellation status |
| `compare` | `notebook`; optional `variantIds` | samples for selected frozen variants |
| `search` | `request` matching the goal API above | baseline, eligible sampled best, decision, exclusions and boundary status |
| `design-study` | none | supplied three-MZI `picsetup-notebook/2` with explicit targets and scenarios |
| `study` | `notebook` using `/2` | nominal/scenario curves, two-output metrics, decisions, semantic differences and full request |
| `ring` | `request` matching `RingRequest` | bounded known-ring resolution experiment, raw samples and qualified metrics |

`executeCommand(input)` exposes the same dispatch in JavaScript. The CLI owns no current scene and never mutates a browser tab or writes circuit files. Redirect JSON output when a result should be saved.

Sweeps use 2–1001 points, comparisons at most six variants, and bounded goal searches 2–201 candidates plus an independent baseline evaluation. Studies allow at most five explicit phase scenarios plus nominal, hence at most 36,036 solves. The restricted ring experiment permits 21–1001 broad samples and a total evaluation budget of 32–1600; exhausted budgets return unresolved measurements. These operations yield between chunks and expose cancellation to JavaScript/worker callers.

Goal search samples one declared scalar parameter and reports boundary hits. Its `best` is the best **eligible sampled candidate**, which can be worse than the baseline. `decision` is `improved`, `no-improvement`, `unresolved` or `cancelled`; `improved` requires objective-directed `improvementW > toleranceW` against the independent baseline at the requested wavelength. The numerical tolerance is `max(Number.MIN_VALUE, 1e-9 * max(abs(source emission), abs(baseline power), abs(best power)))`, not physical uncertainty. Raw failed/rejected candidates and diagnostics remain available, and model warnings are not silently removed. Browser Apply requires an improved, current, completed result. Neither an improvement nor a sampled pass guarantees a continuous/global optimum. Finite uniform wavelength grids can miss narrow ring resonances. All results retain the [photonics model assumptions and dataset limitations](../PHOTONICS_MODEL_CONTRACT.md).
