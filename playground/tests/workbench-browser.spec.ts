import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function downloadText(page: Page, testId: string): Promise<string> {
  const pending = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const stream = await (await pending).createReadStream();
  if (!stream) throw new Error('Export did not provide a readable download');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function captureDialog(page: Page, testInfo: TestInfo, selector: string, controls: string[], filename: string, description: string) {
  const dialog = page.locator(selector), bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('Dialog or viewport is unavailable for visual verification');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  for (const id of controls) {
    await expect(page.getByTestId(id)).toBeVisible();
    const box = await page.getByTestId(id).boundingBox();
    if (!box) throw new Error(`Dialog control ${id} has no visible bounds`);
    expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  }
  const evidence = path.resolve('evidence');
  await mkdir(evidence, { recursive: true });
  const screenshot = path.join(evidence, filename);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(description, { path: screenshot, contentType: 'image/png' });
}

function csvTable(text: string): { header: string[]; rows: string[][] } {
  const records = text.trim().split(/\r?\n/).filter(line => !line.startsWith('#')).map(line => {
    const cells: string[] = []; let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
      else cell += char;
    }
    if (quoted) throw new Error('Unterminated CSV field');
    cells.push(cell); return cells;
  });
  return { header: records[0], rows: records.slice(1) };
}

const experiment = {
  schema: 'picsetup-recipe/1', title: 'Three tunings · open SiEPIC MZI', wavelengthM: 1550e-9,
  parts: [
    { id: 'laser', model: 'source', params: { powerW: .001, phaseRad: 0 } },
    { id: 'mzi', block: 'mzi', params: { couplerModel: 'siepic-coupler', deltaLengthM: 20e-6, phaseRad: 0 } },
    { id: 'through', model: 'detector' }, { id: 'cross', model: 'detector' },
  ],
  links: [
    { from: 'laser.out', to: 'mzi.in0' },
    { from: 'mzi.out0', to: 'through.in' },
    { from: 'mzi.out1', to: 'cross.in' },
  ],
};

