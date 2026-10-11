# Response to the four photonics reviews

Final implementation: `f51433e43a9d982e9d954e49b138ffc12a83c3f8`, on `rebuild/playground-m1`. Six implementation/verification agents worked on separate files; the original numerical reviewer then performed a focused acceptance pass. These are AI reviews and numerical checks, not external human or hardware validation.

| Review concern | Implemented response | Scope still open |
| --- | --- | --- |
| Circuit designer: constant-index power plots do not answer the design question | A ready-to-run A/B/C MZI study, dispersive propagation, both output powers, dB views, sampled worst IL/XT, editable targets, assumed ±0.08 rad scenarios | No calibrated manufacturing corners, thermal response, yield or continuous-band guarantee |
| Numerical physics: coarse scans hide notches; numerical artifacts can win | Known-model ring seed and sampled refinement, explicit convergence/budget failure, baseline-aware goals, shared numerical eligibility, raw rejected results and diagnostics | No universal resonance discovery or certified extinction error bound |
| PDK/models: one table is not a useful propagation library | Pinned SiEPIC 500 × 220 nm TE coefficients/equation, original bytes and notices, independent complex/delay/fringe references, explicit reference index, domain and source metadata | Source fit band, process/temperature, uncertainty, physical mode and reference-plane matching remain unknown; no general importer |
| Design automation: notebook handoff and authoring meaning disappear | Notebook get/load/launch bridge, exact `/2` snapshots and target bindings, semantic differences, retained recipe with recompiled current/stale status, JSON/CSV replay | No arbitrary nested hierarchy, reverse compiler, natural-language runtime or autonomous optimizer |

The small review inconsistencies were also corrected: guide length is named directly; positive-index catalog metadata is strict; the weighted neighboring coupler power is documented as 0.9837416.

## Decision-changing demonstration

All three MZIs use the same imported coupler and declared propagation loss. They are phase-aligned at 1550 nm, then evaluated on 101 wavelengths across 1545–1555 nm. Targets are worst insertion loss ≤1.5 dB and unwanted/desired crosstalk ≤−8 dB.

| Design | Sampled worst IL | Sampled worst XT | Nominal decision | Both assumed phase offsets |
| --- | --- | --- | --- | --- |
| A: constant index, ΔL 20 µm | 0.607 dB | −11.289 dB | Pass | Pass |
| B: dispersive guide, ΔL 20 µm | 1.209 dB | −6.298 dB | Fail | Fail |
| C: dispersive guide, ΔL 10 µm | 0.524 dB | −12.673 dB | Pass | Pass |

The point is the changed design decision under explicit assumptions, not a claim that these values predict manufactured hardware. The source provides no validated guide fit band; 1500–1600 nm is an application evaluation assumption. Sharing a source label does not qualify modal matching.

The default ring's 101-point broad scan shows minimum transmission 0.9989867. The restricted refinement evaluates 209 actual samples and resolves the known modeled notch at 1550.05 nm with 3.18479 pm half-depth linewidth and Q ≈486,703. The exported location/linewidth brackets and closed-form error remain inspectable. The 120 dB reporting cutoff withholds a finite extinction result; it is not a demonstrated accuracy floor.

## Follow-up numerical review

The original numerical reviewer accepted the scoped ring seeding, linewidth definition, convergence/quality rejection, goal eligibility and sampled study decisions. Focused edge probes found no additional accepted failure. Their one remaining request was to rename the ambiguous extinction-floor field and qualify finite extinction accuracy. The final implementation uses `extinctionReportingThresholdDb`, labels finite extinction as an estimate, and states that the absolute-transmission agreement gate does not certify extinction accuracy.

## Verified result

Final implementation `f51433e43a9d982e9d954e49b138ffc12a83c3f8` passed **268 tests in 16 files**, TypeScript/static/API builds, the independent coefficient/equation check, distributed CLI replay/notices checks, and **eight real Chromium journeys**, with zero failures or skips. [Validation run](https://github.com/bertona88/picsetup/actions/runs/38143314798); [static/API build and evidence](https://github.com/bertona88/picsetup/actions/runs/38143314798/artifacts/11703861693) (artifact retention applies). All three new screenshots were inspected. Full response validation and browser metadata are retained under `playground/evidence/`.

## Reproduction

See [STUDIES.md](../../STUDIES.md), [API.md](../../API.md), the [portable A/B/C notebook](../../../examples/studies/dispersion-mzi.json), and [HANDOFF.md](../../../HANDOFF.md) for the final tested commit and browser evidence. The source/equation audit is `python scripts/verify_siepic_waveguide.py --check` from the repository root. The distributed CLI packaging check executes the same study and ring through the built Node entry point.
