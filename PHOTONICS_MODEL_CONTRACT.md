# PicSetup Detector Model Contract

## Scope

This slice models an idealized optical signal at a detector reference plane. It converts explicit signal properties into detector-specific readouts; it does not propagate fields through a circuit.

The input state includes power (W), wavelength and bandwidth (m), Gaussian beam diameters and centroid (m), wavefront divergence (rad) and curvature radius (m), Stokes parameters, image-plane presence, and optional pulse repetition rate (Hz) and duration (s).

## Reduced-order rules

- Peak irradiance uses an elliptical Gaussian-beam approximation: `8P/(π dx dy)`.
- Camera maps sample that Gaussian profile deterministically.
- PMT photon rate is `P/(hc/λ)` and is an ideal incident-photon estimate, not a count model.
- A beam is called collimated when absolute divergence is below the declared tolerance.
- Polarization classification is derived from normalized Stokes parameters.
- Spectra are sampled as Gaussian lines with the supplied FWHM bandwidth.

## Nonclaims

No detector noise, quantum efficiency, saturation, aperture clipping, pixel response, exposure time, dark current, gain statistics, calibration, spectral instrument function, timing jitter, or uncertainty propagation is modeled. The general detector is explicitly idealized and does not claim that one physical instrument performs every measurement simultaneously.