test('sketch a data-backed MZI, fork three tunings and reopen their comparison notebook', async ({ page, browser }, testInfo) => {
  const runtimeErrors: string[] = [], remoteRequests: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) remoteRequests.push(request.url());
  });
  await page.goto('/');

  // A reusable block expands into ordinary, editable primitives without adding a laser.
  const sourcesBefore = await page.locator('[data-component-id][data-model="source"]').count();
  await page.getByTestId('open-sketch').click();
  await page.getByTestId('sketch-blocks-tab').click();
  await page.getByTestId('sketch-insert-mzi').click();
  await expect(page.locator('[data-component-id][data-model="source"]')).toHaveCount(sourcesBefore);
  const insertedPhase = page.locator('[data-component-id][data-model="phase"]').last();
  await expect(insertedPhase).toBeVisible();
  await insertedPhase.click();
  await page.getByTestId('param-phaseRad').fill('.37');
  await page.getByTestId('param-phaseRad').press('Tab');
  const withBlock = JSON.parse(await downloadText(page, 'export-json'));
  expect(withBlock.circuit.components.some((component: { model: string; params: { phaseRad?: number } }) => component.model === 'phase' && component.params.phaseRad === .37)).toBe(true);

  // A recipe is data, not executable code; applying it atomically replaces the sketch.
  await page.getByTestId('open-sketch').click();
  await page.getByTestId('sketch-recipes-tab').click();
  await page.getByTestId('sketch-recipe').fill(JSON.stringify(experiment, null, 2));
  await page.getByTestId('sketch-recipe').evaluate(element => { element.scrollTop = 0; });
  await captureDialog(page, testInfo, '.sketch-window', ['sketch-recipe', 'sketch-apply'], 'sketch-chromium.png', 'SiEPIC MZI recipe ready to build');
  await page.getByTestId('sketch-apply').click();
  await expect(page.locator('[data-component-id][data-model="siepic-coupler"]')).toHaveCount(2);
  await expect(page.locator('[data-component-id]')).toHaveCount(6);
  const compiled = JSON.parse(await downloadText(page, 'export-json'));
  expect(compiled.title).toBe(experiment.title);
  const phaseId = compiled.circuit.components.find((component: { model: string }) => component.model === 'phase').id;
  expect(compiled.circuit.components.filter((component: { model: string }) => component.model === 'source')).toHaveLength(1);

  // Arrangement is allowed to change only the drawing, never physical link lengths.
  await page.getByTestId('auto-arrange').click();
  expect(JSON.parse(await downloadText(page, 'export-json')).circuit).toEqual(compiled.circuit);

  const snapshots: unknown[] = [];
  for (const [index, phase] of [0, Math.PI / 2, Math.PI].entries()) {
    if (index > 0) await page.getByTestId('compare-close').click();
    await page.getByTestId(`node-${phaseId}`).click();
    await page.getByTestId('param-phaseRad').fill(String(phase));
    await page.getByTestId('param-phaseRad').press('Tab');
    snapshots.push(JSON.parse(await downloadText(page, 'export-json')));
    await page.getByTestId('open-compare').click();
    await page.getByTestId('compare-capture').click();
    await expect(page.getByTestId('compare-variant')).toHaveCount(index + 1);
    await page.getByTestId('compare-name').last().fill(['Phase 0 rad', 'Phase π/2 rad', 'Phase π rad'][index]);
    await page.getByTestId('compare-name').last().press('Tab');
  }
  await page.getByTestId('compare-start-nm').fill('1500');
  await page.getByTestId('compare-stop-nm').fill('1600');
  await page.getByTestId('compare-points').fill('101');
  await page.getByTestId('compare-run').click();
  const plot = page.getByTestId('compare-plot');
  await expect(plot).toHaveAttribute('data-status', 'complete');
  const curves = plot.locator('path[data-variant-id]');
  await expect(curves).toHaveCount(3);
  const paths = await curves.evaluateAll(elements => elements.map(element => element.getAttribute('d')));
  expect(paths.every(value => value !== null && value.length > 20)).toBe(true);
  expect(new Set(paths).size).toBe(3);

  const csv = await downloadText(page, 'compare-export-csv');
  expect(csv).toContain('# schema: picsetup-comparison/1');
  expect(csv).toContain('siepic-coupler');
  expect(csv).toContain('945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371');
  const table = csvTable(csv);
  expect(table.rows).toHaveLength(3 * 2 * 101);
  const column = (name: string) => { const index = table.header.indexOf(name); expect(index).toBeGreaterThanOrEqual(0); return index; };
  const variantColumn = column('variant_id'), detectorColumn = column('detector_id'), powerColumn = column('power_W');
  const wavelengthColumn = column('wavelength_m'), okColumn = column('ok');
  expect(table.rows.every(row => row[okColumn] === 'true' && row[powerColumn] !== '' && Number.isFinite(Number(row[powerColumn])))).toBe(true);
  const ids = [...new Set(table.rows.map(row => row[variantColumn]))];
  expect(ids).toHaveLength(3);
  const powers = ids.map(id => table.rows.filter(row => row[variantColumn] === id && row[detectorColumn] === 'through').map(row => Number(row[powerColumn])));
  for (const id of ids) {
    const rows = table.rows.filter(row => row[variantColumn] === id && row[detectorColumn] === 'through');
    expect(rows).toHaveLength(101);
    expect(Number(rows[0][wavelengthColumn])).toBeCloseTo(1500e-9, 15);
    expect(Number(rows[100][wavelengthColumn])).toBeCloseTo(1600e-9, 15);
  }
  expect(Math.max(...powers[0]) - Math.min(...powers[0])).toBeGreaterThan(1e-5);
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) expect(Math.max(...powers[a].map((power, i) => Math.abs(power - powers[b][i])))).toBeGreaterThan(1e-5);
  const notebookText = await downloadText(page, 'compare-export-json');
  const notebook = JSON.parse(notebookText);
  expect(notebook.variants).toHaveLength(3);
  expect(notebook.variants.map((variant: { document: unknown }) => variant.document)).toEqual(snapshots);
  await page.getByTestId('compare-close').click();
  await page.getByTestId('blank-circuit').click();
  await page.getByTestId('open-compare').click();
  await page.getByTestId('compare-variant').last().locator('[data-action="remove"]').click();
  await expect(page.getByTestId('compare-variant')).toHaveCount(2);
  await page.getByTestId('compare-import-json').setInputFiles({ name: 'three-tunings.json', mimeType: 'application/json', buffer: Buffer.from(notebookText) });
  await expect(page.getByTestId('compare-variant')).toHaveCount(3);
  expect(JSON.parse(await downloadText(page, 'compare-export-json'))).toEqual(notebook);
  await page.reload();
  await page.getByTestId('open-compare').click();
  await expect(page.getByTestId('compare-variant')).toHaveCount(3);
  expect(JSON.parse(await downloadText(page, 'compare-export-json'))).toEqual(notebook);
  // Curves are recomputed from the saved models and parameters after reopening.
  await page.getByTestId('compare-run').click();
  await expect(plot).toHaveAttribute('data-status', 'complete');
  expect(csvTable(await downloadText(page, 'compare-export-csv'))).toEqual(table);

  // A stored snapshot loads the exact experiment, then can be edited independently.
  await page.getByTestId('compare-variant').first().locator('[data-action="load"]').click();
  if (await page.getByTestId('compare-panel').getAttribute('data-open') === 'true') await page.getByTestId('compare-close').click();
  expect(JSON.parse(await downloadText(page, 'export-json'))).toEqual(snapshots[0]);
  // The drawer may close on load; capture controls retain the notebook either way.
  if (!(await plot.isVisible())) await page.getByTestId('open-compare').click();
  await expect(plot).toBeVisible();
  await expect(page.getByTestId('toast')).toBeHidden();
  const panelBox = await page.getByTestId('compare-panel').locator('.comparison-window').boundingBox();
  const plotBox = await plot.boundingBox();
  if (!panelBox || !plotBox) throw new Error('Comparison panel or curves are hidden');
  expect(panelBox.y).toBeGreaterThanOrEqual(0);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(1001);
  expect(plotBox.y + plotBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
  for (const testId of ['compare-status', 'compare-legend', 'compare-export-csv']) {
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) throw new Error(`Comparison content ${testId} is hidden`);
    expect(box.y + box.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
  }
  for (const text of ['0', '1600 nm']) {
    const label = plot.locator('.comparison-axis').filter({ hasText: new RegExp(`^${text}$`) });
    await expect(label).toHaveCount(1);
    const box = await label.boundingBox();
    if (!box) throw new Error('Comparison boundary-axis label is hidden');
    expect(box.y + box.height).toBeLessThanOrEqual(plotBox.y + plotBox.height + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const evidence = path.resolve('evidence');
  await mkdir(evidence, { recursive: true });
  const screenshot = path.join(evidence, 'workbench-chromium.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Recipe-built SiEPIC MZI and three saved tunings', { path: screenshot, contentType: 'image/png' });
  await writeFile(path.join(evidence, 'workbench-browser-run.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null,
    workflowRun: process.env.GITHUB_RUN_ID ?? null, browserVersion: browser.version(),
    viewport: page.viewportSize(), variantCount: 3, sampleCount: 101,
    exportedNumericRows: table.rows.length,
    throughPowerRangesW: powers.map(values => [Math.min(...values), Math.max(...values)]),
    runtimeErrors, remoteRequests,
    journey: ['editable source-free block', 'recipe compilation', 'arrangement physics invariant', 'immutable A/B/C captures', 'worker spectrum overlay', 'CSV export', 'notebook reopen', 'notebook autosave reload', 'exact snapshot restore'],
  }, null, 2) + '\n');
  expect(runtimeErrors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});

test('a bounded design goal applies a real phase solution and remains undoable', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('/');
  const recipe = structuredClone(experiment);
  recipe.title = 'Find a dark output';
  const mzi = recipe.parts.find(part => part.block === 'mzi')!;
  mzi.params = { couplerModel: 'coupler', deltaLengthM: 0, phaseRad: Math.PI / 2 };
  // Exercise the supported browser API that an assistant can use to sketch an idea.
  await page.evaluate(input => {
    const bridge = (window as unknown as { picsetup: { loadRecipe(input: unknown): unknown } }).picsetup;
    bridge.loadRecipe(input);
  }, recipe);
  const before = JSON.parse(await downloadText(page, 'export-json'));
  const phaseId = before.circuit.components.find((component: { model: string }) => component.model === 'phase').id;
  const power = async () => Number(await page.getByTestId('detector-through').getAttribute('data-power-w'));
  await expect.poll(power).toBeCloseTo(.0005, 12);
  await page.getByTestId(`node-${phaseId}`).click();
  await page.getByTestId('open-goal').click();
  await page.getByTestId('goal-detector').selectOption('through');
  await page.getByTestId('goal-objective').selectOption('minimize');
  await page.getByTestId('goal-min').fill('0');
  await page.getByTestId('goal-max').fill(String(Math.PI));
  await page.getByTestId('goal-points').fill('21');
  await page.getByTestId('goal-wavelength').fill('1550');
  await page.getByTestId('goal-run').click();
  await expect(page.getByTestId('goal-status')).toHaveAttribute('data-state', 'complete');
  await expect(page.getByTestId('goal-boundary')).toBeVisible();
  await captureDialog(page, testInfo, '.goal-window', ['goal-chart', 'goal-status', 'goal-current-power', 'goal-best-power', 'goal-apply'], 'goal-chromium.png', 'Completed bounded phase search before applying the best setting');
  await page.getByTestId('goal-apply').click();
  if (await page.getByTestId('goal-close').isVisible()) await page.getByTestId('goal-close').click();
  // A hidden/unavailable detector must not masquerade as a successful zero.
  await expect(page.getByTestId('detector-through')).not.toHaveAttribute('data-power-w', '');
  await expect.poll(power).toBeLessThan(1e-14);
  const applied = JSON.parse(await downloadText(page, 'export-json'));
  const expected = structuredClone(before);
  expected.circuit.components.find((component: { id: string }) => component.id === phaseId).params.phaseRad = 0;
  expected.circuit.wavelengthM = 1550 * 1e-9;
  expect(applied.circuit).toEqual(expected.circuit);
  expect(applied.layout).toEqual(before.layout);
  await page.getByTestId('undo').click();
  await expect.poll(power).toBeCloseTo(.0005, 12);
  expect(JSON.parse(await downloadText(page, 'export-json')).circuit).toEqual(before.circuit);
  expect(runtimeErrors).toEqual([]);
});
