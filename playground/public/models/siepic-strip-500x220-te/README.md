# SiEPIC 500 × 220 nm TE strip guide — audited coefficient import

This experimental straight-guide model adds dispersion to explicit circuit connections. The original seven-number coefficient file is preserved byte for byte, including the unused TM values. We select only the TE columns. Simphony and SiEPIC contain the identical 64-byte Git blob `d7a94d16c611c28a4dfb7eeb5141b1f81750b758` at the revisions in [manifest.json](manifest.json). [source-models.py](source-models.py) is the exact pinned Simphony module for offline equation auditing, not executable runtime code.

The selected numbers are λ₀ = 1.55 µm, nₑ = 2.44553, nɡ = 4.19088 and n𝑑 = 0.000354275. Simphony converts wavelength and length from µm to metres and loss from dB/cm to dB/m before evaluating its quadratic in angular frequency. PicSetup already uses metres and dB/m, so these conversions must not be repeated.

With Δω = 2πc(1/λ − 1/λ₀), c = 299792458 m/s:

```text
β(ω) = 2π nₑ/λ₀ + (nɡ/c) Δω − [n𝑑 λ₀²/(4πc)] Δω²
h = 10^(−lossDbPerM × lengthM / 20) exp(−i β lengthM)
n_group(ω) = nɡ − n𝑑 λ₀² Δω/(2π)
delay = n_group(ω) × lengthM / c
```

The upstream transmission uses `exp(+i β L)`. PicSetup conjugates that phase for its `exp(+iωt)` convention. The coefficient n𝑑 has dimensions s/m² by dimensional inference from the pinned equation; neither the coefficient text nor the upstream docstring labels that unit. It is not a free tunable parameter or a process-tolerance distribution.

**1500–1600 nm is a declared application evaluation window, not a source-validated fit band.** Neither pinned source file supplies a fit domain, temperature, process corner, spatial modal fields, measured loss, or quantified uncertainty. Out-of-window evaluations fail with `WAVEGUIDE_OUT_OF_BAND`. The reference `neff` field remains mandatory and must equal 2.44553; mismatches fail rather than silently ignoring a user value. Removing the waveguide reference restores the existing constant-index model.

Propagation is reciprocal, reflectionless, and passive for the separately declared nonnegative loss. Its abstract planes are the beginning and end of the explicitly declared straight-guide length. No coupler deembedding, bend length, bend loss, heater response, geometry transition, physical mode matching, or temperature dependence is inferred. Sharing SiEPIC provenance with the bundled coupler does not establish matching physical reference planes or spatial modes. This is a useful dispersive network hypothesis, not a qualified process design kit.

Run `python scripts/verify_siepic_waveguide.py --check` from the repository root. The standard-library script checks exact SHA-256 and Git blob identities, checks the pinned equation's syntax tree, and computes 60-digit Decimal references independently of TypeScript. [reference.json](reference.json) contains five complex guide samples, five ideal-coupler MZI samples, three equal-phase fringe roots, and phase-derivative delay references. Runtime tests compare actual network fields, loss accounting and fringe roots against these references. The source has no hardware validation evidence; arithmetic agreement is not physical calibration.

Primary sources:

- [Pinned Simphony coefficients](https://github.com/BYUCamachoLab/simphony/blob/5a5e826fb58b2b5ce0355189b3e3b33e2bd8828c/simphony/libraries/siepic/source_data/wg_integral_source/WaveGuideTETMStrip,w=500,h=220.txt)
- [Pinned Simphony equation, TE selection and conversions](https://github.com/BYUCamachoLab/simphony/blob/5a5e826fb58b2b5ce0355189b3e3b33e2bd8828c/simphony/libraries/siepic/models.py)
- [Byte-identical pinned SiEPIC upstream](https://github.com/SiEPIC/SiEPIC_EBeam_PDK/blob/363fbb52eefa8669100499ab531d3fe7befc4867/klayout/EBeam/CML/EBeam/source_data/wg_integral_source/WaveGuideTETMStrip,w=500,h=220.txt)

Both upstream sources use MIT terms. Preserve [LICENSE-SIMPHONY.txt](LICENSE-SIMPHONY.txt) and [LICENSE-SIEPIC.txt](LICENSE-SIEPIC.txt) with distributions containing these coefficients or the adapted equation.
