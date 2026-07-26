import assert from "node:assert/strict";
import test from "node:test";

import { setups } from "../assets/registry.js";
import { decodeSharedState, encodeSharedState } from "../assets/state.js";

function createDrawingContext(canvas) {
  const gradient = { addColorStop() {} };
  const target = {
    canvas,
    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    },
    createLinearGradient() {
      return gradient;
    },
    createRadialGradient() {
      return gradient;
    },
    getImageData(x, y, width, height) {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    },
    measureText(text) {
      return { width: String(text).length * 7 };
    },
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return () => {};
    },
  });
}

function createCanvas() {
  const canvas = {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const drawingContext = createDrawingContext(canvas);
  canvas.getContext = () => drawingContext;
  return canvas;
}

function installBrowserStubs() {
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    createElement(tagName) {
      if (tagName === "canvas") return createCanvas();
      return {};
    },
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}

function createMountContext() {
  const canvas = createCanvas();
  const createControl = () => ({ set() {}, get() {} });
  return {
    canvas,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    createAction() {
      return {};
    },
    createDivider() {},
    createRange: createControl,
    createSelect: createControl,
    createToggle: createControl,
    pointerPosition() {
      return { x: 400, y: 300, nx: 0.5, ny: 0.5 };
    },
    resizeCanvas() {
      return { context: canvas.getContext("2d"), width: 800, height: 600, dpr: 1 };
    },
    setMetrics() {},
    setStatus() {},
    setTick() {},
    showToast() {},
  };
}

test("live states from all eleven mounted modules survive a shared-state roundtrip", () => {
  installBrowserStubs();

  for (const setup of setups) {
    const simulation = setup.mount(createMountContext());
    simulation.pause();
    const state = simulation.getState();
    const encoded = encodeSharedState(setup.id, state);
    assert.deepEqual(decodeSharedState(encoded, setup.id), state, setup.id);
    simulation.destroy();
  }
});
