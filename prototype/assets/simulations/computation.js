import {
  clamp,
  drawGrid,
  rgba,
  seededRandom,
} from "../ui.js";

const presets = {
  rule110: { rule: 110, width: 161, density: 0.08, stepsPerSecond: 16, wrap: true, seedMode: "packet" },
  rule30: { rule: 30, width: 161, density: 0.015, stepsPerSecond: 24, wrap: true, seedMode: "single" },
  rule90: { rule: 90, width: 161, density: 0.015, stepsPerSecond: 18, wrap: true, seedMode: "single" },
  traffic: { rule: 184, width: 161, density: 0.46, stepsPerSecond: 13, wrap: true, seedMode: "random" },
};

function binaryEntropy(row) {
  const active = row.reduce((sum, value) => sum + value, 0);
  const p = active / row.length;
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function blockDiversity(history, depth = 12) {
  const rows = history.slice(-depth);
  if (!rows.length) return 0;
  const blocks = new Set();
  for (const row of rows) {
    for (let index = 0; index <= row.length - 5; index += 1) {
      let code = 0;
      for (let bit = 0; bit < 5; bit += 1) code = (code << 1) | row[index + bit];
      blocks.add(code);
    }
  }
  return blocks.size / 32;
}

export const setup = {
  id: "computation",
  host: "computationsetup.com",
  name: "ComputationSetup",
  field: "Computational dynamics",
  experiment: "A machine made from one local rule",
  code: "CPU–10",
  accent: "#65d7ff",
  summary:
    "Paint one row of bits, then watch a tiny nearest-neighbor rule unfold into signals, collisions, order, or apparent randomness.",
  interaction:
    "Draw directly across the live frontier to change bits. Every stroke creates a new causal history from that row.",
  canvasHint: "Drag across the bright frontier: paint cells · Right click: erase · R: reset",
  scope:
    "This is an elementary one-dimensional cellular automaton. Each new cell depends only on its left, center, and right predecessors.",
  limits: [
    "Rule 110 is capable of universal computation, but this view does not decode glider programs.",
    "Entropy and block diversity describe the visible bit field, not algorithmic complexity.",
    "Discrete synchronous steps are exact for the selected Wolfram rule.",
  ],
  presets: [
    { id: "rule110", label: "Rule 110 computer", description: "Localized structures interact inside a universal rule." },
    { id: "rule30", label: "Rule 30 turbulence", description: "One bit opens into deterministic pseudo-randomness." },
    { id: "rule90", label: "Rule 90 crystal", description: "Pascal's triangle modulo two." },
    { id: "traffic", label: "Rule 184 traffic", description: "Bits behave as cars moving into empty cells." },
  ],

  mount(ctx) {
    const { canvas, controls, setTick, setMetrics, resizeCanvas, pointerPosition } = ctx;
    let params = { ...presets.rule110 };
    let current = new Uint8Array(params.width);
    let history = [];
    let random = seededRandom(10110);
    let running = true;
    let frame = 0;
    let tick = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let painting = false;
    let erase = false;
    const controlsByKey = {};

    function addControls() {
      controlsByKey.rule = ctx.createRange({
        id: "rule-number",
        label: "Rule",
        min: 0,
        max: 255,
        step: 1,
        value: params.rule,
        format: (value) => `Rule ${Math.round(value)}`,
        description: "Eight output bits define all possible three-cell neighborhoods.",
        onInput(value) {
          params.rule = Math.round(value);
          reset();
        },
      });
      controlsByKey.width = ctx.createRange({
        id: "lattice-width",
        label: "Lattice width",
        min: 65,
        max: 257,
        step: 16,
        value: params.width,
        format: (value) => `${Math.round(value)} cells`,
        onInput(value) {
          params.width = Math.round(value) | 1;
          reset();
        },
      });
      controlsByKey.stepsPerSecond = ctx.createRange({
        id: "clock-rate",
        label: "Clock rate",
        min: 1,
        max: 60,
        step: 1,
        value: params.stepsPerSecond,
        format: (value) => `${Math.round(value)} step/s`,
        onInput(value) {
          params.stepsPerSecond = Math.round(value);
        },
      });
      controlsByKey.density = ctx.createRange({
        id: "seed-density",
        label: "Random seed density",
        min: 0.01,
        max: 0.95,
        step: 0.01,
        value: params.density,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput(value) {
          params.density = value;
        },
      });
      controlsByKey.wrap = ctx.createToggle({
        id: "wrap-boundary",
        label: "Periodic boundary",
        checked: params.wrap,
        description: "Connect the left and right edges into a ring.",
        onChange(value) {
          params.wrap = value;
        },
      });
      ctx.createDivider("Frontier");
      ctx.createAction({
        id: "randomize-row",
        label: "Randomize current row",
        onClick() {
          for (let index = 0; index < current.length; index += 1) {
            current[index] = random() < params.density ? 1 : 0;
          }
          history = [current.slice()];
          tick = 0;
          draw();
        },
      });
      ctx.createAction({
        id: "step-once",
        label: "Advance exactly one step",
        quiet: true,
        onClick() {
          step();
          draw();
        },
      });
    }

    function seedRow() {
      current = new Uint8Array(params.width);
      if (params.seedMode === "single") {
        current[Math.floor(current.length / 2)] = 1;
      } else if (params.seedMode === "random") {
        for (let index = 0; index < current.length; index += 1) {
          current[index] = random() < params.density ? 1 : 0;
        }
      } else {
        const packet = "000100110111110001101001011";
        const start = Math.floor((current.length - packet.length) / 2);
        for (let index = 0; index < packet.length; index += 1) {
          current[start + index] = Number(packet[index]);
        }
      }
    }

    function reset() {
      random = seededRandom(10110);
      seedRow();
      history = [current.slice()];
      tick = 0;
      accumulator = 0;
      setTick(0);
      draw();
      updateMetrics();
    }

    function neighbor(index) {
      if (params.wrap) return current[(index + current.length) % current.length];
      if (index < 0 || index >= current.length) return 0;
      return current[index];
    }

    function step() {
      const next = new Uint8Array(current.length);
      for (let index = 0; index < current.length; index += 1) {
        const pattern = (neighbor(index - 1) << 2) | (neighbor(index) << 1) | neighbor(index + 1);
        next[index] = (params.rule >> pattern) & 1;
      }
      current = next;
      history.push(next.slice());
      const maxRows = 420;
      if (history.length > maxRows) history.shift();
      tick += 1;
      if (tick % 3 === 0) updateMetrics();
      setTick(tick);
    }

    function updateMetrics() {
      const active = current.reduce((sum, value) => sum + value, 0);
      let transitions = 0;
      for (let index = 1; index < current.length; index += 1) {
        if (current[index] !== current[index - 1]) transitions += 1;
      }
      const entropy = binaryEntropy(current);
      const diversity = blockDiversity(history);
      setMetrics([
        { id: "active", label: "Active cells", value: `${active} / ${current.length}`, tone: "accent" },
        { id: "entropy", label: "Binary entropy", value: `${entropy.toFixed(3)} bit` },
        { id: "edges", label: "Frontier transitions", value: `${transitions}` },
        { id: "diversity", label: "5-bit block diversity", value: `${Math.round(diversity * 100)}%` },
        { id: "rule-bits", label: "Rule table", value: params.rule.toString(2).padStart(8, "0") },
      ]);
    }

    function draw() {
      const { context, width, height } = resizeCanvas();
      context.clearRect(0, 0, width, height);
      drawGrid(context, width, height, { spacing: 34, color: "rgba(255,255,255,.022)" });
      const top = 34;
      const bottom = 58;
      const visibleHeight = Math.max(10, height - top - bottom);
      const cellWidth = width / current.length;
      const rowHeight = Math.max(1.5, Math.min(5.2, cellWidth * 0.82));
      const visibleRows = Math.max(1, Math.floor(visibleHeight / rowHeight));
      const rows = history.slice(-visibleRows);
      const startY = top + Math.max(0, visibleHeight - rows.length * rowHeight);

      context.save();
      context.globalCompositeOperation = "lighter";
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const age = rowIndex / Math.max(1, rows.length - 1);
        const alpha = 0.18 + age * 0.78;
        const y = startY + rowIndex * rowHeight;
        for (let column = 0; column < row.length; column += 1) {
          if (!row[column]) continue;
          context.fillStyle = rgba(setup.accent, alpha);
          context.fillRect(column * cellWidth, y, Math.max(1, cellWidth - 0.35), Math.max(1, rowHeight - 0.35));
        }
      }
      context.restore();

      const frontierY = startY + Math.max(0, rows.length - 1) * rowHeight;
      context.fillStyle = "rgba(8,11,16,.88)";
      context.fillRect(0, frontierY - 2, width, rowHeight + 5);
      for (let column = 0; column < current.length; column += 1) {
        if (!current[column]) continue;
        context.fillStyle = setup.accent;
        context.shadowColor = setup.accent;
        context.shadowBlur = 7;
        context.fillRect(column * cellWidth, frontierY, Math.max(1, cellWidth - 0.25), Math.max(2, rowHeight));
      }
      context.shadowBlur = 0;
      context.strokeStyle = rgba(setup.accent, 0.45);
      context.beginPath();
      context.moveTo(0, frontierY + rowHeight + 3);
      context.lineTo(width, frontierY + rowHeight + 3);
      context.stroke();

      const bits = params.rule.toString(2).padStart(8, "0");
      const tableX = 18;
      const tableY = height - 31;
      context.font = "9px ui-monospace, monospace";
      context.fillStyle = "rgba(255,255,255,.38)";
      context.fillText("111 110 101 100 011 010 001 000", tableX, tableY - 11);
      context.fillStyle = setup.accent;
      context.fillText(bits.split("").join("   "), tableX + 7, tableY + 3);

      context.textAlign = "right";
      context.fillStyle = "rgba(255,255,255,.42)";
      context.fillText(`RULE ${params.rule} · GENERATION ${tick}`, width - 18, height - 19);
      context.textAlign = "left";
    }

    function editFrontier(event) {
      const point = pointerPosition(event);
      const index = clamp(Math.floor(point.nx * current.length), 0, current.length - 1);
      current[index] = erase ? 0 : 1;
      history = [current.slice()];
      tick = 0;
      setTick(0);
      updateMetrics();
      draw();
    }

    function onPointerDown(event) {
      painting = true;
      erase = event.button === 2 || event.ctrlKey || event.metaKey;
      canvas.setPointerCapture?.(event.pointerId);
      editFrontier(event);
    }

    function onPointerMove(event) {
      if (painting) editFrontier(event);
    }

    function onPointerUp(event) {
      painting = false;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    function loop(now) {
      if (!running) return;
      const delta = Math.min(100, now - lastTime);
      lastTime = now;
      accumulator += delta;
      const interval = 1000 / params.stepsPerSecond;
      while (accumulator >= interval) {
        step();
        accumulator -= interval;
      }
      draw();
      frame = requestAnimationFrame(loop);
    }

    function syncControls() {
      controlsByKey.rule.set(params.rule);
      controlsByKey.width.set(params.width);
      controlsByKey.stepsPerSecond.set(params.stepsPerSecond);
      controlsByKey.density.set(params.density);
      controlsByKey.wrap.set(params.wrap);
    }

    function applyPreset(id) {
      params = { ...(presets[id] || presets.rule110) };
      syncControls();
      reset();
    }

    function play() {
      if (running) return;
      running = true;
      lastTime = performance.now();
      frame = requestAnimationFrame(loop);
    }

    function pause() {
      running = false;
      cancelAnimationFrame(frame);
      draw();
    }

    addControls();
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    reset();
    frame = requestAnimationFrame(loop);

    return {
      reset,
      play,
      pause,
      applyPreset,
      getState() {
        return {
          params,
          row: Array.from(current).join(""),
        };
      },
      setState(state) {
        params = { ...params, ...(state?.params || {}) };
        syncControls();
        reset();
        if (typeof state?.row === "string" && state.row.length === current.length) {
          current = Uint8Array.from(state.row, (character) => (character === "1" ? 1 : 0));
          history = [current.slice()];
          draw();
        }
      },
      destroy() {
        running = false;
        cancelAnimationFrame(frame);
        observer.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
      },
    };
  },
};

