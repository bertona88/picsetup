export const SHARED_STATE_VERSION = 1;
export const MAX_SHARED_STATE_FRAGMENT_LENGTH = 65_536;

const MAX_STATE_DEPTH = 10;
const MAX_STATE_NODES = 8_192;
const MAX_ARRAY_LENGTH = 512;
const MAX_OBJECT_KEYS = 128;
const MAX_KEY_LENGTH = 128;
const MAX_STRING_LENGTH = 32_768;
const MAX_ABSOLUTE_NUMBER = 1_000_000_000;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const PARAMETER_CONTAINERS = {
  electrical: "parameters",
  biological: "parameters",
  gravity: "parameters",
};

const PARAMETER_SCHEMAS = {
  electrical: {
    target: { type: "number", min: 0.2, max: 1.2 },
    kp: { type: "number", min: 0, max: 4 },
    ki: { type: "number", min: 0, max: 1.8 },
    kd: { type: "number", min: 0, max: 0.45 },
    latency: { type: "number", min: 0, max: 180 },
    noise: { type: "number", min: 0, max: 0.1 },
    plantTau: { type: "number", min: 100, max: 800 },
  },
  biological: {
    condition: { type: "enum", values: ["healthy", "apoptosis", "mitosis"] },
    microscopy: { type: "enum", values: ["phase", "fluorescence", "brightfield"] },
    metabolism: { type: "number", min: 0.35, max: 1.5 },
    diffusion: { type: "number", min: 0.35, max: 1.55 },
    stress: { type: "number", min: 0, max: 1 },
    permeability: { type: "number", min: 0, max: 1 },
    pulseStrength: { type: "number", min: 0.15, max: 1 },
    organelles: { type: "boolean" },
  },
  gravity: {
    starMass: { type: "number", min: 0.2, max: 2.2 },
    planetMass: { type: "number", min: 0.05, max: 10 },
    semiMajor: { type: "number", min: 0.03, max: 8 },
    eccentricity: { type: "number", min: 0, max: 0.7 },
    inclination: { type: "number", min: 0, max: 90 },
    maskMas: { type: "number", min: 0, max: 250 },
    distancePc: { type: "number", min: 2, max: 50 },
    timeDays: { type: "number", min: 0, max: 20_000 },
    speed: { type: "number", min: 0, max: 80 },
  },
  ego: {
    population: { type: "integer", min: 12, max: 52 },
    regeneration: { type: "number", min: 0.08, max: 1 },
    scarcity: { type: "number", min: 0, max: 1 },
    temptation: { type: "number", min: 0, max: 1 },
    visibility: { type: "number", min: 0.05, max: 1 },
    mutation: { type: "number", min: 0, max: 0.08 },
  },
  quantum: {
    momentum: { type: "number", min: 5, max: 52 },
    packetWidth: { type: "number", min: 0.045, max: 0.22 },
    barrierHeight: { type: "number", min: 0, max: 420 },
    barrierWidth: { type: "number", min: 0.015, max: 0.22 },
    barrierCenter: { type: "number", min: -0.65, max: 0.65 },
    barrierCount: { type: "enum", values: [0, 1, 2] },
    separation: { type: "number", min: 0.06, max: 0.52 },
    speed: { type: "number", min: 0.2, max: 2 },
  },
  noetic: {
    count: { type: "integer", min: 36, max: 180 },
    coupling: { type: "number", min: 0, max: 4.5 },
    diversity: { type: "number", min: 0.05, max: 2 },
    noise: { type: "number", min: 0, max: 0.2 },
    radius: { type: "number", min: 0.08, max: 0.42 },
  },
  computation: {
    rule: { type: "integer", min: 0, max: 255 },
    width: { type: "integer", min: 65, max: 257, odd: true },
    density: { type: "number", min: 0.01, max: 0.95 },
    stepsPerSecond: { type: "integer", min: 1, max: 60 },
    wrap: { type: "boolean" },
    seedMode: { type: "enum", values: ["single", "random", "packet"] },
  },
  logistic: {
    demand: { type: "number", min: 0.5, max: 10 },
    capacity: { type: "number", min: 0.35, max: 1.8 },
    speed: { type: "number", min: 0.35, max: 1.8 },
    congestionWeight: { type: "number", min: 0, max: 6 },
    disruption: { type: "enum", values: ["none", "port-main", "central-market"] },
  },
  molecular: {
    count: { type: "integer", min: 28, max: 112 },
    temperature: { type: "number", min: 0.05, max: 2.5 },
    attraction: { type: "number", min: 0.05, max: 2.2 },
    packing: { type: "number", min: 0.3, max: 1 },
    thermostat: { type: "number", min: 0, max: 0.45 },
    timeScale: { type: "number", min: 0.2, max: 1.6 },
    phase: { type: "enum", values: ["gas", "liquid", "crystal"] },
  },
};

