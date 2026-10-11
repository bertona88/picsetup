import { describe, expect, it } from 'vitest';
import { compileRecipe, type CircuitRecipe } from '../src/api/recipe';
import { getAuthoringRecipe, getAuthoringStatus, semanticCircuitKey } from '../src/api/authoring';
import { queryCatalog } from '../src/api/catalog';
import { exampleRecipes } from '../src/api/examples';
import { instantiateBlock, type BlockId } from '../src/blocks';
import { blankDocument, parseDocument, serializeDocument, validateDocument } from '../src/io/document';
import type { CircuitDocument } from '../src/model/types';
import { solveCircuit } from '../src/solver/solve';

const mziRecipe = (): CircuitRecipe => structuredClone(exampleRecipes.find(example => example.id === 'ideal-mzi')!.recipe);
const stripRecipe = (): CircuitRecipe => ({
  schema: 'picsetup-recipe/1', title: 'Pinned strip propagation', wavelengthM: 1550e-9,
  parts: [{ id: 'laser', model: 'source', params: { powerW: .001 } }, { id: 'out', model: 'detector' }],
  links: [{ id: 'guide', from: 'laser.out', to: 'out.in', lengthM: 100e-6, lossDbPerM: 1000, waveguide: { model: 'siepic-strip-500x220-te', version: '1' } }],
});

describe('retained recipe provenance', () => {
  it('retains the authored recipe independently and labels an ordinary manual scene as having no recipe', () => {
    const recipe = mziRecipe(), original = JSON.stringify(recipe);
    const document = compileRecipe(recipe);
    expect(getAuthoringStatus(document)).toBe('current');
    expect(getAuthoringRecipe(document)).toBe(original);
    recipe.parts[1].params!.phaseRad = 1.2;
    recipe.title = 'Changed elsewhere';
    expect(getAuthoringRecipe(document)).toBe(original);
    expect(getAuthoringStatus(document)).toBe('current');
    expect(getAuthoringStatus(blankDocument())).toBe('none');
    expect(getAuthoringRecipe(blankDocument())).toBeNull();
  });

  it('keeps provenance current after drawing, naming, storage ordering and reciprocal endpoint edits', () => {
    const document = compileRecipe(mziRecipe());
    const before = solveCircuit(document.circuit);
    document.title = 'A human readable title';
    for (const component of document.circuit.components) {
      component.label = `Renamed ${component.id}`;
      component.params = Object.fromEntries(Object.entries(component.params).reverse());
      document.layout.components[component.id] = { x: 10, y: 70, rotation: 90 };
    }
    for (const connection of document.circuit.connections) {
      [connection.from, connection.to] = [connection.to, connection.from];
      document.layout.connections[connection.id].bend = 123;
    }
    document.circuit.components.reverse(); document.circuit.connections.reverse();
    document.layout.viewport = { x: -400, y: 40, zoom: .3 };
    validateDocument(document);
    expect(getAuthoringStatus(document)).toBe('current');
    const after = solveCircuit(document.circuit);
    for (const detector of ['upper', 'lower']) expect(after.detectors[detector].powerW).toBeCloseTo(before.detectors[detector].powerW, 14);
  });

  it.each<[string, (document: CircuitDocument) => void]>([
    ['wavelength', document => { document.circuit.wavelengthM = 1540e-9; }],
    ['source power', document => { document.circuit.components.find(component => component.model === 'source')!.params.powerW = .002; }],
    ['phase', document => { document.circuit.components.find(component => component.model === 'phase')!.params.phaseRad = .4; }],
    ['coupler model', document => { const coupler = document.circuit.components.find(component => component.model === 'coupler')!; coupler.model = 'siepic-coupler'; coupler.params = {}; }],
    ['guide length', document => { document.circuit.connections[0].lengthM += 1e-6; }],
    ['guide index', document => { document.circuit.connections[0].neff = 2.5; }],
    ['guide loss', document => { document.circuit.connections[0].lossDbPerM = 15; }],
    ['connectivity', document => { const removed = document.circuit.connections.pop()!; delete document.layout.connections[removed.id]; }],
  ])('marks changed %s as stale while preserving the original recipe', (_, edit) => {
    const document = compileRecipe(mziRecipe()), original = getAuthoringRecipe(document);
    edit(document); validateDocument(document);
    expect(getAuthoringStatus(document)).toBe('stale');
    expect(getAuthoringRecipe(document)).toBe(original);
  });

  it('recompiles retained data instead of accepting a forged stored semantic identity', () => {
    const document = compileRecipe(mziRecipe());
    const other = mziRecipe(); other.parts[1].params!.phaseRad = .8;
    document.authoring!.recipeJson = JSON.stringify(other);
    document.authoring!.semanticKey = semanticCircuitKey(document.circuit);
    const reopened = parseDocument(serializeDocument(document));
    expect(getAuthoringStatus(reopened)).toBe('stale');

    // Structurally retained JSON may lack a compilable recipe; it is data, not authority.
    reopened.authoring!.recipeJson = JSON.stringify({ schema: 'picsetup-recipe/1', title: 'Incomplete' });
    expect(getAuthoringStatus(parseDocument(serializeDocument(reopened)))).toBe('stale');
    reopened.authoring!.recipeJson = '{not JSON';
    expect(getAuthoringStatus(reopened)).toBe('stale');
    expect(() => parseDocument(JSON.stringify(reopened))).toThrow(/JSON/);
  });

  it('preserves the exact original recipe after save/reopen even when canvas physics has diverged', () => {
    const document = compileRecipe(mziRecipe()), original = getAuthoringRecipe(document);
    document.circuit.components.find(component => component.model === 'phase')!.params.phaseRad = 1.2;
    const reopened = parseDocument(serializeDocument(document));
    expect(getAuthoringRecipe(reopened)).toBe(original);
    expect(getAuthoringStatus(reopened)).toBe('stale');
    const rebuilt = compileRecipe(JSON.parse(getAuthoringRecipe(reopened)!));
    expect(rebuilt.circuit.components.find(component => component.model === 'phase')!.params.phaseRad).toBe(0);
    expect(reopened.circuit.components.find(component => component.model === 'phase')!.params.phaseRad).toBe(1.2);
  });
});

