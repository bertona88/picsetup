# Acceptance tests — M0 / M1

Commands (from playground/): npm ci; npm test; npm run build; npm run test:browser. Development: npm run dev -- --host 0.0.0.0. Exact pins and commands will be validated before handoff.

M1 gates: (A1) ideal coupler routing, symmetry and full unitarity at K=0,0.5,1; (A2) independently calculated line phase/loss; (A3) MZI powers sin²(Δφ/2), cos²(Δφ/2), phase sweep and accounting; (A4) layout changes preserve complex results; (A5) explicitly wired zero-phase insertion preserves length/result; (A9 subset) loss and matched-boundary accounting; (A11) portable round trip, invalid/nonfinite/oversized/unsupported imports leave scene intact; (A12 subset) Chromium blank-canvas construction, parameter edits, undo/redo, save/reopen, warnings, no third-party runtime requests.

Full M2–M5 gates including spectral worker cancellation, audited external data, module equivalence and cross-browser/performance evidence remain open unless evidenced. Tests use independent algebraic oracles, not duplicate calls to the same evaluator. Preserve app/ and prototype/ trees and Pages workflow.

## Observed M1 result

87 unit/model/editor tests and one real Chromium journey passed at implementation commit `0ddecde64e030d93f4bb854ab6dcca2157d5d722`. No failing/skipped tests in that run. Independent ring/reference fixtures add engine coverage; they do not close M2. The screenshot, numerical readings and full remaining gates are linked in `HANDOFF.md`.
