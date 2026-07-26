# AGENTS.md

## Repository status

This repository is the preliminary wrapper for **PicSetup** (picsetup.com), one system in the **Setup Universe**.

The current browser demo is only a starting artifact. It is not the final product vision, not the final architecture, and not a commitment to the current UI, controls, numerical model, or source layout. The intended PicSetup simulator will be designed and implemented substantially from scratch.

Production release `20260726T002235Z-478235af2650` was verified at https://picsetup.com/ on 2026-07-26. Current availability is external state and must be checked live rather than inferred from this repository.

Its exact source snapshot is preserved under `prototype/` as immutable, reference-only prior art. It is not the architecture that future work should extend. Do not modify that snapshot as part of the rebuild. It may be moved, archived, or removed only with explicit user authorization after a successor has been accepted and its provenance retained.

## Core directive

- Approach the next simulator as a greenfield scientific product.
- Do not optimize or expand the prototype merely because it already exists.
- Before substantial implementation, establish the new product and model boundaries in repository-visible documents:
  - `VISION.md`
  - `PHOTONICS_MODEL_CONTRACT.md`
  - `INTERFACE_CONTRACT.md`
  - `CLAIMS_AND_VALIDATION.md`
  - `ACCEPTANCE_TESTS.md`
- A convincing animation is not sufficient. The intended simulator needs explicit state, units, governing rules, numerical methods, direct manipulation, measurements, experiments, failure states, and validation appropriate to its claims.
- Label qualitative, reduced-order, heuristic, and pedagogical behavior honestly. Never silently promote it to calibrated physical prediction.
- Treat physical, biological, behavioral, social, operational, and performance predictions with the same evidence discipline: state the validity domain, uncertainty, and nonclaims.

## PicSetup direction

The intended PicSetup product is an integrated-photonics workbench for composing waveguides, couplers, resonators, phase shifters, sources, detectors, and electrical controls with explicit coherent-field and scattering models.

**First accepted end-to-end slice:** Build one connectable Mach–Zehnder interferometer whose two output powers respond to wavelength and phase through a documented scattering model, with conservation and reference-plane tests.

**Ownership boundary:** PicSetup owns guided photonic networks; OpticalSetup owns free-space instrument propagation and geometry; ElectricalSetup owns electronic drive and readout dynamics.

**Claim gate:** No fabrication-ready, layout-signoff, or calibrated-device claim is allowed until modes, polarization, wavelength domain, loss model, and port reference planes are validated.

Its Setup Universe interface should eventually exchange optical ports, spectra, phase, loss, detector signals, and control voltages with OpticalSetup and ElectricalSetup. This direction is provisional until a written interface contract is reviewed.

## Setup Universe doctrine

- PicSetup is one composable setup inside a larger universe of scientific and systems workbenches.
- Setup Universe repositories are independently deployed workbenches intended to become interoperable; that interoperability does not exist merely because the repositories share a family name.
- Setups should eventually be able to contain, drive, observe, or exchange well-defined state with other setups. “Contain” means orchestrate or reference another independently owned setup through an interface; it does not mean vendor its source, copy its internal state, or transfer authority over it.
- Cross-setup interoperability must use explicit, versioned interfaces. Every payload must identify schema version, units or an explicit dimensionless convention, coordinate frame where relevant, clock or timebase, uncertainty, provenance, and source-of-truth ownership.
- Do not couple repositories through undocumented globals, copied internal state, visual imitation, or assumptions about another setup's private implementation.
- There is no universal interface yet. Define only the ports and conversions justified by an actual use case; keep unknowns explicit.
- OpticalSetup is externally owned and maintained in Luca Genchi's existing repository. Changes there require a focused proposal or pull request and must preserve Luca's ownership and review boundary.
- Each Setup Universe repository remains independently understandable, testable, and deployable even when it participates in a larger composed experiment.

## Prototype boundary

- `prototype/` is the immutable reference snapshot associated with production release `20260726T002235Z-478235af2650`, verified on 2026-07-26.
- The shared snapshot contains multiple Setup Universe demos because the current production deployment is a host-routed common runtime.
- The snapshot's tests validate only the legacy prototype. They are not acceptance tests for the future PicSetup product.
- Do not infer future APIs or styling from it.
- Keep the live demo online unless the user explicitly authorizes a replacement deployment.
- Do not deploy from this repository or change DNS as an incidental consequence of local development.

## Scientific and engineering quality

- Prefer primary scientific references and document modeling assumptions.
- State coordinate systems, units, signs, time bases, boundary conditions, and solver stability limits.
- Keep deterministic seeds or reproducible fixtures where stochastic behavior exists.
- Test invariants and conservation or accounting laws where applicable, not only DOM presence.
- Validate numerical behavior at parameter extremes and include adversarial or degenerate cases.
- Distinguish model validation, browser smoke testing, deployment, and public acceptance as separate completion boundaries.

## Working agreement

- Read this file and the repository's current status documents before editing.
- Preserve unrelated user work and inspect repository state before commits.
- Keep changes scoped to this repository unless cross-repository work is explicitly requested.
- Do not push, deploy, publish, message collaborators, or alter external services without authority for that action.
- When the greenfield rebuild begins, prefer a small end-to-end scientific experiment over a broad mock interface.
