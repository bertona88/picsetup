# PICSetup: S-parameter library sources and OpenLight

**Research date:** 9 October 2026  
**Status:** Sourcing and architecture note, not an implementation or numerical certification.

## Decision

Use public SiEPIC-derived models to prove the model-import workflow. Use analytical models as separately labeled references. Treat OpenLight as a potential later manufacturing/model partnership, not a prerequisite for PICSetup.

The earlier recommendation to obtain a component-model library should not imply a universal, interchangeable catalogue. The verified sources include raw sampled data, executable Python models, and vendor-specific compact-model packages. These have different capabilities and access conditions. [1–8]

## Actual public locations

| Source | Verified contents | Appropriate first use |
|---|---|---|
| SiEPIC EBeam PDK, `Lumerical_EBeam_CML/` | Source directories and packaged `.cml` libraries; repository license states MIT | Upstream component-data investigation. Inspect `source_files/`, not only packaged libraries. [1,2] |
| Simphony, `simphony/libraries/siepic/source_data/` | SiEPIC-derived data directories and `.sparam` files | Most concrete starting point for a browser import adapter. [3–5] |
| Simphony SiEPIC API | Functions returning SAX-compatible complex responses | Independent reference for a format conversion and component evaluation. [4,5] |
| SiPANN | Parameterized model generators for couplers, waveguides, and ring-related structures; MIT repository | Optional geometry-sensitive models within their documented domains. Not automatically a particular foundry's calibration. [6,7] |
| SAX / Simphony ideal models | Analytical circuit-model functions | Solver tests and explicitly generic teaching models. [8,9] |

Simphony is partly a convenient interface to SiEPIC data, not a second independent characterization of the same devices. Its source loader identifies frequency, magnitude, and phase columns and evaluates a requested wavelength grid. [5]

### One concrete file

Verified through connected GitHub reads:

`BYUCamachoLab/simphony`

`simphony/libraries/siepic/source_data/ebeam_dc_te1550/dc_gap=200nm_Lc=10um.sparam`

The file's Git blob SHA is `2b56aff1c525be81eb1ea374f9e0107cdb59e356`. Its header identifies optical ports and TE mode, followed by frequency-dependent magnitude and phase samples. The corresponding function is `simphony.libraries.siepic.directional_coupler(wl=..., gap=200, coupling_length=10)`. Wavelength and coupling length are expressed in micrometres in that API, while gap is in nanometres. [4,5,10]

This establishes that an actual input dataset exists. It does **not** establish measurement provenance, present-day foundry qualification, complete reference-plane metadata, or physical accuracy. I inspected the file header and selected source, not a full numerical validation.

The directional-coupler documentation lists discrete supported geometries. Do not turn a collection of discrete datasets into an unrestricted geometry slider without adding and validating an interpolation model. [4]

## Where manufacturing-specific models live

AIM is one concrete example of a library-access process: its agreements page identifies named component libraries and requires the applicable agreements before access. [11]

Commercial compact models can also be distributed in protected, engine-specific packages; Ansys documents this explicitly. Being allowed to use a PDK in one simulator does not itself demonstrate a portable format or permission to redistribute model data. [12]

For every proposed integration, request the actual model subset, format specification, validity ranges, port/reference conventions, and written terms covering conversion and intended distribution. Keep layout access, model access, and manufacturing qualification as distinct acceptance gates.

## What OpenLight does

OpenLight combines photonics IP and design enablement with custom PIC design and production services. Its technology integrates active III-V/InP functionality with silicon photonics; Tower's PH18DA is a documented manufacturing platform. This is a manufacturing ecosystem, not just a circuit-simulation library. [13–15]

Its “open” positioning concerns customer/foundry access to its platform. It should not be interpreted as an open-source license. The public pages inspected did not establish an openly licensed, downloadable set of raw optical S-matrices suitable for bundling in PICSetup. Exact pricing, access terms, export rights, and model-delivery formats remain unverified. [13,16]

On 11 August 2026, OpenLight and Tower announced PH18DA PDK availability in Cadence tools. That announcement should not be expanded into a claim of circuit-model portability. OpenLight's published design-enablement table separately lists circuit simulation as supported in OptoCompiler and not supported in its listed Cadence, IPKISS, or GDS Factory integrations. This describes OpenLight's listed integrations, **not** the general capabilities of those tools. Another OpenLight page contains an older-looking capability table, so a current vendor confirmation remains necessary. [13,15,16]

