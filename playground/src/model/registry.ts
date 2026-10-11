import { complex, polar } from './complex';
import type { Complex, Component, ModelId } from './types';

/** Exact bundled analytical model versions. No runtime model or data loading. */
export const MODEL_IDS: readonly ModelId[] = ['source', 'coupler', 'phase', 'attenuator', 'detector', 'termination'];

export function portNames(model: ModelId): string[] {
  switch (model) {
    case 'source': return ['out'];
    case 'coupler': return ['L0', 'L1', 'R0', 'R1'];
    case 'phase': case 'attenuator': return ['L', 'R'];
    case 'detector': case 'termination': return ['in'];
    default: throw new RangeError(`Unknown model: ${String(model)}`);
  }
}

export function defaultParams(model: ModelId): Record<string, number> {
  switch (model) {
    case 'source': return { powerW: 0.001, phaseRad: 0 };
    case 'coupler': return { coupling: 0.5 };
    case 'phase': return { phaseRad: 0 };
    case 'attenuator': return { attenuationDb: 3 };
    case 'detector': case 'termination': return {};
    default: throw new RangeError(`Unknown model: ${String(model)}`);
  }
}

/** S[output][input], scalar power-normalized ports, time convention exp(+iωt). */
export function evaluate(component: Component, wavelengthM: number): Complex[][] {
  if (component.version !== '1') throw new RangeError('Unsupported analytical model version');
  if (!Number.isFinite(wavelengthM) || wavelengthM <= 0) throw new RangeError('Wavelength must be finite and positive');
  const expected = Object.keys(defaultParams(component.model));
  if (Object.keys(component.params).length !== expected.length || expected.some(key => !Number.isFinite(component.params[key]))) {
    throw new RangeError('Model parameters must have exactly the required finite numeric values');
  }
  const n = portNames(component.model).length;
  const s = Array.from({ length: n }, () => Array.from({ length: n }, () => complex()));
  switch (component.model) {
    case 'source':
      if (component.params.powerW < 0) throw new RangeError('Source power must be nonnegative');
      break;
    case 'coupler': {
      const k = component.params.coupling;
      if (k < 0 || k > 1) throw new RangeError('Coupling must be between zero and one');
      const t = complex(Math.sqrt(1 - k));
      const q = complex(0, Math.sqrt(k));
      s[0][2] = t; s[0][3] = q;
      s[1][2] = q; s[1][3] = t;
      s[2][0] = t; s[2][1] = q;
      s[3][0] = q; s[3][1] = t;
      break;
    }
    case 'phase':
      s[0][1] = s[1][0] = polar(1, -component.params.phaseRad);
      break;
    case 'attenuator':
      if (component.params.attenuationDb < 0) throw new RangeError('Attenuation must be nonnegative');
      s[0][1] = s[1][0] = complex(10 ** (-component.params.attenuationDb / 20));
      break;
  }
  return s;
}
