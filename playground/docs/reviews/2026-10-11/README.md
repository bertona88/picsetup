# Four independent photonics reviews

Reviewed 11 October 2026 at checkpoint `7b79b0ab6bba7a57f50fd955afc1e0f7a4d507f6` on `rebuild/playground-m1` (tree `106d28c33ff781aa54dddd984104a6fb4dbbc0d2`). The implementation tested by the preceding CI was `af4db0a84e5ff228035c5ae4c7cb37611990c6b3`; subsequent changes before this review were documentation and evidence.

The owner requested four independent photonics agents, candid criticism, and ideas for future directions. Four fresh-context AI reviewers received the same current repository, contracts, screenshots and test record, with distinct professional perspectives. They did not see one another's findings before submitting. These are AI reviews, not external human expert validation or customer interviews. The coordinator then checked consequential findings and prepared this synthesis. One numerical-review paragraph was corrected against the committed source audit after submission; its conclusions were unchanged.

No implementation was changed during this review. The recommendations below are proposals, not completed work or a new qualification claim. The existing 206 tests and five Chromium journeys remain evidence of their specific checks; review probes are additional evidence about limits those checks do not close.

## The blunt assessment

The current product is a credible coherent-circuit experiment foundation. It can demonstrate interference, preserve assumptions and compare computed responses. It does not yet turn those responses into a sufficiently reliable, understandable design decision. All four reviewers would preserve substantial existing work; none recommended another rewrite. Their criticism targets scientific interpretation, useful measurements and the human–agent experiment loop more than visual polish.

| Independent reviewer | Strongest criticism | Preferred next direction |
| --- | --- | --- |
| [Circuit designer](circuit-designer.md) | Useful for an interference argument; still inadequate for practical PIC decisions. Constant-index guides, power-only plots and single-wavelength tuning miss important design questions. | A dispersive MZI review card with both outputs, band metrics and explicit phase-error scenarios. |
| [Numerical physics](numerical-physics.md) | A successful-looking curve can miss the resonance; a diagnosed numerical artifact can become a goal winner. | One resolution-aware critical-ring experiment, quality-aware candidate ranking and visible per-point diagnostics. |
| [PDK and compact models](pdk-models.md) | One well-audited scattering table demonstrates import engineering, but is not yet a useful component library. | Audit one dispersive waveguide and make propagation assumptions/source sampling visible in the existing MZI study. |
| [Design automation](design-automation.md) | The agent can calculate a study, but the supported browser API cannot hand its notebook to the human; comparisons omit verified differences and decision criteria. | Shared notebook APIs, preserved authoring meaning, baseline differences and an explicit two-output target. |

## Findings checked by the coordinator

The following three cases were independently rerun against the built local API. Exact recipes or topology/parameter descriptions are in the individual reports; machine-readable results are in [verification.json](verification.json).

1. **A deep ring notch can disappear between samples.** For the circuit designer's critical ring, the exact transmission at 1548.3870968 nm is approximately `3.83e-24`. Within ±1 nm of that resonance, the lowest sampled transmission is 99.11%, 90.48% and 11.05% on 101-, 201- and 1001-point grids over 1500–1600 nm. These are local minima near this notch, not the global minimum over the full band. This is a declared finite-resolution limitation, not a scattering-algebra defect. Smooth lines and successful solves do not establish resolved extinction or linewidth.
2. **A correct sampled best can be worse than the baseline.** A balanced ideal MZI at phase π gives 1 mW at the selected output. Maximizing over 0–2π with two permitted samples returns about `6.02e-36 W`, since the grid contains only the two equivalent endpoint states. The UI displays the baseline/difference but still permits Apply. The API result is correct for the requested grid; the missing decision state is “no sampled improvement.” Apply availability was confirmed in source, not through a fresh browser journey.
3. **An extreme feedback artifact can win a goal.** A lossless, zero-length self-feedback ideal coupler at `K=1e-13` returns 0.99433145 mW for 1 mW input, residual zero, and `POWER_IMBALANCE`. A 201-point maximize search over `K=[1e-13,1e-12]` chooses `K=1.315e-13`, reporting 1.00150970 mW with zero failed candidates. Every candidate should transmit 1 mW in the ideal model. The warning catches the discrepancy, but eligibility/ranking still treats it as a valid win. This is an extreme admitted-domain robustness defect, not evidence that ordinary default rings fail.

