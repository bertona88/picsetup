# Sketch, fork and compare — implementation boundary

The owner's next instruction is to build the proposed circuit API, reusable blocks and comparison workflow. This extends the existing scalar coherent CW model; it does not change the physical solver or qualify the imported data as calibrated hardware.

- A versioned JSON recipe describes named parts and named port connections in SI units. Strict compilation produces the same editable flat circuit document used by the canvas. No text is evaluated as code, and no built-in language-model service is implied.
- The initial reusable blocks are source-free MZI, all-pass ring, splitter tree and delay line templates. Each insertion expands into independently editable primitive components and explicit propagation links with fresh identities. This is template reuse, not arbitrary nested module simulation.
- Automatic arrangement changes only component positions, curve bends and viewport. It must preserve the semantic circuit exactly, including optical lengths and phases.
- A comparison notebook stores up to six named, complete circuit snapshots and a shared wavelength grid. Capturing, loading, renaming and replacing snapshots are explicit operations. Editing the live canvas cannot mutate an existing comparison variant.
- Comparison sweeps use the existing evaluator and cancelable worker discipline. Invalid samples remain unavailable. Exports retain the exact model versions, parameters, units, provenance and sampled results needed to reproduce a comparison.
- Bounded goal searches, if exposed, evaluate a declared finite grid for one parameter and report the best sampled result, failures and boundary hits. They do not claim global optimization or fabrication fitness.

Acceptance is an end-to-end recipe → arranged editable circuit → distinct saved variants → computed overlay → portable reopen journey, with numerical equivalence and snapshot-isolation checks. Browser evidence and implementation checkpoint belong in HANDOFF.md after execution. Production deployment and external service integration remain separate work.

## Review response: trustworthy design studies

The owner authorized implementation of the four independent reviews on 2026-10-11. The next slice preserves the scalar circuit kernel and adds:

- A baseline-aware sampled goal decision. Raw candidate measurements remain inspectable; numerical-accounting/conditioning failures cannot be recommended as improvements. Apply requires a trustworthy improvement over the current setting at the target wavelength.
- One pinned dispersive SiEPIC strip-guide coefficient set. Connections may explicitly select its exact identity/version; their length and user-declared loss remain independent. The reference effective index is locked to the selected coefficient set. A declared 1500–1600 nm evaluation window is an application assumption, not a source-qualified fit band or proof of modal matching.
- Optional recipe provenance in a circuit document, retaining the source recipe and its semantic key. Layout, labels and titles do not invalidate it; changed physics does. It is authoring context, not solver hierarchy or authority over edited state.
- A `picsetup-notebook/2` engineering study with explicit desired/unwanted detector mappings, baseline variant, sampled band targets and bounded assumed phase-error scenarios. Classic `/1` notebooks remain supported. Semantic differences are computed from actual circuits. Metrics state their sampled domain and numerical quality; phase scenarios are not manufacturing yield.
- A browser notebook API that atomically hands agent-authored studies to Compare, with exact portable reopen, both-output views and in-place diagnostics.
- A focused ideal-ring resolution experiment. Its known topology permits model-derived resonance seeds and bounded refinement; linewidth/extinction metrics require explicit resolution checks. It makes no generic resonance-discovery or arbitrary imported-ring qualification claim.

Acceptance includes all three reproduced review cases, independent dispersive propagation and study metrics, notebook bridge/reopen, baseline and numerical-quality goal rejection, and a shifted-grid critical-ring browser journey. Preserve prior analytical/imported-model evidence and add fresh screenshots and tested commit metadata.
