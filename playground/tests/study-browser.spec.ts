import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CircuitDocument } from '../src/model/types';
import type { StudyNotebook } from '../src/experiments/notebook';
import type { StudyResult } from '../src/experiments/study';
import type { RingResult } from '../src/experiments/ring';

/** Real worker/UI acceptance for the reviewers' decision-quality reproductions. */
function observe(page: Page) {
  const runtimeErrors: string[] = [], remoteRequests: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) remoteRequests.push(request.url());
  });
  return { runtimeErrors, remoteRequests };
}

async function getDocument(page: Page) {
  return page.evaluate(() => (window as unknown as { picsetup: { getDocument(): CircuitDocument } }).picsetup.getDocument());
}

async function loadRecipe(page: Page, recipe: unknown) {
  await page.evaluate(input => (window as unknown as { picsetup: { loadRecipe(input: unknown): unknown } }).picsetup.loadRecipe(input), recipe);
  return getDocument(page);
}

async function downloadText(page: Page, testId: string) {
  const pending = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const download = await pending, stream = await download.createReadStream();
  if (!stream) throw new Error('Download stream unavailable');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function capture(page: Page, testInfo: TestInfo, selector: string, filename: string, controls: string[]) {
  const bounds = await page.locator(selector).boundingBox(), viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('Dialog or viewport unavailable');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  for (const id of controls) {
    await expect(page.getByTestId(id)).toBeVisible();
    const box = await page.getByTestId(id).boundingBox();
    if (!box) throw new Error(`Missing visible bounds for ${id}`);
    expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const target = path.resolve('evidence', filename);
  await mkdir(path.dirname(target), { recursive: true });
  await page.screenshot({ path: target, fullPage: true });
  await testInfo.attach(filename, { path: target, contentType: 'image/png' });
}

async function evidence(filename: string, data: Record<string, unknown>) {
  await mkdir(path.resolve('evidence'), { recursive: true });
  await writeFile(path.resolve('evidence', filename), JSON.stringify({ capturedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, workflowRun: process.env.GITHUB_RUN_ID ?? null, ...data }, null, 2) + '\n');
}

test('a dispersive design study crosses the agent bridge with mapped decisions, scenarios and exact notebook replay', async ({ page, browser }, testInfo) => {
  const observed = observe(page);
  await page.goto('/');
  await page.getByTestId('open-design-study').click();
  const plot = page.getByTestId('compare-plot');
  await expect(plot).toHaveAttribute('data-status', 'complete');
  await expect(page.getByTestId('compare-variant')).toHaveCount(3);
  const notebook = await page.evaluate(() => (window as unknown as { picsetup: { getNotebook(): StudyNotebook } }).picsetup.getNotebook());
  expect(notebook.schema).toBe('picsetup-notebook/2');
  expect(notebook.study.outputs).toHaveLength(3);
  expect(notebook.study.phaseScenarios).toHaveLength(2);
  expect(notebook.study.targets).toEqual({ maxInsertionLossDb: 1.5, maxCrosstalkDb: -8 });
  expect(notebook.variants.map(variant => variant.document.circuit.connections.some(connection => connection.waveguide?.model === 'siepic-strip-500x220-te'))).toEqual([false, true, true]);
  await expect(page.getByTestId('compare-recipe-status')).toHaveCount(3);
  for (const item of await page.getByTestId('compare-recipe-status').all()) await expect(item).toHaveAttribute('data-status', 'current');

  // The CLI/browser command and the worker-backed view must expose the same study.
  // Independent numerical-oracle tests separately qualify its two-output math.
  const evaluated = await page.evaluate(async input => (window as unknown as { picsetup: { execute(input: unknown): Promise<StudyResult> } }).picsetup.execute({ command: 'study', notebook: input }), notebook);
  expect(evaluated.curves).toHaveLength(9);
  expect(evaluated.cancelled).toBe(false);
  const nominal = evaluated.curves.filter(curve => curve.scenarioId === 'nominal');
  expect(nominal.map(curve => curve.metrics.status)).toEqual(['sampled-pass', 'sampled-fail', 'sampled-pass']);
  expect(nominal[0].metrics.worstInsertionLossDb.value).toBeCloseTo(.606974, 5);
  expect(nominal[1].metrics.worstCrosstalkDb.value).toBeCloseTo(-6.298229, 5);
  expect(nominal[2].metrics.worstCrosstalkDb.value).toBeCloseTo(-12.673313, 5);
  await page.getByTestId('compare-both-outputs').check();
  await page.getByTestId('compare-units').selectOption('db');
  await expect(plot.locator('path[data-variant-id]')).toHaveCount(6);
  await expect(page.getByTestId('study-variant-diff').first()).toContainText('Baseline circuit');
  await expect(page.getByTestId('study-variant-diff').nth(1)).toContainText('waveguide');

  async function assertScenario(id: string) {
    await page.getByTestId('study-scenario').selectOption(id);
    for (const curve of evaluated.curves.filter(curve => curve.scenarioId === id)) {
      const row = page.locator(`[data-testid="study-metric-row"][data-variant-id="${curve.variantId}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('data-status', curve.metrics.status);
      expect(Number(await row.getAttribute('data-il-db'))).toBeCloseTo(curve.metrics.worstInsertionLossDb.value!, 12);
      expect(Number(await row.getAttribute('data-xt-db'))).toBeCloseTo(curve.metrics.worstCrosstalkDb.value!, 12);
      await expect(row.getByTestId('study-il')).toHaveText(`${curve.metrics.worstInsertionLossDb.value!.toFixed(2)} dB`);
      await expect(row.getByTestId('study-xt')).toHaveText(`${curve.metrics.worstCrosstalkDb.value!.toFixed(2)} dB`);
    }
  }
  await assertScenario('nominal');
  for (const scenario of notebook.study.phaseScenarios) await assertScenario(scenario.id);
  // At least one displayed numeric criterion changes under each assumed phase case.
  for (const scenario of notebook.study.phaseScenarios) expect(evaluated.curves.filter(curve => curve.scenarioId === scenario.id).some((curve, index) => Math.abs(curve.metrics.worstCrosstalkDb.value! - nominal[index].metrics.worstCrosstalkDb.value!) > .05)).toBe(true);
  await assertScenario('nominal');
  await page.getByTestId('compare-quality-summary').click();
  await expect(page.getByTestId('compare-diagnostics')).toContainText('SiEPIC');
  await page.getByTestId('compare-quality-summary').click();

  const saved = await downloadText(page, 'compare-export-json');
  expect(JSON.parse(saved)).toEqual(notebook);
  const csv = await downloadText(page, 'compare-export-csv');
  expect(csv).toContain('# schema: picsetup-study-csv/1');
  expect(csv).toContain('siepic-strip-500x220-te');
  expect(csv).toContain('phase-1');
  expect(csv.trim().split(/\r?\n/).filter(line => !line.startsWith('#'))).toHaveLength(1 + 9 * 101);
  const bridgeChecks = await page.evaluate(input => {
    const bridge = (window as unknown as { picsetup: { getNotebook(): StudyNotebook; loadNotebook(input: unknown): StudyNotebook } }).picsetup;
    const returned = bridge.getNotebook();
    returned.variants[0].document.circuit.components.find(component => component.model === 'source')!.params.powerW = .5;
    const cloneIsolated = bridge.getNotebook().variants[0].document.circuit.components.find(component => component.model === 'source')!.params.powerW === .001;
    const invalid = structuredClone(input);
    invalid.study.outputs[0].desiredDetectorId = 'missing-detector';
    let rejected = false;
    try { bridge.loadNotebook(invalid); } catch { rejected = true; }
    return { cloneIsolated, rejected, after: bridge.getNotebook() };
  }, notebook);
  expect(bridgeChecks).toEqual({ cloneIsolated: true, rejected: true, after: notebook });
  await page.evaluate(input => (window as unknown as { picsetup: { loadNotebook(input: string): unknown } }).picsetup.loadNotebook(input), saved);
  await page.reload();
  await page.getByTestId('open-compare').click();
  expect(JSON.parse(await downloadText(page, 'compare-export-json'))).toEqual(notebook);
  await page.getByTestId('compare-run').click();
  await expect(plot).toHaveAttribute('data-status', 'complete');
  const replayedCsv = await downloadText(page, 'compare-export-csv');
  // Worker request IDs are session-local; the saved experiment and every
  // measurement/provenance row must replay exactly across the reload.
  const exportedRequest = (text: string) => JSON.parse(text.split(/\r?\n/).find(line => line.startsWith('# request: '))!.slice('# request: '.length));
  expect(exportedRequest(replayedCsv).notebook).toEqual(notebook);
  expect(replayedCsv.replace(/^# request:.*\r?\n/m, '')).toBe(csv.replace(/^# request:.*\r?\n/m, ''));
  await page.getByTestId('compare-both-outputs').check();
  await page.getByTestId('compare-units').selectOption('db');
  await assertScenario('nominal');
  // All evidence remains reachable at the ordinary viewport; the larger capture
  // makes both the spectrum and the complete decision table readable in one image.
  await page.getByTestId('study-results').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('study-results')).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 1250 });
  await page.locator('.comparison-body').evaluate(element => { element.scrollTop = 0; });
  await capture(page, testInfo, '.comparison-window', 'study-chromium.png', ['compare-plot', 'study-summary', 'study-results', 'compare-export-csv']);
  await evidence('study-browser-run.json', { browserVersion: browser.version(), viewport: page.viewportSize(), variantCount: 3, scenarioCount: 3, sampleCountPerCurve: 101, numericRows: 909, nominal: nominal.map(curve => ({ variant: curve.variantName, status: curve.metrics.status, worstInsertionLossDb: curve.metrics.worstInsertionLossDb, worstCrosstalkDb: curve.metrics.worstCrosstalkDb })), bridge: { cloneIsolated: true, invalidNotebookRejectedAtomically: true, jsonReloadPreserved: true, csvMeasurementsAndProvenanceReplayEqual: true }, ...observed });
  expect(observed.runtimeErrors).toEqual([]);
  expect(observed.remoteRequests).toEqual([]);
});

test('the ring lab withholds budget-limited metrics then resolves the missed notch and loads its measured circuit', async ({ page, browser }, testInfo) => {
  const observed = observe(page);
  await page.goto('/');
  await page.getByTestId('open-ring').click();
  await page.getByTestId('ring-budget').fill('32');
  await page.getByTestId('ring-run').click();
  await expect(page.getByTestId('ring-status')).toHaveAttribute('data-state', 'unresolved');
  await expect(page.getByTestId('ring-status')).toContainText('budget exhausted');
  await expect(page.locator('[data-ring-linewidth]')).toHaveText('—');
  const limited = JSON.parse(await downloadText(page, 'ring-export')) as RingResult & { schema: string };
  expect(limited.schema).toBe('picsetup-ring-measurement/1');
  expect(limited.status).toBe('unresolved');
  expect(limited.metrics).toBeNull();
  expect(limited.evaluations).toBe(32);
  expect(limited.coarse).toHaveLength(32);
  expect(limited.local).toHaveLength(0);

  await page.getByTestId('ring-budget').fill('600');
  await expect(page.getByTestId('ring-status')).toHaveAttribute('data-state', 'stale');
  await expect(page.getByTestId('ring-export')).toBeDisabled();
  await page.getByTestId('ring-run').click();
  await expect(page.getByTestId('ring-status')).toHaveAttribute('data-state', 'resolved');
  const resolved = JSON.parse(await downloadText(page, 'ring-export')) as RingResult & { schema: string };
  expect(resolved.status).toBe('resolved');
  expect(resolved.metrics).not.toBeNull();
  const measured = resolved.metrics!;
  const coarseMinimum = Math.min(...resolved.coarse.map(sample => sample.transmission!));
  const localMinimum = Math.min(...resolved.local.map(sample => sample.transmission!));
  expect(resolved.coarse).toHaveLength(101);
  expect(coarseMinimum).toBeGreaterThan(.99);
  expect(localMinimum).toBeLessThan(1e-12);
  expect(measured.minimumTransmission).toBe(localMinimum);
  expect(Math.abs(measured.resonanceM - 1550.05e-9)).toBeLessThan(.01 * measured.linewidthM);
  expect(measured.linewidthM).toBeGreaterThan(3e-12);
  expect(measured.linewidthM).toBeLessThan(3.3e-12);
  expect(measured.q).toBeGreaterThan(450_000);
  expect(measured.q).toBeLessThan(500_000);
  expect(measured.extinctionDb).toBeNull();
  expect(measured.extinctionReportingThresholdDb).toBe(120);
  expect(resolved.evaluations).toBeLessThanOrEqual(600);
  expect(resolved.convergence.rejectedSamples).toBe(0);
  expect(resolved.convergence.maximumReferenceError).toBeLessThan(1e-6);
  expect(resolved.convergence.linewidthBracketM!).toBeLessThan(.002 * measured.linewidthM);
  await expect(page.getByTestId('ring-coarse-chart').locator('circle')).toHaveCount(resolved.coarse.length);
  await expect(page.getByTestId('ring-local-chart').locator('circle')).toHaveCount(resolved.local.length);
  await expect(page.locator('[data-ring-depth]')).toContainText('finite extinction is unavailable');
  await capture(page, testInfo, '.ring-window', 'resolved-ring-chromium.png', ['ring-coarse-chart', 'ring-local-chart', 'ring-metrics', 'ring-status', 'ring-load']);
  await page.getByTestId('ring-load').click();
  await expect(page.getByTestId('ring-panel')).toBeHidden();
  const loaded = await getDocument(page), expected = structuredClone(resolved.document.circuit);
  expected.wavelengthM = measured.resonanceM;
  expect(loaded.circuit).toEqual(expected);
  await expect(page.getByTestId('detector-through')).not.toHaveAttribute('data-power-w', '');
  await expect.poll(async () => Number(await page.getByTestId('detector-through').getAttribute('data-power-w'))).toBeLessThan(1e-15);
  await evidence('resolved-ring-browser-run.json', { browserVersion: browser.version(), viewport: page.viewportSize(), limited: { evaluations: limited.evaluations, status: limited.status, metrics: limited.metrics }, resolved: { evaluations: resolved.evaluations, coarseMinimum, localMinimum, metrics: measured, convergence: resolved.convergence }, loadedCircuitExact: true, ...observed });
  expect(observed.runtimeErrors).toEqual([]);
  expect(observed.remoteRequests).toEqual([]);
});

test('goal decisions preserve a better baseline and exclude the reviewed numerical artifact', async ({ page, browser }, testInfo) => {
  const observed = observe(page);
  await page.goto('/');
  const baseline = await loadRecipe(page, {
    schema: 'picsetup-recipe/1', title: 'Preserve the better baseline', wavelengthM: 1550e-9,
    parts: [
      { id: 'laser', model: 'source', params: { powerW: .001 } },
      { id: 'mzi', block: 'mzi', params: { couplerModel: 'coupler', deltaLengthM: 0, phaseRad: Math.PI } },
      { id: 'through', model: 'detector' }, { id: 'cross', model: 'detector' },
    ],
    links: [{ from: 'laser.out', to: 'mzi.in0' }, { from: 'mzi.out0', to: 'through.in' }, { from: 'mzi.out1', to: 'cross.in' }],
  });
  const phaseId = baseline.circuit.components.find(component => component.model === 'phase')!.id;
  await expect.poll(async () => Number(await page.getByTestId('detector-through').getAttribute('data-power-w'))).toBeCloseTo(.001, 12);
  await page.getByTestId(`node-${phaseId}`).click();
  await page.getByTestId('open-goal').click();
  await page.getByTestId('goal-detector').selectOption('through');
  await page.getByTestId('goal-objective').selectOption('maximize');
  await page.getByTestId('goal-min').fill('0');
  await page.getByTestId('goal-max').fill(String(2 * Math.PI));
  await page.getByTestId('goal-points').fill('2');
  await page.getByTestId('goal-run').click();
  await expect(page.getByTestId('goal-status')).toHaveAttribute('data-state', 'no-improvement');
  await expect(page.getByTestId('goal-current-power')).toHaveText('1 mW');
  await expect(page.getByTestId('goal-apply')).toBeDisabled();
  await expect(page.getByTestId('goal-status')).toContainText('Keep the current setting');
  expect((await getDocument(page)).circuit).toEqual(baseline.circuit);
  const noImprovement = { baseline: await page.getByTestId('goal-current-power').textContent(), sampledBest: await page.getByTestId('goal-best-power').textContent(), status: await page.getByTestId('goal-status').textContent() };
  await page.getByTestId('goal-close').click();

  // All values are physically admitted. This driven zero-length feedback topology
  // exposes amplified roundoff: the raw warning and powers must remain inspectable.
  const feedback = await loadRecipe(page, {
    schema: 'picsetup-recipe/1', title: 'Numerical feedback quality check', wavelengthM: 1550e-9,
    parts: [
      { id: 'laser', model: 'source', params: { powerW: .001 } },
      { id: 'coupler', model: 'coupler', params: { coupling: 1e-13 } },
      { id: 'output', model: 'detector' },
    ],
    links: [
      { from: 'laser.out', to: 'coupler.L0' },
      { from: 'coupler.R0', to: 'output.in' },
      { from: 'coupler.R1', to: 'coupler.L1' },
    ],
  });
  await page.getByTestId('node-coupler').click();
  await page.getByTestId('open-goal').click();
  await page.getByTestId('goal-detector').selectOption('output');
  await page.getByTestId('goal-objective').selectOption('maximize');
  await page.getByTestId('goal-min').fill('1e-13');
  await page.getByTestId('goal-max').fill('1e-12');
  await page.getByTestId('goal-points').fill('201');
  await page.getByTestId('goal-run').click();
  await expect(page.getByTestId('goal-status')).toHaveAttribute('data-state', 'unresolved');
  await expect(page.getByTestId('goal-baseline-quality')).toHaveText('Baseline excluded from decisions');
  await expect(page.getByTestId('goal-apply')).toBeDisabled();
  await expect(page.locator('[data-goal-diagnostics]')).toContainText('Excluded numerical results');
  const exclusionText = await page.getByTestId('goal-failed-count').textContent();
  expect(Number(exclusionText?.match(/^(\d+) excluded/)?.[1])).toBeGreaterThan(0);
  expect((await getDocument(page)).circuit).toEqual(feedback.circuit);
  await capture(page, testInfo, '.goal-window', 'trust-goal-chromium.png', ['goal-chart', 'goal-current-power', 'goal-status', 'goal-apply']);
  await evidence('trust-goal-browser-run.json', { browserVersion: browser.version(), viewport: page.viewportSize(), noImprovement, feedback: { exclusions: exclusionText, baseline: await page.getByTestId('goal-current-power').textContent(), status: await page.getByTestId('goal-status').textContent() }, ...observed });
  expect(observed.runtimeErrors).toEqual([]);
  expect(observed.remoteRequests).toEqual([]);
});
