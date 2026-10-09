# PICSetup feasibility study
## Circuit simulation, product scope, and an OpticalSetup bridge

**Date:** 9 October 2026  
**Decision:** Conditional go for a validated circuit-and-experiment workbench. Do not start by building a general electromagnetic solver or a fabrication-signoff platform.

## Executive assessment

The idea makes technical sense, but the product boundary determines whether it is a tractable small-team project or a much larger engineering business.

The promising product is a browser-based scientific sketchpad: users compose a photonic circuit, inspect coherent power and phase, sweep wavelength, understand assumptions, and share the experiment or connect its declared optical ports to a laboratory setup. The unpromising starting point is a universal tool that predicts arbitrary nanophotonic geometry, packaging, fabrication yield, and high-speed electronics from a drawing.

You do not have to eliminate electromagnetics. You have to put it in the right place: characterize components with established tools or measurements, then compose their compact models. This is an established device-to-circuit workflow, not an attempt to substitute animation for physics. Luceda's compact-model interface explicitly supports scattering matrices and differential equations; Ansys demonstrates extracting an edge coupler's S-parameters and using them in circuit simulation. [9,15]

My recommendation is to continue with the circuit workbench, prioritize model credibility over component count, and validate demand before pursuing a commercial platform. Confidence is high in the feasibility of a bounded passive circuit engine, moderate in useful OpticalSetup interoperability, and low in any revenue prediction without users or commercial evidence.

## 1. Evidence and limitations of this study

I inspected the public OpticalSetup and PICSetup pages, the connected `bertona88/picsetup` repository, selected implementation files, the model/interface/validation contracts, and primary documentation for relevant alternatives. PICSetup source observations refer to commit `da78d2fced137a30d8474349066039f6eee40530`.

This is a source-and-document feasibility review, not an executed numerical acceptance audit. I did not run the complete repository test suite, conduct interactive browser testing, benchmark a browser/device matrix, compare predictions with measured chips, or interview customers. A local clone attempt was blocked by the execution environment's network resolution; connected GitHub reads provided the source evidence. Proposed schedules, targets, and commercial tests below are planning assumptions, not measured results.

No application code, production configuration, DNS, or external OpticalSetup repository needs to change to act on this study. The feasibility report is documentation only.

### What already exists

PICSetup is not just a domain or a fixed interferometer idea. Its repository contains a semantic circuit model, a simultaneous scattering-network solver, physical and schematic routing, a bridge payload, and explicit nonclaims. The governing model is `b = S a + s`, with connections producing `(I - S C)b = s`. Port amplitudes are normalized so squared magnitude is power in milliwatts. [1,2,5]

OpticalSetup is more capable than a pure intensity-ray sketcher: its documentation describes bounded same-source coherent interference through supported optics. It is still not a general spatial wave-propagation engine, and unsupported paths explicitly lose that coherent interpretation. This corrects the earlier overly broad characterization that it does not model interference. [8]

There is also a documentation inconsistency worth fixing: the PICSetup README says the candidate is not deployed by the current Pages workflow, whereas that workflow stages files from `app/`. The public site displays the richer workbench interface. This review does not certify the exact deployed build identity; documentation, release identity, and live behavior should be reconciled before making release claims. [6,7]

## 2. Three different products hidden inside the idea

| Product | What the user is asking | Feasibility judgment |
| --- | --- | --- |
| Teaching and scientific sketchpad | What does this topology do under declared assumptions? | Strong starting point for a small team |
| Characterized circuit workbench | What does a network of these particular measured or simulated components do? | Feasible with model ingestion, validation, and domain expertise |
| Full device and production-design platform | What will arbitrary geometry fabricate into, including process, packaging, and electronics? | Do not make this the initial commitment |

These are not simply three accuracy settings. They require different evidence, data rights, workflows, and support obligations. A compact model can be quantitatively accurate within a validated domain; a full-wave calculation can be inaccurate when material data, geometry, meshing, or boundaries are wrong. The important distinction is the question answered and the evidence supporting it. Established platforms already separate component physics from circuit models. [9,10,12]

**Recommended promise:** Sketch, simulate, and share photonic circuits using explicit models; connect them to optical experiments through declared ports.

Avoid promising that drawing a shape predicts a manufacturable chip.

## 3. Where the electromagnetic difficulty actually lives

### Composing known components is tractable

For a linear component at one optical frequency, incoming modal amplitudes `a` and outgoing amplitudes `b` satisfy `b = S a`. The scattering matrix contains the amplitude and phase response between declared modes and reference planes. Waveguides and connections add propagation. A circuit solver then solves the resulting complex linear network, including modeled reflections and feedback. SAX is an existing open-source example of this S-parameter approach. [11]

