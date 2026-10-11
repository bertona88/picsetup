import { describe, expect, it } from 'vitest';
import { compileRecipe, parseRecipe, queryCatalog, executeCommand, exampleRecipes, starterRecipe, serializeDocument, solveCircuit, createNotebook, setSweep } from '../src/api';
import { MAX_DOCUMENT_BYTES } from '../src/io/document';
import type { CircuitRecipe } from '../src/api';

function direct(): CircuitRecipe {
  return { schema: 'picsetup-recipe/1', title: 'Named-port direct test', wavelengthM: 1550e-9,
    parts: [{ id: 'laser', model: 'source', params: { powerW: 0.002 } }, { id: 'out', model: 'detector' }],
    links: [{ from: 'laser.out', to: 'out.in', lengthM: 20e-6, lossDbPerM: 1500 }],
  };
}

describe('headless circuit recipes', () => {
  it('uses declared SI values, explicit version/defaults, stable named-port endpoints and independent layout', () => {
    const input = direct(); const unchanged = structuredClone(input);
    const document = compileRecipe(input);
    expect(input).toEqual(unchanged);
    expect(document.circuit.components[0]).toMatchObject({ id: 'laser', model: 'source', version: '1', params: { powerW: 0.002, phaseRad: 0 } });
    expect(document.circuit.connections[0]).toEqual({ id: 'link_1', from: { component: 'laser', port: 0 }, to: { component: 'out', port: 0 }, lengthM: 20e-6, lossDbPerM: 1500, neff: 2.4 });
    const result = solveCircuit(document.circuit);
    expect(result.ok).toBe(true);
    expect(result.detectors.out.powerW).toBeCloseTo(0.002 * 10 ** (-1500 * 20e-6 / 10), 14);
    expect(document.layout.components.laser.x).not.toBe(document.layout.components.out.x);
    expect(parseRecipe(JSON.stringify(input))).toEqual(document);
    expect(serializeDocument(document)).toContain('picsetup-playground/1');
  });
  it('compiles and solves all runnable examples, preserving pinned imported models', () => {
    for (const example of exampleRecipes) {
      const document = compileRecipe(example.recipe);
      const result = solveCircuit(document.circuit);
      expect(result.ok, example.id).toBe(true);
      expect(Math.abs(result.budget.imbalanceW)).toBeLessThan(1e-10);
    }
    const imported = compileRecipe(starterRecipe);
    expect(imported.circuit.components.filter(component => component.model === 'siepic-coupler')).toHaveLength(2);
    for (const component of imported.circuit.components.filter(component => component.model === 'siepic-coupler')) expect(component).toMatchObject({ version: '1', params: {} });
  });
  it('namespaces repeated blocks without collisions and keeps their internal connection lengths', () => {
    const document = compileRecipe({ schema: 'picsetup-recipe/1', title: 'Two delays', wavelengthM: 1550e-9,
      parts: [{ id: 'a', block: 'delay-line', params: { lengthM: 10e-6 } }, { id: 'b', block: 'delay-line', params: { lengthM: 30e-6 } }], links: [] });
    expect(document.circuit.components.some(component => component.id.startsWith('a__'))).toBe(true);
    expect(document.circuit.components.some(component => component.id.startsWith('b__'))).toBe(true);
    expect(document.circuit.connections.filter(connection => connection.id.startsWith('a__')).reduce((sum, connection) => sum + connection.lengthM, 0)).toBeCloseTo(10e-6, 14);
    expect(document.circuit.connections.filter(connection => connection.id.startsWith('b__')).reduce((sum, connection) => sum + connection.lengthM, 0)).toBeCloseTo(30e-6, 14);
  });
  it('keeps structurally valid out-of-band scenes editable and reports failed physics', () => {
    const recipe = structuredClone(starterRecipe); recipe.wavelengthM = 1400e-9;
    const result = solveCircuit(compileRecipe(recipe).circuit);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(item => item.code === 'DATASET_OUT_OF_BAND')).toBe(true);
  });
  it.each([
    ['schema', (recipe: any) => { recipe.schema = 'picsetup-recipe/2'; }],
    ['unknown top-level field', (recipe: any) => { recipe.units = 'nm'; }],
    ['unit string', (recipe: any) => { recipe.wavelengthM = '1550 nm'; }],
    ['NaN', (recipe: any) => { recipe.parts[0].params.powerW = NaN; }],
    ['negative power', (recipe: any) => { recipe.parts[0].params.powerW = -1; }],
    ['unknown part field', (recipe: any) => { recipe.parts[0].position = [0, 0]; }],
    ['ambiguous primitive/block', (recipe: any) => { recipe.parts[0].block = 'mzi'; }],
    ['unknown model', (recipe: any) => { recipe.parts[0].model = 'download-me'; }],
    ['unknown version', (recipe: any) => { recipe.parts[0].version = 'latest'; }],
    ['unknown parameter', (recipe: any) => { recipe.parts[0].params.width = 5; }],
    ['expression', (recipe: any) => { recipe.parts[0].params.powerW = 'Math.random()'; }],
    ['unsafe id', (recipe: any) => { recipe.parts[0].id = 'constructor'; }],
    ['dotted id', (recipe: any) => { recipe.parts[0].id = 'laser.out'; }],
    ['duplicate part', (recipe: any) => { recipe.parts.push(recipe.parts[0]); }],
    ['unknown port', (recipe: any) => { recipe.links[0].from = 'laser.in'; }],
    ['nonphysical loss', (recipe: any) => { recipe.links[0].lossDbPerM = -1; }],
    ['occupied port', (recipe: any) => { recipe.links.push({ ...recipe.links[0] }); }],
    ['unknown link field', (recipe: any) => { recipe.links[0].lengthNm = 1000; }],
    ['connection id collision', (recipe: any) => { recipe.links[0].id = 'laser'; }],
  ])('rejects %s before producing a document', (_, mutate) => {
    const recipe = direct(); mutate(recipe);
    expect(() => compileRecipe(recipe)).toThrow();
  });
  it('rejects unsupported fixed geometry and bounds expanded block counts and JSON bytes', () => {
    const fixed = structuredClone(starterRecipe); fixed.parts = [{ id: 'dc', model: 'siepic-coupler', params: { gap: 200 } }]; fixed.links = [];
    expect(() => compileRecipe(fixed)).toThrow(/not a parameter/);
    const expanded = { ...direct(), parts: Array.from({ length: 100 }, (_, index) => ({ id: `m${index}`, block: 'mzi' })), links: [] };
    expect(() => compileRecipe(expanded)).toThrow(/expanded circuit/);
    expect(() => parseRecipe(' '.repeat(MAX_DOCUMENT_BYTES + 1))).toThrow(/1 MiB/);
    expect(() => parseRecipe('{')).toThrow(/valid JSON/);
    expect(() => parseRecipe('{"schema":"picsetup-recipe/1","title":"unsafe","wavelengthM":0.00000155,"parts":[{"id":"p","model":"phase","params":{"__proto__":1}}],"links":[]}')).toThrow();
  });
});

