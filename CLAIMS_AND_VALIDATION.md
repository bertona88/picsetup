# Claims and validation

## Candidate status

The application under `app/` is a greenfield successor candidate. The current public site continues to use the immutable `prototype/` snapshot unless a separately authorized release replaces it.

## Supported claims

Subject to the automated checks and the declared model contract, the candidate may be described as:

- a browser-based semantic PIC and publication-figure workbench;
- an interactive reduced-order coherent scattering-network simulator;
- a typed hybrid figure editor whose non-optical domains remain outside the optical solve;
- a Paper Figure Studio with content-cropped SVG and high-resolution PNG export;
- a sender and neutral receiver-adapter proposal for the versioned `setup-port/1` OpticalSetup boundary;
- a dependency-light local application that can produce a standalone HTML build.

The included component models are analytical, imported, pedagogical, or reduced order as their definitions state. Output is suitable for topology exploration, system-level reasoning, teaching, and figure composition within those assumptions.

## Prohibited claims

Without additional primary validation, the candidate must not be described as:

- fabrication ready, mask-layout ready, DRC clean, or foundry qualified;
- a calibrated predictor of device, thermal, electrical, RF, control, biological, behavioral, operational, or performance outcomes;
- a full-vector, multimode, polarization-resolved, nonlinear, or full-wave electromagnetic solver;
- proof that imported S-parameters are passive, causal, correctly referenced, or process valid;
- a deployed OpticalSetup receiver, live synchronization layer, or coupled PicSetup/OpticalSetup solver;
- the current production site merely because local tests or a standalone build pass.

## Validation matrix

| Boundary | Evidence | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| JavaScript syntax | `npm run app:check` | Runtime and receiver modules parse in Node | Browser behavior or model correctness |
| Model and interface regression | `npm run app:test` | Declared invariants, exports, typed-domain isolation, template, and bridge round trips | Full browser interaction or external receiver integration |
| Standalone packaging | `npm run app:build` | Multi-file source can be bundled into one local HTML artifact | Public deployment |
| Browser smoke | Serve `app/` and exercise the acceptance journey | Current browser loads and primary UI/export actions work | Cross-browser completeness or production acceptance |
| Prototype preservation | Compare the `prototype/` tree against the base commit | Prior-art snapshot was not modified | Production availability |
| Pull-request CI | GitHub Actions validation on the proposed commit | Clean-run reproducibility in the hosted runner | Merge, release, DNS, or live-site replacement |
| Live verification | Inspect the deployed URL and release identity after an authorized deployment | Public artifact and selected smoke behavior are live | Scientific calibration or user acceptance |

## Export claims

Semantic JSON preserves the hybrid graph and bridge manifest. SAX YAML and gdsfactory Python are topology scaffolds restricted to physical optical content; they are not PDK-qualified layouts or substitutes for foundry compact models.

SVG/PNG output is publication-oriented composition. A stylized plot panel is diagram content unless replaced by exported numerical data. Image panels preserve user-supplied imagery but do not validate its provenance or quantitative meaning.

## Reporting results

Validation reports must give exact pass/fail counts, record warnings, and identify skipped manual or external checks. Tests, browser smoke, deployment, OpticalSetup receiver adoption, and public acceptance are separate completion boundaries.
