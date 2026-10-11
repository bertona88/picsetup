# Independent review: practicing PIC circuit-designer perspective

**Reviewer:** AI reviewer adopting a practicing integrated-photonic circuit designer's perspective; not an external human expert. **Date:** 11 October 2026. Independent review; no other reviewer reports consulted.

## Verdict

I can sketch a useful interference argument here. I cannot yet make a useful device-design decision without exporting the data and rebuilding the engineering analysis elsewhere. This is a credible coherent-network teaching and hypothesis notebook, still a toy as a PIC design instrument. The displayed answers do not correspond closely enough to the questions a designer asks.

Concrete tasks: explaining why unequal MZI arms produce fringes works; choosing an MZI arm difference for a specified filter spacing is unqualified; checking a ring's extinction and linewidth can fail through sampling; comparing delay lines tells me almost nothing in the power plot. The most promising niche is a shareable, inspectable **pre-PDK design-review notebook** that makes assumptions and sensitivity visible.

I read the five requested contracts/status documents, inspected implementation, recipes and tests, and viewed all three requested screenshots. I reran `reference.test.ts`, `blocks.test.ts` and `goals.test.ts`: **55 tests passed**. I did not rerun the entire suite or interactively operate the browser. Hardware agreement, customer demand and PDK compatibility are **not verified**.

## Ranked findings

### 1. High — broadband plots rest on the wrong level of waveguide model for design

**Deliberate reduced scope, not a solver bug.** `playground/src/model/types.ts::Connection` contains one constant `neff`; propagation in `playground/src/solver/solve.ts::solveCircuit` uses that value across wavelength. `playground/src/blocks/index.ts::BLOCK_DEFINITIONS` defaults to 2.4. There is no independent group index or dispersion model.

Consequently, matching optical phase at one wavelength also fixes the modeled phase slope. That is restrictive precisely where the interface encourages 1500–1600 nm spectral reasoning. Ring FSR depends on group index; Ansys explicitly warns that a constant effective index does not reproduce the device FSR [1]. The same phase-slope issue applies to unequal-arm MZIs. Do not interpret the bundled SiEPIC couplers as making the surrounding circuit silicon-calibrated: their reference planes and modal matching remain unqualified in `PHOTONICS_MODEL_CONTRACT.md`.

**Consequence:** I cannot responsibly choose physical arm length from these fringes. Add a small, explicit waveguide model with reference wavelength, phase index, group index and declared validity before adding more device pictures. Do not invent silicon defaults without provenance.

### 2. High — the ring can appear to have a completely different notch

**Documented sampling limitation with a verified user consequence.** `playground/src/solver/sweep.ts::sweepWavelength` uses a uniform grid; `MAX_SWEEP_POINTS` is 1001. `playground/src/ui/comparison.ts::renderPlot` connects the samples with line segments. There is no convergence assessment.

Using the local bundled API and `examples/recipes/ring.json`, I changed only ideal coupling to `1 − 10^(−0.1/10)`. Ring parameters: length 100 µm, index 2.4, loss 1000 dB/m, phase 0 rad, input 1 mW. At resonance `2.4 × 100 µm / 155 = 1548.3870968 nm`, computed through transmission is approximately `3.8e−24`. Over 1500–1600 nm, the lowest sampled transmission within ±1 nm of that resonance is **99.11%, 90.48%, and 11.05%** for 101, 201, and 1001 points. Other resonances hit grid endpoints; these figures concern this interior resonance, not the global minimum.

**Consequence:** even maximum resolution can radically misstate extinction at an interior notch. The warning in the contract is honest but insufficient as an instrument affordance. A resolved local scan or explicit “unresolved” state matters more than another ring template.

### 3. High — useful fields exist, but useful measurements are missing from the workflow

**Product limitation.** `SolveResult` retains complex port fields, and `SweepSample` retains detector phase. However, `playground/src/ui/spectrum.ts::renderPlot` and `comparison.ts::renderPlot` show normalized power; comparison selects one detector per variant. The screenshots confirm this emphasis.

