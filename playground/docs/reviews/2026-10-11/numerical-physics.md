# Independent AI review: numerical physics

**Reviewer perspective:** photonics numerical methods and coherent circuit simulation. This is an independent AI review, not an external human expert endorsement. Reviewed 11 October 2026, working tree corresponding to checkpoint `7b79b0ab6bba7a57f50fd955afc1e0f7a4d507f6`. I read the requested contracts, implementation and numerical tests, and inspected `workbench-chromium.png` and `goal-chromium.png`. I did not inspect other reviewers’ reports or change implementation. Probes below reproduced against a fresh scratch bundle of `src/api/index.ts`, using Node 24.19.0.

## Verdict

The coherent network equations are credible; the experiment conclusions are much less protected. This is a useful equation workbench for well-conditioned declared models. It is not yet a trustworthy resonance exploration instrument. Its most dangerous failure mode is a clean, successful-looking experiment that samples away the phenomenon or ranks floating-point error as improvement. The documentation admits important limits, but admission does not make those limits operationally visible. The 206 tests and five browser journeys support particular behaviors, not arbitrary resonator accuracy.

## Ranked findings

### 1. High: the supported sweep can entirely miss an ordinary critical-coupling notch

**Reproduced consequence of an intentional limitation, not an undisclosed algorithm bug.** `src/solver/sweep.ts:50–53` generates a uniform wavelength grid, capped at 1001 points. `src/experiments/compare.ts` shares that grid across variants without a resolution estimate. Neither a successful solve nor increased point count establishes resolved spectra.

Reproduction: source 1 mW → ideal coupler L0; R0 → detector; connect R1 back to L1. Set `K=0.001`, `neff=2.4`, feedback length `155 × 1550.05e−9 / 2.4 = 0.00010010739583333335 m`, and feedback loss `−10 log10(1−K)/L = 43.404562709942134 dB/m`. Other guides have zero length/loss. This makes round-trip amplitude equal to coupler through-amplitude.

Across 1500–1600 nm, **101 samples report minimum transmission 0.9989867183**: essentially a flat wire. Even **1001 samples report 0.8767772869**. Direct evaluation at the analytical resonance, 1550.05 nm, gives **4.70365e−21**, with no diagnostics. Both sweeps have zero failures. This is a practically important editable ring, not an astronomical parameter stunt. Smooth connecting lines, as seen in the comparison screenshot, make under-resolved data look more complete than they are. Uniform parameter goals have the same aliasing mechanism.

### 2. Medium: resonant roundoff can become a recommended “best” setting

**Reproduced admitted-domain robustness defect at extreme coupling; not evidence that default rings are inaccurate.** Use the same three-component topology, but zero feedback length/loss and `K=1e−13`. An ideal lossless all-pass ring has unit transmitted power. The implementation returns **0.9943314505 mW** for 1 mW launch, `ok=true`, residual **0**, and no `SMALL_PIVOT`. It does issue `POWER_IMBALANCE`, so the accounting safeguard catches the discrepancy.

The explanation is visible in `src/solver/solve.ts:102–113`: a small self-feedback diagonal can also be its row’s scale, leaving its scaled pivot unremarkable. The residual at lines 173–185 measures equation satisfaction, not accuracy relative to the intended physical coefficients. Coefficient rounding and cancellation are amplified by resonant circulation. The existing near-singular test (`tests/reference.test.ts:211–223`) uses an unsourced loop whose answer is identically zero; it cannot expose this failure.

A maximize-coupling goal over `[1e−13, 1e−12]`, 201 candidates, selects **K=1.315e−13, power=1.0015096977 mW**, with **zero failed candidates**. Physically every candidate should tie at 1 mW. `src/experiments/goals.ts:79–82` treats any finite `ok` power as eligible, including failed power accounting. The goal UI does display warnings; the defect is promoting a diagnosed numerical artifact into a recommended candidate. LAPACK’s primary documentation uses conditioning and explicit forward-error estimates to qualify linear solves: [error bounds](https://www.netlib.org/lapack/lug/node80.html).

### 3. Medium: interpolation error is large enough to steer comparisons

**Known model approximation, not a conversion defect.** `src/model/dataset.ts:22–41` faithfully implements Cartesian interpolation. The committed `models/siepic-dc-200nm-10um/verification.json` audit records **0.9716000813333332** single-input output at 1550 nm against **0.98374157785268** weighted neighboring sampled powers: approximately **1.21415 percentage points** attributable to interpolation curvature. The approximately 0.9834 value in the existing prose is stale. That difference can compound through several couplers and alter feedback linewidths. More circuit wavelength samples cannot recover missing device information.

Preserving the source and declaring uncertainty is correct. Presenting this model as the main realistic comparison starter without showing source sample positions or interpolation sensitivity is still scientifically weak. A future delay-separated interpolation experiment is reasonable; it must be separately versioned and validated, not silently replace the pinned model. Ansys explicitly supports isolating linear group-delay phase to handle rapid phase rotation: [S-parameter format documentation](https://optics.ansys.com/hc/en-us/articles/360036618513-S-parameter-file-formats-and-usage). This does not prove any alternative interpolant is correct for this dataset.

### 4. Medium: comparison diagnostics are exported rather than investigated

`src/ui/comparison.ts:229–233,280–285` compresses sample warnings into “model warnings in CSV” and a generic dataset footnote. Thus conditioning and power-accounting warnings can accompany apparently ordinary curves. The screenshot confirms this presentation. A user comparing candidate devices should see which wavelength and variant is suspect without exporting and parsing diagnostic JSON. This is an interpretation defect, not missing numerical data.

## Concrete directions and success criteria

1. **Build one resolution-aware ring experiment.** Use the critical ring above; estimate phase advance/linewidth where available, offer local refinement, and show sampled points plus unresolved intervals. Midpoint refinement alone can miss an isolated notch. Success: recover resonance location within 1% of linewidth and minimum normalized transmission within 0.01, or explicitly declare resolution insufficient. Include a browser journey and shifted grids.
2. **Make numerical quality affect goal eligibility.** Add driven, near-resonant tests against high-precision analytical references over coupling/loss decades, including equivalent feedback factorizations. Retain raw results, distinguish questionable candidates, and do not present power-accounting failures as ordinary design wins. Success: the lossless-coupling probe produces either tied trustworthy candidates or explicit unresolved status, never a claimed improvement from its artificial gain.
3. **Audit interpolation as an experiment.** Compare native-knot results, current Cartesian interpolation and a separately identified phase/delay-aware candidate using withheld source samples. Record complex-field error, full-matrix passivity and downstream ring/MZI sensitivity. Success means quantified differences and honest uncertainty, not prettier spectra.

## Keep, and strongest next slice

Keep the scalar scattering architecture, explicit reciprocal boundaries, fixed phasor convention, unclipped fields, separate model-supplied power, immutable snapshots and independent complex-field oracles. Nondispersive guides and opaque dataset reference planes are clearly declared limitations; reduced-order modeling itself is not the problem.

The strongest next slice is **one critical ring with resolution checks, numerical-quality-aware tuning and visible per-point diagnostics**. Complete that before expanding the device catalog. It would turn the existing solver into an instrument that can tell users when its answer deserves trust.
