import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileRecipe, starterRecipe, solveCircuit, createNotebook, addVariant, setSweep, ringPreset } from '../dist-api/api.mjs';

// Exercise the distributed Node entry point, not the TypeScript implementation
// imported directly by unit tests. Every command is ordinary bounded JSON.
const run = (command, path) => {
  const execution = spawnSync(process.execPath, ['dist-api/cli.mjs', ...(path ? [path] : [])], {
    input: path ? undefined : JSON.stringify(command), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (execution.error) throw execution.error;
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const response = JSON.parse(execution.stdout);
  assert.equal(response.ok, true);
  return response.result;
};
const catalog = run({ command: 'catalog', filter: { modelKind: 'dataset', mode: 'TE', wavelengthM: 1550e-9 } });
assert.equal(catalog.length, 1);
assert.equal(catalog[0].id, 'siepic-coupler');
assert.equal(catalog[0].mode, 'TE mode 1');
const document = compileRecipe(starterRecipe);
assert.deepEqual(run({ command: 'compile', recipe: starterRecipe }), document);
assert.deepEqual(run({ command: 'solve', recipe: starterRecipe }), solveCircuit(document.circuit));
const sweep = run({ command: 'sweep', document, startM: 1500e-9, stopM: 1600e-9, points: 11 });
assert.equal(sweep.samples.length, 11);
assert.equal(sweep.cancelled, false);
assert(sweep.samples.every(sample => sample.ok));
const alternative = structuredClone(document);
alternative.circuit.components.find(component => component.model === 'phase').params.phaseRad = Math.PI / 2;
const notebook = setSweep(addVariant(createNotebook(document), alternative, 'Phase variant'), { startM: 1500e-9, stopM: 1600e-9, points: 11 });
const comparison = run({ command: 'compare', notebook });
assert.equal(comparison.results.length, 2);
assert(comparison.results.every(result => result.samples.length === 11));
const guides = run({ command: 'catalog', filter: { kind: 'waveguide' } });
assert.equal(guides[0].id, 'siepic-strip-500x220-te');
const designStudy = run({ command: 'design-study' });
assert.equal(designStudy.schema, 'picsetup-notebook/2');
designStudy.sweep.points = 11;
const study = run({ command: 'study', notebook: designStudy });
assert.equal(study.curves.length, 9);
assert.deepEqual(study.curves.filter(curve => curve.scenarioId === 'nominal').map(curve => curve.metrics.status), ['sampled-pass', 'sampled-fail', 'sampled-pass']);
const ring = run({ command: 'ring', request: ringPreset });
assert.equal(ring.status, 'resolved');
assert(ring.metrics.linewidthM > 3.18e-12 && ring.metrics.linewidthM < 3.19e-12);
assert.equal(ring.metrics.extinctionReportingThresholdDb, 120);
const temp = mkdtempSync(join(process.cwd(), '.api-smoke-'));
try {
  const file = join(temp, 'command.json');
  writeFileSync(file, JSON.stringify({ command: 'solve', document }));
  assert.deepEqual(run(null, file), solveCircuit(document.circuit));
} finally { rmSync(temp, { recursive: true, force: true }); }
const rejected = spawnSync(process.execPath, ['dist-api/cli.mjs'], { input: '{"command":"unknown"}', encoding: 'utf8' });
assert.equal(rejected.status, 1);
assert.equal(JSON.parse(rejected.stdout).ok, false);
assert(existsSync('dist/THIRD_PARTY_NOTICES.txt'));
assert(existsSync('dist-api/THIRD_PARTY_NOTICES.txt'));
for (const folder of ['dist', 'dist-api']) for (const file of ['LICENSE-SIMPHONY.txt', 'LICENSE-SIEPIC.txt', 'manifest.json', 'source.txt']) assert(existsSync(`${folder}/models/siepic-strip-500x220-te/${file}`));
console.log('Distributed API/CLI passed: catalog, compilation, solve, sweep, comparison, dispersion study, resolved ring, file/stdin input, explicit rejection and bundled notices.');
