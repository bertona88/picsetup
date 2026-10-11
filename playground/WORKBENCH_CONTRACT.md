# Sketch, fork and compare — implementation boundary

The owner's next instruction is to build the proposed circuit API, reusable blocks and comparison workflow. This extends the existing scalar coherent CW model; it does not change the physical solver or qualify the imported data as calibrated hardware.

- A versioned JSON recipe describes named parts and named port connections in SI units. Strict compilation produces the same editable flat circuit document used by the canvas. No text is evaluated as code, and no built-in language-model service is implied.
- The initial reusable blocks are source-free MZI, all-pass ring, splitter tree and delay line templates. Each insertion expands into independently editable primitive components and explicit propagation links with fresh identities. This is template reuse, not arbitrary nested module simulation.
- Automatic arrangement changes only component positions, curve bends and viewport. It must preserve the semantic circuit exactly, including optical lengths and phases.
- A comparison notebook stores up to six named, complete circuit snapshots and a shared wavelength grid. Capturing, loading, renaming and replacing snapshots are explicit operations. Editing the live canvas cannot mutate an existing comparison variant.
- Comparison sweeps use the existing evaluator and cancelable worker discipline. Invalid samples remain unavailable. Exports retain the exact model versions, parameters, units, provenance and sampled results needed to reproduce a comparison.
- Bounded goal searches, if exposed, evaluate a declared finite grid for one parameter and report the best sampled result, failures and boundary hits. They do not claim global optimization or fabrication fitness.

Acceptance is an end-to-end recipe → arranged editable circuit → distinct saved variants → computed overlay → portable reopen journey, with numerical equivalence and snapshot-isolation checks. Browser evidence and implementation checkpoint belong in HANDOFF.md after execution. Production deployment and external service integration remain separate work.
