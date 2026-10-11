import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Chromium does not route service-worker main-script update fetches through
// Playwright's page routes. A loopback HTTP fixture serves both generations at
// the same /sw.js URL; replacement app requests reach the real preview server.
test('a returning browser retires legacy asset caches without disturbing open work or saved documents', async ({ page, baseURL, browser }) => {
  if (!baseURL) throw new Error('A running application server is required');
  const retirementResponse = await page.request.get('/sw.js');
  expect(retirementResponse.status()).toBe(200);
  const retirementWorker = await retirementResponse.text();
  expect(retirementWorker).toContain('self.registration.unregister()');

  let replacementDeployed = false;
  const oldHtml = '<!doctype html><html><head><title>Legacy PicSetup fixture</title></head><body><main data-testid="legacy-app">Open legacy experiment</main></body></html>';
  const oldWorker = `
    const CACHE = 'picsetup-paper-studio-v3';
    self.addEventListener('install', event => event.waitUntil(
      caches.open(CACHE).then(cache => cache.addAll(['/', '/index.html'])).then(() => self.skipWaiting())
    ));
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => {
      if (event.request.method !== 'GET') return;
      event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
    });
  `;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', baseURL);
      if (url.pathname === '/sw.js') {
        response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
        response.end(replacementDeployed ? retirementWorker : oldWorker);
      } else if (!replacementDeployed && ['/', '/index.html'].includes(url.pathname)) {
        response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        response.end(oldHtml);
      } else {
        const upstream = await fetch(url);
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      }
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(String(error));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  const fixtureUrl = `http://127.0.0.1:${address.port}/`;

  try {
    await page.goto(fixtureUrl);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
    await page.evaluate(async () => {
      localStorage.setItem('picsetup.autosave', '{"legacy":"saved circuit"}');
      localStorage.setItem('picsetup.explicit-save', '{"legacy":"explicit save"}');
      localStorage.setItem('unrelated-document', 'keep this');
      (window as unknown as { unsavedExperiment: string }).unsavedExperiment = 'keep open work';
      await (await caches.open('picsetup-paper-studio-v2')).put('/old-assets.js', new Response('old asset'));
      await (await caches.open('picsetup-user-documents')).put('/saved-document', new Response('keep cached document'));
      await (await caches.open('another-app-v1')).put('/other-document', new Response('keep other data'));
    });

    replacementDeployed = true;
    // Demonstrate the hazard before the update: the old worker still returns its
    // cached app after the server has switched to the new distribution.
    expect(await page.evaluate(async () => (await fetch('/')).text())).toBe(oldHtml);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration) throw new Error('Missing legacy registration');
      await registration.update();
    });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).sort())).toEqual(['another-app-v1', 'picsetup-user-documents']);

    // Activation must not navigate away, replace the DOM, or erase open work.
    await expect(page.getByTestId('legacy-app')).toBeVisible();
    expect(page.url()).toBe(fixtureUrl);
    expect(await page.evaluate(() => (window as unknown as { unsavedExperiment: string }).unsavedExperiment)).toBe('keep open work');
    const expectedSaved = ['{"legacy":"saved circuit"}', '{"legacy":"explicit save"}', 'keep this'];
    const saved = () => page.evaluate(() => ['picsetup.autosave', 'picsetup.explicit-save', 'unrelated-document'].map(key => localStorage.getItem(key)));
    expect(await saved()).toEqual(expectedSaved);
    expect(await page.evaluate(async () => (await (await caches.open('picsetup-user-documents')).match('/saved-document'))!.text())).toBe('keep cached document');

    // Only the user's subsequent reload switches to the real new application.
    await page.reload();
    await expect(page.getByTestId('open-design-study')).toBeVisible();
    await expect(page.getByTestId('open-ring')).toBeVisible();
    await expect(page.getByTestId('legacy-app')).toHaveCount(0);
    expect(await saved()).toEqual(expectedSaved);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

    await mkdir(path.resolve('evidence'), { recursive: true });
    await writeFile(path.resolve('evidence/deployment-browser-run.json'), JSON.stringify({
      capturedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null,
      workflowRun: process.env.GITHUB_RUN_ID ?? null, browserVersion: browser.version(),
      builtStaticSite: process.env.PICSETUP_STATIC === '1', legacyCacheFirstReproduced: true,
      legacyAssetCachesRemoved: true, unrelatedCachesRetained: true,
      localStorageRetained: true, openWorkAndDomRetained: true,
      registrationRemoved: true, nextReloadShowsNewApp: true,
    }, null, 2) + '\n');
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
});