const DYNAMIC_SCHEMAS = {
  electrical: {
    tick: { type: "integer", min: 0, max: MAX_ABSOLUTE_NUMBER },
    plant: { type: "number", min: 0, max: 1.5 },
    plantVelocity: { type: "number", min: -4, max: 4 },
    integral: { type: "number", min: -0.75, max: 0.95 },
    thermal: { type: "number", min: 0, max: 2 },
    perturbation: { type: "number", min: -0.78, max: 0.78 },
  },
  biological: {
    tick: { type: "integer", min: 0, max: MAX_ABSOLUTE_NUMBER },
    atp: { type: "number", min: 0.03, max: 1 },
    calcium: { type: "number", min: 0.015, max: 1.35 },
    caspase: { type: "number", min: 0, max: 1.2 },
    membrane: { type: "number", min: 0.18, max: 1 },
    cycle: { type: "number", min: 0, max: 1 },
    pulse: { type: "number", min: 0, max: 1.35 },
    pulseX: { type: "number", min: 0, max: 1 },
    pulseY: { type: "number", min: 0, max: 1 },
  },
};

const TOP_LEVEL_SCHEMAS = {
  pic: {
    version: { type: "literal", value: 1 },
    wavelengthNm: { type: "number", min: 1480, max: 1620 },
    phasePi: { type: "number", min: 0, max: 2 },
    inputCoupling: { type: "number", min: 0.02, max: 0.98 },
    outputCoupling: { type: "number", min: 0.02, max: 0.98 },
    armLossDb: { type: "number", min: 0, max: 6 },
    pathDeltaUm: { type: "number", min: -8, max: 8 },
    inputPort: { type: "enum", values: ["0", "1"] },
    inputPowerMw: { type: "number", min: 0.1, max: 5 },
  },
  electrical: {
    version: { type: "literal", value: 1 },
    preset: { type: "enum", values: ["tuned", "underdamped", "delayed", "noisy", "custom"] },
    parameters: { type: "object" },
    dynamics: { type: "object" },
  },
  biological: {
    version: { type: "literal", value: 1 },
    preset: {
      type: "enum",
      values: ["homeostasis", "apoptosis", "mitosis", "signalling", "custom"],
    },
    parameters: { type: "object" },
    dynamics: { type: "object" },
  },
  gravity: {
    version: { type: "literal", value: 1 },
    preset: { type: "enum", values: ["coronagraph", "transit", "reflex"] },
    parameters: { type: "object" },
    observations: { type: "array" },
  },
  "two-photon": {
    version: { type: "literal", value: 1 },
    powerMw: { type: "number", min: 3, max: 20 },
    waistUm: { type: "number", min: 0.3, max: 1.2 },
    scanSpeed: { type: "number", min: 0.4, max: 8 },
    diffusion: { type: "number", min: 0, max: 0.2 },
    threshold: { type: "number", min: 0.12, max: 0.8 },
    radicalLifetime: { type: "number", min: 0.2, max: 2 },
    scanMode: { type: "enum", values: ["stationary", "line", "raster"] },
    autoScan: { type: "boolean" },
    developed: { type: "boolean" },
    focusX: { type: "number", min: -6, max: 6 },
    focusZ: { type: "number", min: 0, max: 8 },
    simulationTime: { type: "number", min: 0, max: 3600 },
    field: { type: "base64-field", decodedLength: 8640 },
  },
};

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSetupId(setupId) {
  if (typeof setupId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(setupId)) {
    throw new TypeError("Shared state has an invalid setup id");
  }
}

