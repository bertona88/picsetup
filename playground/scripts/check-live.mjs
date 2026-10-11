import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

// This runs after Pages deploys. Verify the public origin, hashed assets and real workers.
const url = new URL(process.env.PICSETUP_LIVE_URL || 'https://picsetup.com/');
const expectedCommit = process.env.PICSETUP_EXPECTED_COMMIT;
assert.match(expectedCommit || '', /^[0-9a-f]{40}$/);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1250 } });
const errors = [], failedRequests = [], externalRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
page.on('request', request => { const requestUrl = new URL(request.url()); if (['http:', 'https:'].includes(requestUrl.protocol) && requestUrl.origin !== url.origin) externalRequests.push(request.url()); });
await mkdir('evidence', { recursive: true });
let release;
try {
  for (let attempt = 0; attempt < 18; attempt++) {
    const response = await page.request.get(new URL(`release.json?verify=${expectedCommit}-${attempt}`, url).href);
    if (response.ok()) {
      try { const candidate = await response.json(); if (candidate.commit === expectedCommit) { release = candidate; break; } } catch { /* Pages may still serve its previous HTML response. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(release?.commit, expectedCommit, 'Public origin must serve this release');
  url.searchParams.set('release', expectedCommit);
  const response = await page.goto(url.href, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200);
  await page.getByTestId('open-design-study').click();
  await expect(page.getByTestId('compare-plot')).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
  const decisions = await page.getByTestId('study-metric-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-status')));
  assert.deepEqual(decisions, ['sampled-pass', 'sampled-fail', 'sampled-pass']);
  await page.screenshot({ path: 'evidence/production-study.png', fullPage: true });
  await page.evaluate(() => window.picsetup.openRing());
  await page.getByTestId('ring-run').click();
  await expect(page.getByTestId('ring-status')).toHaveAttribute('data-state', 'resolved', { timeout: 30_000 });
  const linewidth = await page.locator('[data-ring-linewidth]').textContent();
  assert.match(linewidth, /3\.18/);
  await page.screenshot({ path: 'evidence/production-ring.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  assert.deepEqual(externalRequests, []);
  const result = { schema: 'picsetup-production-verification/1', verifiedAt: new Date().toISOString(), origin: url.origin, release, browserVersion: browser.version(), decisions, ringLinewidth: linewidth, errors, failedRequests, externalRequests };
  await writeFile('evidence/production-verification.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
