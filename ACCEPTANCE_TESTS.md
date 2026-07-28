# Acceptance tests

## Automated gate

From the repository root:

```sh
npm run app:validate
```

The gate must:

1. parse every `app/src/*.js` runtime module and the OpticalSetup receiver adapter;
2. pass the complete Node regression suite with no failures;
3. build `app/dist/PicSetup-Lab-10x-preview.html`;
4. leave generated `app/dist/` output untracked.

The existing prototype remains independently checkable:

```sh
npm run prototype:test
npm run prototype:check
```

The `prototype/` tree object must be identical to the base commit.

## Required model and graph cases

The automated suite must cover:

- lossless coherent-network conservation and finite residuals;
- Mach–Zehnder and resonator response over declared sweeps;
- physical and schematic route-length contracts;
- hierarchy collapse/expand response preservation;
- deterministic tuning, tolerance, and pulse fixtures;
- semantic, SAX, gdsfactory, and S-parameter workflows;
- typed-domain compatibility and exclusion of non-optical links from the coherent solve;
- the hybrid paper template's component vocabulary and optical/electrical/RF/control graph;
- `setup-port/1` encoding, URL, manifest, and receiver round trips;
- explicit unresolved spatial state at the OpticalSetup boundary.

## Browser acceptance journey

Serve `app/` over HTTP and verify in a current browser:

1. The application loads without runtime errors.
2. A user can create, connect, move, inspect, save, and reopen a photonic circuit.
3. Wavelength or phase changes produce complementary MZI output behavior.
4. Unsupported or disconnected state produces an explicit warning rather than a fabricated result.
5. Paper Figure Studio opens the included hybrid template.
6. The template contains a chip figure, OpticalSetup boundaries, RF/electrical/control wiring, instrumentation, plot, image placeholder, panel label, and operating-condition annotation.
7. Component label placement, metadata visibility, connection labels, offsets, and arrow direction are editable.
8. SVG export is content cropped and opens as a valid vector document.
9. PNG export has a white or transparent background as selected and a publication-scale resolution.
10. Bridge JSON and the bridge manifest identify `setup-port/1`, units, both power references, omissions, source identity, and target URL.
11. Opening a bridge retains `incomingBridge` and `bridgeSchema=setup-port/1` in the OpticalSetup URL.
12. No action implies that the external OpticalSetup receiver is already deployed.

## Pull-request acceptance

Before review:

- CI is green on the proposed commit.
- The diff is confined to the successor application, governing contracts, documentation, scripts, and validation workflow.
- `prototype/` is unchanged.
- No generated `dist/`, dependency directory, credential, or machine-specific `/mnt/data` path is committed.
- The PR description separates implemented behavior from manual browser evidence, external receiver work, merge, and deployment.

## Production acceptance

Merge does not by itself authorize replacement of the public prototype. A production release requires explicit approval, a scoped deployment plan, a live URL/version check, browser smoke on the deployed artifact, and a recorded rollback path.
