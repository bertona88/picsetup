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

Recipe identifiers start with a letter and contain at most 40 letters, digits, underscores or hyphens. Reserved object keys are rejected. Port references use `instance.portName`; a port accepts only one connection. Each link requires `from` and `to`; optional fields are `id`, `lengthM`, `neff` and `lossDbPerM`. Defaults are **0 m, 2.4, and 0 dB/m**, respectively. Generated link IDs are deterministic. Positions never supply physical lengths.

Physical distances and wavelengths are in metres, power in W, phase in radians, guide power loss in dB/m, and component attenuation in dB. Coupling and effective index are dimensionless. Unit strings such as `"1550 nm"` and mathematical expressions are rejected. Unknown fields, models, versions, enum values and parameters fail before a new scene is returned.

Block IDs are `mzi`, `ring`, `splitter-tree`, and `delay-line`. Their named ports are:

| Block | Exposed ports |
| --- | --- |
| `mzi` | `in0`, `in1`, `out0`, `out1` |
| `ring` | `in`, `out` |
| `splitter-tree` | `in`, `out0`, `out1`, `out2`, `out3` |
| `delay-line` | `in`, `out` |

Blocks are source-free. Expansion prefixes internal IDs with `instance__`, retains exact primitive model version 1, and leaves every primitive independently editable. It does not preserve a hidden nested block in the flat scene. Unsupported wavelengths remain editable and exportable; solving them produces explicit model-domain errors.

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
// search.best.document is a separate candidate snapshot; applying it is explicit.
```

`parseRecipe(text)` compiles a JSON string. `compileRecipe(value)` accepts an object and returns a fresh arranged `CircuitDocument`. `arrangeDocument(document)` also returns a fresh document with identical circuit physics. `parseDocument` and `serializeDocument` handle the portable flat schema. The build also exports block construction, immutable notebook operations, CSV exports, goal search and their TypeScript source types through `src/api/index.ts`.

`queryCatalog` accepts optional `kind: 'model'|'block'`, `modelKind: 'analytical'|'dataset'|'composition'`, `mode: 'TE'|'TE0'|'TE mode 1'`, `wavelengthM`, and text `query`. It returns fresh metadata with ports, defaults, parameter units, declared mode, wavelength domain, provenance and limits. Block metadata describes its analytical default; selecting imported couplers imposes the dataset band. Native **TE mode 1** is a source mode ID, not a claim of transverse-order TE1. The analytical-to-imported modal overlap and physical reference planes remain unqualified.

## JSON command protocol

| Command | Fields besides `command` | Result |
| --- | --- | --- |
| `catalog` | optional `filter` | matching catalog entries |
| `compile` | `recipe` | arranged flat document |
| `solve` | exactly one of `recipe`, `document` | solver result and diagnostics |
| `sweep` | exactly one of `recipe`, `document`; `startM`, `stopM`, `points` | request plus samples and cancellation status |
| `compare` | `notebook`; optional `variantIds` | samples for selected frozen variants |
| `search` | `request` matching the goal API above | sampled candidates, best document, failures and boundary status |

`executeCommand(input)` exposes the same dispatch in JavaScript. The CLI owns no current scene and never mutates a browser tab or writes circuit files. Redirect JSON output when a result should be saved.

Sweeps use 2–1001 points, comparisons at most six variants, and bounded goal searches 2–201 candidates. They yield between chunks and expose cancellation to JavaScript/worker callers. Goal search samples one declared scalar parameter and reports boundary hits; it does not guarantee a continuous or global optimum. Finite uniform wavelength grids can miss narrow ring resonances. All numerical results retain the existing [photonics model assumptions and dataset limitations](../PHOTONICS_MODEL_CONTRACT.md).
