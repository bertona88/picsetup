# PICSetup playground

A fresh browser photonic playground. Place parts, connect ports, change phase, and see interference. Isolated from the older `app/` and `prototype/`.

## Run

Use Node.js 24. From `playground/`:

```sh
npm ci
npm run dev
```

Open http://localhost:4175. `npm run build` produces static `dist/`; `npm run preview` serves it. No account or paid service required.

## Check

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Linux browser dependencies may require `npx playwright install --with-deps chromium`. CI validates this workspace without deploying it. See [HANDOFF.md](HANDOFF.md) for actual evidence and remaining milestones.

## Explore

Open the editable MZI example or build from blank. Add a source, two couplers, a phase shifter and two detectors. Select two ports to connect them. Each port has one connection; coupler order is L0, L1, R0, R1.

Connect source → first L0; first R0 → phase → second L0; first R1 → second L1; second R0/R1 → detectors. Vary phase: with matched arms and 50/50 couplers the outputs exchange as sin²(φ/2) and cos²(φ/2).

New links have **L = 0 µm**. Select a link to change its explicit length, index or loss. Moving or bending only changes the sketch. Equal-length arms naturally show no wavelength-dependent power redistribution; change one arm length to explore that effect. Export JSON to keep a portable experiment; local autosave is also available.

## Physics

Analytical, single-mode, linear CW scattering networks. SI internally; `(I − SC)b = s`. Constant effective index is nondispersive. Unconnected ports are ideal matched boundaries; zero-power phase is undefined. No implicit interactions at crossings. No hardware calibration or fabrication claim.

The [model contract](PHOTONICS_MODEL_CONTRACT.md), [document contract](INTERFACE_CONTRACT.md) and [notices](THIRD_PARTY_NOTICES.md) provide details. This first slice implements the [11 October brief](https://github.com/bertona88/picsetup/blob/c32f58e102a55ae13cd11c11d312de63ecc8aff5/docs/picsetup-agent-brief-2026-10-11.md)'s M0/M1 scope. Later work adds spectral sweeps, audited external models and reusable modules.
