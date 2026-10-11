# Independent AI review: photonics design automation

Reviewer: an AI taking the perspective of a photonics design-automation researcher, not an external human expert. Reviewed 11 October 2026. Scope: the supplied checkpoint, contracts, authoring/experiment implementations, relevant tests, and all three supplied screenshots. No implementation changes or external consultations.

## Blunt verdict

PICSetup has a credible experiment kernel and a pleasant interface, but it is not yet a compelling agent–human idea workbench. An agent can construct and solve a circuit; a human can admire several curves. The missing product is the conversation between those steps: **what changed, why it mattered, whether it met the intention, and what to try next**.

The screenshots are clean and unclipped. Compare is the strongest surface: distinct colors, aligned spectra, persistent variants. Sketch's dominant JSON textarea, however, makes “What will light do?” feel like an API demo. Tune demonstrates a sampled extremum, not an engineering decision. That is a product assessment, not evidence that the solver is wrong.

## Ranked findings

### 1. High — The agent and the human cannot share an entire experiment through the supported bridge

`src/main.ts:161–163` exposes document loading, arrangement, catalog lookup and headless `execute`. It exposes no notebook getter/loader, result presentation, or goal proposal. `src/api/commands.ts:37–46` can compute comparisons/searches, but the result is data. The browser's `ComparisonPanel` owns its separate private notebook (`src/ui/comparison.ts:24–28`). The special three-arm demonstration reaches that panel through an internal function (`src/main.ts:160`).

**Consequence:** an external agent can produce an excellent three-candidate study but cannot put it into the human's Compare view using the advertised API. It must fall back to file import or UI scripting. Conversely, it cannot inspect the user's pinned study through that bridge. This is a deliberate API boundary, not a broken endpoint, but it cuts directly across the desired collaboration loop. A versioned, atomic `loadNotebook`/`getNotebook` pair is more valuable now than an embedded chat box.

### 2. High — Compilation preserves physics while discarding the reusable design intention

`src/api/recipe.ts:113–158` expands blocks into prefixed primitives and returns only a flat document. `src/experiments/notebook.ts:6–7` stores document snapshots and detector choices, with no recipe, parameter binding, parent, hypothesis or change description. The goal example consequently addresses the generated internal name `mzi__phase` (`docs/API.md`, JavaScript example).

**Consequence:** “increase this MZI's arm difference” starts as one meaningful parameter and becomes an inference over anonymous physical links after editing/reopening. An agent must reconstruct relationships that the compiler already knew. The documented absence of arbitrary nested modules is reasonable; losing a source map is not necessary to maintain a flat solver. Preserve optional authoring provenance and bindings, while marking them stale when incompatible canvas edits occur. Do not build a hierarchical simulator to solve this smaller problem.

### 3. High — Compare shows divergence but cannot explain it or judge it

Variant cards show a thumbnail, component/connection counts, a name and one detector selector (`src/ui/comparison.ts:261–277`). Readouts show normalized power at one sampled wavelength (`294–305`). There is no semantic parameter diff or explicit acceptance metric. The snapshot names in the supplied screenshot manually supply the explanation; the UI does not verify those names. Updating a variant can replace its document while retaining its name (`src/experiments/notebook.ts:72–73`).

**Consequence:** “Phase π rad” can remain the label after an unrelated canvas replaces it. That operation is explicit and correct, but its scientific interpretation is fragile. Users must remember what differs and visually estimate which design is useful. Identical-looking thumbnails cannot distinguish phase, coupling, loss and length changes. Add a computed physical diff against a baseline, alongside one declared metric. Preserve full snapshots and CSV: their isolation and replay are real strengths, tested in `tests/comparison.test.ts` and `tests/workbench-browser.spec.ts:155–174`.

### 4. High — A valid sampled best can be a terrible next action