The practical distinction is:

**Given component responses, predict the connected circuit** — appropriate for PICSetup.

**Given arbitrary geometry and materials, derive those component responses** — normally delegated to mode, eigenmode-expansion, finite-element, finite-difference, or other specialized device tools. Tidy3D's component-modeling workflow is an example of obtaining S-parameters from device-level simulation. [12]

A representative network relation is:

`b = S a + s`, `a = C b`, hence `(I - S C)b = s`.

That is also the structure used by the inspected PICSetup candidate. It is the right abstraction to investigate, not a reason to rewrite the project around full-chip Maxwell equations. [1,2]

### Deriving trustworthy component models is harder

Changing waveguide width, etch depth, coupler gap, temperature, or polarization requires a defensible model for the resulting response. A plausible slider curve is not sufficient evidence. Use a deliberately small library with explicit provenance: analytical teaching models, characterized simulation-derived models, and measured or process-specific models. Do not silently upgrade one category into another.

Even modest index errors matter. As an illustrative calculation, for a 1 mm path at 1.55 micrometres, an effective-index error of `1e-4` gives `delta_phi = 2*pi*L*delta_n/lambda = 0.405 rad`, about 23.2 degrees. Those are assumed inputs, not a measured process tolerance. The example explains why apparently small model errors can matter in an interferometer.

### Current implementation implications

The inspected connection propagator uses a supplied constant effective index in `-2*pi*n_eff*L/lambda`. That is a legitimate bounded model, but does not supply a calibrated wavelength-dependent propagation constant. Realistic group delay and resonance spacing require a consistent dispersion model; group index should follow the derivative of that same phase model. [2]

The code detects a declared minimum bend-radius violation and warns that it does not automatically add bend loss. That is honest behavior, but it means physical-looking routing is not a bend-loss predictor. Similarly, nearby drawn waveguides should not imply modeled evanescent coupling unless an explicit coupling model represents the interaction. [2]

The linear solver uses dense complex matrices and elimination with pivoting. This is a reasonable baseline, not evidence of large-circuit scalability. Dense elimination has cubic arithmetic scaling in the number of modal port unknowns and quadratic storage; repeated wavelength and tolerance solves multiply the work. Benchmark before advertising a circuit-size limit. [3; complexity assessment from the inspected algorithm]

### Recommended implementation strategy

Retain the semantic graph and separate editor, models, solver, and rendering. Run calculations away from the interaction thread; profile before choosing WebAssembly or GPU work. Start with double-precision CPU numerics, cache model evaluations and topology metadata, and reuse a factorization for different excitations only when the matrix is unchanged. Larger networks can later use sparse methods and hierarchical reduction.

Use an existing engine such as SAX as an independent reference and optional export target. Do not assume Python/JAX can be dropped unchanged into the browser. Likewise, topology export is not equivalent to transferring calibrated models or obtaining a foundry-qualified layout. [11,20,21]

## 4. The OpticalSetup bridge

The bridge is meaningful when it represents an experiment, not just a transition between websites.

A first useful experiment is a tunable laser feeding a declared fiber or chip interface, passing through an MZI or ring filter, and reaching output fibers and detectors. PICSetup owns the guided network; OpticalSetup owns external geometry and instruments; interface models own the explicitly defined boundary conversion. Commercial device-to-circuit coupling examples show this separation is physically sensible. [15]

### Stage A: explicit document and power/spectrum handoff

Begin with one-way or manually refreshed boundary data: wavelength or sampled spectrum, power, mode, polarization assumption, coupling efficiency, reference side, provenance, and omissions. A user-supplied coupling efficiency is acceptable when labeled as such. It is not a prediction of alignment or diffraction.

The existing `setup-port/1` already provides much of this structure, including both interface-side powers and unresolved spatial information. Its contract correctly says it is a document handoff, not live co-simulation; the neutral receiver adapter is not proof of adoption by OpticalSetup. Preserve that distinction and require receiver-side review. [5]

### Stage B: coherent chip-as-component exchange

The next useful boundary is a frequency-dependent multiport response: an exported PIC behaves as a reusable block in an experiment. This requires solved complex amplitudes or a consistent chip S-matrix, reference-plane positions, phasor convention, normalization, mode basis, spectral sampling, and coherence relationships between sources. Reflections and feedback must be solved in a shared network or an explicitly converged coupling scheme, not a one-pass round trip between applications.

