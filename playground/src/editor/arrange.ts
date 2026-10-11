import { validateDocument } from '../io/document';
import type { CircuitDocument, Component, Endpoint } from '../model/types';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function side(component: Component, port: number): 'in' | 'out' {
  if (component.model === 'source') return 'out';
  if (component.model === 'detector' || component.model === 'termination') return 'in';
  if (component.model === 'coupler' || component.model === 'siepic-coupler') return port < 2 ? 'in' : 'out';
  return port === 0 ? 'in' : 'out';
}

/** Deterministic graph sketching. Positions never infer or overwrite physical lengths. */
export function arrangeDocument(document: CircuitDocument): CircuitDocument {
  validateDocument(document);
  const result = structuredClone(document);
  const components = new Map(result.circuit.components.map(component => [component.id, component]));
  const ids = [...components.keys()].sort(compare);
  const successors = new Map(ids.map(id => [id, new Set<string>()]));
  const predecessors = new Map(ids.map(id => [id, new Set<string>()]));
  const directions = new Map<string, [string, string]>();
  for (const link of result.circuit.connections) {
    let from: Endpoint = link.from, to: Endpoint = link.to;
    const a = side(components.get(from.component)!, from.port), b = side(components.get(to.component)!, to.port);
    if (a === 'in' && b === 'out' || a === b && compare(from.component, to.component) > 0) [from, to] = [to, from];
    directions.set(link.id, [from.component, to.component]);
    if (from.component !== to.component) {
      successors.get(from.component)!.add(to.component);
      predecessors.get(to.component)!.add(from.component);
    }
  }

  // Condense feedback cycles before assigning columns; loops never cause recursion
  // through an assumed acyclic optical topology. Tarjan depth is capped by document limits.
  let nextIndex = 0;
  const index = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], onStack = new Set<string>(), groups: string[][] = [];
  const visit = (id: string) => {
    index.set(id, nextIndex); low.set(id, nextIndex++); stack.push(id); onStack.add(id);
    for (const target of [...successors.get(id)!].sort(compare)) {
      if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); }
      else if (onStack.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) === index.get(id)) {
      const group: string[] = [];
      let member: string;
      do { member = stack.pop()!; onStack.delete(member); group.push(member); } while (member !== id);
      groups.push(group.sort(compare));
    }
  };
  ids.forEach(id => { if (!index.has(id)) visit(id); });
  const groupOf = new Map<string, number>();
  groups.forEach((group, i) => group.forEach(id => groupOf.set(id, i)));
  const incoming = groups.map(() => new Set<number>());
  for (const [from, targets] of successors) for (const to of targets) {
    const a = groupOf.get(from)!, b = groupOf.get(to)!;
    if (a !== b) incoming[b].add(a);
  }
  const rank = new Map<number, number>();
  const groupRank = (group: number): number => {
    if (!rank.has(group)) rank.set(group, Math.max(0, ...[...incoming[group]].map(parent => groupRank(parent) + 1)));
    return rank.get(group)!;
  };
  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const column = groupRank(groupOf.get(id)!);
    layers.set(column, [...layers.get(column) ?? [], id]);
  }
  const rows = new Map<string, number>();
  const maxRows = Math.max(1, ...[...layers.values()].map(layer => layer.length));
  for (const [column, layer] of [...layers].sort((a, b) => a[0] - b[0])) {
    const center = (id: string) => {
      const known = [...predecessors.get(id)!].filter(parent => rows.has(parent));
      return known.length ? known.reduce((sum, parent) => sum + rows.get(parent)!, 0) / known.length : maxRows / 2;
    };
    layer.sort((a, b) => center(a) - center(b) || compare(a, b));
    layer.forEach((id, i) => {
      const row = i + (maxRows - layer.length) / 2;
      rows.set(id, row);
      result.layout.components[id] = { x: 150 + column * 230, y: 150 + row * 160, rotation: 0 };
    });
  }
  // A single two-port arm between split and recombination gets room above its bypass.
  for (const id of ids) {
    const component = components.get(id)!;
    if (component.model !== 'phase' && component.model !== 'attenuator') continue;
    const before = [...predecessors.get(id)!], after = [...successors.get(id)!];
    const column = groupRank(groupOf.get(id)!);
    if (layers.get(column)!.length === 1 && before.length === 1 && after.length === 1 && successors.get(before[0])!.size > 1 && predecessors.get(after[0])!.size > 1) result.layout.components[id].y -= 90;
  }
  for (const link of result.circuit.connections) {
    const [from, to] = directions.get(link.id)!;
    const difference = groupRank(groupOf.get(to)!) - groupRank(groupOf.get(from)!);
    const sameGroup = groupOf.get(from) === groupOf.get(to);
    result.layout.connections[link.id] = { bend: sameGroup ? 180 : difference > 1 ? 120 + 25 * difference : 0 };
  }
  result.layout.viewport = { x: 0, y: 0, zoom: 1 };
  validateDocument(result);
  return result;
}
