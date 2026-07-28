# PicSetup

> **Preliminary Setup Universe wrapper.** The current demo is temporary; the full simulator is expected to be redesigned and rebuilt substantially from scratch.

- **Live prototype:** https://picsetup.com/
- **Prototype release verified:** 2026-07-26 (`20260726T002235Z-478235af2650`); check the URL for current availability
- **Field:** Integrated photonics
- **Status:** Greenfield successor candidate with a preserved production prototype

## Vision

The intended PicSetup product is an integrated-photonics workbench for composing waveguides, couplers, resonators, phase shifters, sources, detectors, and electrical controls with explicit coherent-field and scattering models.

PicSetup is part of the **Setup Universe**: independently deployed scientific and systems workbenches intended to become interoperable. Over time, setups should be able to orchestrate or interface with one another through explicit, versioned, unit-aware ports without transferring ownership or copying private implementation state.

**First accepted end-to-end slice:** Build one connectable Mach–Zehnder interferometer whose two output powers respond to wavelength and phase through a documented scattering model, with conservation and reference-plane tests.

**Model boundary:** PicSetup owns guided photonic networks; OpticalSetup owns free-space instrument propagation and geometry; ElectricalSetup owns electronic drive and readout dynamics.

**Claim gate:** No fabrication-ready, layout-signoff, or calibrated-device claim is allowed until modes, polarization, wavelength domain, loss model, and port reference planes are validated.

## Important starting point

Read [AGENTS.md](./AGENTS.md) before planning or implementing work.

The present browser demo should not constrain the next architecture. The candidate successor is governed by `VISION.md`, `PHOTONICS_MODEL_CONTRACT.md`, `INTERFACE_CONTRACT.md`, `CLAIMS_AND_VALIDATION.md`, and `ACCEPTANCE_TESTS.md`.

## Successor candidate

`app/` contains the dependency-light greenfield workbench candidate. It combines an editable semantic PIC canvas, compact coherent-network analysis, typed cross-domain figure connections, publication SVG/PNG export, and versioned OpticalSetup bridge ports.

Paper Figure Studio can combine simulated photonic objects with diagram-only instruments, RF/electrical/control wiring, plots, image panels, annotations, and chip boundaries without admitting non-optical links into the coherent solve. Its included hybrid template demonstrates the complete figure workflow.

The `setup-port/1` bridge is a deterministic document handoff. PicSetup emits an explicit scalar guided-mode boundary; OpticalSetup retains authority over free-space geometry, beam waist, numerical aperture, wavefront, and receiver-side scene construction. The neutral receiver adapter under `app/integrations/opticalsetup/` is a focused integration proposal, not a deployment to Luca Genchi's repository.

To validate or serve the candidate locally:

```sh
npm run app:validate
npm run app:serve
```

Then open http://127.0.0.1:4174/.

The candidate is not deployed by the current Pages workflow. Acceptance, merge, and replacement of the live prototype remain separate decisions.

## Prototype model boundary

The following describes only the current reference prototype, not the intended simulator.

**Exact current scope:** A coherent, single-mode 2 × 2 scattering-matrix model with wavelength-dependent phase and lumped arm loss.

**Known limits:**

- It does not solve waveguide modes, bends, reflections, or polarization.
- Dispersion is reduced to fixed effective/group indices; thermal crosstalk and detector noise are omitted.

## Current prototype snapshot

`prototype/` preserves the exact shared browser-prototype source associated with production release `20260726T002235Z-478235af2650`. Its recorded deployed-source SHA-256 is `478235af26508aa70aa2af5f0196c9868b92ded1bed88106a9aa1a1cd86f8ba5`.

The snapshot contains all current Setup Universe demos because that release uses one shared, host-routed runtime. It is immutable, reference-only prior art: do not build the new architecture inside it. Moving, archiving, or removing it requires explicit user authorization after an accepted successor and preserved provenance.

To run the snapshot locally:

```sh
npm run prototype:test
npm run prototype:check
npm run prototype:serve
```

Then open http://127.0.0.1:4173/?setup=pic.

These commands validate only the legacy prototype. The successor has its own tests and build under `app/`; neither suite demonstrates a production deployment.

## Setup Universe

[ElectricalSetup](https://github.com/bertona88/electricalsetup) · [BiologicalSetup](https://github.com/bertona88/biologicalsetup) · [GravitySetup](https://github.com/bertona88/gravitysetup) · [TwoPhotonLithography](https://github.com/bertona88/twophotonlithography) · [EgoSetup](https://github.com/bertona88/egosetup) · [QuantumSetup](https://github.com/bertona88/quantumsetup) · [NoeticSetup](https://github.com/bertona88/noeticsetup) · [ComputationSetup](https://github.com/bertona88/computationsetup) · [LogisticSetup](https://github.com/bertona88/logisticsetup) · [MolecularSetup](https://github.com/bertona88/molecularsetup)

OpticalSetup remains in [LucaGenchi/optics-sketch](https://github.com/LucaGenchi/optics-sketch).

## License

No open-source license has been selected yet.
