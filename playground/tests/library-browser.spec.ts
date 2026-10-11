import { expect, test, type Page } from '@playwright/test';
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
async function configureSweep(page: Page, points: number, start = 1500, stop = 1600) {
  await page.getByTestId('sweep-start-nm').fill(String(start));
  await page.getByTestId('sweep-stop-nm').fill(String(stop));
  await page.getByTestId('sweep-points').fill(String(points));
}
async function sweep(page: Page, points: number) {
  await configureSweep(page, points);
  await page.getByTestId('sweep-run').click();
  await expect(page.getByTestId('spectrum-plot')).toHaveAttribute('data-status', 'complete');
  await expect(page.getByTestId('spectrum-plot')).toHaveAttribute('data-sample-count', String(points));
}
function numericCsv(csv: string) {
  // Numeric columns precede quoted diagnostics JSON, which is deliberately not parsed here.
  const lines = csv.trim().split(/\r?\n/).filter(line => !line.startsWith('#'));
  return { header: lines[0].split(','), rows: lines.slice(1).map(line => line.split(',')) };
}

test('open-data MZI has real spectra, exact model swaps and a portable reopen', async ({ page, browser }, testInfo) => {
  const errors: string[] = [], remoteRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) remoteRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByTestId('experiment-dataset-mzi').click();
  const plot = page.getByTestId('spectrum-plot');
  await expect(plot).toHaveAttribute('data-status', 'complete');
  await sweep(page, 201);
  await expect(plot.locator('path[data-detector-id]')).toHaveCount(2);
  const csv = await downloadText(page, 'sweep-csv');
  expect(csv).toContain('# schema: picsetup-spectrum/1');
  expect(csv).toContain('siepic-coupler');
  expect(csv).toContain('945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371');
  const table = numericCsv(csv);
  expect(table.rows).toHaveLength(201);
  expect(table.header).toContain('budget_modelSupplied_W');
  expect(Number(table.rows[0][0])).toBeCloseTo(1500e-9, 15);
  expect(Number(table.rows[200][0])).toBeCloseTo(1600e-9, 15);
  expect(table.rows.every(row => row[1] === 'true')).toBe(true);
  const powerColumn = table.header.findIndex(value => value.endsWith(':power_W'));
  const powers = table.rows.map(row => Number(row[powerColumn]));
  expect(powers.every(Number.isFinite)).toBe(true);
  expect(Math.max(...powers) - Math.min(...powers)).toBeGreaterThan(1e-5);

  await plot.press('Home');
  await expect(page.getByTestId('wavelength-nm')).toHaveValue('1500');
  await plot.press('End');
  await expect(page.getByTestId('wavelength-nm')).toHaveValue('1600');
  await page.getByTestId('wavelength-nm').fill('1550');
  await expect(plot).toHaveAttribute('data-status', 'complete');
  const imported = page.locator('[data-component-id][data-model="siepic-coupler"]').first();
  const id = await imported.getAttribute('data-component-id');
  if (!id) throw new Error('Dataset component has no stable identity');
  await page.getByTestId(`node-${id}`).click();
  await expect(page.getByTestId('dataset-metadata')).toContainText(/200 nm|10 µm/);
  const before = JSON.parse(await downloadText(page, 'export-json'));
  await page.getByTestId('coupler-model').selectOption('coupler');
  await expect(page.getByTestId(`node-${id}`)).toHaveAttribute('data-model', 'coupler');
  await expect(plot).toHaveAttribute('data-status', 'stale');
  await expect(plot.locator('path[data-detector-id]')).toHaveCount(0);
  const swapped = JSON.parse(await downloadText(page, 'export-json'));
  expect(swapped.circuit.connections).toEqual(before.circuit.connections);
  expect(swapped.layout).toEqual(before.layout);
  expect(swapped.circuit.components.find((component: { id: string }) => component.id === id)).toMatchObject({ version: '1', model: 'coupler', params: { coupling: .5 } });
  await page.getByTestId('coupler-model').selectOption('siepic-coupler');
  const savedText = await downloadText(page, 'export-json');
  const saved = JSON.parse(savedText);
  expect(saved.circuit).toEqual(before.circuit);
  await page.getByTestId('blank-circuit').click();
  await page.getByTestId('import-json').setInputFiles({ name: 'portable-data-mzi.json', mimeType: 'application/json', buffer: Buffer.from(savedText) });
  await expect(page.getByTestId('toast')).toContainText(/opened|restored/i);
  await expect(page.locator('[data-component-id][data-model="siepic-coupler"]')).toHaveCount(2);
  await page.reload();
  expect(JSON.parse(await downloadText(page, 'export-json')).circuit).toEqual(saved.circuit);
  await sweep(page, 201);
  await page.getByRole('button', { name: 'Fit circuit to view', exact: true }).click();
  await page.getByTestId(`node-${id}`).click();
  await expect(page.getByTestId('dataset-metadata')).toBeVisible();
  await expect(page.getByTestId('toast')).toBeHidden();
  // A visible SVG can still overflow its fixed drawer and be hidden behind the footer.
  const panelBox = await page.getByTestId('spectrum-panel').boundingBox();
  const plotBox = await plot.boundingBox();
  const statusBox = await page.getByTestId('spectrum-status').boundingBox();
  if (!panelBox || !plotBox || !statusBox) throw new Error('Spectrum panel, plot or status is not visible');
  expect(plotBox.y + plotBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
  expect(statusBox.y + statusBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
  expect(plotBox.y + plotBox.height).toBeLessThanOrEqual(statusBox.y + 1);
  for (const label of [plot.locator('.spectrum-axis').filter({ hasText: /^0$/ }), plot.getByText('1600 nm', { exact: true })]) {
    await expect(label).toHaveCount(1);
    const labelBox = await label.boundingBox();
    if (!labelBox) throw new Error('A spectrum boundary-axis label is not visible');
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(plotBox.y + plotBox.height + 1);
  }
  const evidence = path.resolve('evidence');
  await mkdir(evidence, { recursive: true });
  const screenshot = path.join(evidence, 'library-experiments-chromium.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Imported MZI with calculated spectrum', { path: screenshot, contentType: 'image/png' });
  await writeFile(path.join(evidence, 'library-browser-run.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null,
    workflowRun: process.env.GITHUB_RUN_ID ?? null, browserVersion: browser.version(),
    viewport: page.viewportSize(), model: 'siepic-coupler', modelVersion: '1',
    sourceSha256: '945ddee41a7b46d7288a862ac9ad3c4802336810cf5c7b6d3716b848c00f1371',
    sampleCount: table.rows.length, wavelengthNm: [1500, 1600],
    firstDetectorPowerRangeW: [Math.min(...powers), Math.max(...powers)],
    runtimeErrors: errors, remoteRequests,
    journey: ['dataset MZI preset', 'worker spectrum', 'CSV numerical export', 'keyboard wavelength scrubbing', 'coupler model swap', 'portable JSON reopen', 'autosave reload'],
  }, null, 2) + '\n');
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});

