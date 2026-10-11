# Claims and validation — playground only

This iteration adds **early SiEPIC component and spectral experiments** to the verified M0/M1 playground. It does not close all M2/M3 requirements or claim full M0–M5 completion. Current features are a pinned open component dataset, coherent composition with the analytical components, coupler and unequal-arm MZI comparisons, worker-based wavelength sweeps, request-specific cancellation and CSV export.

The supported scientific claim is numerical evaluation of the declared scalar-mode CW equations and the bundled table under documented interpolation. Geometry does not supply optical length. Physical mode matching, reference-plane coordinates, process variation and measured accuracy remain unqualified. No calibrated-device, fabrication, passive-network certification, production deployment, offline reload or external receiver integration is claimed. SiPANN and SAX runtime integrations, arbitrary custom-model imports and reusable modules remain open. Firefox/WebKit, accessibility and performance qualification remain open.

## Evidence from this iteration

- Exact source provenance: the SiEPIC/Simphony raw blob, both MIT notices, pinned revisions, checksums and primary convention references are committed with [the dataset](models/siepic-dc-200nm-10um/manifest.json).
- `python scripts/convert_siepic.py --check` passed. Conversion preserves all 1,616 complex values after the declared phasor conjugation.
- `python scripts/verify_siepic.py --check` passed using an independent regex/NumPy parser. Complete raw matrices match canonical values with maximum observed absolute error 0. NumPy SVD records `σmax` from 0.9852978180 to 1.0022352696, including 17/101 slight passivity violations; reciprocity is exact at source precision.
- `python scripts/verify_siepic_mzi.py` passed. A separate reduced eight-port incident-wave NumPy solve produces complex detector fields and complete budgets at 1500, 1525, 1550, 1575 and 1600 nm for the 80/100 µm SiEPIC MZI. Maximum reference equation residual is `7.67e−18`; maximum budget imbalance is `4.34e−19 W`. This is an independent numerical oracle, not physical ground truth.
- Source interpolation is explicitly audited: at 1550 nm Cartesian interpolation yields approximately 0.9716 total output fraction, while weighted neighboring sample powers are approximately 0.9834. The difference is an interpolation effect. No clipping, passivity correction or artificial damping hides it.

Fresh TypeScript/build results and fresh browser evidence for this iteration must be recorded in [HANDOFF.md](HANDOFF.md) after execution. They are **pending at this documentation checkpoint**. Historical M1 screenshots and browser metadata do not validate the new data adapter, spectral controls or CSV flow.

## Historical baseline

M0/M1 was verified with 87 numerical/editor tests and one passing real Chromium construction/save/reopen journey. See the historical section of [HANDOFF.md](HANDOFF.md). Analytical oracles cover complete complex matrices, MZI phase/power, line propagation, conservation and ring closed forms. Ring solver fixtures alone do not establish a complete interactive ring milestone.

Every milestone requires its own evidence. A successful build establishes neither browser behavior nor scientific fidelity; a source conversion check establishes neither calibrated device performance nor the correctness of every composed circuit.