Its PDK Sampler is physical die-level hardware for testing library elements, not simply a downloadable sample of the software kit. [13]

### Relevance to PICSetup

My assessment is that OpenLight could eventually be a model supplier or ecosystem partner, subject to agreement, rather than a direct substitute for the proposed cross-platform workbench. PICSetup should not claim to replace OpenLight's process development, component qualification, or manufacturing services.

A passive linear import does not make an active PDK fully supported. In `b = S a`, zero incoming field yields zero output: a self-emitting source needs additional modeling. Small-signal responses can fit within linear models, but general state-dependent dynamics require a broader contract. Luceda's compact-model interface explicitly distinguishes S-matrices from differential-equation/stateful models. [17]

## Proposed next engineering test

Choose the single verified coupler dataset above before expanding the library. Inspect its full metadata and source context; document any unknown conventions. Convert it into an internal optical-port format and compare complex values against the source loader at original sample points. Then check intermediate-wavelength interpolation and connect two components into an MZI test.

The import contract should preserve source identity and blob/version, license notices, geometry, modes, port ordering, normalization, wavelength units, phase convention, reference planes, and valid ranges. Include explicit unknowns rather than invented defaults. Keep source files separate from generated conversion artifacts.

Do not combine models from different fabrication platforms and describe the result as a manufacturable single chip. Such a network can be a conceptual system study only when the connecting interfaces are explicitly represented.

For the OpticalSetup bridge, a scalar chip-port response is useful, but is not a reconstructed free-space wavefront. The initial handoff should use declared modes and reference planes, not promise arbitrary alignment prediction.

**No component models were added to PICSetup and no app code or deployment was changed in this research task.**

## Sources and direct entry points

Primary sources checked on 9 October 2026. GitHub directory and sample-file existence was verified through the connected GitHub API. Repository links using `master` can change; the sample-file blob identity is recorded above.

1. SiEPIC EBeam PDK: https://github.com/SiEPIC/SiEPIC_EBeam_PDK
2. SiEPIC model directory and license: https://github.com/SiEPIC/SiEPIC_EBeam_PDK/tree/master/Lumerical_EBeam_CML ; https://github.com/SiEPIC/SiEPIC_EBeam_PDK/blob/master/LICENSE.md
3. Simphony source data: https://github.com/BYUCamachoLab/simphony/tree/master/simphony/libraries/siepic/source_data
4. Simphony SiEPIC API: https://simphonyphotonics.readthedocs.io/en/latest/libs/siepic.html
5. Simphony SiEPIC implementation: https://simphonyphotonics.readthedocs.io/en/latest/_modules/simphony/libraries/siepic/models.html
6. SiPANN repository: https://github.com/BYUCamachoLab/SiPANN
7. SiPANN model-domain documentation: https://simphonyphotonics.readthedocs.io/en/latest/libs/sipann.html
8. SAX: https://gdsfactory.github.io/sax/ ; https://gdsfactory.github.io/sax/models/
9. Simphony ideal models: https://simphonyphotonics.readthedocs.io/en/latest/libs/ideal.html
10. Sample coupler file: https://github.com/BYUCamachoLab/simphony/blob/master/simphony/libraries/siepic/source_data/ebeam_dc_te1550/dc_gap=200nm_Lc=10um.sparam
11. AIM access agreements: https://www.aimphotonics.com/agreements
12. Ansys model packaging: https://optics.ansys.com/hc/en-us/articles/360036620273-Custom-Library-Design-Kit
13. OpenLight IP, services, and PDK sampler: https://openlightphotonics.com/intellectual-property
14. OpenLight technology: https://openlightphotonics.com/technology
15. Tower/OpenLight announcement, 11 August 2026: https://towersemi.com/2026/08/11/08112026/
16. OpenLight design enablement and support table: https://openlightphotonics.com/pasic-design-enablement
17. Luceda compact-model contract: https://academy.lucedaphotonics.com/ipkiss/reference/circuitmodels/ref/ipkiss3.all.CompactModel
