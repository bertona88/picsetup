#!/usr/bin/env python3
"""Regenerate/check independent dispersive-guide references; Python stdlib only."""
import argparse
import ast
import cmath
from decimal import Decimal, localcontext
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'playground/models/siepic-strip-500x220-te'
PI = Decimal('3.141592653589793238462643383279502884197169399375105820974944592307816406')
C = Decimal(299792458)


def regenerate():
    manifest = json.loads((MODEL / 'manifest.json').read_text())
    for key in ('source', 'implementationSource'):
        spec = manifest[key]
        data = (MODEL / spec['localPath']).read_bytes()
        assert hashlib.sha256(data).hexdigest() == spec['sha256']
        assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == spec['gitBlobSha1']
    values = [Decimal(value) for value in (MODEL / 'source.txt').read_text().split()]
    assert len(values) == 7
    lam0, ne, _, ng, _, nd, _ = values
    coefficient_metadata = manifest['coefficients']
    assert all(float(value) == coefficient_metadata[key] for value, key in (
        (lam0, 'referenceWavelengthM'), (ne, 'neff'), (ng, 'groupIndex'), (nd, 'dispersionCoefficient')))
    module = ast.parse((MODEL / 'source-models.py').read_text())
    function = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'waveguide')
    actual = next(node.value for node in ast.walk(function) if isinstance(node, ast.Assign)
                  and any(isinstance(target, ast.Name) and target.id == 'K' for target in node.targets))
    expected = ast.parse('2 * jnp.pi * ne / lam0 + (ng / SPEED_OF_LIGHT) * (omega - omega0) - (nd * lam0**2 / (4 * jnp.pi * SPEED_OF_LIGHT)) * ((omega - omega0) ** 2)', mode='eval').body
    assert ast.dump(actual) == ast.dump(expected), 'Pinned source beta expression differs'

    # The independent calculation uses high-precision frequency differences and
    # a scalar quadratic, not the TypeScript implementation or network solver.
    b0 = 2 * PI * ne / lam0
    b1 = ng / C
    b2 = -nd * lam0 * lam0 / (4 * PI * C)

    def beta(wavelength):
        dw = 2 * PI * (C / wavelength - C / lam0)
        return b0 + dw * (b1 + b2 * dw)

    def group_index(wavelength):
        dw = 2 * PI * (C / wavelength - C / lam0)
        return C * (b1 + 2 * b2 * dw)

    def complex_record(value):
        return {'re': value.real, 'im': value.imag}

    length = Decimal('13.7e-6')
    loss = Decimal(24000)
    guide_samples = []
    mzi_samples = []
    derivative_errors = []
    for nm in (1500, 1525, 1550, 1575, 1600):
        wavelength = Decimal(nm) * Decimal('1e-9')
        beta_value = beta(wavelength)
        gain = math.pow(10, -float(loss * length) / 20)
        h = cmath.rect(gain, -float(beta_value * length))
        delay = group_index(wavelength) * length / C
        freq = C / wavelength
        df = Decimal('1e9')
        derivative_delay = (beta(C / (freq + df)) - beta(C / (freq - df))) * length / (4 * PI * df)
        derivative_errors.append(float(abs(derivative_delay - delay)))
        guide_samples.append({'wavelengthM': float(wavelength), 'lengthM': float(length), 'lossDbPerM': float(loss),
                              'betaRadPerM': float(beta_value), 'effectiveIndex': float(beta_value * wavelength / (2 * PI)),
                              'groupIndex': float(group_index(wavelength)), 'groupDelayS': float(delay), 'h': complex_record(h)})
        upper = cmath.exp(-1j * float(beta_value * Decimal('80e-6')) - 0.37j)
        lower = cmath.exp(-1j * float(beta_value * Decimal('100e-6')))
        source = math.sqrt(0.001)
        d0 = source * (upper - lower) / 2
        d1 = source * 1j * (upper + lower) / 2
        mzi_samples.append({'wavelengthM': float(wavelength), 'd0': complex_record(d0), 'd1': complex_record(d1),
                            'd0PowerW': abs(d0) ** 2, 'd1PowerW': abs(d1) ** 2})

    # Solve the independent high-precision quadratic exactly at equal-arm-phase
    # orders. The 20 um difference gives adjacent in-window fringes near 1550 nm.
    delta_length = Decimal('20e-6')
    fringes = []
    for order in (31, 32, 33):
        target_delta_beta = 2 * PI * order / delta_length - b0
        dw = 2 * target_delta_beta / (b1 + (b1*b1 + 4*b2*target_delta_beta).sqrt())
        wavelength = C / (C / lam0 + dw / (2 * PI))
        fringes.append({'order': order, 'wavelengthM': float(wavelength), 'frequencyHz': float(C / wavelength)})
    reference = {'schema': 'picsetup.waveguide-reference/1', 'sourceSha256': manifest['source']['sha256'],
                 'calculation': 'Independent 60-digit Decimal frequency polynomial; complex sin/cos in Python binary64.',
                 'guideSamples': guide_samples,
                 'mzi': {'upperLengthM': 80e-6, 'lowerLengthM': 100e-6, 'phaseRad': 0.37, 'sourcePowerW': 0.001, 'samples': mzi_samples},
                 'fringes': {'deltaLengthM': 20e-6, 'phaseRad': 0, 'equalPhaseOrders': fringes,
                             'adjacentWavelengthSpacingM': [fringes[i]['wavelengthM'] - fringes[i+1]['wavelengthM'] for i in range(2)],
                             'localReferenceFsrHz': float(C / (ng * delta_length))}}
    report = {'schema': 'picsetup.waveguide-audit/1', 'sourceSha256': manifest['source']['sha256'],
              'exactSourceBlobVerified': True, 'exactImplementationBlobVerified': True,
              'pinnedBetaAstVerified': True, 'sourceCoefficientCount': len(values),
              'guideSampleCount': len(guide_samples), 'mziSampleCount': len(mzi_samples),
              'phaseDerivativeDelayMaxAbsErrorS': max(derivative_errors),
              'mziPowerClosureMaxAbsErrorW': max(abs(sample['d0PowerW'] + sample['d1PowerW'] - 0.001) for sample in mzi_samples),
              'referenceGroupDelayFor13_7umS': float(ng * length / C),
              'referenceLocalFsrFor20umHz': float(C / (ng * delta_length)),
              'sourceValidatedWavelengthBandM': None,
              'declaredEvaluationWindowM': manifest['eligibility']['evaluationWindowM'],
              'nonclaims': ['No hardware validation', 'No calibrated fit domain', 'No loss calibration', 'No coupler mode or port-plane matching']}
    return {'reference.json': reference, 'verification.json': report}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify checked-in references without rewriting them')
    args = parser.parse_args()
    with localcontext() as context:
        context.prec = 60
        outputs = regenerate()
    for name, value in outputs.items():
        expected = json.dumps(value, indent=2, ensure_ascii=False) + '\n'
        path = MODEL / name
        if args.check:
            assert path.read_text() == expected, f'{name} differs; regenerate with this script'
        else:
            path.write_text(expected)
    print(json.dumps(outputs['verification.json'], indent=2))
