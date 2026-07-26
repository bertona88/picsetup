import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  opticalSetup,
  resolveSetup,
  setups,
  setupUrlForLocation,
  universeEntries,
} from "../assets/registry.js";

const expected = new Map([
  ["pic", "picsetup.com"],
  ["electrical", "electricalsetup.com"],
  ["biological", "biologicalsetup.com"],
  ["gravity", "gravitysetup.com"],
  ["two-photon", "twophotonlithography.com"],
  ["ego", "egosetup.com"],
  ["quantum", "quantumsetup.ai"],
  ["noetic", "noeticsetup.com"],
  ["computation", "computationsetup.com"],
  ["logistic", "logisticsetup.com"],
  ["molecular", "molecularsetup.com"],
]);

test("registry exposes exactly the eleven hosted setup modules", () => {
  assert.equal(setups.length, expected.size);
  assert.deepEqual(
    new Map(setups.map(({ id, host }) => [id, host])),
    expected,
  );
  assert.equal(new Set(setups.map(({ id }) => id)).size, setups.length);
  assert.equal(new Set(setups.map(({ host }) => host)).size, setups.length);
});

test("every setup has a playable-module contract", () => {
  for (const setup of setups) {
    assert.equal(typeof setup.mount, "function", `${setup.id}: missing mount`);
    assert.match(setup.name, /Setup|Lithography/, `${setup.id}: missing product name`);
    assert.ok(setup.field, `${setup.id}: missing field`);
    assert.match(setup.accent, /^#[0-9a-f]{6}$/i, `${setup.id}: invalid accent`);
    assert.ok(setup.summary?.length >= 40, `${setup.id}: summary is too thin`);
    assert.ok(setup.interaction?.length >= 30, `${setup.id}: interaction is too thin`);
    assert.ok(setup.scope?.length >= 40, `${setup.id}: scope is too thin`);
    assert.ok(setup.limits?.length >= 2, `${setup.id}: missing model limits`);
    assert.ok(setup.presets?.length >= 3, `${setup.id}: needs at least three experiments`);
    assert.equal(
      new Set(setup.presets.map(({ id }) => id)).size,
      setup.presets.length,
      `${setup.id}: duplicate preset`,
    );
  }
});

test("universe roster begins with OpticalSetup and contains twelve unique hops", () => {
  const entries = universeEntries();
  assert.equal(entries.length, 12);
  assert.equal(entries[0], opticalSetup);
  assert.equal(opticalSetup.url, "https://opticalsetup.com/sketch/");
  assert.equal(new Set(entries.map(({ host }) => host)).size, entries.length);
});

test("recognized setup hosts take precedence over preview query routing", () => {
  assert.equal(
    resolveSetup(new URL("https://www.electricalsetup.com/?setup=ego")).id,
    "electrical",
  );
  assert.equal(
    resolveSetup(new URL("http://127.0.0.1:4173/?setup=ego")).id,
    "ego",
  );
  assert.equal(
    resolveSetup(new URL("http://127.0.0.1:4173/?setup=unknown")).id,
    "pic",
  );
});

test("setup URLs preserve routing only on preview hosts", () => {
  const electrical = setups.find(({ id }) => id === "electrical");
  const canonical = setupUrlForLocation(
    "https://electricalsetup.com/?setup=ego&mode=lab#old",
    electrical,
  );
  assert.equal(canonical.searchParams.has("setup"), false);
  assert.equal(canonical.searchParams.get("mode"), "lab");

  const preview = setupUrlForLocation(
    "http://127.0.0.1:4173/?setup=ego&mode=lab#old",
    electrical,
  );
  assert.equal(preview.searchParams.get("setup"), "electrical");
  assert.equal(preview.searchParams.get("mode"), "lab");
});

test("shell exposes the public browser-smoke contract", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const marker of [
    'data-testid="simulation-canvas"',
    'data-testid="play-toggle"',
    'data-testid="simulation-tick"',
    'data-testid="reset"',
    'id="experimentRail"',
    'id="simulationInspector"',
    'id="mobileGuideButton"',
    'id="mobileShareButton"',
    'id="mobileResetButton"',
    'id="universeDrawer"',
  ]) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("runtime fails loudly when a setup module cannot mount", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  assert.match(source, /model failed to initialize/);
  assert.match(source, /throw error/);
});
