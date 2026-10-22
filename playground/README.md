# PICSetup idea workbench

Sketch a guided photonic circuit, change an assumption, and compare the result. The canvas, JSON recipe compiler, Node API and experiment workers use the same scalar coherent CW solver.

## Start with the new design experiments

**Design study** opens a controlled MZI comparison: constant index at ΔL 20 µm, dispersive guide at 20 µm, then a 10 µm redesign. Both outputs, dB views, explicit insertion-loss/crosstalk targets, semantic changes and assumed ±0.08 rad phase errors are visible together. The study runs 101 wavelengths from 1545–1555 nm. Under the declared models and targets, A passes, B fails and C passes all three phase scenarios. These are sampled model decisions, not fabrication predictions.

**Resolve ring** demonstrates a 3.185 pm notch missed by the broad scan. It seeds one known ideal single-bus resonance from optical length, samples and brackets it, and withholds metrics when budget or numerical checks fail. Export retains the actual samples and convergence evidence. The 120 dB extinction cutoff is a reporting policy, not an accuracy bound.

[Studies and replay](docs/STUDIES.md) describe the schemas, target definitions and limitations.

## Try the workflow

**IQ transmitter:** the Sketch starter composes two nested MZIs with static
I/Q arm phases and a quadrature bias. All four output powers remain visible.
This is one ideal scalar CW channel, with no gain, RF drive or data-rate model.
See [the Infinera-map capability assessment and recipe guide](docs/INFINERA_PIC_MAP.md)
for the runnable example, phase conventions and path to a fuller transceiver.

1. Open **Sketch** and choose a SiEPIC MZI, ideal MZI, ring, splitter tree or delay line. Edit its recipe and choose **Build this idea**.
2. Select components or guides to change phase, coupling, length and loss. **Arrange** redraws the graph without changing any physical parameter.
3. Open **Compare** and **Pin current circuit**. Change the live circuit and pin another variant. Each snapshot keeps its own complete circuit; compare up to six on one wavelength grid.
4. Select a phase shifter, ideal coupler or guide and choose **Tune toward a goal**. Search a bounded range, inspect the sampled best and apply it explicitly. Undo restores the previous circuit.
5. Save a circuit JSON, a complete notebook JSON, or full-precision CSV results. Notebook restore retains the variants and sweep settings; run again to recompute the curves.

For an immediate example, Sketch → **Compare three arm lengths** builds three SiEPIC MZIs with ΔL = 10, 20 and 30 µm. They appear together in the comparison notebook with their exact parameters preserved.

**Add a building block** inserts a source-free MZI, all-pass ring, 1→4 splitter or delay line. Blocks expand into editable primitives with ordinary exposed ports. This is reusable template composition; arbitrary nested custom modules are not implemented.

## Run

Use Node.js 24. From `playground/`:

```sh
npm ci
npm run dev
```

Open http://localhost:4175. Build the static application and headless API with `npm run build`. The application is in `dist/`; the Node ES modules and JSON CLI are in `dist-api/`. `npm run preview` serves the static app. No account, API key or external model service is needed to run it.

## Author with an agent or script

```sh
npm run build:api
node dist-api/cli.mjs examples/commands/catalog-te.json
node dist-api/cli.mjs examples/commands/solve-mzi.json
node dist-api/cli.mjs examples/commands/compare-arm-lengths.json
node dist-api/cli.mjs examples/commands/search-phase.json
```

The CLI also reads a single JSON command from stdin. [API documentation](docs/API.md) covers strict named-port recipes, catalog queries, solving, sweeps, notebooks and bounded searches. Runnable recipes and commands are in `examples/recipes/` and `examples/commands/`.

The browser exposes `window.picsetup` version `1`: `getDocument()`, `loadRecipe(input)`, `loadDocument(input)`, `arrange()`, `getNotebook()`, `loadNotebook(input)`, `startDesignStudy()`, `openRing()`, `catalog(filter)` and async `execute(command)`. Recipe loading compiles and arranges; document loading restores an exact snapshot. Headless `execute` returns data without changing the canvas. These are explicit programming interfaces; the app does not contain a natural-language model.

## Check

```sh
npm test
npm run build
node scripts/check-api.mjs
npx playwright install chromium
npm run test:browser
```

Linux browser dependencies may require `npx playwright install --with-deps chromium`. The workflow validates and uploads browser evidence, static assets and the Node API without deploying production. [HANDOFF.md](HANDOFF.md) records actual test results, screenshots and remaining boundaries.

## Model boundaries

SI internally: m, W, rad and dB/m. One coherent source, one declared scalar guided mode per port, linear steady state. The network solves `(I − SC)b = s`; guides support declared constant index or the pinned experimental SiEPIC 500 × 220 nm TE dispersion coefficients. Drawn geometry never supplies optical length. New links default to zero length. Unconnected ports use matched boundaries; crossings do not connect.

The bundled SiEPIC coupler has fixed 200 nm gap and 10 µm coupling length, source TE mode 1, and approximately 1500–1600 nm support. Its native spatial reference planes are unknown. Complex Cartesian interpolation can introduce apparent attenuation; some original matrices show slight apparent gain. Those values are preserved, with visible diagnostics and explicit accounting. No calibrated-device or fabrication claim is made.

Uniform wavelength and parameter grids can miss narrow resonances or optima. Goal search evaluates the starting circuit, excludes numerically suspect candidates, and only enables Apply for a meaningful improvement. It retains rejected raw values and boundary hits. Source data, conventions and both MIT notices are preserved in [the dataset](models/siepic-dc-200nm-10um/README.md) and in distributed third-party notices.

See the [workbench contract](WORKBENCH_CONTRACT.md), [physics contract](PHOTONICS_MODEL_CONTRACT.md), [document contract](INTERFACE_CONTRACT.md), and [claims](CLAIMS_AND_VALIDATION.md).