function assertJsonTree(value, path, depth, budget) {
  budget.nodes += 1;
  if (budget.nodes > MAX_STATE_NODES) throw new RangeError("Shared state is too complex");
  if (depth > MAX_STATE_DEPTH) throw new RangeError("Shared state is nested too deeply");

  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_NUMBER) {
      throw new RangeError(`Shared state contains an invalid number at ${path}`);
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new RangeError(`Shared state string is too long at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new RangeError(`Shared state array is too long at ${path}`);
    }
    value.forEach((entry, index) => assertJsonTree(entry, `${path}[${index}]`, depth + 1, budget));
    return;
  }
  if (!isRecord(value)) throw new TypeError(`Shared state contains a non-JSON value at ${path}`);

  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_KEYS) {
    throw new RangeError(`Shared state object has too many keys at ${path}`);
  }
  for (const [key, entry] of entries) {
    if (key.length > MAX_KEY_LENGTH || BLOCKED_KEYS.has(key)) {
      throw new TypeError(`Shared state contains an invalid key at ${path}`);
    }
    assertJsonTree(entry, `${path}.${key}`, depth + 1, budget);
  }
}

function assertSchemaValue(setupId, path, value, rule) {
  if (rule.type === "literal") {
    if (value !== rule.value) throw new TypeError(`Shared state has an invalid value at ${path}`);
    return;
  }
  if (rule.type === "boolean") {
    if (typeof value !== "boolean") throw new TypeError(`Shared state has an invalid boolean at ${path}`);
    return;
  }
  if (rule.type === "enum") {
    if (!rule.values.includes(value)) throw new TypeError(`Shared state has an invalid enum at ${path}`);
    return;
  }
  if (rule.type === "object") {
    if (!isRecord(value)) throw new TypeError(`Shared state must contain an object at ${path}`);
    return;
  }
  if (rule.type === "array") {
    if (!Array.isArray(value)) throw new TypeError(`Shared state must contain an array at ${path}`);
    return;
  }
  if (rule.type === "base64-field") {
    if (typeof value !== "string") {
      throw new TypeError(`Shared state has an invalid field at ${path}`);
    }
    if (value === "") return;
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
      throw new TypeError(`Shared state has an invalid field at ${path}`);
    }
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    const decodedLength = (value.length / 4) * 3 - padding;
    if (decodedLength !== rule.decodedLength) {
      throw new RangeError(`Shared state has an invalid field size at ${path}`);
    }
    return;
  }
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < rule.min
    || value > rule.max
    || (rule.type === "integer" && !Number.isInteger(value))
    || (rule.odd && value % 2 !== 1)
  ) {
    throw new RangeError(`Shared state is outside safe bounds at ${path} for ${setupId}`);
  }
}

function assertExactObjectSchema(setupId, value, path, schema) {
  if (!isRecord(value)) throw new TypeError(`Shared state must contain an object at ${path}`);

  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(schema).sort();
  if (actualKeys.join(",") !== expectedKeys.join(",")) {
    throw new TypeError(`Shared state has unexpected or missing fields at ${path} for ${setupId}`);
  }
  for (const [key, rule] of Object.entries(schema)) {
    assertSchemaValue(setupId, `${path}.${key}`, value[key], rule);
  }
}

function assertParameterSchema(setupId, state) {
  const schema = PARAMETER_SCHEMAS[setupId];
  if (!schema) return;
  const container = PARAMETER_CONTAINERS[setupId] ?? "params";
  assertExactObjectSchema(setupId, state[container], `state.${container}`, schema);
}

function assertDynamicSchema(setupId, state) {
  const schema = DYNAMIC_SCHEMAS[setupId];
  if (!schema) return;
  assertExactObjectSchema(setupId, state.dynamics, "state.dynamics", schema);
}

function assertTopLevelSchema(setupId, state) {
  const schema = TOP_LEVEL_SCHEMAS[setupId];
  if (!schema) return;
  assertExactObjectSchema(setupId, state, "state", schema);
}

function assertState(setupId, state) {
  assertSetupId(setupId);
  if (!isRecord(state)) throw new TypeError("Shared state payload must be an object");
  for (const key of ["params", "parameters", "dynamics"]) {
    if (Object.hasOwn(state, key) && !isRecord(state[key])) {
      throw new TypeError(`Shared state ${key} must be an object`);
    }
  }
  assertJsonTree(state, "state", 0, { nodes: 0 });
  assertTopLevelSchema(setupId, state);
  assertParameterSchema(setupId, state);
  assertDynamicSchema(setupId, state);
}

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeUtf8Base64(encoded) {
  if (
    !encoded
    || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new TypeError("Shared state is not valid base64");
  }
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeSharedState(setupId, state) {
  assertState(setupId, state);
  const encoded = encodeUtf8Base64(JSON.stringify({
    version: SHARED_STATE_VERSION,
    setupId,
    state,
  }));
  if (encoded.length > MAX_SHARED_STATE_FRAGMENT_LENGTH) {
    throw new RangeError("Shared state is too large");
  }
  return encoded;
}

export function decodeSharedState(encoded, expectedSetupId) {
  assertSetupId(expectedSetupId);
  if (typeof encoded !== "string" || encoded.length > MAX_SHARED_STATE_FRAGMENT_LENGTH) {
    throw new RangeError("Shared state fragment is too large");
  }

  const envelope = JSON.parse(decodeUtf8Base64(encoded));
  if (!isRecord(envelope)) throw new TypeError("Shared state envelope must be an object");
  const keys = Object.keys(envelope).sort();
  if (keys.join(",") !== "setupId,state,version") {
    throw new TypeError("Shared state envelope has unexpected fields");
  }
  if (envelope.version !== SHARED_STATE_VERSION) {
    throw new TypeError("Shared state version is not supported");
  }
  if (envelope.setupId !== expectedSetupId) {
    throw new TypeError("Shared state belongs to a different setup");
  }
  assertState(expectedSetupId, envelope.state);
  return envelope.state;
}