describe('queryable catalog and JSON commands', () => {
  it('filters the bundled dataset by actual band, mode and searchable title', () => {
    const imported = queryCatalog({ kind: 'model', mode: 'TE mode 1', wavelengthM: 1550e-9 });
    expect(imported.map(item => item.id)).toEqual(['siepic-coupler']);
    expect(imported[0].provenance).toMatchObject({ kind: 'dataset', datasetVersion: '1.0.0' });
    expect(queryCatalog({ mode: 'TE mode 1', wavelengthM: 1400e-9 })).toEqual([]);
    expect(queryCatalog({ mode: 'TE', modelKind: 'dataset' }).map(item => item.id)).toEqual(['siepic-coupler']);
    expect(queryCatalog({ kind: 'block' })).toHaveLength(4);
    expect(queryCatalog({ query: 'directional' }).map(item => item.id)).toEqual(['coupler', 'siepic-coupler']);
    imported[0].ports.push('bad');
    expect(queryCatalog({ mode: 'TE mode 1' })[0].ports).toEqual(['L0', 'L1', 'R0', 'R1']);
    expect(() => queryCatalog({ wavelengthM: NaN })).toThrow();
    expect(() => queryCatalog({ surprising: 1 } as any)).toThrow();
  });
  it('dispatches explicit compile, solve and sweep commands and rejects ambiguous envelopes', async () => {
    const document = await executeCommand({ command: 'compile', recipe: direct() });
    expect(document).toEqual(compileRecipe(direct()));
    const solved = await executeCommand({ command: 'solve', document }) as ReturnType<typeof solveCircuit>;
    expect(solved.ok).toBe(true);
    const sweep = await executeCommand({ command: 'sweep', recipe: direct(), startM: 1500e-9, stopM: 1600e-9, points: 3 }) as any;
    expect(sweep.samples).toHaveLength(3);
    expect(sweep.cancelled).toBe(false);
    expect(sweep.samples.every((sample: any) => sample.ok)).toBe(true);
    expect(await executeCommand({ command: 'catalog', filter: { kind: 'block' } })).toHaveLength(4);
    await expect(executeCommand({ command: 'solve', recipe: direct(), document })).rejects.toThrow(/exactly one/);
    await expect(executeCommand({ command: 'solve', recipe: direct(), source: 'eval me' })).rejects.toThrow(/unsupported/);
    await expect(executeCommand({ command: 'fetch', url: 'https://example.com' })).rejects.toThrow(/Unknown command/);
  });
  it('dispatches reproducible notebook comparisons and bounded goal searches', async () => {
    const document = compileRecipe(exampleRecipes.find(example => example.id === 'ideal-mzi')!.recipe);
    const notebook = setSweep(createNotebook(document), { startM: 1500e-9, stopM: 1600e-9, points: 3 });
    const comparison = await executeCommand({ command: 'compare', notebook }) as any;
    expect(comparison.cancelled).toBe(false);
    expect(comparison.results[0].samples).toHaveLength(3);
    const result = await executeCommand({ command: 'search', request: {
      id: 0, document, wavelengthM: 1550e-9, detectorId: 'upper', objective: 'minimize',
      parameter: { kind: 'component', componentId: 'mzi__phase', name: 'phaseRad' }, min: 0, max: 2 * Math.PI, points: 9,
    } }) as any;
    expect(result.cancelled).toBe(false);
    expect(result.samples).toHaveLength(9);
    expect(result.best.powerW).toBeLessThan(0.001);
    expect(document.circuit.components.find(component => component.id === 'mzi__phase')!.params.phaseRad).toBe(0);
    await expect(executeCommand({ command: 'search', request: { document } })).rejects.toThrow();
  });
});