Two smaller inconsistencies were confirmed by source inspection: block catalog metadata declares an inclusive-looking `neff.min=0` while validation requires strictly positive index; several existing prose documents say 0.9834 for a weighted neighboring power that the committed audit records as 0.98374157785268. The latter versus 0.9716000813333332 interpolated power is a 1.21415 percentage-point difference. It is a comparison with neighboring samples, not a measurement of the unknown true response between them. These corrections were identified here, not applied to implementation or existing contracts.

The bridge gap and lost authoring context are also observable boundaries: `window.picsetup` exposes circuit operations and headless commands, but no notebook getter/loader; compiled documents and notebook variants do not retain the originating recipe or block parameter bindings. These are missing capabilities, not broken advertised endpoints.

## Where the reviews agree, and where they do not

Keep explicit SI quantities, physical-length/layout separation, source-free flat templates, strict recipes, frozen experiment snapshots, unclipped data, provenance/licensing and independent complex-field references. Make failure/uncertainty visible at the point of interpretation. More catalog entries and an embedded chat box do not by themselves solve the identified problems.

There is no unanimous next-feature vote. The circuit and PDK reviewers prioritize propagation realism; the numerical reviewer prioritizes knowing whether an answer is resolved and trustworthy; the automation reviewer prioritizes shared experiment state and meaning. These address different risks and should not be collapsed into a claim of consensus.

## Coordinator's recommended sequence

**First, a focused trust fix:** distinguish baseline improvement from grid extrema; exclude or clearly segregate numerical-accounting failures when recommending candidates; make warnings inspectable at the selected wavelength/variant. Keep the raw results available. Use the two goal reproductions above as concrete acceptance cases, and reconcile the small metadata/audit inconsistencies.

**Then build one compelling MZI study:** an agent creates three alternatives; the human receives them directly in Compare; each card states the actual changed parameters and guide/coupler assumptions; both outputs have dB and bandwise metrics; a small set of explicitly assumed phase-error cases tests whether the conclusion survives. Add one audited dispersive waveguide model, keeping the constant-index model as an explicit alternative. Preserve the recipe's parameter bindings or a source map without introducing a hierarchical solver. Success is a reproducible choice with a visible reason, not merely three different curves.

The physical motivation is supported by the checked [Ansys constant-index/FSR discussion](https://optics.ansys.com/hc/en-us/articles/360042800213-Ring-resonator-getting-started-Final-parameter-extraction). The live [Simphony SiEPIC implementation](https://simphonyphotonics.readthedocs.io/en/stable/_modules/simphony/libraries/siepic/models.html) exposes phase/group-index and dispersion coefficients for propagation. Exact new coefficient bytes, version, geometry and compatibility still need an audit before import; a shared SiEPIC label does not establish modal matching.

**Make ring resolution a separate acceptance experiment:** use both reviewers' critical-ring cases, shifted grids and local refinement. Display the actual samples; report resolved metrics only when a declared convergence criterion passes, otherwise say unresolved. Do not assume midpoint refinement alone can find an arbitrarily narrow unseen notch.

Only after that, broaden to a small audited coupler family. Defer a universal importer, broad PDK coverage, arbitrary module hierarchy, electrical/thermal animations and embedded LLM infrastructure. The proposed distinctive product is a shareable photonic design-review notebook: sketch an idea, expose its assumptions, compare alternatives, and show exactly where the conclusion stops being trustworthy.
