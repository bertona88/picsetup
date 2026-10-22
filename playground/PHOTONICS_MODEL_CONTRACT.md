# Photonics model contract — playground only

Use SI internally: m, W, radians, dB/m; UI converts nm, µm, mW and dB/cm once. Complex amplitudes have units sqrt(W), power `|a|²`. Time convention `Re{E exp(+iωt)}`. Matrix orientation is `S[output][input]`. Each port carries one declared scalar guided mode. Analytical parts use a TE0 declaration; the imported table labels its mode **TE, mode 1**. Spatial modal fields and their physical matching are not supplied; connecting these scalar ports is an exploratory model assumption.

## Networks and analytical parts

`b = S a + s; a = C b`; solve `(I − S C)b = s` with pivoted complex elimination, never matrix inversion. `C` contains reciprocal propagation exactly once: `h = 10^(−αL/20) exp(−i 2π n_eff L/λ)`. Constant `n_eff` is explicitly nondispersive. No pixel-derived physics.

Ideal coupler ports `[L0,L1,R0,R1]`, `t=sqrt(1−K)`, `q=i sqrt(K)`: `S=[[0,0,t,q],[0,0,q,t],[t,q,0,0],[q,t,0,0]]`. Phase shifter reciprocal transmission is `exp(−iφ)`; attenuator transmission is `10^(−A_dB/20)`. Source `S=0` and injection `sqrt(P)exp(iφ)`, absorbing returning power. Detector/termination `S=0` reads/absorbs incoming power. Unconnected ports have `a=0`: matched boundaries, not real open facets. One connection per port; crossing curves do not connect.

## Bundled SiEPIC model

`siepic-coupler` version `1` permanently resolves bundled dataset `siepic-dc-200nm-10um` version `1.0.0`, raw source SHA-256 `945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371`. Geometry is fixed at 200 nm gap and 10 µm coupling length. [The manifest](models/siepic-dc-200nm-10um/manifest.json) records pinned Simphony/SiEPIC revisions, licenses and primary sources.

All sixteen entries at all 101 samples are explicitly retained, including reflection and back-coupling. Source port order `[1,2,3,4]` maps to `[L0,L1,R0,R1]`. Ansys documents power-normalized optical ports and `exp(−iωt)`; Simphony's parser and propagator corroborate that convention. Conversion is `S_canonical = conjugate(S_source)`, with no amplitude normalization, symmetry forcing, reference-plane shift or clipping.

Evaluate at `f=c/λ`, `c=299792458 m/s`. Interpolate each real and imaginary coefficient linearly in frequency between neighboring samples. Supported band is **187.370–199.862 THz**, approximately **1499.997288–1600.002444 nm**. Out-of-band queries fail; only floating-point endpoint round-trip error is tolerated. No physical extrapolation or implicit endpoint extension is allowed.

Native port planes and phase are retained as opaque boundaries. Spatial plane coordinates, de-embedding offsets, modal fields, temperature, process corner and quantified uncertainty are unknown. Added guide lengths are explicit distances from these abstract boundaries; their connection to a real layout is unqualified. No calibrated component, fabrication or physical-reference-plane claim is made.

Cartesian interpolation can lower apparent power between phase-rotating samples. At 1550 nm the interpolated single-input total is approximately 0.9716, versus 0.9837416 for a weighted average of the neighboring sampled powers. The difference is an interpolation effect, not measured extra device loss. The source grid does not validate fine structure synthesized between samples.

The raw table has `σmax` from **0.9852978180 to 1.0022352696**, with 17/101 samples above `1+1e−6`. No passivity repair is applied. This exact dataset has checked XOR mirror symmetry `S[o][i]=S[0][o xor i]`. A real orthogonal Hadamard basis diagonalizes it, so the largest modulus of the four signed row sums is its exact spectral norm. Runtime verifies that symmetry before using this specialized evaluator; it is not a general nonnormal-matrix norm approximation. A queried `σmax>1+1e−6` emits a passivity warning.

## Accounting and numerical limits

Report source emission, escape at unconnected ports, detector absorption, returned source absorption, component absorption, propagation loss and **model-supplied power** separately. For each imported component compute signed exchange `Σ|a|²−Σ|b|²`. Positive exchange adds to `componentAbsorbedW`; negative exchange contributes its magnitude to `modelSuppliedW` and emits a warning. This exposes the table's apparent gain. Do not conceal it as negative passive loss or change the solved fields.

