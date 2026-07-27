import { defaultParams, getDefinition, getPorts } from './models.js';
import { connectionDomain, isOpticalConnection } from './physics.js';
import { bridgeManifest } from './bridge.js';

const clone = value => structuredClone(value);
const yamlString = value => JSON.stringify(String(value));

export function semanticNetlist(circuit) {
  const domains = Object.fromEntries(['optical','electrical','rf','control','annotation'].map(domain => [domain, (circuit.connections ?? []).filter(connection => connectionDomain(connection, circuit.components) === domain).length]));
  return {
    format: 'picsetup-semantic-netlist',
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    model: {
      basis: 'scalar TE0 power-normalized complex amplitudes',
      equation: 'b = S a + s',
      routingMode: circuit.settings?.routingMode ?? 'physical',
      worldToUm: circuit.settings?.worldToUm ?? 0.2,
      boundary: 'Only optical-domain ports and connections enter the coherent solve; electrical, RF, control, and figure objects remain typed semantic graph elements.'
    },
    graphSummary: {
      components: circuit.components?.length ?? 0,
      connections: circuit.connections?.length ?? 0,
      connectionDomains: domains,
      figureObjects: (circuit.components ?? []).filter(component => getDefinition(component.type).diagramOnly).length
    },
    circuit: clone(circuit),
    bridges: bridgeManifest(circuit),
    models: Object.fromEntries(circuit.components.map(component => {
      const definition = getDefinition(component.type);
      return [component.id, {
        type: component.type,
        label: definition.label,
        provenance: component.params?.provenance ?? definition.provenance,
        assumptions: definition.assumptions ?? [],
        diagramOnly: Boolean(definition.diagramOnly),
        ports: getPorts(component).map(port => ({ id: port.id, label: port.label, domain: port.role ?? 'optical', medium: port.medium ?? null }))
      }];
    }))
  };
}

export function toSaxYAML(circuit) {
  const lines = [
    `name: ${yamlString(circuit.name ?? 'picsetup_circuit')}`,
    'schema: picsetup-sax-oriented-v1',
    'settings:',
    `  wavelength_nm: ${Number(circuit.settings?.wavelengthNm ?? 1550)}`,
    'instances:'
  ];
  const physicalComponents = circuit.components.filter(component => !getDefinition(component.type).diagramOnly);
  const opticalConnections = circuit.connections.filter(connection => isOpticalConnection(connection, circuit.components));
  for (const component of physicalComponents) {
    lines.push(`  ${component.id}:`);
    lines.push(`    component: ${yamlString(component.type)}`);
    lines.push(`    model: ${yamlString(component.params?.modelName ?? getDefinition(component.type).label)}`);
    lines.push('    settings:');
    for (const [key, value] of Object.entries(component.params ?? {})) {
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') lines.push(`      ${key}: ${typeof value === 'string' ? yamlString(value) : value}`);
    }
  }
  lines.push('placements:');
  for (const component of physicalComponents) {
    lines.push(`  ${component.id}: {x: ${Number(component.x ?? 0)}, y: ${Number(component.y ?? 0)}, rotation: ${Number(component.rotation ?? 0)}}`);
  }
  lines.push('connections:');
  for (const connection of opticalConnections) {
    lines.push(`  ${connection.a.component},${connection.a.port}: ${yamlString(`${connection.b.component},${connection.b.port}`)}`);
  }
  lines.push('metadata:');
  lines.push('  note: "SAX-oriented optical export. Figure-only objects and non-optical links remain in the semantic JSON, not this physical-model handoff. Map model names to your PDK/model library before simulation."');
  return `${lines.join('\n')}\n`;
}

function pythonLiteral(value, indent = 0) {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => pythonLiteral(item, indent + 1)).join(', ')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => ['string','number','boolean'].includes(typeof item)).map(([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item, indent + 1)}`).join(', ')}}`;
  return 'None';
}