Goal search ranks only the requested uniform grid (`src/experiments/goals.ts:71–89`). Its objective is one detector's raw power at one wavelength (`7–10`, `79–82`), with no requirement to improve on the current circuit. The UI computes a baseline separately (`src/ui/goals.ts:179–182`) but enables Apply whenever a noncancelled best exists (`63–66`).

**Verified focused check:** using the built API, an ideal balanced MZI at phase π produced approximately 1 mW at `upper`. Maximizing over 0–2π with the permitted two samples returned approximately `6.02e−36 W` at 2π. The UI source would permit applying that result. This is **not a numerical bug**: it is exactly the declared grid. It is a decision-support trap. Display “No sampled improvement,” include the baseline as an incumbent, and offer refinement. The boundary advice is also indiscriminate: widening a full-period ideal phase search adds duplicate states, not information (`src/ui/goals.ts:199`).

Exact reproduction from `playground/` (the complete baseline recipe and request):

```js
import {compileRecipe,runGoalSearch,solveCircuit} from './dist-api/api.mjs';
const document=compileRecipe({
  schema:'picsetup-recipe/1',title:'Baseline',wavelengthM:1550e-9,
  parts:[{id:'laser',model:'source',params:{powerW:.001}},
    {id:'mzi',block:'mzi',params:{couplerModel:'coupler',deltaLengthM:0,phaseRad:Math.PI}},
    {id:'upper',model:'detector'},{id:'lower',model:'detector'}],
  links:[{from:'laser.out',to:'mzi.in0'},
    {from:'mzi.out0',to:'upper.in'},{from:'mzi.out1',to:'lower.in'}]
});
const baseline=solveCircuit(document.circuit).detectors.upper.powerW;
const result=await runGoalSearch({id:0,document,wavelengthM:1550e-9,
  detectorId:'upper',objective:'maximize',
  parameter:{kind:'component',componentId:'mzi__phase',name:'phaseRad'},
  min:0,max:2*Math.PI,points:2});
```

Observed: `baseline=0.0010000000000000005`; sample powers `[3.009265538105056e-36,6.018531076210112e-36]`; `best.value=6.283185307179586`; `best.powerW=6.018531076210112e-36`; `boundaryHit=true`. This verifies the API result; Apply availability is established by the source condition, not a newly executed browser journey.

## Three bounded directions

1. **An agent hands a study to a human.** Add notebook bridge methods, authoring provenance and a baseline diff. Demonstrate “compare ΔL = 10/20/30 µm, explain the differences, restore one, change it, reopen.” Success: a documented API completes this journey without DOM scripting; every card shows verified changed quantities; reopen retains their meaning.

2. **Turn one extremum into one photonic specification.** Keep one adjustable phase, but add a two-detector contrast goal across a small declared wavelength band, plus minimum useful output. Show baseline, sampled best and a finer-grid verification. Success: a candidate passes explicit thresholds or reports infeasibility; a narrow single-wavelength improvement cannot silently count as success; an inferior sampled candidate is clearly identified before application. This requires no general optimizer.

3. **Make a bad result diagnosable in place.** Add a selected-sample details panel showing failed/warning diagnostics, power accounting and the affected component. Compare currently directs full diagnostics to CSV (`src/ui/comparison.ts:224–235`, `280–286`); the data already exist. Success: a reviewer explains an out-of-band gap and an imported-model warning without downloading a file or guessing from a curve.

## Keep, kill, next slice

Keep the pure API, strict schemas, SI core, independent geometry, frozen snapshots, explicit application, cancellation and honest model limits. Keep JSON as an advanced authoring surface. Kill manual variant names as the sole account of an experiment, and stop treating attractive overlays as completed insight. Defer broad PDK integration, arbitrary hierarchy and embedded LLM infrastructure.

**Strongest next slice:** one reproducible agent-authored three-variant study, loaded directly into Compare, with verified parameter differences and a clearly stated two-output target. Let the human alter one assumption and immediately see whether the conclusion survives. That is a plausible “wow” moment grounded in the architecture already present.
