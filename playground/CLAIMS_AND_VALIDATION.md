# Claims and validation — playground only

M0/M1 implemented and verified. See [HANDOFF.md](HANDOFF.md) for exact tested commit, commands, 87 passing numerical/editor tests and the passing Chromium construction/save/reopen journey. Real UI evidence and browser metadata are committed in `evidence/`.

Supported claim: a locally running analytical single-mode CW scattering playground with editable topology, live powers/phases, explicit propagation and recoverable portable documents. Geometry does not supply optical length. Numerical validation uses independent algebraic oracles and accounting, not hardware measurements.

No calibrated components, qualified external dataset, reusable modules, full M0–M5 completion, spectral sweep worker, performance qualification, production deployment, offline reload or external receiver integration is claimed. No external implementation code or model data reused. Firefox/WebKit remain untested.

Each future milestone needs its own evidence; a successful build alone does not establish browser behavior or scientific fidelity.
