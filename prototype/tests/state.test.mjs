import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeSharedState,
  encodeSharedState,
  MAX_SHARED_STATE_FRAGMENT_LENGTH,
  SHARED_STATE_VERSION,
} from "../assets/state.js";

function encodeRawJson(json) {
  return Buffer.from(json, "utf8").toString("base64");
}

const validParams = {
  ego: {
    population: 28,
    regeneration: 0.72,
    scarcity: 0.28,
    temptation: 0.24,
    visibility: 0.82,
    mutation: 0.02,
  },
  quantum: {
    momentum: 28,
    packetWidth: 0.105,
    barrierHeight: 175,
    barrierWidth: 0.075,
    barrierCenter: 0.1,
    barrierCount: 1,
    separation: 0.2,
    speed: 1,
  },
  noetic: {
    count: 96,
    coupling: 1.42,
    diversity: 1.1,
    noise: 0.045,
    radius: 0.22,
  },
  computation: {
    rule: 110,
    width: 161,
    density: 0.08,
    stepsPerSecond: 16,
    wrap: true,
    seedMode: "packet",
  },
  logistic: {
    demand: 3.2,
    capacity: 1,
    speed: 1,
    congestionWeight: 1.8,
    disruption: "none",
  },
  molecular: {
    count: 76,
    temperature: 0.78,
    attraction: 1.08,
    packing: 0.82,
    thermostat: 0.1,
    timeScale: 0.86,
    phase: "liquid",
  },
};

const validStrictStates = {
  pic: {
    version: 1,
    wavelengthNm: 1550,
    phasePi: 0,
    inputCoupling: 0.5,
    outputCoupling: 0.5,
    armLossDb: 0,
    pathDeltaUm: 0,
    inputPort: "0",
    inputPowerMw: 1,
  },
  electrical: {
    version: 1,
    preset: "tuned",
    parameters: {
      target: 0.78,
      kp: 1.9,
      ki: 0.72,
      kd: 0.075,
      latency: 24,
      noise: 0.008,
      plantTau: 240,
    },
    dynamics: {
      tick: 0,
      plant: 0.18,
      plantVelocity: 0,
      integral: 0,
      thermal: 0,
      perturbation: 0,
    },
  },
  biological: {
    version: 1,
    preset: "homeostasis",
    parameters: {
      condition: "healthy",
      microscopy: "phase",
      metabolism: 1,
      diffusion: 1,
      stress: 0.08,
      permeability: 0.12,
      pulseStrength: 0.62,
      organelles: true,
    },
    dynamics: {
      tick: 0,
      atp: 0.88,
      calcium: 0.12,
      caspase: 0.02,
      membrane: 0.98,
      cycle: 0.18,
      pulse: 0,
      pulseX: 0.5,
      pulseY: 0.5,
    },
  },
  gravity: {
    version: 1,
    preset: "coronagraph",
    parameters: {
      starMass: 1,
      planetMass: 1,
      semiMajor: 5.2,
      eccentricity: 0.05,
      inclination: 62,
      maskMas: 90,
      distancePc: 10,
      timeDays: 310,
      speed: 42,
    },
    observations: [],
  },
  "two-photon": {
    version: 1,
    powerMw: 10,
    waistUm: 0.55,
    scanSpeed: 2.4,
    diffusion: 0.045,
    threshold: 0.42,
    radicalLifetime: 0.75,
    scanMode: "stationary",
    autoScan: true,
    developed: false,
    focusX: 0,
    focusZ: 4,
    simulationTime: 0,
    field: "",
  },
};

test("shared state uses a versioned setup-bound envelope", () => {
  const state = {
    params: validParams.computation,
    row: "0010110",
    note: "deterministic µ-state",
  };
  const encoded = encodeSharedState("computation", state);
  assert.deepEqual(decodeSharedState(encoded, "computation"), state);

  const envelope = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.deepEqual(Object.keys(envelope).sort(), ["setupId", "state", "version"]);
  assert.equal(envelope.version, SHARED_STATE_VERSION);
  assert.equal(envelope.setupId, "computation");
});

test("shared state rejects cross-setup, legacy, and unknown-version payloads", () => {
  const encoded = encodeSharedState("pic", validStrictStates.pic);
  assert.throws(() => decodeSharedState(encoded, "quantum"), /different setup/);

  const legacy = encodeRawJson('{"wavelengthNm":1550}');
  assert.throws(() => decodeSharedState(legacy, "pic"), /unexpected fields/);

  const future = encodeRawJson(
    '{"version":2,"setupId":"pic","state":{"wavelengthNm":1550}}',
  );
  assert.throws(() => decodeSharedState(future, "pic"), /version is not supported/);
});

