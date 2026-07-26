# Setup Universe — implementation brief

## Product bar

Every owned domain opens directly into a playable browser instrument. There is no
landing-page interstitial. A useful setup has:

- a live model on first paint;
- at least three meaningful controls;
- direct canvas interaction;
- a measurable readout that responds to controls;
- play/pause, reset, presets, and shareable state;
- an explicit statement of what the model does and does not simulate.

## Visual thesis

A nocturnal scientific workbench cut from smoked glass and phosphor ink. Each
domain gets one luminous field signature inside a shared, restrained instrument
chassis.

## Content plan

1. Thin toolbar: identity, scenario, run/reset/share, Setup Universe.
2. Full-height working surface: the simulation is the dominant visual.
3. Left rail: experiment presets, interaction instructions, model scope.
4. Right inspector: parameters and live measurements.
5. Universe drawer: direct hops between all instruments.

## Interaction thesis

- The model is already moving when the page opens.
- Pointer input perturbs the physical/system state directly.
- Parameter changes produce a visible field/trajectory change and updated data.
- The Universe drawer moves like an instrument tray, not a marketing menu.

## Module contract

Each file in `assets/simulations/` exports `setup`:

```js
export const setup = {
  id: "pic",
  host: "picsetup.com",
  name: "PicSetup",
  field: "Integrated photonics",
  accent: "#55e6d8",
  summary: "One short operational sentence.",
  scope: "One honest sentence about the model.",
  limits: ["Bound one", "Bound two"],
  interaction: "Drag …",
  presets: [{ id: "balanced", label: "Balanced MZI" }],
  mount(context) {
    // context: canvas, controls, metrics, toolbar, setStatus, setTick,
    // createRange, createSelect, createToggle, createAction, setMetrics,
    // resizeCanvas, pointerPosition, clamp, lerp
    // Return reset/play/pause/applyPreset/getState/setState/destroy methods.
  }
};
```

The public smoke-test contract is:

- `body[data-setup-id]`
- `[data-testid="simulation-canvas"]`
- `[data-testid="play-toggle"]`
- `[data-testid="simulation-tick"]`
- `[data-testid="reset"]`
- changing a control or canvas state changes the simulation tick/readouts.

## Exact universe roster

- opticalsetup.com → existing LucaGenchi OpticalSetup canvas
- picsetup.com
- electricalsetup.com
- biologicalsetup.com
- gravitysetup.com
- twophotonlithography.com
- egosetup.com
- quantumsetup.ai
- noeticsetup.com
- computationsetup.com
- logisticsetup.com
- molecularsetup.com

