# Acceptance tests — M1 baseline and early SiEPIC experiments

From `playground/`: `npm ci`, `npm test`, `npm run build`, `npm run test:browser`. Development: `npm run dev -- --host 0.0.0.0`. From the repository root, reproduce source/reference evidence with `python scripts/convert_siepic.py --check`, `python scripts/verify_siepic.py --check` and `python scripts/verify_siepic_mzi.py` (NumPy required for the latter two).

## Retained M1 gates

- Ideal coupler routing, symmetry and complete unitarity at K=0, 0.5 and 1; independently calculated line phase/loss.
- MZI powers, complex phases, arbitrary coupler ratios and unequal arms against independent algebraic formulas; source return, matched-boundary and loss accounting.
- Layout changes preserve complex results; explicitly wired zero-phase insertion preserves length/results.
- Portable round trips and malformed, nonfinite, oversized or unsupported imports preserve the prior scene.
- Real Chromium construction from blank, parameter edits, undo/redo, save/reopen and warnings without third-party runtime requests.

## Early dataset and spectral gates

- **Provenance and conversion:** verify exact raw source hash and complete 16×101 coefficient conversion against an independent parser. Preserve source bytes, licenses and unknown physical metadata.
- **Evaluation:** match every source grid sample and independently calculated frequency-interpolated matrices. Exercise exact band endpoints, just-outside rejection, nonfinite wavelengths, matrix orientation and phasor sign. No gain clipping or reciprocity fabrication.
- **Repairable scenes:** supported-model documents with finite out-of-band wavelengths round-trip intact; solving them returns explicit unavailable results, and editing wavelength back into band restores a valid solve. Unsupported model identities still fail document validation.
- **Passivity:** compare the fixed-dataset Hadamard norm with independent complete-matrix NumPy SVD, including all 17 source violations. Require exact symmetry before using the specialized norm.
- **Composition:** compare full complex detector fields and power budgets of the 80/100 µm imported MZI against the independent NumPy oracle across five wavelengths. Include reflected source power, escaped power, component absorption and model-supplied apparent gain. No physical ground-truth claim follows.
- **Sweeps:** validate finite increasing ranges and 2–1001 sample limits; preserve exact endpoints. Verify direct-solve agreement, chunked progress, cancellation, superseded jobs and stale-response rejection. Invalid samples remain unavailable rather than zero.
- **CSV:** verify units, circuit replay state, exact dataset identity, request/sample counts, diagnostics, full-precision powers, explicit model-supplied power and blank unavailable measurements.
- **Browser:** exercise the coupler/SiEPIC MZI/ideal MZI experiments, spectral interaction, model controls, cancel/restart, stale-result invalidation, invalid ranges, CSV export and dataset JSON save/reopen. Capture fresh screenshots and browser/commit metadata.

## Observed evidence

The three Python conversion/reference commands passed in this iteration. Full fresh TypeScript/build and browser results are pending at this documentation checkpoint; record actual counts and execution metadata in [HANDOFF.md](HANDOFF.md) after the runs. Do not substitute historical screenshots for the spectral UI checks.

Historical M1: 87 unit/model/editor tests and one Chromium journey passed at implementation commit `0ddecde64e030d93f4bb854ab6dcca2157d5d722`, with no failures/skips. Historical links are retained in the handoff.

Full M2–M5 gates remain open: interactive ring example/journey, broader external-library metadata qualification/import, reusable-module equivalence, cross-browser/accessibility and performance evidence. Preserve `app/`, `prototype/` and production Pages configuration. This experiment iteration does not authorize or perform a production replacement.