A concrete implementation risk exists now: `buildOpticalBridgePayload` sets `phaseRad` from the component parameter and declares `carrierPhase: true`; it does not derive the exported phase from the solved complex port field. This may be acceptable for an authored boundary condition, but it is not evidence that the computed chip-output phase is transferred. Rename the capability or implement solved-field transfer, then test an upstream phase shift crossing the boundary. [4]

Unknown coherence must remain unknown. OpticalSetup's bounded coherent support can help with selected paths, but exporting power, a polarization label, and a scalar phase does not reconstruct an arbitrary transverse wavefront. [8]

### Stage C: spatially predictive coupling

Predicting coupling changes from displacement, tilt, beam waist, polarization, or a grating's radiation profile needs field or mode information and a suitable propagation model. Mode-overlap calculations use the spatial electromagnetic fields; a geometric ray carrying power does not contain enough information. Ansys documents both overlap analysis and coupler-to-circuit workflows. [14,15]

Start with explicitly declared fiber boundaries. Add analytical Gaussian overlap or imported field data only for well-defined cases; retain external solvers for general structures.

**Do not make live, full-vector, cross-application co-simulation an MVP dependency.**

## 5. The scientific validation burden

The crucial risk is not failing to draw light. It is showing a convincing result whose implied validity exceeds the model.

### Numerical and model validation

Use analytical MZIs, known ring responses, lossy chains, reflective networks, disconnected ports, and deliberately singular cases. Compare the same declared models against an independent implementation. Test complex response, not only detector intensity. A small linear residual verifies an algebraic solve, not physical fidelity or complete power accounting. [1,22]

For normalized passive-port models, check that the largest singular value of `S` does not exceed one within numerical tolerance; ideal lossless models satisfy `S^dagger S = I`. Individual column power checks alone do not establish passivity for all coherent input combinations. Passivity testing is a real compact-model workflow requirement, not a cosmetic warning. [13]

Add phase/reference-plane tests so propagation is neither omitted nor counted twice. Test grid refinement near narrow resonances. A frequency grid adequate for one ring is not automatically adequate for a higher-Q network. Do not hide singular or ill-conditioned feedback behind undocumented damping.

### Imported data

Every imported model should identify port order, supported modes, units, frequency convention, power normalization, reference planes, material/platform context, valid ranges, provenance, version, and uncertainty where known. Interpolation must preserve the intended complex response; phase wrapping and insufficient sampling can corrupt it. Passivity checks do not establish causality, and a finite-band file is not proof of a physically valid broadband time-domain model. The current project explicitly excludes such blanket claims for imported data. [13,21]

Do not promise arbitrary pulse propagation merely because an inverse transform can produce a plot. Frequency coverage, delay, interpolation, time-window conventions, and causal model behavior need their own acceptance criteria.

### Fabrication variability

Initially offer sensitivity analysis and explicitly assumed tolerance scenarios. Do not call random slider perturbations manufacturing yield. Useful yield estimates require distributions, parameter sensitivities, and shared versus local variation with justified correlations. Statistical compact-model workflows account for both systematic and random process variation. [18]

### Minimum expertise

A software-focused founder can build the architecture, but a practicing photonics modeler should review the port conventions, dispersion, coupling, model provenance, and validation cases. This can begin as a limited collaboration rather than a large EM team. Independent review is more valuable initially than another twenty component icons.

## 6. Product and competitive feasibility

| Alternative | Established capability relevant here | Consequence for PICSetup |
| --- | --- | --- |
| Ansys Lumerical INTERCONNECT | Compact-model circuit simulation, time/frequency analysis, PDK and electronic-photonic workflows | Do not start by competing for production signoff. [10] |
| Luceda IPKISS/Caphe | Component compact models and circuit simulation | A coherent circuit engine is established practice, not a unique product claim. [9] |
| PhotonForge | Web interface for integrated-photonic design and simulation workflows | Browser access alone is not differentiation. [16] |
| SAX / GDSFactory ecosystem | Scriptable S-parameter circuits and chip-design tooling | Integrate or interoperate instead of rebuilding everything. [11,20] |
| AIM Photonics virtual labs | Browser simulations for PIC component intuition | Education is an existing category, not an empty market. [17] |

The defensible hypothesis is a particularly low-friction, shareable experiment workflow: draw an arbitrary circuit, inspect what the model assumes, compare variants, include its optical bench context, and hand the result to another person without losing its model identity.

That hypothesis is not yet demonstrated differentiation. It must beat users' existing notebooks, slides, teaching demos, or commercial workflows on a specific repeated task.

