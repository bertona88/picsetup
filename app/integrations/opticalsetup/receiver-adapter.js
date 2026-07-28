/**
 * Framework-agnostic receiving adapter for PicSetup's setup-port/1 URL handoff.
 *
 * OpticalSetup can import this module, call readIncomingBridge() on startup,
 * convert the payload with opticalSetupBoundaryFromBridge(), and then map the
 * returned descriptor into its own scene/component API.
 */

export const SETUP_PORT_SCHEMA = 'setup-port/1';

function decodeBase64UrlText(value) {
  const source = String(value ?? '').trim();
  if (!source) throw new Error('Missing incomingBridge payload.');
  const padded = source.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((source.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

function finite(value, fallback = null) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function decodeIncomingBridge(encoded) {
  const payload = JSON.parse(decodeBase64UrlText(encoded));
  if (!payload || payload.schema !== SETUP_PORT_SCHEMA) {
    throw new Error(`Unsupported setup bridge schema: ${payload?.schema ?? 'missing'}`);
  }
  if (payload.domain !== 'optical') throw new Error(`Unsupported bridge domain: ${payload.domain ?? 'missing'}`);
  if (!payload.bridgeId) throw new Error('Bridge payload has no bridgeId.');
  return payload;
}

export function readIncomingBridge(url = globalThis.location?.href) {
  if (!url) return null;
  const parsed = new URL(String(url), 'https://opticalsetup.com/sketch/');
  const encoded = parsed.searchParams.get('incomingBridge');
  if (!encoded) return null;
  const requestedSchema = parsed.searchParams.get('bridgeSchema');
  if (requestedSchema && requestedSchema !== SETUP_PORT_SCHEMA) {
    throw new Error(`URL requests unsupported bridge schema: ${requestedSchema}`);
  }
  return decodeIncomingBridge(encoded);
}

/**
 * Turn the cross-product payload into a neutral OpticalSetup-side descriptor.
 * This function intentionally does not invent beam waist, NA, wavefront, or
 * laboratory coordinates because PicSetup exports a scalar guided-mode boundary.
 */
export function opticalSetupBoundaryFromBridge(payload) {
  if (!payload || payload.schema !== SETUP_PORT_SCHEMA) throw new Error('Expected a setup-port/1 payload.');
  const state = payload.state ?? {};
  const direction = ['input', 'output', 'bidirectional'].includes(payload.direction) ? payload.direction : 'output';
  const role = direction === 'output' ? 'source' : direction === 'input' ? 'sink' : 'bidirectional';
  const kind = String(payload.kind ?? 'free-space-beam');

  return {
    id: `picsetup:${String(payload.bridgeId)}`,
    name: String(payload.source?.componentName || 'PicSetup optical boundary'),
    type: kind === 'fiber-mode' ? 'fiber-interface' : 'free-space-interface',
    role,
    wavelengthNm: finite(state.wavelengthNm, 1550),
    opticalPowerMw: Math.max(0, finite(state.opticalSetupSidePowerMw, finite(state.opticalPowerMw, 0))),
    polarization: String(state.polarization || 'unspecified'),
    guidedMode: String(state.guidedMode || 'unspecified'),
    temporal: {
      mode: state.sourceMode === 'pulsed' ? 'pulsed' : 'cw',
      repetitionRateMHz: state.sourceMode === 'pulsed' ? finite(state.repetitionRateMHz) : null,
      pulseDurationPs: state.sourceMode === 'pulsed' ? finite(state.pulseDurationPs) : null
    },
    referenceFrame: payload.referenceFrame ?? null,
    unresolvedSpatialState: {
      beamWaistUm: null,
      numericalAperture: null,
      wavefront: 'unspecified',
      laboratoryCoordinates: 'unresolved'
    },
    bridge: {
      schema: payload.schema,
      bridgeId: String(payload.bridgeId),
      sourceApplication: String(payload.source?.application || 'PicSetup'),
      sourceDocument: String(payload.source?.documentName || ''),
      sourceComponentId: String(payload.source?.componentId || ''),
      returnUrl: payload.returnUrl || null,
      capabilities: payload.capabilities ?? {},
      omissions: Array.isArray(payload.omissions) ? [...payload.omissions] : []
    }
  };
}

/**
 * Minimal startup helper for OpticalSetup. `createBoundary` should be the one
 * application-specific function that places/selects the corresponding object.
 */
export function consumeIncomingBridge(createBoundary, { url = globalThis.location?.href } = {}) {
  if (typeof createBoundary !== 'function') throw new TypeError('createBoundary must be a function.');
  const payload = readIncomingBridge(url);
  if (!payload) return null;
  const descriptor = opticalSetupBoundaryFromBridge(payload);
  return createBoundary(descriptor, payload);
}
