# PICSetup playground

A fresh browser photonic workbench with an open SiEPIC component dataset, coherent circuit editing and wavelength experiments. This workspace is isolated from the older `app/` and `prototype/`.

## Run

Use Node.js 24. From `playground/`:

```sh
npm ci
npm run dev
```

Open http://localhost:4175. `npm run build` produces static `dist/`; `npm run preview` serves it. No account or paid service is required.

## Try the experiments

- **Coupler spectrum:** send 1 mW into a real tabulated SiEPIC directional-coupler model, with a 200 nm gap and 10 µm coupling length. Inspect through/cross powers and their wavelength response. The full four-port matrix retains reflections and back-coupling.
- **SiEPIC MZI:** compose two imported couplers with explicit 80/100 µm arms. Sweep wavelength, move through the spectrum, and adjust the phase shifter.
- **Ideal MZI:** use the same arm lengths with ideal 50/50 couplers to compare the declared models. The original balanced MZI remains available separately.

The spectral explorer runs 2–1001 uniformly spaced wavelengths in a worker, supports stopping a run and exports full-precision CSV with SI units, circuit state, dataset identity, diagnostics and power accounting. Clicking the spectrum or using its arrow keys changes the selected wavelength. Changes to circuit physics invalidate the old sweep.

Add parts from the palette and click two ports to connect them. Coupler order is `[L0,L1,R0,R1]`, corresponding to source dataset ports `[1,2,3,4]`. Each port has one connection. New links have **L = 0 µm**; set length, effective index and loss explicitly. Moving or bending a link only changes the sketch. Export JSON for a portable experiment; local autosave is also available.

## What the data means

The bundled SiEPIC table contains 101 frequency samples across approximately **1500–1600 nm**, with all sixteen complex S entries at each sample. It is pinned to exact upstream revisions and preserved with MIT notices and reproducible conversion scripts. [Dataset provenance and audit](models/siepic-dc-200nm-10um/README.md) describe the source and conventions.

This is an **experimental interpolated response**, not a calibrated device prediction. Native reference-plane coordinates and uncertainty are unknown. The original table has small passivity violations, preserved and reported. Linear interpolation of real/imaginary coefficients can add apparent attenuation between source samples; it is not measured extra physical loss. Queries outside the source band fail instead of extrapolating.

The network uses single-scalar-mode, linear CW scattering with SI units and `(I − SC)b = s`. Constant effective index is nondispersive. Unconnected ports are ideal matched boundaries; dark detector phase is undefined. There are no implicit interactions at crossings, layout-derived optical lengths, fabrication claims or external service dependencies.

## Check

From `playground/`:

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

From the repository root, reproduce the source conversion and independent NumPy references:

```sh
python scripts/convert_siepic.py --check
python scripts/verify_siepic.py --check
python scripts/verify_siepic_mzi.py
```

The first script needs only Python's standard library; independent verification needs NumPy. Linux browser dependencies may require `npx playwright install --with-deps chromium`. CI validates this workspace without deploying it.

See [HANDOFF.md](HANDOFF.md) for actual evidence and remaining work, plus the [model contract](PHOTONICS_MODEL_CONTRACT.md), [document contract](INTERFACE_CONTRACT.md), and [notices](THIRD_PARTY_NOTICES.md). These are early M2/M3 experiments following M1, not completion of the full [11 October brief](https://github.com/bertona88/picsetup/blob/c32f58e102a55ae13cd11c11d312de63ecc8aff5/docs/picsetup-agent-brief-2026-10-11.md). Ring interaction, general external-model import, reusable modules and broader browser/performance qualification remain open.