### Initial audiences

Educators and students are the best fit for testing the interaction and teaching value. Researchers may value topology exploration, reusable models, and reproducible figures. Engineers with characterized components may value quick system studies or sharing. Foundry signoff users are the wrong initial promise.

Commercially, these are different businesses. A useful free teaching tool may have strong community value and weak willingness to pay. A research tool needs model import, provenance, and reproducibility. An enterprise product adds private data handling, integrations, support, and validated process libraries. Do not infer one market from interest in another.

There is no verified traffic, retention, interview, procurement, or revenue evidence in this study. No total-addressable-market or revenue forecast is justified from the evidence inspected.

### Commercial and IP constraints

Foundry data is not automatically redistributable. AIM's PDK access explicitly involves agreements, and its listed licenses distinguish development from commercialization permissions. Model-data access and redistribution rights should be checked for the actual target platform. [19]

OpticalSetup identifies GPL licensing; PICSetup's README says no open-source license has yet been selected. Decide the source/model-data licensing strategy before copying code or promising a proprietary product. A protocol boundary is good architecture, not an automatic legal exemption. [6,8]

For confidential models, prefer local import or user-controlled storage and never embed proprietary S-parameter tables in share URLs by default. The current bridge uses URL query parameters; base64url is encoding, not encryption. Add a size cap and a share preview, and prefer document/reference exchange for larger or sensitive data. [5]

## 7. Recommended first release

Ship a small scientific instrument, not a broad library of unvalidated previews.

**Scope:** one declared guided mode, linear passive operation, coherent continuous-wave analysis, wavelength sweeps, and explicit phase controls. Start with sources, waveguides, couplers, phase shifters, ring structures, terminations/detectors, and a generic imported S-parameter block. Parameter presets may be illustrative until independently characterized.

**User journey:** build an MZI from a blank canvas, perturb an arm, inspect complementary outputs, build or load a ring, refine a wavelength sweep, import one characterized component, export the exact model-bearing document, and complete one OpticalSetup boundary handoff.

**Geometry:** make schematic versus physical routing unmistakable. Moving a component for presentation should not accidentally alter optical length in schematic mode. Physical routing can change path length, but must not imply unmodeled bends, crossings, or proximity coupling are solved.

**Leave outside the accepted first-release envelope:** new device inverse design, full spatial mode solving, fabrication-ready GDS/DRC, general nonlinear dynamics, thermal fields/crosstalk, high-speed RF/transistor co-simulation, quantum many-photon state evolution, and arbitrary ultrashort-pulse propagation. Features already present experimentally can remain behind explicit capability labels rather than expand the release claim.

The existing candidate should be audited and narrowed before any blanket rewrite. Its model and ownership boundaries already match much of this recommendation. [1,5,23]

## 8. Effort and operating feasibility

The following is a planning envelope for a trustworthy pilot, assuming the existing editor is substantially reusable, one experienced developer works on the project, a photonics reviewer is available, and no new full-wave solver or proprietary PDK integration is attempted. It is not a delivery commitment or a benchmark of the current code.

| Workstream | Estimated additional effort |
| --- | --- |
| Audit conventions, reconcile claims, establish independent reference tests | 2–4 person-weeks |
| Stabilize editing, persistence, error states, and measured performance | 3–6 person-weeks |
| Validate a small component library and an import path | 3–6 person-weeks |
| Implement and test one actual receiver-approved bridge workflow | 2–4 person-weeks |
| Pilot sessions, documentation, compatibility and release evidence | 2–4 person-weeks |
| **Total planning envelope** | **12–24 person-weeks** |

Some work can overlap, but model review and receiver adoption are dependencies, not interchangeable coding hours. A substantial rewrite, commercial foundry licensing, or general spatial coupling is outside this envelope.

For budgeting, multiply the engineering envelope by the actual fully loaded weekly cost and add expert review, model-data/solver access, and support. Do not treat low static-hosting cost as evidence that the product is cheap to maintain. The scientific library and compatibility obligations are the likely continuing costs.

A browser-first local solver avoids a mandatory per-solve cloud bill for this scope. Optional external device simulations should be a separately metered or user-managed workflow, not a hidden dependency of every drag operation.

## 9. A bounded go/no-go experiment

Before committing to the whole envelope, cap the first validation effort at roughly ten developer-days, contingent on a reviewer being available. This is a proposed project gate, not work claimed to have been completed in this study.

