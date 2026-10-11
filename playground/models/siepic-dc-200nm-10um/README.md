# SiEPIC coupler experiment

Real, openly licensed tabulated complex data from the SiEPIC EBeam PDK via Simphony. This is a **200 nm gap, 10 µm coupling-length, TE mode-1** directional coupler, not an ideal adjustable splitter. All **16 complex S entries at 101 frequencies** are retained, including reflections and small back-coupling. The raw file is byte-identical in the pinned Simphony and upstream SiEPIC revisions documented in [manifest.json](manifest.json).

The source covers **1499.997288–1600.002444 nm** (187.370–199.862 THz). The nominal 125 GHz frequency grid has 124/125 GHz steps due to stored precision. `data.json` stores strictly ascending `frequencyHz` and `s[sample][output][input]`, with `{re, im}` coefficients. The source headers specify TE, mode 1, and magnitude/phase values; phase is in radians. Source port numbering `[1,2,3,4]` maps to schematic `[L0,L1,R0,R1]`. All four are bidirectional ports.

## Phase and power

Ansys documents `exp(-iωt)` time dependence and power-normalized optical port scattering amplitudes. SiEPIC documents FDTD/MODE methodology for this component; Simphony reads `magnitude * exp(+i phase)` and its waveguide propagates as `exp(+iβL)`, consistent with that source convention. The converter **conjugates each coefficient exactly once** for the playground's `exp(+iωt)` convention. It leaves magnitudes and native port planes unchanged. See the primary source links in the manifest.

Spatial coordinates of the source reference planes, de-embedding offsets, modal fields, process corner, temperature and uncertainty are **not supplied**. Native phases can be used as opaque component boundaries for exploratory circuits, with added guides explicitly measured from those boundaries. No physical-layout length, fabrication accuracy, phase calibration, or foundry qualification follows from these experiments. The source TE mode-1 label is not an independently verified modal-field match to another component.

## Preserve the imperfections

The raw full matrix has a largest singular value between **0.9852978180 and 1.0022352696**. **17/101 samples** exceed one by more than `1e-6`. The worst coherent power ratio is approximately **1.00447554**. Single-port excitation alone does not detect every passivity violation; the full complex matrix audit does. Original reciprocity is exact at stored precision. No gain clipping, passivity enforcement, reciprocity forcing, renormalization, smoothing or reference-plane adjustment is applied.

Status: **experimental, not passive-certified**. Coherent experiments expose the original table's imperfections. Avoid interpreting artificial gain in feedback loops as a physical amplifier. Interpolation is linear in real and imaginary coefficients versus frequency, and queries outside the exact source band are rejected. The approximately 1 nm source sampling does not establish the true response between samples or resolve a narrow resonator linewidth created later by feedback.

At 1550 nm, Cartesian interpolation gives fractions of a unit excitation at port 1 of approximately `0.0001592483, 0.0001284652, 0.7586734137, 0.2126389542` at ports 1–4. This is the table's response under the declared interpolation, not a calibrated hardware measurement.

Cartesian interpolation follows a chord between rotating complex samples, so it can lower the apparent power between source samples. At 1550 nm the interpolated total port-1 output is about **0.9716**, while the weighted neighboring sample powers total about **0.9837416**. This difference is an interpolation effect, not measured extra physical loss. The independent audit records both values; exact-grid sampling preserves the original sampled powers. No between-sample uncertainty estimate is available.

## Reproduce

From the repository root:

```sh
python scripts/convert_siepic.py --check
python scripts/verify_siepic.py --check
python scripts/verify_siepic_mzi.py
```

The converter uses Python's standard library. The independent verification requires NumPy and uses a separate regex/array parser without importing converter code. It compares all 1,616 complex values, checks the complete matrix norm, and records an independently interpolated 1550 nm matrix in [verification.json](verification.json). To regenerate the bundled JSON/report, omit `--check` on conversion and use `--write` on verification.

The separate MZI oracle combines the zero-phase upper guide segments analytically and solves an eight-port incident-wave system using NumPy. [mzi-reference.json](mzi-reference.json) contains complete complex detector fields and power budgets at five wavelengths for the 80/100 µm imported-coupler experiment. It executes no production TypeScript evaluator or solver and validates numerical composition, not physical hardware.

Licenses: [SiEPIC MIT](LICENSE-SIEPIC.txt), copyright Lukas Chrostowski and contributors; [Simphony MIT](LICENSE-SIMPHONY.txt), copyright Simphony Project Contributors and others. No upstream Python library implementation is included in the browser bundle.