export function toGdsfactoryPython(circuit) {
  const componentMap = {
    source: 'gf.components.straight(length=10)',
    detector: 'gf.components.straight(length=10)',
    termination: 'gf.components.straight(length=5)',
    phase: 'gf.components.straight(length=max(1, params.get("lengthUm", 20)))',
    modulator: 'gf.components.straight(length=max(1, params.get("lengthUm", 1000)))',
    attenuator: 'gf.components.straight(length=max(1, params.get("lengthUm", 10)))',
    coupler: 'gf.components.coupler(gap=params.get("gapUm", 0.2), length=params.get("interactionLengthUm", 20))',
    mmi: 'gf.components.mmi2x2()',
    splitter: 'gf.components.mmi1x2()',
    ring: 'gf.components.ring_double(radius=params.get("radiusUm", 10))',
    crossing: 'gf.components.crossing()',
    bragg: 'gf.components.dbr()',
    grating: 'gf.components.grating_coupler_elliptical()',
    'edge-coupler': 'gf.components.taper(length=20, width1=0.5, width2=0.15)',
    spiral: 'gf.components.spiral_racetrack(length=params.get("lengthUm", 5000))',
    heater: 'gf.components.straight_heater_metal(length=max(10, params.get("lengthUm", 100)))',
    awg: 'gf.components.rectangle(size=(60, 40))',
    'fiber-array': 'gf.components.array(component=gf.components.grating_coupler_elliptical(), columns=1, rows=4, spacing=(0, 127))',
    probe: 'gf.components.straight(length=5)',
    generic: 'gf.components.rectangle(size=(20, 10))',
    block: 'gf.components.rectangle(size=(30, 16))'
  };
  const physicalIds = new Set(circuit.components.filter(component => !getDefinition(component.type).diagramOnly).map(component => component.id));
  const layoutCircuit = {
    ...clone(circuit),
    components: circuit.components.filter(component => physicalIds.has(component.id)),
    connections: circuit.connections.filter(connection => isOpticalConnection(connection, circuit.components) && physicalIds.has(connection.a.component) && physicalIds.has(connection.b.component))
  };
  const state = JSON.stringify(layoutCircuit, null, 2);
  return `"""PicSetup starter layout.

Generated as a readable handoff, not a foundry-ready layout. Replace generic mappings,
port names, routes, cross-sections, and process settings with your PDK conventions.
"""
from __future__ import annotations
import json
import gdsfactory as gf

PICSETUP = json.loads(r'''${state.replace(/'''/g, "\\'\\'\\'")}''')


def component_for(instance: dict) -> gf.Component:
    params = instance.get("params", {})
    kind = instance["type"]
${Object.entries(componentMap).map(([type, expression], index) => `    ${index ? 'elif' : 'if'} kind == ${JSON.stringify(type)}:\n        return ${expression}`).join('\n')}
    return gf.components.rectangle(size=(20, 10))


@gf.cell
def picsetup_layout() -> gf.Component:
    c = gf.Component(${JSON.stringify((circuit.name ?? 'picsetup').replace(/[^a-zA-Z0-9_]+/g, '_'))})
    refs: dict[str, gf.ComponentReference] = {}
    for instance in PICSETUP["components"]:
        ref = c << component_for(instance)
        # PicSetup canvas coordinates are schematic/world coordinates. Adjust scale for your PDK.
        ref.move((instance.get("x", 0), -instance.get("y", 0)))
        refs[instance["id"]] = ref

    # Connections are preserved below as semantic endpoints. Port-name mappings vary by PDK.
    semantic_connections = [
${layoutCircuit.connections.map(item => `        (${pythonLiteral(`${item.a.component},${item.a.port}`)}, ${pythonLiteral(`${item.b.component},${item.b.port}`)}),`).join('\n')}
    ]
    c.info["picsetup_connections"] = semantic_connections
    c.info["picsetup_model_state"] = PICSETUP
    return c


if __name__ == "__main__":
    component = picsetup_layout()
    component.show()
`;
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function parseComplex(value) {
  if (Array.isArray(value)) return [Number(value[0] ?? 0), Number(value[1] ?? 0)];
  if (typeof value === 'object') return [Number(value.re ?? 0), Number(value.im ?? 0)];
  if (typeof value === 'number') return [value, 0];
  const text = String(value ?? '').trim().replace(/i$/i, 'j');
  const match = text.match(/^([+-]?[\d.eE]+)?([+-][\d.eE]+)j$/);
  if (match) return [Number(match[1] || 0), Number(match[2] || 0)];
  return [Number(text) || 0, 0];
}

export function parseSParameterData(text, filename = 'Imported S matrix') {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The S-parameter file is empty.');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    const root = Array.isArray(data) ? { samples: data } : data;
    if (Array.isArray(root.wavelengthsNm) && Array.isArray(root.matrices)) {
      const count = root.matrices[0]?.length ?? 2;
      return {
        modelName: root.modelName ?? filename,
        provenance: root.provenance ?? 'Imported JSON S-parameter table',
        ports: root.ports ?? makePorts(count),
        sParameters: { wavelengthsNm: root.wavelengthsNm.map(Number), matrices: root.matrices }
      };
    }
    if (Array.isArray(root.samples)) {
      const wavelengthsNm = root.samples.map(sample => Number(sample.wavelengthNm ?? sample.wavelength_nm ?? sample.lambda_nm));
      const matrices = root.samples.map(sample => sample.S ?? sample.matrix ?? sample.s);
      const count = matrices[0]?.length ?? 2;
      return { modelName: root.modelName ?? filename, provenance: root.provenance ?? 'Imported JSON S-parameter samples', ports: root.ports ?? makePorts(count), sParameters: { wavelengthsNm, matrices } };
    }
    throw new Error('JSON must contain wavelengthsNm + matrices, or a samples array.');
  }

  const lines = trimmed.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map(value => value.trim().toLowerCase());
  const wavelengthColumn = headers.findIndex(value => ['wavelength_nm','wavelength','lambda_nm','lambda'].includes(value));
  if (wavelengthColumn < 0) throw new Error('CSV requires a wavelength_nm column.');
  const portPairs = [];
  for (const header of headers) {
    const match = header.match(/^s(\d+)(\d+)_(re|im)$/);
    if (match) portPairs.push([Number(match[1]), Number(match[2])]);
  }
  const portCount = Math.max(2, ...portPairs.flat());
  const wavelengthsNm = [];
  const matrices = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter).map(value => value.trim());
    const wavelength = Number(cells[wavelengthColumn]);
    if (!Number.isFinite(wavelength)) continue;
    const matrix = Array.from({ length: portCount }, () => Array.from({ length: portCount }, () => [0, 0]));
    for (let row = 1; row <= portCount; row += 1) {
      for (let col = 1; col <= portCount; col += 1) {
        const reIndex = headers.indexOf(`s${row}${col}_re`);
        const imIndex = headers.indexOf(`s${row}${col}_im`);
        matrix[row - 1][col - 1] = [Number(cells[reIndex] ?? 0), Number(cells[imIndex] ?? 0)];
      }
    }
    wavelengthsNm.push(wavelength);
    matrices.push(matrix);
  }
  if (!wavelengthsNm.length) throw new Error('No numeric S-parameter rows were found.');
  return { modelName: filename, provenance: 'Imported CSV complex S-parameter table', ports: makePorts(portCount), sParameters: { wavelengthsNm, matrices } };
}

