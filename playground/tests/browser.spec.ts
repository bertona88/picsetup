import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type SavedDocument = {
  schema: string;
  circuit: { components: Array<{ id: string; model: string }>; connections: unknown[] };
  layout: unknown;
};

async function exportDocument(page: Page): Promise<SavedDocument> {
  const pending = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const download = await pending;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('JSON export did not provide a readable download');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function addAt(page: Page, model: string, xFraction: number, yFraction: number): Promise<string> {
  const nodes = page.locator(`[data-component-id][data-model="${model}"]`);
  const before = await nodes.count();
  await page.getByTestId(`palette-${model}`).click();
  await expect(nodes).toHaveCount(before + 1);
  const node = nodes.last();
  const id = await node.getAttribute('data-component-id');
  if (!id) throw new Error('Placed component has no stable identity');
  const bounds = await node.boundingBox();
  const canvas = await page.getByTestId('canvas').boundingBox();
  if (!bounds || !canvas) throw new Error('Placed component or canvas is not visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * xFraction, canvas.y + canvas.height * yFraction, { steps: 6 });
  await page.mouse.up();
  return id;
}

async function connect(page: Page, from: string, fromPort: number, to: string, toPort: number): Promise<void> {
  await page.getByTestId(`port-${from}-${fromPort}`).click();
  await page.getByTestId(`port-${to}-${toPort}`).click();
}

async function power(page: Page, id: string): Promise<number> {
  const value = await page.getByTestId(`detector-${id}`).getAttribute('data-power-w');
  if (value === null || value.trim() === '' || !Number.isFinite(Number(value))) throw new Error('Detector readout has no finite solved power');
  return Number(value);
}

async function expectPower(page: Page, id: string, expectedW: number): Promise<void> {
  await expect.poll(() => power(page, id), { message: `Detector ${id} should report ${expectedW} W` })
    .toBeCloseTo(expectedW, 10);
}

test('build an MZI from blank, edit and undo phase, save/reopen and reject bad files', async ({ page, browser, browserName }, testInfo) => {
  const runtimeErrors: string[] = [];
  const remoteRequests: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      remoteRequests.push(request.url());
    }
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByTestId('blank-circuit').click();
  await expect(page.locator('[data-component-id]')).toHaveCount(0);

  // All topology is constructed through ordinary palette, drag and port interactions.
  const source = await addAt(page, 'source', .10, .48);
  const first = await addAt(page, 'coupler', .27, .48);
  const phase = await addAt(page, 'phase', .47, .27);
  const second = await addAt(page, 'coupler', .65, .48);
  const upper = await addAt(page, 'detector', .86, .33);
  const lower = await addAt(page, 'detector', .86, .65);
  await connect(page, source, 0, first, 0);
  await connect(page, first, 2, phase, 0);
  await connect(page, phase, 1, second, 0);
  await connect(page, first, 3, second, 1);
  await connect(page, second, 2, upper, 0);
  await connect(page, second, 3, lower, 0);
  await expect(page.locator('[data-connection-id]')).toHaveCount(6);

  // The source control displays mW; all serialized physics and assertions use W.
  await page.getByTestId(`node-${source}`).click();
  await page.getByTestId('param-powerW').fill('1');
  await page.getByTestId('param-powerW').press('Tab');
  await page.getByTestId(`node-${phase}`).click();
  await page.getByTestId('param-phaseRad').fill('0');
  await page.getByTestId('param-phaseRad').press('Tab');
  await expectPower(page, upper, 0);
  await expectPower(page, lower, .001);

  // Keyboard-accessible numeric editing and command history must update real results.
  await page.getByTestId('param-phaseRad').fill(String(Math.PI));
  await page.getByTestId('param-phaseRad').press('Tab');
  await expectPower(page, upper, .001);
  await expectPower(page, lower, 0);
  await page.getByTestId('undo').click();
  await expectPower(page, upper, 0);
  await expectPower(page, lower, .001);
  await page.getByTestId('redo').click();
  await expectPower(page, upper, .001);

  await page.getByTestId(`node-${phase}`).click();
  await page.getByTestId('param-phaseRad').fill(String(Math.PI / 2));
  await page.getByTestId('param-phaseRad').press('Tab');
  await expectPower(page, upper, .0005);
  await expectPower(page, lower, .0005);
  const beforeMove = await exportDocument(page);
  const selected = await page.getByTestId(`node-${phase}`).boundingBox();
  if (!selected) throw new Error('Phase shifter is not visible');
  await page.mouse.move(selected.x + selected.width / 2, selected.y + selected.height / 2);
  await page.mouse.down();
  await page.mouse.move(selected.x + selected.width / 2 + 20, selected.y + selected.height / 2 - 20, { steps: 6 });
  await page.mouse.up();
  await expectPower(page, upper, .0005);
  const saved = await exportDocument(page);
  expect(saved.schema).toBe('picsetup-playground/1');
  expect(saved.circuit).toEqual(beforeMove.circuit);
  expect(saved.layout).not.toEqual(beforeMove.layout);
  expect(saved.circuit.components).toHaveLength(6);
  expect(saved.circuit.connections).toHaveLength(6);

  await page.getByTestId('blank-circuit').click();
  await expect(page.locator('[data-component-id]')).toHaveCount(0);
  await page.getByTestId('import-json').setInputFiles({
    name: 'roundtrip-mzi.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.locator('[data-component-id]')).toHaveCount(6);
  await expectPower(page, upper, .0005);
  expect((await exportDocument(page)).circuit).toEqual(saved.circuit);
  await page.reload();
  await expect(page.locator('[data-component-id]')).toHaveCount(6);
  await expectPower(page, lower, .0005);

  await page.getByTestId('import-json').setInputFiles({
    name: 'unsupported.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"picsetup-playground/999"}'),
  });
  await expect(page.getByTestId('toast')).toContainText(/unsupported|schema|version/i);
  await expect(page.locator('[data-component-id]')).toHaveCount(6);
  expect((await exportDocument(page)).circuit).toEqual(saved.circuit);
  await page.getByTestId('import-json').setInputFiles({
    name: 'malformed.json', mimeType: 'application/json', buffer: Buffer.from('{this is not JSON'),
  });
  await expect(page.getByTestId('toast')).toContainText(/json|parse|invalid|expected|property/i);
  expect((await exportDocument(page)).circuit).toEqual(saved.circuit);
  await expectPower(page, upper, .0005);

  // Restore the valid file so the evidence image shows the accepted experiment.
  await page.getByTestId('import-json').setInputFiles({
    name: 'roundtrip-mzi.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.getByTestId('toast')).toContainText(/opened|restored/i);
  await expectPower(page, lower, .0005);
  await page.getByTestId(`node-${phase}`).click();
  await expect(page.getByTestId('toast')).toBeHidden();
  const evidence = path.resolve('evidence');
  await mkdir(evidence, { recursive: true });
  const screenshotPath = path.join(evidence, 'mzi-chromium.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('MZI constructed from blank', { path: screenshotPath, contentType: 'image/png' });
  await writeFile(path.join(evidence, 'browser-run.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null,
    workflowRun: process.env.GITHUB_RUN_ID ?? null, browserName, browserVersion: browser.version(),
    viewport: page.viewportSize(), userAgent: await page.evaluate(() => navigator.userAgent),
    sourcePowerW: .001, phaseRad: Math.PI / 2,
    expectedDetectorPowerW: [.0005, .0005],
    actualDetectorPowerW: [await power(page, upper), await power(page, lower)],
    runtimeErrors, remoteRequests,
    journey: ['blank', 'palette placement', 'drag', 'port connections', 'phase editing', 'undo', 'redo', 'layout independence', 'JSON roundtrip', 'autosave reload', 'invalid import rejection'],
  }, null, 2) + '\n');
  expect(runtimeErrors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});
