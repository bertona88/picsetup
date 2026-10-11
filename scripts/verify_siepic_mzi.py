#!/usr/bin/env python3
"""Independent reduced 8-port NumPy oracle for the 80/100 µm SiEPIC MZI.

Two couplers, reciprocal links, matched source/detectors and zero phase shifter.
The two 40 µm upper links are analytically combined into one 80 µm link. Solve
for incident waves using (I - C S) a = a_external, rather than the TypeScript
solver's outgoing-wave equations. No TypeScript model/solver is executed.
"""
import sys
sys.dont_write_bytecode = True
import argparse
import json

import numpy as np

from verify_siepic import MODEL, C, independently_parse


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    frequency, matrices = independently_parse((MODEL / "source.sparam").read_bytes())
    samples = []
    for wavelength_nm in (1500, 1525, 1550, 1575, 1600):
        wavelength_m = wavelength_nm * 1e-9
        target_frequency = C / wavelength_m
        local_s = np.array([[np.interp(target_frequency, frequency, matrices[:, o, i]) for i in range(4)] for o in range(4)])
        s = np.zeros((8, 8), complex)
        s[:4, :4] = local_s
        s[4:, 4:] = local_s
        connection = np.zeros((8, 8), complex)
        for left, right, length_m in ((2, 4, 80e-6), (3, 5, 100e-6)):
            h = np.exp(-2j * np.pi * 2.4 * length_m / wavelength_m)
            connection[left, right] = connection[right, left] = h
        external = np.zeros(8, complex)
        external[0] = np.sqrt(0.001)
        system = np.eye(8) - connection @ s
        incoming = np.linalg.solve(system, external)
        outgoing = s @ incoming
        device_exchange = [float(np.sum(np.abs(incoming[part]) ** 2) - np.sum(np.abs(outgoing[part]) ** 2)) for part in (slice(0, 4), slice(4, 8))]
        detectors = {f"detector-{i + 1}": {"incoming": {"re": float(value.real), "im": float(value.imag)}, "powerW": float(abs(value) ** 2)} for i, value in enumerate(outgoing[6:])}
        budget = {
            "emittedW": 0.001,
            "modelSuppliedW": sum(max(-exchange, 0) for exchange in device_exchange),
            "detectedW": float(np.sum(np.abs(outgoing[6:]) ** 2)),
            "escapedW": float(abs(outgoing[1]) ** 2),
            "componentAbsorbedW": sum(max(exchange, 0) for exchange in device_exchange),
            "returnedToSourceW": float(abs(outgoing[0]) ** 2),
            "propagationLossW": 0.0
        }
        budget["imbalanceW"] = budget["emittedW"] + budget["modelSuppliedW"] - sum(budget[k] for k in ("detectedW", "escapedW", "componentAbsorbedW", "returnedToSourceW", "propagationLossW"))
        samples.append({"wavelengthM": wavelength_m, "detectors": detectors, "budget": budget,
                        "deviceNetAbsorbedW": device_exchange,
                        "absoluteEquationResidual": float(np.max(np.abs(system @ incoming - external)))})
    report = {
        "schema": "picsetup.independent-mzi-reference.v1",
        "sourceSha256": "945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371",
        "method": "Independent raw regex/NumPy parser, Cartesian frequency interpolation, reduced 8-port incident-wave solve via numpy.linalg.solve; no production TypeScript evaluator or solver",
        "experiment": {"factory": "createDatasetMziExperiment", "upperArmM": 80e-6, "lowerArmM": 100e-6, "neff": 2.4, "sourcePowerW": 0.001, "sourcePhaseRad": 0, "phaseShiftRad": 0, "lossDbPerM": 0, "timeConvention": "exp(+iωt)"},
        "samples": samples
    }
    path = MODEL / "mzi-reference.json"
    if args.write:
        path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    else:
        recorded = json.loads(path.read_text())
        for actual, expected in zip(samples, recorded["samples"], strict=True):
            assert actual["wavelengthM"] == expected["wavelengthM"]
            for key in actual["budget"]:
                np.testing.assert_allclose(actual["budget"][key], expected["budget"][key], atol=1e-15, rtol=1e-12)
            for name in actual["detectors"]:
                for part in ("re", "im"):
                    np.testing.assert_allclose(actual["detectors"][name]["incoming"][part], expected["detectors"][name]["incoming"][part], atol=1e-14, rtol=1e-12)
    print(json.dumps({"verifiedMziWavelengths": len(samples), "maxResidual": max(sample["absoluteEquationResidual"] for sample in samples), "maxBudgetImbalanceW": max(abs(sample["budget"]["imbalanceW"]) for sample in samples)}))


if __name__ == "__main__":
    main()
