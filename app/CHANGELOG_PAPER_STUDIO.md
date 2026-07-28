# PicSetup Paper Figure Studio — implementation notes

## What changed

The uploaded PicSetup Lab source was extended from a compact PIC analysis canvas into a hybrid analysis-and-publication workbench.

### Paper Figure Studio

- Dedicated **Paper** entry point in the top bar.
- White or transparent paper preview, optional export grid and port markers.
- Content-cropped SVG export with embedded styles.
- High-resolution PNG export; the included example exports at 2400 × 1796 px.
- Editable component-label placement, metadata visibility, X/Y label offsets, and rotation.
- Editable connection labels, X/Y offsets, and start/end/bidirectional arrows.
- Background chip boundary, panel letters, annotations, image/micrograph panels, and stylized plot panels.
- Included **Hybrid PIC paper figure** template combining a PIC, OpticalSetup boundaries, RF/electrical/control wiring, instrumentation, plot, micrograph placeholder, and operating-condition callout.

### New photonic and system vocabulary

New compact or interface elements include:

- edge coupler;
- OpticalSetup bridge port;
- spiral delay line;
- four-channel AWG;
- thermo-optic heater with an electrical control terminal.

New publication/system elements include:

- fiber array;
- polarization controller;
- optical instrument;
- RF source;
- electrical amplifier/TIA;
- oscilloscope;
- controller;
- generic laser/receiver/driver/processor/sample system block;
- chip boundary;
- image panel;
- plot panel;
- text annotation;
- panel label.

### Typed graph and solver boundary

Connections now have explicit `optical`, `electrical`, `rf`, `control`, or `annotation` domains. Ports are checked for compatibility. Only optical links enter the coherent scattering solve; the other domains remain editable and exportable without being misinterpreted as waveguides.

The semantic netlist preserves the full hybrid figure graph. SAX and gdsfactory handoffs intentionally contain only physical optical topology.

### OpticalSetup bridge

PicSetup now emits the versioned `setup-port/1` contract. A bridge records:

- stable bridge identity;
- source document/component and target application;
- interface direction and physical kind;
- wavelength;
- PicSetup-side and OpticalSetup-side powers with an explicit power reference;
- coupling efficiency;
- polarization and guided mode;
- boundary phase;
- CW/pulsed state, repetition rate, and pulse duration;
- capabilities, omissions, reference frame, and return URL.

Opening a bridge launches:

```text
https://opticalsetup.com/sketch/?incomingBridge=<payload>&bridgeSchema=setup-port/1
```

The source also includes a framework-independent receiver parser at:

```text
integrations/opticalsetup/receiver-adapter.js
```

That adapter validates and normalizes the handoff without inventing beam waist, NA, wavefront, or laboratory coordinates. OpticalSetup still needs to map the normalized descriptor into its own scene/component creation API and deploy that receiver. The current integration is a deterministic document handoff, not live synchronization or a distributed multi-physics solve.

## Validation

- JavaScript syntax checks passed for every runtime and receiver-adapter module.
- Full Node regression suite: **19/19 passed**.
- Browser smoke test passed for:
  - loading the 19-object / 14-link hybrid template;
  - connection figure controls;
  - component figure controls;
  - OpticalSetup bridge actions;
  - Paper Figure Studio;
  - SVG export;
  - PNG export;
  - bridge-manifest export;
  - generated OpticalSetup URL and query payload.
- No browser runtime errors were produced in the smoke run. The only warnings came from intentionally loading the standalone file in a null-origin test page, where `localStorage` is unavailable; normal HTTP serving avoids that condition.

## Run

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

Rebuild the portable one-file version with:

```bash
python build_single.py
```

Run tests with:

```bash
node --test tests/*.test.mjs
```
