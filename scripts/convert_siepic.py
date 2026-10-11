#!/usr/bin/env python3
"""Reproduce the pinned SiEPIC directional-coupler browser dataset.

Intentionally a narrow, strict reader for this file, not a general Lumerical
importer. No extrapolation, reciprocity completion, gain clipping, normalization,
reference-plane shift, or group-delay correction is performed.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "playground/models/siepic-dc-200nm-10um"
SOURCE_SHA256 = "945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371"


def convert(raw: bytes) -> dict:
    """Parse all sixteen explicit blocks, mapping S[output][input]."""
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("Source differs from the pinned, audited dataset")
    lines = iter(raw.decode("ascii").splitlines())
    blocks: dict[tuple[int, int], list[tuple[float, float, float]]] = {}
    grid = None
    for line in lines:
        header = ast.literal_eval(line)
        if not isinstance(header, tuple) or len(header) != 6:
            raise ValueError("Unsupported header; group-delay variants need a separate audit")
        out, pol, mode_out, inp, mode_in, kind = header
        names = [f"port {i}" for i in range(1, 5)]
        if out not in names or inp not in names or (pol, mode_out, mode_in, kind) != ("TE", 1, 1, "transmission"):
            raise ValueError("Unexpected port, polarization, mode or value type")
        shape = ast.literal_eval(next(lines))
        if shape != (101, 3):
            raise ValueError("Expected 101 (frequencyHz, magnitude, phaseRad) rows")
        rows = []
        for _ in range(shape[0]):
            row = tuple(float(value) for value in next(lines).split())
            if len(row) != 3 or not all(math.isfinite(value) for value in row):
                raise ValueError("Non-finite or malformed data row")
            if row[0] <= 0 or row[1] < 0:
                raise ValueError("Invalid frequency or magnitude")
            rows.append(row)
        frequencies = [row[0] for row in rows]
        if any(a >= b for a, b in zip(frequencies, frequencies[1:])):
            raise ValueError("Frequency samples must increase strictly")
        if grid is None:
            grid = frequencies
        elif frequencies != grid:
            raise ValueError("Every S entry must use the same frequency grid")
        key = (names.index(out), names.index(inp))
        if key in blocks:
            raise ValueError("Duplicate S entry")
        blocks[key] = rows
    if len(blocks) != 16:
        raise ValueError("All sixteen S entries must be explicitly present")
    # Lumerical uses Re{E exp(-i wt)}; this workbench uses Re{E exp(+i wt)}.
    # Complex conjugation changes representation, not power or reference planes.
    matrices = [
        [[{"re": blocks[o, i][k][1] * math.cos(blocks[o, i][k][2]),
           "im": -blocks[o, i][k][1] * math.sin(blocks[o, i][k][2])}
          for i in range(4)] for o in range(4)]
        for k in range(len(grid))
    ]
    return {
        "schema": "picsetup.smatrix.v1", "id": "siepic-dc-200nm-10um", "version": "1.0.0",
        "frequencyHz": grid, "s": matrices,
        "metadata": {
            "label": "SiEPIC DC · 200 nm gap · 10 µm coupling length",
            "sourceSha256": SOURCE_SHA256,
            "sourceCommit": "5a5e826fb58b2b5ce0355189b3e3b33e2bd8828c",
            "portOrder": ["port 1", "port 2", "port 3", "port 4"],
            "matrixConvention": "S[output][input]",
            "timeConvention": "exp(+iωt)", "sourceTimeConvention": "exp(-iωt)",
            "powerNormalization": "abs(amplitude)^2 in W; source modal power normalization retained",
            "polarization": "TE", "modeId": 1,
            "referencePlanes": "native source port planes retained; spatial locations and de-embedding unknown",
            "interpolation": "linear real and imaginary parts in frequencyHz; no extrapolation",
            "status": "experimental",
            "passiveCertified": False,
            "warnings": [
                "Raw dataset slightly violates passivity at some samples; no gain clipping or normalization applied.",
                "Native port reference planes have no published spatial coordinates; experiments retain their phase as opaque boundaries.",
                "TE mode 1 is the source label; modal fields and calibrated fabrication accuracy are not supplied."
            ]
        }
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if checked-in JSON is not reproduced byte for byte")
    args = parser.parse_args()
    result = (json.dumps(convert((MODEL / "source.sparam").read_bytes()), ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    path = MODEL / "data.json"
    if args.check:
        if path.read_bytes() != result:
            raise SystemExit("data.json differs from deterministic conversion")
        print("Verified deterministic conversion: 101 samples × 16 complete complex entries")
    else:
        path.write_bytes(result)
        print(f"Wrote {path.relative_to(ROOT)} ({len(result)} bytes)")


if __name__ == "__main__":
    main()