test("shared state rejects non-finite and resource-amplifying values", () => {
  assert.throws(
    () => encodeSharedState("pic", { wavelengthNm: Number.NaN }),
    /invalid number/,
  );
  assert.throws(
    () => encodeSharedState("ego", {
      params: { ...validParams.ego, population: 50_000 },
    }),
    /outside safe bounds/,
  );
  assert.throws(
    () => encodeSharedState("quantum", {
      params: { ...validParams.quantum, speed: 500 },
    }),
    /outside safe bounds/,
  );

  const craftedInfinity = encodeRawJson(
    '{"version":1,"setupId":"molecular","state":{"params":{"count":1e309}}}',
  );
  assert.throws(
    () => decodeSharedState(craftedInfinity, "molecular"),
    /invalid number/,
  );
});

test("merge-based setup parameters require exact types, enums, keys, and bounds", () => {
  for (const [setupId, params] of Object.entries(validParams)) {
    const encoded = encodeSharedState(setupId, { params });
    assert.deepEqual(decodeSharedState(encoded, setupId), { params });
  }

  for (const [setupId, key] of [
    ["noetic", "coupling"],
    ["computation", "rule"],
    ["logistic", "capacity"],
    ["molecular", "attraction"],
  ]) {
    assert.throws(
      () => encodeSharedState(setupId, {
        params: { ...validParams[setupId], [key]: "not-a-number" },
      }),
      /outside safe bounds/,
    );
  }

  assert.throws(
    () => encodeSharedState("computation", {
      params: { ...validParams.computation, wrap: "true" },
    }),
    /invalid boolean/,
  );
  assert.throws(
    () => encodeSharedState("molecular", {
      params: { ...validParams.molecular, phase: "plasma" },
    }),
    /invalid enum/,
  );
  assert.throws(
    () => encodeSharedState("ego", {
      params: { ...validParams.ego, hiddenMultiplier: 4 },
    }),
    /unexpected or missing (?:fields|parameters)/,
  );
});

test("flat and nested setup states reject type-confused, missing, and unknown fields", () => {
  for (const [setupId, state] of Object.entries(validStrictStates)) {
    const encoded = encodeSharedState(setupId, state);
    assert.deepEqual(decodeSharedState(encoded, setupId), state);
  }

  for (const [setupId, container, key] of [
    ["pic", null, "wavelengthNm"],
    ["electrical", "parameters", "kp"],
    ["biological", "parameters", "metabolism"],
    ["two-photon", null, "powerMw"],
  ]) {
    const state = structuredClone(validStrictStates[setupId]);
    if (container) state[container][key] = "x";
    else state[key] = "x";
    assert.throws(
      () => encodeSharedState(setupId, state),
      /outside safe bounds/,
    );
  }

  const missingPicField = structuredClone(validStrictStates.pic);
  delete missingPicField.wavelengthNm;
  assert.throws(
    () => encodeSharedState("pic", missingPicField),
    /unexpected or missing fields/,
  );

  const unknownElectricalParameter = structuredClone(validStrictStates.electrical);
  unknownElectricalParameter.parameters.hiddenGain = 2;
  assert.throws(
    () => encodeSharedState("electrical", unknownElectricalParameter),
    /unexpected or missing fields/,
  );
});

test("shared state enforces bounded fragments and nested JSON structures", () => {
  assert.throws(
    () => decodeSharedState("A".repeat(MAX_SHARED_STATE_FRAGMENT_LENGTH + 1), "pic"),
    /fragment is too large/,
  );
  assert.throws(
    () => encodeSharedState("pic", { value: "x".repeat(40_000) }),
    /string is too long/,
  );
  assert.throws(
    () => encodeSharedState("pic", { values: Array.from({ length: 513 }, () => 0) }),
    /array is too long/,
  );

  const representativeTwoPhotonField = "A".repeat(11_520);
  const encoded = encodeSharedState("two-photon", {
    ...validStrictStates["two-photon"],
    field: representativeTwoPhotonField,
  });
  assert.equal(
    decodeSharedState(encoded, "two-photon").field,
    representativeTwoPhotonField,
  );
});
