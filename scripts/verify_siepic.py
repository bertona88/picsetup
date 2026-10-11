#!/usr/bin/env python3
"""Independently read raw .sparam via regex/NumPy and audit browser conversion.

Does not import the converter. Requires NumPy. The committed report/fixtures
are reproducible with --write; --check validates without modifying artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np

MODEL = Path(__file__).resolve().parents[1] / "playground/models/siepic-dc-200nm-10um"
C = 299792458.0


def independently_parse(raw: bytes) -> tuple[np.ndarray, np.ndarray]:
    block_pattern = re.compile(
        r"\('port ([1-4])','TE',1,'port ([1-4])',1,'transmission'\)\n"
        r"\(101,3\)\n((?:(?!\().+\n){101})"
    )
    source = raw.decode("ascii")
    blocks = list(block_pattern.finditer(source))
    if len(blocks) != 16 or "".join(m.group(0) for m in blocks) != source:
        raise AssertionError("Raw file does not consist of exactly sixteen expected blocks")
    frequency = None
    matrices = np.full((101, 4, 4), complex(float("nan"), float("nan")))
    seen = set()
    for block in blocks:
        out, inp = (int(block.group(i)) - 1 for i in (1, 2))
        assert (out, inp) not in seen, "duplicate matrix entry"
        seen.add((out, inp))
        rows = np.loadtxt(block.group(3).splitlines())
        assert rows.shape == (101, 3)
        if frequency is None:
            frequency = rows[:, 0]
        np.testing.assert_array_equal(frequency, rows[:, 0])
        # Independent vectorized complex exponential; source phase is radians.
        matrices[:, out, inp] = rows[:, 1] * np.exp(-1j * rows[:, 2])
    assert np.isfinite(matrices).all()
    return frequency, matrices


def complex_json(matrix: np.ndarray) -> list:
    return [[{"re": float(value.real), "im": float(value.imag)} for value in row] for row in matrix]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    raw = (MODEL / "source.sparam").read_bytes()
    frequency, matrices = independently_parse(raw)
    browser = json.loads((MODEL / "data.json").read_text())
    np.testing.assert_array_equal(frequency, browser["frequencyHz"])
    stored = np.array([[[complex(v["re"], v["im"]) for v in row] for row in sample] for sample in browser["s"]])
    np.testing.assert_allclose(stored, matrices, atol=2e-15, rtol=0)
    sigmas = np.linalg.svd(matrices, compute_uv=False)[:, 0]
    excess = np.where(sigmas > 1 + 1e-6)[0]
    # Cartesian interpolation independently implemented by np.interp.
    target_frequency = C / 1550e-9
    interpolated = np.empty((4, 4), complex)
    for out in range(4):
        for inp in range(4):
            interpolated[out, inp] = np.interp(target_frequency, frequency, matrices[:, out, inp])
    bracket = int(np.searchsorted(frequency, target_frequency)) - 1
    fraction = (target_frequency - frequency[bracket]) / (frequency[bracket + 1] - frequency[bracket])
    endpoint_power = (np.abs(matrices[[bracket, bracket + 1], :, 0]) ** 2).sum(axis=1)
    report = {
        "schema": "picsetup.dataset-audit.v1",
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "gitBlobSha1": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest(),
        "independentParser": "regex block extraction + numpy.loadtxt + numpy.exp; no converter imports",
        "samples": 101, "complexEntriesPerSample": 16,
        "frequencyHzMin": float(frequency[0]), "frequencyHzMax": float(frequency[-1]),
        "frequencyStepHzMin": float(np.diff(frequency).min()), "frequencyStepHzMax": float(np.diff(frequency).max()),
        "wavelengthMMin": float(C / frequency[-1]), "wavelengthMMax": float(C / frequency[0]),
        "sourceToCanonicalMaxAbsError": float(np.abs(stored - matrices).max()),
        "passivity": {
            "method": "largest singular value of full complex 4×4 S at each source sample, numpy.linalg.svd",
            "sigmaMaxMin": float(sigmas.min()), "sigmaMaxMax": float(sigmas.max()),
            "maxCoherentPowerGain": float(sigmas.max() ** 2), "tolerance": 1e-6,
            "samplesAboveOnePlusTolerance": len(excess), "sampleIndicesAboveOnePlusTolerance": excess.tolist(),
            "action": "preserve original data and warn; no passivity enforcement"
        },
        "reciprocityMaxAbsError": float(np.abs(matrices - matrices.transpose(0, 2, 1)).max()),
        "maxSingleInputPowerSum": float((np.abs(matrices) ** 2).sum(axis=1).max()),
        "phaseConversion": "S_canonical = conjugate(S_source)",
        "referenceAt1550nm": {
            "frequencyHz": float(target_frequency),
            "method": "numpy.interp separately for every complex S element on source frequency grid",
            "s": complex_json(interpolated),
            "port1OutputPowerFractions": (np.abs(interpolated[:, 0]) ** 2).tolist(),
            "interpolationAudit": {
                "bracketingSampleIndices": [bracket, bracket + 1],
                "fraction": float(fraction),
                "weightedEndpointPort1TotalPower": float((1 - fraction) * endpoint_power[0] + fraction * endpoint_power[1]),
                "interpolatedPort1TotalPower": float((np.abs(interpolated[:, 0]) ** 2).sum()),
                "note": "Cartesian complex interpolation can reduce power between phase-rotating samples; this difference is interpolation error, not measured extra physical loss."
            }
        }
    }
    path = MODEL / "verification.json"
    if args.write:
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if args.check:
        recorded = json.loads(path.read_text())
        # BLAS/platform last-bit differences are immaterial; verify reported data numerically.
        assert recorded["sourceSha256"] == report["sourceSha256"]
        assert recorded["passivity"]["samplesAboveOnePlusTolerance"] == len(excess)
        for key in ("sigmaMaxMin", "sigmaMaxMax", "maxCoherentPowerGain"):
            assert abs(recorded["passivity"][key] - report["passivity"][key]) < 1e-12
        assert recorded["reciprocityMaxAbsError"] == report["reciprocityMaxAbsError"]
        recorded_s = np.array([[complex(v["re"], v["im"]) for v in row] for row in recorded["referenceAt1550nm"]["s"]])
        np.testing.assert_allclose(recorded_s, interpolated, atol=2e-15, rtol=0)
    print(json.dumps({"verifiedComplexValues": matrices.size, "maxError": report["sourceToCanonicalMaxAbsError"],
                      "sigmaMaxRange": [float(sigmas.min()), float(sigmas.max())],
                      "passivityViolations": len(excess),
                      "port1OutputFractionsAt1550nm": report["referenceAt1550nm"]["port1OutputPowerFractions"]}, indent=2))


if __name__ == "__main__":
    main()
