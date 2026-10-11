# PicSetup

A photonic circuit workbench at **https://picsetup.com/**. The production source is `playground/`: compose coherent circuits, compare explicit design alternatives, and inspect the numerical evidence behind the result.

- **Design study:** compare constant-index and dispersive SiEPIC MZIs with both outputs, insertion-loss/crosstalk targets, and declared phase-error scenarios.
- **Resolve ring:** reveal a narrow modeled notch missed by a broad scan, with sampled refinement and convergence checks.
- **Sketch and tune:** build from named-port recipes and reusable blocks, edit the canvas, preserve exact notebooks, and apply only eligible sampled improvements.
- **Agent API:** the same compiler, models and experiments are available through Node JSON commands and `window.picsetup`.

Start with [the playground guide](playground/README.md), [API documentation](playground/docs/API.md), [model contract](playground/PHOTONICS_MODEL_CONTRACT.md), and [validation evidence](playground/HANDOFF.md). The model evaluates declared scalar coherent CW networks; it does not claim calibrated hardware prediction, manufacturing yield or fabrication signoff. Propagation assumptions, imported data limitations and numerical failures remain visible.

## Develop and deploy

Use Node 24:

```sh
cd playground
npm ci
npm run dev
npm test
npm run build
node scripts/check-api.mjs
PICSETUP_STATIC=1 npm run test:browser
```

The Pages workflow builds `playground/dist` on `main`, verifies the built site in Chromium before publication, stamps `release.json`, and checks the public study and ring workflows after deployment. The existing Pages custom domain is retained; no DNS change is needed. A retirement worker at `/sw.js` clears legacy application caches and unregisters itself. It leaves saved browser documents intact and does not force-reload open tabs.

## Preserved earlier implementations

`app/` retains the earlier workbench and Paper Figure Studio; its OpticalSetup receiver adapter remains a proposal rather than a deployment to Luca Genchi's repository. `prototype/` remains the immutable source snapshot associated with release `20260726T002235Z-478235af2650`. Neither directory is the production source for this release. Their saved-document formats are not silently converted to the new schema; legacy browser storage remains untouched.

Read [AGENTS.md](AGENTS.md) for repository ownership and scientific boundaries. PicSetup owns guided photonic networks; OpticalSetup owns free-space optics; ElectricalSetup owns electronic drive/readout. Cross-setup integration requires explicit versioned interfaces and does not follow merely from shared branding.

## Setup Universe

[ElectricalSetup](https://github.com/bertona88/electricalsetup) · [BiologicalSetup](https://github.com/bertona88/biologicalsetup) · [GravitySetup](https://github.com/bertona88/gravitysetup) · [TwoPhotonLithography](https://github.com/bertona88/twophotonlithography) · [EgoSetup](https://github.com/bertona88/egosetup) · [QuantumSetup](https://github.com/bertona88/quantumsetup) · [NoeticSetup](https://github.com/bertona88/noeticsetup) · [ComputationSetup](https://github.com/bertona88/computationsetup) · [LogisticSetup](https://github.com/bertona88/logisticsetup) · [MolecularSetup](https://github.com/bertona88/molecularsetup)

OpticalSetup remains in [LucaGenchi/optics-sketch](https://github.com/LucaGenchi/optics-sketch).

## License

No open-source license has been selected yet.
