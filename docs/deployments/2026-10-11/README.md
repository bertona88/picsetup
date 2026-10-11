# Production deployment — 11 October 2026

The owner explicitly authorized publishing the reviewed workbench to **https://picsetup.com/**. Main was fast-forwarded from `da78d2fced137a30d8474349066039f6eee40530` to release `91e15ea21d1690d20f14281dc5d6743abebbac8f` after the built static site passed its gates. GitHub Pages deployed successfully without a DNS change.

- [Production workflow](https://github.com/bertona88/picsetup/actions/runs/38151649244): 268 unit tests, 9 Chromium journeys against `dist`, source/equation audits, TypeScript/static/API build, CLI replay and notices checks; all passed.
- [Pre-deployment branch validation](https://github.com/bertona88/picsetup/actions/runs/38151517148) independently passed the same 9 static browser journeys, including the returning-visitor migration.
- [Production artifact](https://github.com/bertona88/picsetup/actions/runs/38151649244/artifacts/11705559883), SHA-256 `0cea269ade899a7503a92d22a2f27104b54225e124c100761313a961ab088c13` (artifact retention applies).
- [Live verification](verification.json): actual Chromium requests to picsetup.com loaded this release; the study returned sampled pass/fail/pass and the ring resolved a 3.1848 pm linewidth. No page errors, failed HTTP/assets or external runtime requests were observed. Screenshots: [study](study.png), [ring](ring.png).
- An independent HTTP fetch of the ordinary homepage returned the new title and hashed bundle `index-BsevdLno.js`; `/release.json` returned the exact release SHA above. The public URL did not require a preview route.

## Returning visitors and preserved work

The retirement `/sw.js` remains at the previous registration URL. It removes only generated `picsetup-paper-studio-*` asset caches, claims clients and unregisters. It has no fetch handler and does not force navigation. The real-browser migration test proves that unrelated caches, legacy saved circuits and open unsaved state survive; the next explicit reload displays the new app. No new service worker is registered. Old document formats are not silently converted.

The previous `app/` tree (`7266a6656f54c4e72d723bace45820a42d4a5f23`) and immutable `prototype/` tree (`4d72604f67ffea9a7a7bc6b675d8b5e83306d8b5`) remain unchanged in the repository. The previous production workflow and source remain recoverable at the prior main commit. This release publishes `playground/dist` and its model notices. Its numerical/model limitations remain those in the playground contracts; public deployment adds no calibrated-device or fabrication claim.
