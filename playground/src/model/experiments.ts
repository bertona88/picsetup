import { blankDocument, validateDocument } from '../io/document';
import { createMziExample } from './examples';
import type { CircuitDocument } from './types';

/** Single-port excitation: preserves both reflected channels of the imported block. */
export function createCouplerExperiment(): CircuitDocument {
  const doc = blankDocument();
  doc.title = 'SiEPIC coupler · wavelength response';
  doc.circuit.components = [
    { id: 'source-1', model: 'source', version: '1', label: 'CW source', params: { powerW: 0.001, phaseRad: 0 } },
    { id: 'coupler-1', model: 'siepic-coupler', version: '1', label: 'SiEPIC · 200 nm / 10 µm', params: {} },
    { id: 'detector-1', model: 'detector', version: '1', label: 'Through · port 3', params: {} },
    { id: 'detector-2', model: 'detector', version: '1', label: 'Cross · port 4', params: {} },
  ];
  const link = (id: string, from: string, fromPort: number, to: string) => ({ id, from: { component: from, port: fromPort }, to: { component: to, port: 0 }, lengthM: 0, lossDbPerM: 0, neff: 2.4 });
  doc.circuit.connections = [link('link-1', 'source-1', 0, 'coupler-1'), link('link-2', 'coupler-1', 2, 'detector-1'), link('link-3', 'coupler-1', 3, 'detector-2')];
  doc.layout.components = {
    'source-1': { x: 160, y: 230, rotation: 0 }, 'coupler-1': { x: 440, y: 230, rotation: 0 },
    'detector-1': { x: 760, y: 150, rotation: 0 }, 'detector-2': { x: 760, y: 320, rotation: 0 },
  };
  doc.layout.connections = Object.fromEntries(doc.circuit.connections.map(line => [line.id, { bend: 0 }]));
  validateDocument(doc);
  return doc;
}

/** Same 80/100 µm schematic arms for a controlled comparison of the coupler models. */
export function createIdealMziExperiment(): CircuitDocument {
  const doc = createMziExample();
  doc.title = 'Ideal MZI · 20 µm path difference';
  doc.circuit.connections.find(line => line.id === 'link-4')!.lengthM = 100e-6;
  validateDocument(doc);
  return doc;
}

export function createDatasetMziExperiment(): CircuitDocument {
  const doc = createIdealMziExperiment();
  doc.title = 'SiEPIC MZI · 20 µm path difference';
  for (const component of doc.circuit.components) if (component.model === 'coupler') {
    component.model = 'siepic-coupler'; component.params = {};
    component.label = component.id === 'coupler-1' ? 'SiEPIC input coupler' : 'SiEPIC output coupler';
  }
  validateDocument(doc);
  return doc;
}
