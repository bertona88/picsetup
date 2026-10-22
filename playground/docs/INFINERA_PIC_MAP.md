# From the Infinera PIC map to PicSetup

Assessment on 22 October 2026 against upstream `main` at
`50a284af2415667f24983dd697051375dae6853d` and the live https://picsetup.com/ application.
The production source is `playground/`, released on 11 October. The attached
PicSetup-Lab-10x source is an earlier implementation and is not the production API.

## What the reference shows

The [Outside 5 Sigma interactive map](https://outside5sigma.com/infinera-pic-map/)
(dated 20 October 2026 in its UI) describes a 1.6 Tb/s coherent transceiver with
two wavelength channels, four IQ transmitter lanes and four coherent receiver
lanes. Its schematic is linked to a siliconpr0n die micrograph. Component,
category and subsystem selection, routes, highlights and a guided tour explain
the mapping. The map distinguishes die-labeled features from inferred ones.
That distinction must survive any future reconstruction; the map is not a
calibrated foundry netlist or a complete source of device parameters.

The reference's TE1/TM1/TE2/TM2 labels identify lanes in that reconstruction.
They must not be treated as PicSetup modal orders or as verified on-chip
polarization transformations. Separately labeling four scalar circuits would
not implement polarization physics.

## Capability mapping

| Reference element or experience | Current production workbench | Required extension for a fuller model |
| --- | --- | --- |
| Couplers, split/combine paths, phase tuning, waveguide phase/loss | Editable ideal couplers, phase shifters, attenuators and explicit links | InP device data and qualified reference planes for hardware prediction |
| Nested I/Q Mach–Zehnder transmitter | New ideal single-channel static recipe, using existing primitives | Voltage-to-phase response, RF bandwidth, waveform/envelope dynamics and drive conventions |
| DBR transmitter and LO lasers | One prescribed ideal coherent CW source per solve | Multiple sources with explicit coherence groups, frequencies, linewidth/noise and laser tuning models |
| Semiconductor optical amplifiers | Not modeled; negative attenuation is correctly rejected | Declared gain, saturation, noise and power accounting; nonlinear solving if required |
| 90-degree hybrid and balanced detectors | Ideal passive mixing can be composed; detectors report optical power | Signal/LO excitation semantics, differential photocurrent, responsivity, noise and bandwidth; electrical readout interface |
| Two wavelengths and polarization lanes | Separate scalar single-frequency experiments | Explicit channel and polarization schema, mixing/coupling rules and multi-frequency experiments |
| Monitor taps and terminations | Coupler taps, optical detectors and matched terminations | Device-specific tap ratios, detector response and reflection data |
| Chip micrograph linked to schematic | Not in the current production UI | Image annotations, stable component-to-region IDs, cross-highlighting, confidence/provenance and asset permission review |
| 64-QAM, constellation, BER or 1.6 Tb/s performance | Not computed by the CW solver | Modulated signals, sampling/timebase, noise/channel model and receiver DSP with independent validation |

The earlier `app/` figure editor and attached ZIP have broader-looking controls,
but their schemas and physics are not silently available in `playground/`.
In particular the bundled SiEPIC silicon data must not be presented as a model
of this InP die. The new starter deliberately uses only analytical ideal parts.

## First runnable slice

`examples/recipes/ideal-iq-transmitter.json` is an original, simplified functional
IQ transmitter composition. It is not a traced die netlist. It has one source,
six ideal 50:50 couplers, four static arm phase shifters, a Q quadrature bias and
four absorbing optical readouts. The rejected inner-MZI outputs are explicitly
measured so their power does not disappear. These readouts do not reproduce the
map's monitor-tap hardware. There is no SOA, DBR cavity, electrode or RF model.
All links explicitly have zero length; the drawing is schematic and supplies no
physical propagation distance. A wavelength sweep therefore has no spectral
structure until the user adds wavelength-dependent parts or unequal lengths.

On a build containing this change: **Sketch an idea → IQ transmitter → Build
this idea**. On the existing live release, paste the recipe into the Sketch
blueprint and select **Build this idea**, or import the compiled circuit at
`examples/circuits/ideal-iq-transmitter.json` through **Import JSON**.

The I and Q pairs are independent ordinary phase components. To set push-pull
biases, set `iUpper=+uI`, `iLower=-uI`, `qUpper=+uQ`, `qLower=-uQ` in radians;
there is no automatic parameter link. `quadrature` defaults to pi/2. Inspect
the optical power and phase at `signal`, or obtain its full complex incoming
field through the existing solve API. An optical detector is an absorbing
readout, not a new electrical detector model.

With PicSetup's `exp(+i omega t)` convention, a phase element transmits
`exp(-i phi)`. Let `cI=cos(uI)`, `cQ=cos(uQ)`, and quadrature bias be `psi`.
At the declared zero-length reference planes:

```text
E_signal / E_source     = i/2 (cI - exp(-i psi) cQ)
E_complement / E_source = -1/2 (cI + exp(-i psi) cQ)
P_I_rejected / P_source = sin(uI)^2 / 2
P_Q_rejected / P_source = sin(uQ)^2 / 2
```

At `psi=pi/2`, the signal field is `(-cQ + i cI)/2` times the source field.
Thus the two biases independently control orthogonal field coordinates, up to
the documented fixed phase/axis convention. These are static operating points;
this does not produce a symbol stream or establish a data rate.

At the starter's `uI=uQ=pi/3` and 1 mW source, the expected powers are
0.125 mW signal, 0.125 mW complementary, and 0.375 mW at each rejected port.
All four sum to 1 mW. At `uI=uQ=pi/2` the useful outputs are dark and the rejected
ports account for the launched power. Phase at a dark detector is undefined.

The regression tests compare all four complex fields with independent
feed-forward algebra at six bias combinations, including nonquadrature bias
and nonzero source phase, and check orthogonal signed control, power closure,
portable replay and zero/dark cases. This validates the ideal composition only.

## Next implementation steps

1. Add a source-free IQ building block and a passive 90-degree hybrid with
   explicit port/sign conventions; validate their complete scattering maps.
2. Introduce signal/LO source semantics and balanced optical-difference
   measurements, then an explicit electrical responsivity/readout boundary.
3. Add a bounded modulation-envelope experiment with voltage-to-phase mapping
   and static constellation checks before time-dependent QAM or BER claims.
4. Add independently identified wavelength/polarization channels and only then
   assemble a two-wavelength transceiver study.
5. Add the linked-image teaching view using original or permission-cleared
   imagery, retaining labeled/inferred/unknown evidence for each mapped item.

No micrograph, map code or third-party annotation dataset is copied in this
change. The reference is linked for inspection. Laser/SOA parameters, geometry,
material data and missing connectivity must remain explicit unknowns.

## Sources and evidence scope

- [Interactive map](https://outside5sigma.com/infinera-pic-map/), directly
  inspected in the browser on 22 October 2026: topology labels and UI behavior.
- [NTT Technical Review: high-speed modulator](https://www.ntt-review.jp/archive/ntttechnical.php?contents=ntr201804ra2_s.html):
  primary engineering report explaining InP IQ modulators and their electrical
  bandwidth/drive requirements; not a model of the mapped Infinera chip.
- [Current PicSetup model contract](../PHOTONICS_MODEL_CONTRACT.md), registry,
  recipe compiler and solver: actual supported equations, models and units.
- [Production release record](../../docs/deployments/2026-10-11/README.md):
  historical release evidence; live availability was checked separately.
