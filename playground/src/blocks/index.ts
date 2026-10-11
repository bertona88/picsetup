import { blankDocument, validateDocument } from '../io/document';
import type { CircuitDocument, Component, Connection, Endpoint, Position } from '../model/types';
import { waveguideMetadata } from '../model/propagation';

export type BlockId = 'mzi' | 'ring' | 'splitter-tree' | 'delay-line';
export type BlockParams = Record<string, number | string>;
export interface BlockParameter {
  type: 'number' | 'enum';
  default: number | string;
  description: string;
  unit?: string;
  min?: number;
  exclusiveMin?: number;
  max?: number;
  options?: string[];
}
export interface BlockDefinition {
  id: BlockId;
  title: string;
  description: string;
  ports: string[];
  params: Record<string, BlockParameter>;
}
export interface BlockFragment {
  components: Component[];
  connections: Connection[];
  ports: Record<string, Endpoint>;
}

const number = (value: number, unit: string, description: string, min?: number): BlockParameter => ({
  type: 'number', default: value, unit, description, ...(min === undefined ? {} : { min }),
});
const propagation = () => ({
  guideModel: { type: 'enum' as const, default: 'constant-index', options: ['constant-index', 'siepic-strip-500x220-te'], description: 'Constant index or the pinned dispersive 500 × 220 nm SiEPIC strip coefficient set. The dispersive evaluation window and modal matching remain unqualified.' },
  neff: { ...number(2.4, '1', 'Constant effective index; strictly positive. Locked to the source reference index for a selected dispersive guide.'), exclusiveMin: 0 },
  lossDbPerM: number(0, 'dB/m', 'Explicit guide power loss per metre.', 0),
});
const couplerModel = (): BlockParameter => ({
  type: 'enum', default: 'coupler', options: ['coupler', 'siepic-coupler'],
  description: 'Ideal coupler or the fixed 200 nm gap / 10 µm SiEPIC table. Dataset validity and reference-plane limits apply.',
});

/** Blocks expand to ordinary versioned primitives, never opaque solver models. */
export const BLOCK_DEFINITIONS: Record<BlockId, BlockDefinition> = {
  mzi: {
    id: 'mzi', title: 'Mach–Zehnder',
    description: 'Two couplers, an upper-arm phase shifter, and explicit 80 µm / (80 µm + ΔL) arms. Ideal couplers use K = 0.5.',
    ports: ['in0', 'in1', 'out0', 'out1'],
    params: {
      couplerModel: couplerModel(),
      deltaLengthM: number(20e-6, 'm', 'Lower-arm length minus the fixed 80 µm upper arm.', -80e-6),
      phaseRad: number(0, 'rad', 'Additional upper-arm reciprocal phase delay.'),
      ...propagation(),
    },
  },
  ring: {
    id: 'ring', title: 'All-pass ring',
    description: 'A coupler with a reciprocal phase shifter in its feedback path. Ideal coupling K = 0.2; explicit default guide loss is 1000 dB/m.',
    ports: ['in', 'out'],
    params: {
      couplerModel: couplerModel(),
      roundTripLengthM: number(100e-6, 'm', 'Total explicit feedback guide length, independent of the drawing.', 0),
      phaseRad: number(0, 'rad', 'Additional round-trip reciprocal phase delay.'),
      ...propagation(),
      lossDbPerM: number(1000, 'dB/m', 'Explicit feedback guide power loss per metre; not numerical damping.', 0),
    },
  },
  'splitter-tree': {
    id: 'splitter-tree', title: '1 → 4 splitter',
    description: 'Three couplers in two stages. Ideal K = 0.5 gives four equal-power outputs; unused inputs are matched boundaries.',
    ports: ['in', 'out0', 'out1', 'out2', 'out3'],
    params: {
      couplerModel: couplerModel(),
      branchLengthM: number(40e-6, 'm', 'Guide length from the first coupler to each second-stage coupler.', 0),
      ...propagation(),
    },
  },
  'delay-line': {
    id: 'delay-line', title: 'Delay line',
    description: 'Reciprocal phase and attenuation primitives joined by a guide with explicit physical length. This is a CW phase-delay model.',
    ports: ['in', 'out'],
    params: {
      lengthM: number(100e-6, 'm', 'Explicit guide length between the two primitives.', 0),
      phaseRad: number(0, 'rad', 'Additional reciprocal phase delay.'),
      attenuationDb: number(0, 'dB', 'Lumped power attenuation, additional to guide loss.', 0),
      ...propagation(),
    },
  },
};