test('unsupported wavelengths remain gaps, and cancelled or stale sweeps cannot become current', async ({ page }) => {
  await page.goto('/');
  const plot = page.getByTestId('spectrum-plot');
  await expect(plot).toHaveAttribute('data-status', 'complete');
  await configureSweep(page, 2, 1400, 1410);
  await page.getByTestId('sweep-run').click();
  await expect(plot).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('spectrum-status')).toContainText(/unsupported|outside|band/i);
  await expect(plot.locator('path[data-detector-id]')).toHaveCount(0);
  const invalid = numericCsv(await downloadText(page, 'sweep-csv'));
  expect(invalid.rows).toHaveLength(2);
  expect(invalid.rows.every(row => row[1] === 'false')).toBe(true);
  for (const row of invalid.rows) for (const [index, name] of invalid.header.entries()) {
    if (name.endsWith(':power_W') || name.startsWith('budget_') || name === 'residual') expect(row[index]).toBe('');
  }
  await page.getByTestId('wavelength-nm').fill('1400');
  await expect(page.locator('#solver-status')).toContainText(/check|invalid|unsupported/i);
  for (const detector of await page.locator('[data-testid^="detector-"]').all()) await expect(detector).toHaveAttribute('data-power-w', '');
  await page.getByTestId('wavelength-nm').fill('1550');
  await configureSweep(page, 1001);
  await page.getByTestId('sweep-run').click();
  await page.getByTestId('sweep-cancel').click();
  await expect(plot).toHaveAttribute('data-status', 'cancelled');
  const cancelledId = Number(await plot.getAttribute('data-request-id'));
  expect(Number(await plot.getAttribute('data-sample-count'))).toBeLessThan(1001);
  await page.locator('[data-component-id][data-model="source"]').click();
  await page.getByTestId('sweep-run').click();
  await page.getByTestId('param-powerW').fill('1.1');
  await expect(plot).toHaveAttribute('data-status', 'stale');
  await expect(plot).toHaveAttribute('data-sample-count', '0');
  await expect(plot.locator('path[data-detector-id]')).toHaveCount(0);
  await expect(page.getByTestId('sweep-csv')).toBeDisabled();
  await sweep(page, 11);
  expect(Number(await plot.getAttribute('data-request-id'))).toBeGreaterThan(cancelledId);
  await expect(plot).toHaveAttribute('data-sample-count', '11');
});
