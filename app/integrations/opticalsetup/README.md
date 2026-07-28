# OpticalSetup receiver adapter

PicSetup opens OpticalSetup with a versioned optical boundary in the query string:

```text
https://opticalsetup.com/sketch/?incomingBridge=…&bridgeSchema=setup-port/1
```

`receiver-adapter.js` is a framework-agnostic parser for that handoff. It validates the schema and optical domain, then converts the payload into a neutral OpticalSetup-side boundary descriptor.

A minimal integration in OpticalSetup is:

```js
import { consumeIncomingBridge } from './receiver-adapter.js';

consumeIncomingBridge((descriptor, originalPayload) => {
  // Replace this with OpticalSetup's real scene/component creation API.
  const element = createExternalOpticalBoundary({
    name: descriptor.name,
    role: descriptor.role,
    wavelengthNm: descriptor.wavelengthNm,
    powerMw: descriptor.opticalPowerMw,
    polarization: descriptor.polarization,
    sourceMode: descriptor.temporal.mode
  });

  element.setupBridge = descriptor.bridge;
  selectElement(element.id);
  return element;
});
```

The receiver intentionally leaves beam waist, numerical aperture, wavefront, and laboratory coordinates unresolved. Those properties belong to OpticalSetup and cannot be reconstructed honestly from PicSetup's scalar guided-mode boundary.

The adapter does not implement live synchronization. The first integration slice is a deterministic, inspectable document handoff with a return URL and stable bridge ID.