export const blockCatalog = Object.values(BLOCK_DEFINITIONS).map(definition => ({
  id: definition.id, title: definition.title, description: definition.description,
  ports: [...definition.ports],
  defaultParams: Object.fromEntries(Object.entries(definition.params).map(([key, spec]) => [key, spec.default])) as BlockParams,
  parameters: structuredClone(definition.params),
}));

function freezeMetadata(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeMetadata);
    Object.freeze(value);
  }
}
// Catalog callers cannot silently alter the meaning of a versioned block.
freezeMetadata(BLOCK_DEFINITIONS);
freezeMetadata(blockCatalog);

function parameters(kind: BlockId, supplied: BlockParams): BlockParams {
  if (!Object.hasOwn(BLOCK_DEFINITIONS, kind)) throw new RangeError(`Unknown block: ${String(kind)}`);
  if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied)) throw new TypeError('Block parameters must be an object.');
  const definitions = BLOCK_DEFINITIONS[kind].params;
  for (const key of Object.keys(supplied)) {
    if (!Object.hasOwn(definitions, key)) throw new RangeError(`Unknown ${kind} parameter: ${key}`);
  }
  const resolved: BlockParams = {};
  for (const [key, spec] of Object.entries(definitions)) {
    const value = Object.hasOwn(supplied, key) ? supplied[key] : spec.default;
    if (spec.type === 'enum') {
      if (typeof value !== 'string' || !spec.options!.includes(value)) throw new RangeError(`${kind}.${key} must be ${spec.options!.join(' or ')}.`);
    } else if (typeof value !== 'number' || !Number.isFinite(value) ||
      (spec.min !== undefined && value < spec.min) || (spec.exclusiveMin !== undefined && value <= spec.exclusiveMin) || (spec.max !== undefined && value > spec.max)) {
      throw new RangeError(`${kind}.${key} must be a finite number within its declared range.`);
    }
    resolved[key] = value;
  }
  if ((resolved.neff as number) <= 0) throw new RangeError(`${kind}.neff must be strictly positive.`);
  if (resolved.guideModel === 'siepic-strip-500x220-te') {
    if (Object.hasOwn(supplied, 'neff') && supplied.neff !== waveguideMetadata.neff) throw new RangeError(`${kind}.neff must equal the selected waveguide reference index ${waveguideMetadata.neff}; omit it to use the source value.`);
    resolved.neff = waveguideMetadata.neff;
  }
  return resolved;
}

const endpoint = (component: string, port: number): Endpoint => ({ component, port });
const component = (id: string, model: Component['model'], label: string, params: Component['params']): Component => ({
  id, model, version: '1', label, params,
});