Budget closure is `emittedW + modelSuppliedW − detectedW − escapedW − componentAbsorbedW − returnedToSourceW − propagationLossW`. Internal circulation is not an output. Numerical residual and scale-aware pivot diagnostics remain visible. Invalid/singular networks return diagnostics, never artificial damping. Target `1e−9` unit-scale analytical agreement and normalized residual `<1e−10` for well-conditioned fixtures. These verify equations and conversion, not hardware fidelity.

Detector phase is undefined below power `1e−24 × emittedW` (relative field amplitude `1e−12`), where cancellation roundoff makes its angle meaningless. Calculated complex fields and powers remain unclipped. Sweep failures return unavailable data, not artificial zero power. Uniform wavelength sweeps are finite samples, not adaptive searches or guarantees that narrow resonances are resolved.


## Compositional templates and sampled design goals

Reusable blocks expand to the existing version-1 primitives and explicit guide connections. The MZI uses a fixed 80 µm upper arm and an adjustable lower-arm difference; the ideal ring has K=0.2 with explicit default 1000 dB/m feedback loss; ideal splitter trees use K=0.5 in two stages; a delay line combines phase, attenuation and explicit guide propagation. These are source-free network templates, not new device models. Root-level source/detector ports and matched unused boundaries retain the same rules. Ring loss is a declared parameter, never implicit numerical damping.

Catalog mode labels distinguish analytical TE0 declarations from the dataset's native TE mode 1 identifier; the latter does not establish transverse-order TE1. Automatic arrangement and block drawing never infer propagation distance. Model identity, canonical phasor conversion, passivity checks and all source limitations remain unchanged under recipe compilation or snapshot comparison.

Comparison curves use the same wavelength samples and each snapshot's actual source power. Goal searches uniformly sample one permitted scalar parameter within explicit bounds. Failed candidates remain unavailable. The selected best is a grid result, not a continuous/global optimum, sensitivity analysis or fabrication tolerance claim. Finite grids can miss narrow ring resonances; the generic sweep does not adapt; the separate ring lab has the restricted refinement scope below.

## Dispersive guides, trust gates and scoped refinement

Connections may explicitly select `siepic-strip-500x220-te` version `1`. The [pinned equation and coefficient audit](models/siepic-strip-500x220-te/README.md) specifies β(ω), group index, canonical phase, exact source hashes and independently declared loss. Reference n is 2.44553 and group index is 4.19088 at 1550 nm. The application rejects evaluation outside 1500–1600 nm; this window is an application assumption because the sources provide no fit band, temperature, process corner or uncertainty. Physical matching to the imported coupler remains unqualified.

Numerical eligibility rejects failed/nonfinite samples, small pivots and power imbalance. Model/provenance warnings remain visible and are not silently conflated with numerical failure. Goal Apply additionally requires an eligible starting result and improvement above the explicit relative tolerance. Full-period phase searches do not suggest widening their domain.

Study targets use IL = −10 log10(Pdesired / Pinput) and XT = 10 log10(Punwanted / Pdesired), with explicit desired/unwanted output mappings. Only complete eligible sample grids receive sampled pass/fail decisions. Missing results and exact zero have distinct representations. Phase scenarios are user-declared offsets, not manufacturing distributions or yield estimates.

The ring lab refines one model-seeded ideal constant-index single-bus resonance. It brackets the location and half-depth linewidth and checks an independent closed form. It does not discover unknown resonances in arbitrary networks. Q is λres / full width at half notch depth. A 120 dB extinction reporting cutoff is not a certified bound; even finite extinction remains a computed estimate and the absolute transmission agreement gate does not certify its accuracy.

## Ideal static IQ example

The IQ transmitter starter composes six ideal couplers, five phase elements,
one CW source and four optical detector readouts. It uses the same version-1
models and explicit zero-length links. Paired arm phases are independent
parameters; there is no automatic push-pull link or electrical drive. The
[recipe guide](docs/INFINERA_PIC_MAP.md) derives all four outputs with the
declared phasor convention and accounts for the rejected inner-MZI power.
This is a single scalar static functional example, not an Infinera/InP device
model, a polarization model, a DBR/SOA simulation or a QAM/data-rate prediction.
