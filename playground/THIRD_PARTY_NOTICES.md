# Notices — playground

New application implementation is authored for this rebuild; no implementation was copied from `app/`, `prototype/`, SAX or Simphony. This iteration includes one openly licensed tabulated SiEPIC component dataset. Simphony, SiPANN and SAX Python implementations are not included in the browser runtime.

## SiEPIC directional-coupler data

The exact raw `.sparam` file and converted complex values are distributed in [models/siepic-dc-200nm-10um/](models/siepic-dc-200nm-10um/). The data comes from Simphony commit `5a5e826fb58b2b5ce0355189b3e3b33e2bd8828c`, path `simphony/libraries/siepic/source_data/ebeam_dc_te1550/dc_gap=200nm_Lc=10um.sparam`. It is byte-identical to the file in the upstream SiEPIC EBeam PDK at commit `363fbb52eefa8669100499ab531d3fe7befc4867`, path `klayout/EBeam/CML/EBeam/source_data/ebeam_dc_te1550/dc_gap=200nm_Lc=10um.sparam`.

- **SiEPIC EBeam PDK:** MIT; copyright (c) 2016–2020, Lukas Chrostowski and contributors. Full [license notice](models/siepic-dc-200nm-10um/LICENSE-SIEPIC.txt) is preserved.
- **Simphony:** MIT; copyright (c) 2019–2020, Simphony Project Contributors and others. Full [license notice](models/siepic-dc-200nm-10um/LICENSE-SIMPHONY.txt) is preserved. Simphony's top-level notice refers to separately licensed resources; the direct upstream SiEPIC MIT license and identical data blob establish this included file's source license.

Source blob SHA-1: `2b56aff1c525be81eb1ea374f9e0107cdb59e356`. Raw SHA-256: `945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371`. The [manifest](models/siepic-dc-200nm-10um/manifest.json) records provenance, primary convention references and exact conversion. New conversion scripts preserve every coefficient, changing only the declared phasor representation from `exp(−iωt)` to `exp(+iωt)` through complex conjugation. Source bytes are unchanged.

`public/THIRD_PARTY_NOTICES.txt` includes both full license notices and pinned source attribution. Vite copies it into every static `dist/` build alongside the bundled dataset.

## Development dependencies

Pinned package metadata/lockfile captures development dependencies: TypeScript 5.9.3 (Apache-2.0), Vite 7.3.7 (MIT), Vitest 4.1.11 (MIT), and @playwright/test 1.56.1 (Apache-2.0). Their dependency tree is preserved by `package-lock.json`. Independent Python verification uses NumPy in the development environment; it is not bundled into the app. Runtime assets are bundled and need no external service.

The repository has no selected license for newly authored application code; this work does not alter that status. The bundled third-party data remains under its preserved MIT notices.