function makePorts(count) {
  const leftCount = Math.ceil(count / 2);
  const rightCount = count - leftCount;
  const ports = [];
  for (let index = 0; index < leftCount; index += 1) ports.push({ id: `p${index + 1}`, label: `P${index + 1}`, role: 'optical', x: -52, y: (index - (leftCount - 1) / 2) * 22 });
  for (let index = 0; index < rightCount; index += 1) ports.push({ id: `p${leftCount + index + 1}`, label: `P${leftCount + index + 1}`, role: 'optical', x: 52, y: (index - (rightCount - 1) / 2) * 22 });
  return ports;
}

export function makeSParameterComponent(params, point = { x: 550, y: 360 }) {
  return {
    id: `sblock-${Math.random().toString(36).slice(2, 8)}`,
    type: 'generic',
    name: params.modelName ?? 'S-parameter block',
    x: point.x, y: point.y, rotation: 0,
    params: { ...defaultParams('generic'), ...clone(params) }
  };
}

export function autoLayoutCircuit(circuit) {
  const components = circuit.components ?? [];
  if (!components.length) return circuit;
  const depth = new Map();
  const queue = [];
  const sources = components.filter(component => component.type === 'source');
  (sources.length ? sources : [components[0]]).forEach(component => { depth.set(component.id, 0); queue.push(component.id); });
  const neighbors = new Map(components.map(component => [component.id, []]));
  for (const connection of circuit.connections ?? []) {
    neighbors.get(connection.a.component)?.push(connection.b.component);
    neighbors.get(connection.b.component)?.push(connection.a.component);
  }
  while (queue.length) {
    const id = queue.shift();
    for (const neighbor of neighbors.get(id) ?? []) {
      if (!depth.has(neighbor)) { depth.set(neighbor, depth.get(id) + 1); queue.push(neighbor); }
    }
  }
  let fallbackDepth = Math.max(0, ...depth.values()) + 1;
  components.forEach(component => { if (!depth.has(component.id)) depth.set(component.id, fallbackDepth++); });
  const columns = new Map();
  components.forEach(component => { const d = depth.get(component.id); if (!columns.has(d)) columns.set(d, []); columns.get(d).push(component); });
  const maxDepth = Math.max(...columns.keys());
  for (const [d, items] of columns) {
    items.forEach((component, index) => {
      component.x = 100 + d * Math.min(230, 900 / Math.max(1, maxDepth));
      component.y = 360 + (index - (items.length - 1) / 2) * Math.min(150, 520 / Math.max(1, items.length));
    });
  }
  circuit.connections?.forEach(connection => { connection.waypoints = []; });
  return circuit;
}

export function importSemanticNetlist(data) {
  const circuit = clone(data?.circuit ?? data);
  if (!Array.isArray(circuit?.components) || !Array.isArray(circuit?.connections)) throw new Error('No PicSetup-compatible circuit graph was found.');
  const hasPlacement = circuit.components.some(component => Number.isFinite(component.x) && Number.isFinite(component.y));
  if (!hasPlacement) autoLayoutCircuit(circuit);
  return circuit;
}