I need insertion loss and crosstalk in dB, extinction, phase difference, and eventually group delay with a stated reference plane and phase-unwrapping/resolution checks. These are not decorative statistics: a lossless all-pass ring changes phase despite unity transmitted power, and changing `examples/recipes/delay-line.json` length does not change power when guide loss is zero. The current preferred observable conceals the reason those circuits exist. Full internal fields in the API are excellent; making the user write their own analyzer forfeits much of the product's value.

### 4. Medium-high — “Tune” answers an easy question, not a design question

**Deliberate scope plus product judgment.** `playground/src/experiments/goals.ts::GoalRequest` permits one detector, one wavelength and one scalar parameter, with only minimize/maximize power. `runGoalSearch` correctly preserves failed candidates and calls the result sampled-best. I found no optimizer correctness bug.

But nulling an ideal MZI at one wavelength is an introductory exercise. My practical question is: “Which phase setting keeps unwanted output below my specification across this band and these phase-error cases?” No band objective or corner evaluation exists. Similarly, phase in radians is not a heater control model. Defer voltage sliders, thermal animation, large meshes and additional starter circuits until a defensible objective and robustness view exist. A richer catalog will not fix the absence of a decision criterion.

## Two experiments worth building

1. **MZI design-review card.** Compare three arm differences with declared phase/group indices; show both outputs in dB, bandwise worst crosstalk and insertion loss, then apply explicit phase-error scenarios. Initially call these assumed scenarios, not manufacturing yield. Success: a reviewer can identify the best variant, explain the controlling assumption, and reproduce it from the notebook without writing code. Validate against an independent dispersive closed form.
2. **Resolved ring measurement.** Starting from the exact case above, refine a selected notch, display sampled points, and report extinction/linewidth only after a resolution check. Success: resonance and linewidth stabilize under refinement within a declared tolerance, or the tool visibly declines the measurement. Add phase and circulating power only with clear normalization. Ring analysis in established circuit tools explicitly extracts FSR and Q [2].

## Preserve and choose

Preserve physical-length/layout separation, source-free editable blocks, immutable comparison snapshots, strict recipes, explicit unavailable results, and honest passivity accounting. `tests/reference.test.ts` checks independent complex MZI/ring formulas; that is substantially stronger than checking attractive plots.

**Recommended next slice:** the MZI design-review card, including the minimal dispersive guide model and two-output band metrics. Keep the existing ring available but visibly mark unresolved scans. I would choose this tool when a colleague can send me a small experiment whose assumptions, tradeoffs and failure margins I can inspect in minutes. I would not choose it merely because it draws a pleasant MZI.

## Primary references checked

1. Ansys, *Ring resonator getting started — Final parameter extraction*, constant-index/FSR limitation: https://optics.ansys.com/hc/en-us/articles/360042800213-Ring-resonator-getting-started-Final-parameter-extraction
2. Ansys, *Ring resonator using INTERCONNECT primitive elements*, group-index FSR and peak analysis: https://optics.ansys.com/hc/en-us/articles/360042323794-Ring-resonator-using-INTERCONNECT-primitive-elements

Minimal reproduction from the repository root, using the existing API build:

```sh
node --input-type=module <<'NODE'
import {readFileSync} from 'node:fs';
import {compileRecipe,solveCircuit,sweepCircuit} from './playground/dist-api/api.mjs';
const {circuit}=compileRecipe(JSON.parse(readFileSync('./playground/examples/recipes/ring.json')));
circuit.components.find(c=>c.model==='coupler').params.coupling=1-10**(-0.1/10);
const resonance=2.4*100e-6/155;
console.log('exact',solveCircuit({...circuit,wavelengthM:resonance}).detectors.through.powerW/0.001);
for(const points of [101,201,1001]){
  const {samples}=await sweepCircuit({id:points,circuit,startM:1500e-9,stopM:1600e-9,points});
  console.log(points,Math.min(...samples.filter(s=>Math.abs(s.wavelengthM-resonance)<1e-9).map(s=>s.detectors.through.powerW/0.001)));
}
NODE
```
