# First working slice — 11 October 2026

Branch: `rebuild/playground-m1`. Implementation checkpoint: `0ddecde64e030d93f4bb854ab6dcca2157d5d722`. This is the fresh M0/M1 playground, not the full M0–M5 candidate. No production replacement was made.

## What works

An editable MZI opens at phase π/3. Build another from blank using palette placement/drag and port clicks. Move/rotate components, bend connections, pan/zoom, duplicate/delete, edit phase/wavelength/coupling/loss/explicit length, read detector powers/phases and the power budget, undo/redo, export/import JSON, and recover local autosave. Source and component versions are carried in the document. `examples/mzi.json` is an importable balanced-arm experiment.

Fresh TypeScript model, complex network solver, document validation, immutable editor commands and SVG UI share no implementation with the old app. Analytical components: source, reciprocal four-port coupler, phase shifter, attenuator, detector and termination. One declared scalar guided mode per port, one coherent CW source, no implicit geometry-to-physics conversion.

## Reproduce

From `playground/`, with Node.js 24:

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Development opens at http://localhost:4175. Static output is `dist/`; `npm run preview` serves it. Linux environments missing Chromium libraries can use `npx playwright install --with-deps chromium` when system installation is allowed. A nondeploying GitHub Actions workflow runs all checks and uploads a static review build plus browser evidence.

## Evidence

- Local Node v24.19.0, npm 11.9.0: **87 unit/model/editor tests passed**, no failures or skips; TypeScript and Vite build passed. Dependencies pinned: TypeScript 5.9.3, Vite 7.3.7, Vitest 4.1.11, Playwright 1.56.1. Dependency audit on 11 October: 0 reported vulnerabilities.
- Headless assertions cover full complex coupler unitarity; MZI power/phase at 17 phase values; independent arbitrary-coupler, unequal-arm MZI fields; line attenuation and phase; zero-phase insertion preserving length; reflected-source absorption; ring closed forms; singular/near-singular diagnostics; immutable editing; roundtrip and hostile documents.
- Complex MZI oracle is `e(t2*t1*hu − sqrt(K2*K1)*hl)` and `i*e(sqrt(K2)*t1*hu + t2*sqrt(K1)*hl)`. Equal 50/50 couplers reduce to `e(hu−hl)/2`, `i*e(hu+hl)/2`; matched lossless arm powers are sin²(φ/2), cos²(φ/2). Ring oracle is `(t−A)/(1−tA)`. These independent algebraic fixtures validate declared equations, not measured devices.
- Browser verification: **1 Chromium journey passed**, 0 failures/skips, Chromium 141.0.7390.37 on Ubuntu 24.04 GitHub runner (Node 24.21.0 / npm 11.19.0). Builds topology through the UI, checks phase 0/π/π/2 outputs, undo/redo, drag physics invariance, portable JSON, local reload and invalid imports. No page errors or required third-party requests. At π/2 and 1 mW launch, both outputs were 0.5000000000000001 mW. Screenshot: [evidence/mzi-chromium.png](evidence/mzi-chromium.png); exact browser/commit metadata: [evidence/browser-run.json](evidence/browser-run.json).
- Validation run: https://github.com/bertona88/picsetup/actions/runs/38134741263

The first browser run exposed pointer-target replacement during connection preview; hover now updates only the preview path, preserving port targets. No test assertion was removed to hide the failure.

## Boundaries and next work

Next unfinished gate: **M2 spectral sweeps, cancelable worker execution and a ring editing/example journey**. Scalar wavelength editing and ring solver fixtures exist; no sweep UI/CSV, worker cancellation, or interactive ring milestone is claimed. M3 external-data ingestion and metadata qualification, M4 reusable modules, and M5 cross-browser/accessibility/performance coverage remain open. Firefox/WebKit and performance benchmarks were not run; no throughput or offline reload claims. Probe UI, source-free modules and external custom models are not accepted by this document schema yet.

Dense solver caps: 100 components, 256 optical ports, 128 links. Import limit: 1 MiB. Curve geometry never changes specified propagation. Detector phase is undefined below the documented numerical-darkness threshold. Layout edits do not enter the solve. Unconnected ports use matched boundaries.

No external component implementation or dataset was copied. See `THIRD_PARTY_NOTICES.md`; MIT is proposed for new code but no repository license was changed. No hardware calibration, foundry qualification, fabrication, live bridge or OpticalSetup change.

Preservation: `prototype/` tree remains `4d72604f67ffea9a7a7bc6b675d8b5e83306d8b5`, `app/` remains `7266a6656f54c4e72d723bace45820a42d4a5f23`; existing Pages workflow unchanged. The task branch and successive GitHub commits preserve the work without deploying `main`.

Static review build and browser evidence: https://github.com/bertona88/picsetup/actions/runs/38134741263/artifacts/11700088432 (artifact retention applies; source and the screenshot are also committed here).
