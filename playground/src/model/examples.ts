import type { CircuitDocument } from './types';
import { blankDocument, validateDocument } from '../io/document';

/** A balanced 80 µm-per-arm MZI, using the same public component and link schema. */
export function createMziExample(): CircuitDocument {
  const doc = blankDocument();
  doc.title = 'Balanced Mach–Zehnder interferometer';
  doc.circuit.components = [
    { id: 'source-1', model: 'source', version: '1', label: 'CW source', params: { powerW: 0.001, phaseRad: 0 } },
    { id: 'coupler-1', model: 'coupler', version: '1', label: 'Input coupler', params: { coupling: 0.5 } },
    { id: 'phase-1', model: 'phase', version: '1', label: 'Upper arm phase', params: { phaseRad: 0 } },
    { id: 'coupler-2', model: 'coupler', version: '1', label: 'Output coupler', params: { coupling: 0.5 } },
    { id: 'detector-1', model: 'detector', version: '1', label: 'Output 0', params: {} },
    { id: 'detector-2', model: 'detector', version: '1', label: 'Output 1', params: {} },
  ];
  const link = (id: string, from: string, fromPort: number, to: string, toPort: number, lengthM: number) => ({
    id, from: { component: from, port: fromPort }, to: { component: to, port: toPort }, lengthM, lossDbPerM: 0, neff: 2.4,
  });
  doc.circuit.connections = [
    link('link-1', 'source-1', 0, 'coupler-1', 0, 0),
    link('link-2', 'coupler-1', 2, 'phase-1', 0, 40e-6),
    link('link-3', 'phase-1', 1, 'coupler-2', 0, 40e-6),
    link('link-4', 'coupler-1', 3, 'coupler-2', 1, 80e-6),
    link('link-5', 'coupler-2', 2, 'detector-1', 0, 0),
    link('link-6', 'coupler-2', 3, 'detector-2', 0, 0),
  ];
  doc.layout.components = {
    'source-1': { x: 100, y: 250, rotation: 0 },
    'coupler-1': { x: 280, y: 250, rotation: 0 },
    'phase-1': { x: 490, y: 140, rotation: 0 },
    'coupler-2': { x: 700, y: 250, rotation: 0 },
    'detector-1': { x: 900, y: 180, rotation: 0 },
    'detector-2': { x: 900, y: 330, rotation: 0 },
  };
  doc.layout.connections = Object.fromEntries(doc.circuit.connections.map(connection => [connection.id, { bend: connection.id === 'link-4' ? 140 : 0 }]));
  validateDocument(doc);
  return doc;
}
