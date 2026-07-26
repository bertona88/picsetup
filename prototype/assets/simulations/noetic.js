import {
  clamp,
  drawGrid,
  makeHistory,
  rgba,
  seededRandom,
} from "../ui.js";

const TAU = Math.PI * 2;

const presets = {
  drift: { count: 84, coupling: 0.25, diversity: 1.35, noise: 0.09, radius: 0.19 },
  threshold: { count: 96, coupling: 1.42, diversity: 1.1, noise: 0.045, radius: 0.22 },
  coherence: { count: 104, coupling: 3.15, diversity: 0.72, noise: 0.018, radius: 0.28 },
  chimera: { count: 120, coupling: 2.05, diversity: 1.42, noise: 0.025, radius: 0.16 },
};

function circularMean(oscillators) {
  let real = 0;
  let imaginary = 0;
  for (const oscillator of oscillators) {
    real += Math.cos(oscillator.phase);
    imaginary += Math.sin(oscillator.phase);
  }
  real /= oscillators.length || 1;
  imaginary /= oscillators.length || 1;
  return {
    order: Math.hypot(real, imaginary),
    phase: Math.atan2(imaginary, real),
  };
}

export const setup = {
  id: "noetic",
  defaultPreset: "threshold",
  host: "noeticsetup.com",
  name: "NoeticSetup",
  field: "Collective dynamics",
  experiment: "When many clocks become one",
  code: "NOE–09",
  accent: "#be8cff",
  summary:
    "A local Kuramoto field for exploring the boundary between independent rhythms and collective coherence.",
  interaction:
    "Press and drag through the field to deliver a phase pulse. Watch whether the perturbation entrains its neighbors or dissolves.",
  canvasHint: "Drag: phase pulse · Shift-drag: anti-phase pulse · Space: pause",
  scope:
    "This is a network of noisy coupled oscillators, a standard model of synchronization. It visualizes coherence—not consciousness.",
  limits: [
    "Oscillators interact only inside the selected neighborhood radius.",
    "Natural frequencies are sampled from a fixed seeded distribution.",
    "The order parameter measures phase alignment and carries no cognitive interpretation.",
  ],
  presets: [
    { id: "drift", label: "Private rhythms", description: "Weak coupling leaves phases largely independent." },
    { id: "threshold", label: "Edge of coherence", description: "Clusters appear and disappear near transition." },
    { id: "coherence", label: "Shared tempo", description: "Strong coupling entrains almost the entire field." },
    { id: "chimera", label: "Chimera field", description: "Local islands synchronize inside a drifting sea." },
  ],

  mount(ctx) {
    const { canvas, controls, setTick, setMetrics, resizeCanvas, pointerPosition } = ctx;
    let params = { ...presets.threshold };
    let oscillators = [];
    let random = seededRandom(9109);
    let running = true;
    let frame = 0;
    let tick = 0;
    let lastTime = performance.now();
    let pulse = null;
    const coherenceHistory = makeHistory(180, 0);
    const controlsByKey = {};

    function addControls() {
      controlsByKey.count = ctx.createRange({
        id: "oscillators",
        label: "Oscillators",
        min: 36,
        max: 180,
        step: 4,
        value: params.count,
        format: (value) => `${Math.round(value)} nodes`,
        onInput(value) {
          params.count = Math.round(value);
          reset();
        },
      });
      controlsByKey.coupling = ctx.createRange({
        id: "coupling",
        label: "Coupling K",
        min: 0,
        max: 4.5,
        step: 0.01,
        value: params.coupling,
        format: (value) => Number(value).toFixed(2),
        description: "Pull toward neighbors' phase; the transition emerges rather than being scripted.",
        onInput(value) {
          params.coupling = value;
        },
      });
      controlsByKey.diversity = ctx.createRange({
        id: "diversity",
        label: "Frequency diversity",
        min: 0.05,
        max: 2,
        step: 0.01,
        value: params.diversity,
        format: (value) => `${Number(value).toFixed(2)} σ`,
        onInput(value) {
          params.diversity = value;
          for (const oscillator of oscillators) oscillator.omega = oscillator.baseOmega * value;
        },
      });
      controlsByKey.noise = ctx.createRange({
        id: "noise",
        label: "Phase noise",
        min: 0,
        max: 0.2,
        step: 0.001,
        value: params.noise,
        format: (value) => Number(value).toFixed(3),
        onInput(value) {
          params.noise = value;
        },
      });
      controlsByKey.radius = ctx.createRange({
        id: "radius",
        label: "Neighborhood radius",
        min: 0.08,
        max: 0.42,
        step: 0.005,
        value: params.radius,
        format: (value) => `${Math.round(value * 100)}% field`,
        onInput(value) {
          params.radius = value;
        },
      });
      ctx.createDivider("Perturbation");
      ctx.createAction({
        id: "global-pulse",
        label: "Deliver global phase reset",
        onClick() {
          for (const oscillator of oscillators) {
            oscillator.phase = random() * 0.35;
            oscillator.flash = 1;
          }
        },
      });
    }

    function reset() {
      random = seededRandom(9109);
      oscillators = Array.from({ length: params.count }, (_, index) => {
        const angle = index * 2.399963229728653 + random() * 0.25;
        const radius = Math.sqrt((index + 0.5) / params.count) * 0.43;
        let gaussian = 0;
        for (let sample = 0; sample < 6; sample += 1) gaussian += random();
        gaussian = (gaussian - 3) / 0.72;
        return {
          x: 0.5 + Math.cos(angle) * radius,
          y: 0.5 + Math.sin(angle) * radius,
          phase: random() * TAU,
          baseOmega: gaussian,
          omega: gaussian * params.diversity,
          flash: 0,
        };
      });
      tick = 0;
      pulse = null;
      coherenceHistory.reset(0);
      setTick(0);
      draw();
    }

    function update(dt) {
      const next = new Float64Array(oscillators.length);
      let meanNeighbors = 0;
      for (let i = 0; i < oscillators.length; i += 1) {
        const source = oscillators[i];
        let coupling = 0;
        let neighbors = 0;
        for (let j = 0; j < oscillators.length; j += 1) {
          if (i === j) continue;
          const target = oscillators[j];
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.hypot(dx, dy);
          if (distance > params.radius) continue;
          const weight = 1 - distance / params.radius;
          coupling += Math.sin(target.phase - source.phase) * weight;
          neighbors += weight;
        }
        meanNeighbors += neighbors;
        const interaction = neighbors > 0 ? params.coupling * (coupling / neighbors) : 0;
        const stochastic = (random() - 0.5) * params.noise * Math.sqrt(Math.max(dt, 0.001)) * 7;
        next[i] = source.phase + (source.omega + interaction) * dt + stochastic;
      }
      for (let index = 0; index < oscillators.length; index += 1) {
        oscillators[index].phase = ((next[index] % TAU) + TAU) % TAU;
        oscillators[index].flash *= 0.93;
      }
      tick += 1;
      const mean = circularMean(oscillators);
      coherenceHistory.push(mean.order);

      if (tick % 7 === 0) {
        const phaseVariance =
          oscillators.reduce((sum, oscillator) => {
            const wrapped = Math.atan2(
              Math.sin(oscillator.phase - mean.phase),
              Math.cos(oscillator.phase - mean.phase),
            );
            return sum + wrapped * wrapped;
          }, 0) / oscillators.length;
        setMetrics([
          { id: "order", label: "Coherence R", value: mean.order.toFixed(3), tone: "accent" },
          { id: "phase", label: "Collective phase", value: `${(((mean.phase + TAU) % TAU) * 180 / Math.PI).toFixed(1)}°` },
          { id: "spread", label: "Circular spread", value: Math.sqrt(phaseVariance).toFixed(3) },
          { id: "neighbors", label: "Mean weighted degree", value: (meanNeighbors / oscillators.length).toFixed(1) },
          {
            id: "regime",
            label: "Observed regime",
            value: mean.order > 0.78 ? "entrained" : mean.order > 0.38 ? "clustered" : "incoherent",
          },
        ]);
      }
      setTick(tick);
    }

    function phaseColor(phase, alpha = 1) {
      const hue = ((phase / TAU) * 300 + 205) % 360;
      return `hsla(${hue}, 82%, 67%, ${alpha})`;
    }

    function draw() {
      const { context, width, height } = resizeCanvas();
      context.clearRect(0, 0, width, height);
      drawGrid(context, width, height, { spacing: 38, color: "rgba(255,255,255,.027)" });

      const mean = circularMean(oscillators);
      context.save();
      context.globalCompositeOperation = "lighter";
      for (let i = 0; i < oscillators.length; i += 1) {
        const source = oscillators[i];
        const sx = source.x * width;
        const sy = source.y * height;
        for (let j = i + 1; j < oscillators.length; j += 1) {
          const target = oscillators[j];
          const distance = Math.hypot(target.x - source.x, target.y - source.y);
          if (distance > params.radius) continue;
          const alignment = (Math.cos(target.phase - source.phase) + 1) * 0.5;
          if (alignment < 0.72) continue;
          context.beginPath();
          context.moveTo(sx, sy);
          context.lineTo(target.x * width, target.y * height);
          context.strokeStyle = phaseColor((source.phase + target.phase) * 0.5, (alignment - 0.7) * 0.12);
          context.lineWidth = 0.7;
          context.stroke();
        }
      }
      context.restore();

      for (const oscillator of oscillators) {
        const x = oscillator.x * width;
        const y = oscillator.y * height;
        const color = phaseColor(oscillator.phase);
        context.beginPath();
        context.arc(x, y, 4 + oscillator.flash * 6, 0, TAU);
        context.fillStyle = phaseColor(oscillator.phase, 0.04 + oscillator.flash * 0.12);
        context.fill();
        context.beginPath();
        context.arc(x, y, 3.1, 0, TAU);
        context.fillStyle = color;
        context.shadowColor = color;
        context.shadowBlur = 4 + mean.order * 7;
        context.fill();
        context.shadowBlur = 0;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(oscillator.phase) * 8, y + Math.sin(oscillator.phase) * 8);
        context.strokeStyle = phaseColor(oscillator.phase, 0.7);
        context.lineWidth = 1;
        context.stroke();
      }

      const phasorX = 60;
      const phasorY = height - 67;
      const phasorRadius = 30;
      context.beginPath();
      context.arc(phasorX, phasorY, phasorRadius, 0, TAU);
      context.strokeStyle = "rgba(255,255,255,.13)";
      context.stroke();
      context.beginPath();
      context.moveTo(phasorX, phasorY);
      context.lineTo(
        phasorX + Math.cos(mean.phase) * phasorRadius * mean.order,
        phasorY + Math.sin(mean.phase) * phasorRadius * mean.order,
      );
      context.strokeStyle = setup.accent;
      context.lineWidth = 2;
      context.shadowColor = setup.accent;
      context.shadowBlur = 8;
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = "rgba(255,255,255,.45)";
      context.font = "9px ui-monospace, monospace";
      context.fillText("ORDER PARAMETER", 20, phasorY - 42);

      const chartWidth = Math.min(250, width * 0.36);
      const chartHeight = 42;
      const chartX = width - chartWidth - 18;
      const chartY = height - chartHeight - 36;
      context.fillStyle = "rgba(255,255,255,.38)";
      context.fillText("COHERENCE HISTORY", chartX, chartY - 8);
      context.beginPath();
      coherenceHistory.values.forEach((value, index) => {
        const x = chartX + (index / (coherenceHistory.values.length - 1)) * chartWidth;
        const y = chartY + chartHeight * (1 - value);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = setup.accent;
      context.lineWidth = 1.3;
      context.stroke();
      context.strokeStyle = "rgba(255,255,255,.08)";
      context.strokeRect(chartX, chartY, chartWidth, chartHeight);

      if (pulse) {
        context.beginPath();
        context.ellipse(
          pulse.x * width,
          pulse.y * height,
          pulse.radius * width,
          pulse.radius * height,
          0,
          0,
          TAU,
        );
        context.strokeStyle = rgba(setup.accent, 0.35);
        context.stroke();
      }
    }

    function perturb(event) {
      const point = pointerPosition(event);
      const anti = event.shiftKey;
      const targetPhase = anti ? Math.PI : 0;
      const radius = 0.11;
      for (const oscillator of oscillators) {
        const distance = Math.hypot(oscillator.x - point.nx, oscillator.y - point.ny);
        if (distance > radius) continue;
        const strength = 1 - distance / radius;
        const delta = Math.atan2(
          Math.sin(targetPhase - oscillator.phase),
          Math.cos(targetPhase - oscillator.phase),
        );
        oscillator.phase += delta * strength * 0.72;
        oscillator.flash = Math.max(oscillator.flash, strength);
      }
      pulse = { x: point.nx, y: point.ny, radius };
      draw();
    }

    let dragging = false;
    function onPointerDown(event) {
      dragging = true;
      canvas.setPointerCapture?.(event.pointerId);
      perturb(event);
    }
    function onPointerMove(event) {
      if (dragging) perturb(event);
    }
    function onPointerUp(event) {
      dragging = false;
      canvas.releasePointerCapture?.(event.pointerId);
      pulse = null;
    }

    function loop(now) {
      if (!running) return;
      const dt = Math.min(0.035, Math.max(0.004, (now - lastTime) / 1000));
      lastTime = now;
      update(dt * 2.4);
      draw();
      frame = requestAnimationFrame(loop);
    }

    function syncControls() {
      for (const [key, control] of Object.entries(controlsByKey)) control.set(params[key]);
    }

    function applyPreset(id) {
      params = { ...(presets[id] || presets.threshold) };
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
      getState: () => ({ params }),
      setState(state) {
        params = { ...params, ...(state?.params || {}) };
        syncControls();
        reset();
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