The technical deliverable is one auditable MZI, one ring/feedback fixture, one real imported component dataset with permission to use it, and one port handoff that preserves exactly what it claims. If the receiver is not yet adopted, show the validated descriptor and say integration remains incomplete; do not simulate success with a link alone.

Recruit approximately 6–10 users across teaching and research. Observe a task they already perform, not just a demo reaction. Ask them to recreate an existing example, modify it, explain the assumptions, and reopen or share it later. For a commercial hypothesis, seek a concrete pilot commitment from an actual budget owner rather than a hypothetical willingness-to-pay answer.

### Proposed continuation gates

- **Scientific:** independent reference agreement for well-conditioned analytical fixtures; correct power and phase conventions; honest rejection of unsupported state. Set numerical tolerances separately from physical-model uncertainty.
- **Performance:** measure named circuits and hardware. A reasonable target to investigate is under 100 ms for a small single-wavelength update, with spectral sweeps cancelable and the editor responsive; this is a target, not a current result.
- **Workflow:** one user completes the sketch–simulate–share path without losing model identity, and the optical-boundary workflow is understandable.
- **Demand:** several users return to use their own circuits, not only supplied demos; ideally at least three independent groups identify a repeated task the tool improves. These are early decision heuristics, not statistical proof of a market.

Narrow or pause the project when users primarily demand fabrication qualification, cannot use their own component data, are satisfied by static illustrations, or need spatial coupling before the first workflow becomes useful. Continue if the bounded circuit tool produces repeat use and trust without expanding into an EM platform.

## Final recommendation

**Build PICSetup as a transparent circuit workbench, not as a new Maxwell solver. Build the bridge as a sequence of validated boundaries, not as an immediate universal simulator.**

The source evidence supports technical feasibility for the narrow product. The remaining hard work is model provenance, phase/port semantics, numerical validation, user experience, and a reason for people to return. The domain purchase is not the investment decision; the next investment should be a small, falsifiable pilot.

## Sources

Primary sources accessed on 9 October 2026. Repository links are pinned where possible. Vendor documentation establishes capabilities/workflows, not independently measured comparative performance.

1. PICSetup, Photonics model contract: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/PHOTONICS_MODEL_CONTRACT.md
2. PICSetup, `app/src/physics.js`: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/app/src/physics.js
3. PICSetup, `app/src/complex.js`: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/app/src/complex.js
4. PICSetup, `app/src/bridge.js`: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/app/src/bridge.js
5. PICSetup, Interface contract: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/INTERFACE_CONTRACT.md
6. PICSetup, README: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/README.md
7. PICSetup, Pages workflow: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/.github/workflows/pages.yml
8. OpticalSetup, model details and public overview: https://github.com/LucaGenchi/opticalsetup/blob/main/docs/model-details.md ; https://opticalsetup.com/
9. Luceda, CompactModel: https://academy.lucedaphotonics.com/ipkiss/reference/circuitmodels/ref/ipkiss3.all.CompactModel
10. Ansys, INTERCONNECT: https://ansys.synopsys.com/products/optics/interconnect
11. SAX documentation: https://gdsfactory.github.io/sax/
12. Flexcompute, computing a device scattering matrix: https://www.flexcompute.com/tidy3d/examples/notebooks/SMatrix/
13. Ansys, S-parameter/passive workflow guide: https://optics.ansys.com/hc/en-us/articles/360059772393-S-parameter-passive-workflow-guide
14. Ansys, understanding mode overlap: https://optics.ansys.com/hc/en-us/articles/360034396834-Understanding-the-mode-overlap-calculation
15. Ansys, edge coupler: https://optics.ansys.com/hc/en-us/articles/360042305354-Edge-coupler
16. PhotonForge web UI tutorials: https://www.flexcompute.com/photonforge/learning-center/photonforge-gui/
17. AIM Photonics virtual lab library: https://www.aimphotonics.com/simulation-library
18. Ansys, statistical compact models: https://optics.ansys.com/hc/en-us/articles/360055833233-Introduction-to-statistical-compact-models
19. AIM Photonics PDK agreements: https://www.aimphotonics.com/pdk-agreements
20. GDSFactory PDK documentation: https://gdsfactory.github.io/gdsfactory/notebooks/08_pdk/
21. PICSetup, claims and validation: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/CLAIMS_AND_VALIDATION.md
22. PICSetup, acceptance tests: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/ACCEPTANCE_TESTS.md
23. PICSetup, vision: https://github.com/bertona88/picsetup/blob/da78d2fced137a30d8474349066039f6eee40530/VISION.md
24. Public PICSetup interface inspected: https://picsetup.com/