export function instantiateBlock(kind: BlockId, params: BlockParams = {}): BlockFragment {
  const p = parameters(kind, params);
  const coupler = (id: string, label: string, coupling = 0.5) => component(
    id, p.couplerModel as 'coupler' | 'siepic-coupler', label,
    p.couplerModel === 'coupler' ? { coupling } : {},
  );
  const phase = (id: string, label: string) => component(id, 'phase', label, { phaseRad: p.phaseRad as number });
  const link = (id: string, from: Endpoint, to: Endpoint, lengthM: number): Connection => ({
    id, from, to, lengthM, neff: p.neff as number, lossDbPerM: p.lossDbPerM as number,
    ...(p.guideModel === 'siepic-strip-500x220-te' ? { waveguide: { model: 'siepic-strip-500x220-te' as const, version: '1' as const } } : {}),
  });
  let fragment: BlockFragment;
  switch (kind) {
    case 'mzi':
      fragment = {
        components: [coupler('split', 'MZI input coupler'), phase('phase', 'MZI upper phase'), coupler('combine', 'MZI output coupler')],
        connections: [
          link('upper-start', endpoint('split', 2), endpoint('phase', 0), 40e-6),
          link('upper-end', endpoint('phase', 1), endpoint('combine', 0), 40e-6),
          link('lower', endpoint('split', 3), endpoint('combine', 1), 80e-6 + (p.deltaLengthM as number)),
        ],
        ports: { in0: endpoint('split', 0), in1: endpoint('split', 1), out0: endpoint('combine', 2), out1: endpoint('combine', 3) },
      };
      break;
    case 'ring':
      fragment = {
        components: [coupler('coupler', 'Ring bus coupler', 0.2), phase('phase', 'Ring phase')],
        connections: [
          link('loop-start', endpoint('coupler', 3), endpoint('phase', 0), (p.roundTripLengthM as number) / 2),
          link('loop-end', endpoint('phase', 1), endpoint('coupler', 1), (p.roundTripLengthM as number) / 2),
        ],
        ports: { in: endpoint('coupler', 0), out: endpoint('coupler', 2) },
      };
      break;
    case 'splitter-tree':
      fragment = {
        components: [coupler('split', 'Tree input coupler'), coupler('upper', 'Tree upper coupler'), coupler('lower', 'Tree lower coupler')],
        connections: [
          link('upper-link', endpoint('split', 2), endpoint('upper', 0), p.branchLengthM as number),
          link('lower-link', endpoint('split', 3), endpoint('lower', 0), p.branchLengthM as number),
        ],
        ports: { in: endpoint('split', 0), out0: endpoint('upper', 2), out1: endpoint('upper', 3), out2: endpoint('lower', 2), out3: endpoint('lower', 3) },
      };
      break;
    case 'delay-line':
      fragment = {
        components: [phase('phase', 'Delay line phase'), component('loss', 'attenuator', 'Delay line attenuation', { attenuationDb: p.attenuationDb as number })],
        connections: [link('guide', endpoint('phase', 1), endpoint('loss', 0), p.lengthM as number)],
        ports: { in: endpoint('phase', 0), out: endpoint('loss', 1) },
      };
      break;
  }
  // Apply the same structural and numerical admission rules as native scenes.
  const doc = blankDocument();
  doc.circuit.components = fragment.components;
  doc.circuit.connections = fragment.connections;
  doc.layout.components = Object.fromEntries(fragment.components.map(item => [item.id, { x: 0, y: 0, rotation: 0 }]));
  doc.layout.connections = Object.fromEntries(fragment.connections.map(item => [item.id, { bend: 0 }]));
  validateDocument(doc);
  return fragment;
}

function localLayout(kind: BlockId): Record<string, Position> {
  const position = (x: number, y: number, rotation = 0): Position => ({ x, y, rotation });
  switch (kind) {
    case 'mzi': return { split: position(0, 110), phase: position(210, 0), combine: position(420, 110) };
    case 'ring': return { coupler: position(0, 0), phase: position(140, 210, 180) };
    case 'splitter-tree': return { split: position(0, 130), upper: position(230, 0), lower: position(230, 260) };
    case 'delay-line': return { phase: position(0, 0), loss: position(230, 0) };
  }
}

/** Atomic insertion. Physical guide lengths are never derived from layout. */
export function insertBlock(
  doc: CircuitDocument, kind: BlockId, params: BlockParams = {}, position?: { x: number; y: number },
): { document: CircuitDocument; ports: Record<string, Endpoint>; componentIds: string[] } {
  validateDocument(doc);
  const fragment = instantiateBlock(kind, params);
  const anchor = position ?? {
    x: doc.circuit.components.length ? Math.max(...Object.values(doc.layout.components).map(item => item.x)) + 240 : 200,
    y: 160,
  };
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) throw new RangeError('Block insertion position must be finite.');
  const existing = new Set([...doc.circuit.components, ...doc.circuit.connections].map(item => item.id));
  const all = [...fragment.components, ...fragment.connections];
  let ordinal = 1;
  while (all.some(item => existing.has(`${kind}-${ordinal}--${item.id}`))) ordinal++;
  const remap = (id: string) => `${kind}-${ordinal}--${id}`;
  const port = (value: Endpoint): Endpoint => ({ component: remap(value.component), port: value.port });
  const document = structuredClone(doc);
  const positions = localLayout(kind);
  for (const item of fragment.components) {
    const id = remap(item.id);
    document.circuit.components.push({ ...item, id });
    const local = positions[item.id];
    document.layout.components[id] = { ...local, x: anchor.x + local.x, y: anchor.y + local.y };
  }
  for (const item of fragment.connections) {
    const id = remap(item.id);
    document.circuit.connections.push({ ...item, id, from: port(item.from), to: port(item.to) });
    document.layout.connections[id] = { bend: kind === 'mzi' && item.id === 'lower' ? 140 : kind === 'ring' ? 90 : 0 };
  }
  validateDocument(document);
  return { document, ports: Object.fromEntries(Object.entries(fragment.ports).map(([name, value]) => [name, port(value)])), componentIds: fragment.components.map(item => remap(item.id)) };
}
