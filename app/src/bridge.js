export const SETUP_PORT_SCHEMA = 'setup-port/1';
export const DEFAULT_OPTICALSETUP_URL = 'https://opticalsetup.com/sketch/';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function base64UrlEncodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecodeText(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

export function normalizeBridgeId(value, fallback = 'optical-bridge') {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return normalized || fallback;
}

export function buildOpticalBridgePayload(circuit, component, solve = null, { returnUrl = null } = {}) {
  const params = component?.params ?? {};
  const result = solve?.components?.get?.(component?.id);
  const port = result?.ports?.pic ?? result?.ports?.optical ?? Object.values(result?.ports ?? {})[0] ?? null;
  const direction = ['input', 'output', 'bidirectional'].includes(params.direction) ? params.direction : 'output';
  const efficiency = Math.max(0, Math.min(1, finite(params.couplingEfficiency, 0.7)));
  const declaredOpticalSetupPowerMw = Math.max(0, finite(params.powerMw, 0));
  const picIncomingPowerMw = Math.max(0, finite(port?.incomingPowerMw, 0));
  const picOutgoingPowerMw = Math.max(0, finite(port?.outgoingPowerMw, 0));
  const picSidePowerMw = direction === 'input'
    ? (picOutgoingPowerMw || declaredOpticalSetupPowerMw * efficiency)
    : picIncomingPowerMw;
  const opticalSetupSidePowerMw = direction === 'input'
    ? declaredOpticalSetupPowerMw
    : picSidePowerMw * efficiency;
  const interfaceKind = ['free-space', 'fiber', 'edge', 'grating'].includes(params.interfaceKind) ? params.interfaceKind : 'free-space';
  const bridgeId = normalizeBridgeId(params.bridgeId, component?.id ?? 'optical-bridge');
  const wavelengthNm = finite(circuit?.settings?.wavelengthNm, finite(params.wavelengthNm, 1550));

  return {
    schema: SETUP_PORT_SCHEMA,
    bridgeId,
    source: {
      application: 'PicSetup',
      documentName: String(circuit?.name ?? 'Untitled experiment'),
      componentId: String(component?.id ?? ''),
      componentName: String(component?.name ?? 'OpticalSetup bridge')
    },
    target: { application: 'OpticalSetup', url: String(params.targetUrl || DEFAULT_OPTICALSETUP_URL) },
    domain: 'optical',
    kind: interfaceKind === 'fiber' ? 'fiber-mode' : interfaceKind === 'edge' ? 'chip-edge-mode' : interfaceKind === 'grating' ? 'grating-free-space-mode' : 'free-space-beam',
    direction,
    referenceFrame: {
      type: interfaceKind === 'edge' ? 'pic-edge' : interfaceKind === 'grating' ? 'pic-surface-normal' : interfaceKind,
      orientationDeg: finite(component?.rotation, 0),
      handedness: 'screen-xy-clockwise-positive'
    },
    state: {
      wavelengthNm,
      opticalPowerMw: opticalSetupSidePowerMw,
      powerReference: 'OpticalSetup-side interface power',
      picSidePowerMw,
      opticalSetupSidePowerMw,
      couplingEfficiency: efficiency,
      polarization: String(params.polarization || 'TE'),
      guidedMode: String(params.guidedMode || 'TE0'),
      sourceMode: String(params.sourceMode || 'cw'),
      repetitionRateMHz: params.sourceMode === 'pulsed' ? finite(params.repetitionRateMHz, 80) : null,
      pulseDurationPs: params.sourceMode === 'pulsed' ? finite(params.pulseDurationPs, 12) : null,
      phaseRad: finite(params.phaseRad, 0)
    },
    capabilities: {
      absolutePower: true,
      wavelength: true,
      pulseEnvelope: params.sourceMode === 'pulsed',
      carrierPhase: true,
      fullVectorField: false,
      spatialBeamProfile: false,
      higherOrderModes: false
    },
    omissions: [
      'PicSetup exports a scalar guided-mode boundary, not a sampled transverse field.',
      'OpticalSetup must choose or reconstruct beam waist, wavefront, numerical aperture, and laboratory coordinates.',
      'The coupling efficiency and both interface-side powers are explicit; unsupported properties are not silently invented.'
    ],
    returnUrl: returnUrl ? String(returnUrl) : null,
    createdAt: new Date().toISOString()
  };
}

export function encodeBridgePayload(payload) {
  return base64UrlEncodeText(JSON.stringify(payload));
}

export function decodeBridgePayload(encoded) {
  const payload = JSON.parse(base64UrlDecodeText(encoded));
  if (!payload || payload.schema !== SETUP_PORT_SCHEMA) throw new Error(`Unsupported bridge schema: ${payload?.schema ?? 'missing'}`);
  return payload;
}

export function opticalSetupBridgeUrl(payload, targetUrl = null) {
  const base = new URL(targetUrl || payload?.target?.url || DEFAULT_OPTICALSETUP_URL, typeof location === 'undefined' ? DEFAULT_OPTICALSETUP_URL : location.href);
  base.searchParams.set('incomingBridge', encodeBridgePayload(payload));
  base.searchParams.set('bridgeSchema', SETUP_PORT_SCHEMA);
  return base.toString();
}

export function bridgeManifest(circuit, solve = null, options = {}) {
  return (circuit?.components ?? [])
    .filter(component => component.type === 'optical-bridge')
    .map(component => buildOpticalBridgePayload(circuit, component, solve, options));
}
