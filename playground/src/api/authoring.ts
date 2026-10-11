import type { Circuit, CircuitDocument } from '../model/types';
import { compileRecipe } from './recipe';

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
 ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;

/** Physical identity only: reciprocal endpoint orientation and drawing/labels do not matter. */
export function semanticCircuitKey(circuit: Circuit): string {
 const components = circuit.components.map(({ id, model, version, params }) => ({ id, model, version, params })).sort((a, b) => a.id.localeCompare(b.id));
 const connections = circuit.connections.map(({ id, from, to, ...physical }) => ({ id, endpoints: [from, to].sort((a, b) => a.component.localeCompare(b.component) || a.port - b.port), ...physical })).sort((a, b) => a.id.localeCompare(b.id));
 return JSON.stringify(stable({ wavelengthM: circuit.wavelengthM, components, connections }));
}

/** Recompile retained data before calling it current; imported authoring text is never trusted code. */
export function getAuthoringStatus(document: CircuitDocument): 'current' | 'stale' | 'none' {
 if (!document.authoring) return 'none';
 try {
  const compiled = compileRecipe(JSON.parse(document.authoring.recipeJson), { recordAuthoring: false });
  const sourceKey = semanticCircuitKey(compiled.circuit);
  return sourceKey === document.authoring.semanticKey && sourceKey === semanticCircuitKey(document.circuit) ? 'current' : 'stale';
 } catch { return 'stale'; }
}
export function getAuthoringRecipe(document: CircuitDocument): string | null { return document.authoring?.recipeJson ?? null; }