describe('selected waveguide authoring boundaries', () => {
  it('uses the locked source reference index and explicit loss for a selected recipe guide', () => {
    const document = compileRecipe(stripRecipe()), guide = document.circuit.connections[0];
    expect(guide.neff).toBe(2.44553);
    expect(guide.waveguide).toEqual({ model: 'siepic-strip-500x220-te', version: '1' });
    const result = solveCircuit(document.circuit);
    expect(result.ok).toBe(true);
    expect(result.detectors.out.powerW).toBeCloseTo(.001 * 10 ** (-.1 / 10), 14);
    expect(getAuthoringStatus(document)).toBe('current');
    const explicit = stripRecipe(); explicit.links[0].neff = 2.44553;
    expect(compileRecipe(explicit).circuit).toEqual(document.circuit);
    const constant = structuredClone(document); delete constant.circuit.connections[0].waveguide;
    expect(getAuthoringStatus(constant)).toBe('stale');
  });

  it('rejects mismatched guide index and unknown identity/version at recipe and document boundaries', () => {
    const mismatch = stripRecipe(); mismatch.links[0].neff = 2.4;
    expect(() => compileRecipe(mismatch)).toThrow(/reference effective index/);
    for (const waveguide of [{ model: 'siepic-strip-500x220-te', version: '2' }, { model: 'unbundled-strip', version: '1' }]) {
      const invalidRecipe = stripRecipe();
      Object.assign(invalidRecipe.links[0], { waveguide });
      expect(() => compileRecipe(invalidRecipe)).toThrow(/unsupported waveguide/);
      const invalidDocument = compileRecipe(stripRecipe());
      Object.assign(invalidDocument.circuit.connections[0], { waveguide });
      expect(() => parseDocument(JSON.stringify(invalidDocument))).toThrow(/unsupported waveguide/);
    }
    const invalidDocument = compileRecipe(stripRecipe()); invalidDocument.circuit.connections[0].neff = 2.4;
    expect(() => parseDocument(JSON.stringify(invalidDocument))).toThrow(/reference effective index/);
  });

  it('keeps outside-window scenes portable and editable, while solve remains unavailable until repaired', () => {
    const recipe = stripRecipe(); recipe.wavelengthM = 1450e-9;
    const document = parseDocument(serializeDocument(compileRecipe(recipe)));
    expect(document.circuit.wavelengthM).toBe(1450e-9);
    expect(getAuthoringStatus(document)).toBe('current');
    const unavailable = solveCircuit(document.circuit);
    expect(unavailable.ok).toBe(false);
    expect(unavailable.detectors).toEqual({});
    expect(unavailable.diagnostics.some(item => item.code === 'WAVEGUIDE_OUT_OF_BAND')).toBe(true);
    document.circuit.wavelengthM = 1550e-9;
    validateDocument(document);
    expect(solveCircuit(document.circuit).ok).toBe(true);
    expect(getAuthoringStatus(document)).toBe('stale');
  });

  it.each<BlockId>(['mzi', 'ring', 'splitter-tree', 'delay-line'])('expands %s guides with the selected pinned source and rejects a conflicting index', kind => {
    const fragment = instantiateBlock(kind, { guideModel: 'siepic-strip-500x220-te' });
    expect(fragment.connections.length).toBeGreaterThan(0);
    for (const guide of fragment.connections) {
      expect(guide.neff).toBe(2.44553);
      expect(guide.waveguide).toEqual({ model: 'siepic-strip-500x220-te', version: '1' });
    }
    expect(() => instantiateBlock(kind, { guideModel: 'siepic-strip-500x220-te', neff: 2.4 })).toThrow(/reference index/);
    const document = compileRecipe({ schema: 'picsetup-recipe/1', title: `Dispersive ${kind}`, wavelengthM: 1550e-9, parts: [{ id: 'block', block: kind, params: { guideModel: 'siepic-strip-500x220-te' } }], links: [] });
    expect(document.circuit.connections.every(guide => guide.neff === 2.44553 && guide.waveguide?.version === '1')).toBe(true);
    expect(getAuthoringStatus(document)).toBe('current');
  });

  it('advertises a strictly positive constant index and accepts exactly that boundary', () => {
    const entries = queryCatalog({ kind: 'block' });
    expect(entries).toHaveLength(4);
    for (const entry of entries) {
      if (entry.kind !== 'block') throw new Error('Expected block catalog entries.');
      expect(entry.parameters.neff.exclusiveMin).toBe(0);
      expect(entry.parameters.neff.min).toBeUndefined();
      expect(() => instantiateBlock(entry.id, { neff: 0 })).toThrow();
      expect(() => instantiateBlock(entry.id, { neff: -1 })).toThrow();
      expect(instantiateBlock(entry.id, { neff: 1e-6 }).connections.every(guide => guide.neff === 1e-6)).toBe(true);
    }
    const recipe = stripRecipe(); delete recipe.links[0].waveguide; recipe.links[0].neff = 0;
    expect(() => compileRecipe(recipe)).toThrow(/positive/);
    recipe.links[0].neff = 1e-6;
    expect(compileRecipe(recipe).circuit.connections[0].neff).toBe(1e-6);
  });
});
