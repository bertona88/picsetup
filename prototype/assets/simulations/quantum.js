import {
  clamp,
  drawGrid,
  rgba,
  seededRandom,
} from "../ui.js";

const SIZE = 256;
const DOMAIN = 2;
const DX = DOMAIN / SIZE;
const TAU = Math.PI * 2;

const presets = {
  tunnel: {
    momentum: 28,
    packetWidth: 0.105,
    barrierHeight: 175,
    barrierWidth: 0.075,
    barrierCenter: 0.1,
    barrierCount: 1,
    separation: 0.2,
    speed: 1,
  },
  resonant: {
    momentum: 25,
    packetWidth: 0.12,
    barrierHeight: 230,
    barrierWidth: 0.038,
    barrierCenter: 0.12,
    barrierCount: 2,
    separation: 0.19,
    speed: 0.9,
  },
  split: {
    momentum: 33,
    packetWidth: 0.085,
    barrierHeight: 95,
    barrierWidth: 0.045,
    barrierCenter: 0.02,
    barrierCount: 1,
    separation: 0.2,
    speed: 1.1,
  },
  free: {
    momentum: 20,
    packetWidth: 0.095,
    barrierHeight: 0,
    barrierWidth: 0.05,
    barrierCenter: 0,
    barrierCount: 0,
    separation: 0.2,
    speed: 1.15,
  },
};

function fft(real, imaginary, inverse = false) {
  const length = real.length;
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }

  for (let span = 2; span <= length; span <<= 1) {
    const angle = (inverse ? TAU : -TAU) / span;
    const wLengthReal = Math.cos(angle);
    const wLengthImag = Math.sin(angle);
    for (let start = 0; start < length; start += span) {
      let wReal = 1;
      let wImag = 0;
      for (let offset = 0; offset < span / 2; offset += 1) {
        const even = start + offset;
        const odd = even + span / 2;
        const oddReal = real[odd] * wReal - imaginary[odd] * wImag;
        const oddImag = real[odd] * wImag + imaginary[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImag;
        real[even] += oddReal;
        imaginary[even] += oddImag;
        const nextWReal = wReal * wLengthReal - wImag * wLengthImag;
        wImag = wReal * wLengthImag + wImag * wLengthReal;
        wReal = nextWReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

export const setup = {
  id: "quantum",
  host: "quantumsetup.ai",
  name: "QuantumSetup",
  field: "Wave mechanics",
  experiment: "A wavepacket meets a barrier",
  code: "QNT–08",
  accent: "#80a2ff",
  summary:
    "Evolve a complex quantum wavepacket through free space, barriers, and a resonant cavity with a unitary split-step solver.",
  interaction:
    "Drag horizontally to move the barrier. Release, then watch reflection, tunnelling, phase winding, and packet spreading emerge.",
  canvasHint: "Drag: move potential barrier · Measure button: sample and collapse position",
  scope:
    "The canvas solves a dimensionless one-dimensional time-dependent Schrödinger equation using Fourier split-step propagation.",
  limits: [
    "The model is one-dimensional, non-relativistic, and uses a periodic numerical grid with soft absorbing edges.",
    "Position measurement is an idealized projective sample followed by a narrow Gaussian reset.",
    "Displayed energies use reduced units; they are not calibrated to a laboratory particle.",
  ],
  presets: [
    { id: "tunnel", label: "Single barrier", description: "Tune energy and width to cross classically forbidden space." },
    { id: "resonant", label: "Resonant cavity", description: "Two barriers admit narrow transmission resonances." },
    { id: "split", label: "Quantum beam splitter", description: "A lower barrier separates reflected and transmitted lobes." },
    { id: "free", label: "Free packet", description: "Observe dispersion with no external potential." },
  ],

  mount(ctx) {
    const { canvas, controls, setTick, setMetrics, resizeCanvas, pointerPosition } = ctx;
    let params = { ...presets.tunnel };
    const real = new Float64Array(SIZE);
    const imaginary = new Float64Array(SIZE);
    const potential = new Float64Array(SIZE);
    let random = seededRandom(8088);
    let running = true;
    let frame = 0;
    let tick = 0;
    let elapsed = 0;
    let lastTime = performance.now();
    let dragging = false;
    let measuredAt = null;
    const controlsByKey = {};

    function xAt(index) {
      return -1 + (index + 0.5) * DX;
    }

    function rebuildPotential() {
      potential.fill(0);
      if (params.barrierCount === 0 || params.barrierHeight <= 0) return;
      const centers =
        params.barrierCount === 2
          ? [
              params.barrierCenter - params.separation * 0.5,
              params.barrierCenter + params.separation * 0.5,
            ]
          : [params.barrierCenter];
      for (let index = 0; index < SIZE; index += 1) {
        const x = xAt(index);
        for (const center of centers) {
          const edge = Math.abs(x - center) - params.barrierWidth * 0.5;
          const smooth = 1 / (1 + Math.exp(edge * 260));
          potential[index] += params.barrierHeight * smooth;
        }
      }
    }

    function normalize() {
      let norm = 0;
      for (let index = 0; index < SIZE; index += 1) {
        norm += (real[index] * real[index] + imaginary[index] * imaginary[index]) * DX;
      }
      const scale = norm > 1e-14 ? 1 / Math.sqrt(norm) : 1;
      for (let index = 0; index < SIZE; index += 1) {
        real[index] *= scale;
        imaginary[index] *= scale;
      }
      return norm;
    }

    function preparePacket(center = -0.58, momentum = params.momentum, width = params.packetWidth) {
      for (let index = 0; index < SIZE; index += 1) {
        const x = xAt(index);
        const envelope = Math.exp(-((x - center) ** 2) / (4 * width * width));
        const phase = momentum * x;
        real[index] = envelope * Math.cos(phase);
        imaginary[index] = envelope * Math.sin(phase);
      }
      normalize();
    }

    function addControls() {
      controlsByKey.momentum = ctx.createRange({
        id: "packet-momentum",
        label: "Incident momentum k₀",
        min: 5,
        max: 52,
        step: 0.5,
        value: params.momentum,
        format: (value) => `${Number(value).toFixed(1)} ℏ/L`,
        description: "Kinetic energy scales as k²/2 in these reduced units.",
        onInput(value) {
          params.momentum = value;
          reset();
        },
      });
      controlsByKey.packetWidth = ctx.createRange({
        id: "packet-width",
        label: "Packet width σ",
        min: 0.045,
        max: 0.22,
        step: 0.005,
        value: params.packetWidth,
        format: (value) => Number(value).toFixed(3),
        onInput(value) {
          params.packetWidth = value;
          reset();
        },
      });
      controlsByKey.barrierHeight = ctx.createRange({
        id: "barrier-height",
        label: "Barrier potential V",
        min: 0,
        max: 420,
        step: 2,
        value: params.barrierHeight,
        format: (value) => `${Math.round(value)} E₀`,
        onInput(value) {
          params.barrierHeight = value;
          rebuildPotential();
          draw();
        },
      });
      controlsByKey.barrierWidth = ctx.createRange({
        id: "barrier-width",
        label: "Barrier width",
        min: 0.015,
        max: 0.22,
        step: 0.005,
        value: params.barrierWidth,
        format: (value) => `${Number(value).toFixed(3)} L`,
        onInput(value) {
          params.barrierWidth = value;
          rebuildPotential();
          draw();
        },
      });
      controlsByKey.separation = ctx.createRange({
        id: "barrier-separation",
        label: "Cavity separation",
        min: 0.06,
        max: 0.52,
        step: 0.01,
        value: params.separation,
        format: (value) => `${Number(value).toFixed(2)} L`,
        onInput(value) {
          params.separation = value;
          rebuildPotential();
          draw();
        },
      });
      controlsByKey.speed = ctx.createRange({
        id: "time-scale",
        label: "Propagation speed",
        min: 0.2,
        max: 2,
        step: 0.05,
        value: params.speed,
        format: (value) => `${Number(value).toFixed(2)}×`,
        onInput(value) {
          params.speed = value;
        },
      });
      ctx.createDivider("Observation");
      ctx.createAction({
        id: "measure-position",
        label: "Measure position once",
        onClick: measurePosition,
      });
    }

    function reset() {
      random = seededRandom(8088);
      rebuildPotential();
      preparePacket();
      measuredAt = null;
      tick = 0;
      elapsed = 0;
      setTick(0);
      updateMetrics();
      draw();
    }

    function applyPotentialPhase(dtHalf) {
      for (let index = 0; index < SIZE; index += 1) {
        const angle = -potential[index] * dtHalf;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const nextReal = real[index] * cosine - imaginary[index] * sine;
        imaginary[index] = real[index] * sine + imaginary[index] * cosine;
        real[index] = nextReal;
      }
    }

    function propagate(dt) {
      applyPotentialPhase(dt * 0.5);
      fft(real, imaginary, false);
      for (let index = 0; index < SIZE; index += 1) {
        const mode = index <= SIZE / 2 ? index : index - SIZE;
        const waveNumber = TAU * mode / DOMAIN;
        const angle = -0.5 * waveNumber * waveNumber * dt;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const nextReal = real[index] * cosine - imaginary[index] * sine;
        imaginary[index] = real[index] * sine + imaginary[index] * cosine;
        real[index] = nextReal;
      }
      fft(real, imaginary, true);
      applyPotentialPhase(dt * 0.5);

      for (let index = 0; index < SIZE; index += 1) {
        const edge = Math.max(0, (Math.abs(xAt(index)) - 0.88) / 0.12);
        if (edge <= 0) continue;
        const damping = Math.exp(-0.018 * edge * edge);
        real[index] *= damping;
        imaginary[index] *= damping;
      }
      tick += 1;
      elapsed += dt;
      if (tick % 20 === 0) updateMetrics();
      setTick(tick);
    }

    function probabilities() {
      let norm = 0;
      let mean = 0;
      let meanSquare = 0;
      let left = 0;
      let right = 0;
      for (let index = 0; index < SIZE; index += 1) {
        const probability = (real[index] ** 2 + imaginary[index] ** 2) * DX;
        const x = xAt(index);
        norm += probability;
        mean += probability * x;
        meanSquare += probability * x * x;
        if (x < params.barrierCenter - params.barrierWidth) left += probability;
        if (x > params.barrierCenter + params.barrierWidth) right += probability;
      }
      mean /= norm || 1;
      meanSquare /= norm || 1;
      return {
        norm,
        mean,
        spread: Math.sqrt(Math.max(0, meanSquare - mean * mean)),
        left,
        right,
      };
    }

    function updateMetrics() {
      const stats = probabilities();
      const energy = 0.5 * params.momentum * params.momentum;
      setMetrics([
        { id: "norm", label: "Survival probability", value: stats.norm.toFixed(4), tone: "accent" },
        { id: "mean", label: "Mean position ⟨x⟩", value: stats.mean.toFixed(3) },
        { id: "spread", label: "Position spread Δx", value: stats.spread.toFixed(3) },
        { id: "reflection", label: "Left probability", value: `${(stats.left * 100).toFixed(1)}%` },
        { id: "transmission", label: "Right probability", value: `${(stats.right * 100).toFixed(1)}%` },
        { id: "energy", label: "Incident E = k²/2", value: energy.toFixed(1) },
        { id: "time", label: "Model time", value: elapsed.toFixed(3) },
      ]);
    }

    function measurePosition() {
      let total = 0;
      const cumulative = new Float64Array(SIZE);
      for (let index = 0; index < SIZE; index += 1) {
        total += (real[index] ** 2 + imaginary[index] ** 2) * DX;
        cumulative[index] = total;
      }
      let drawValue = random() * total;
      let sampleIndex = 0;
      while (sampleIndex < SIZE - 1 && cumulative[sampleIndex] < drawValue) sampleIndex += 1;
      measuredAt = xAt(sampleIndex);
      preparePacket(measuredAt, 0, 0.033);
      ctx.showToast(`Measured x = ${measuredAt.toFixed(3)}`);
      updateMetrics();
      draw();
    }

    function phaseColor(realPart, imaginaryPart, alpha) {
      const phase = Math.atan2(imaginaryPart, realPart);
      const hue = ((phase / TAU) * 300 + 225 + 360) % 360;
      return `hsla(${hue}, 90%, 67%, ${alpha})`;
    }

    function draw() {
      const { context, width, height } = resizeCanvas();
      context.clearRect(0, 0, width, height);
      drawGrid(context, width, height, { spacing: 36, color: "rgba(255,255,255,.028)" });

      const baseline = height * 0.7;
      const amplitudeScale = height * 0.48;
      const potentialScale = height * 0.35 / 420;

      context.beginPath();
      for (let index = 0; index < SIZE; index += 1) {
        const x = (index / (SIZE - 1)) * width;
        const y = baseline - potential[index] * potentialScale;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.lineTo(width, baseline);
      context.lineTo(0, baseline);
      context.closePath();
      context.fillStyle = rgba(setup.accent, 0.07);
      context.fill();
      context.strokeStyle = rgba(setup.accent, 0.42);
      context.lineWidth = 1;
      context.stroke();

      let maxDensity = 0;
      for (let index = 0; index < SIZE; index += 1) {
        maxDensity = Math.max(maxDensity, real[index] ** 2 + imaginary[index] ** 2);
      }
      const densityScale = amplitudeScale / Math.max(0.2, maxDensity);

      context.beginPath();
      for (let index = 0; index < SIZE; index += 1) {
        const density = real[index] ** 2 + imaginary[index] ** 2;
        const x = (index / (SIZE - 1)) * width;
        const y = baseline - density * densityScale;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.lineTo(width, baseline);
      context.lineTo(0, baseline);
      context.closePath();
      const gradient = context.createLinearGradient(0, baseline - amplitudeScale, 0, baseline);
      gradient.addColorStop(0, rgba(setup.accent, 0.3));
      gradient.addColorStop(1, rgba(setup.accent, 0.025));
      context.fillStyle = gradient;
      context.fill();

      context.save();
      context.lineWidth = Math.max(1.2, width / SIZE * 0.8);
      context.globalCompositeOperation = "lighter";
      for (let index = 0; index < SIZE - 1; index += 1) {
        const density = real[index] ** 2 + imaginary[index] ** 2;
        const nextDensity = real[index + 1] ** 2 + imaginary[index + 1] ** 2;
        const x1 = (index / (SIZE - 1)) * width;
        const x2 = ((index + 1) / (SIZE - 1)) * width;
        context.beginPath();
        context.moveTo(x1, baseline - density * densityScale);
        context.lineTo(x2, baseline - nextDensity * densityScale);
        context.strokeStyle = phaseColor(real[index], imaginary[index], 0.65 + clamp(density / maxDensity, 0, 1) * 0.35);
        context.stroke();
      }
      context.restore();

      context.beginPath();
      context.moveTo(0, baseline + 0.5);
      context.lineTo(width, baseline + 0.5);
      context.strokeStyle = "rgba(255,255,255,.17)";
      context.stroke();

      const barrierX = ((params.barrierCenter + 1) / 2) * width;
      context.beginPath();
      context.moveTo(barrierX, 25);
      context.lineTo(barrierX, height - 36);
      context.strokeStyle = rgba(setup.accent, dragging ? 0.72 : 0.16);
      context.setLineDash([3, 5]);
      context.stroke();
      context.setLineDash([]);

      if (measuredAt !== null) {
        const measuredX = ((measuredAt + 1) / 2) * width;
        context.beginPath();
        context.moveTo(measuredX, 36);
        context.lineTo(measuredX, baseline);
        context.strokeStyle = "rgba(255,255,255,.32)";
        context.stroke();
        context.fillStyle = "rgba(255,255,255,.55)";
        context.font = "9px ui-monospace, monospace";
        context.fillText(`MEASURED x ${measuredAt.toFixed(3)}`, measuredX + 6, 47);
      }

      context.fillStyle = "rgba(255,255,255,.45)";
      context.font = "9px ui-monospace, monospace";
      context.fillText("PROBABILITY DENSITY |ψ|² · PHASE ENCODED BY COLOR", 16, 23);
      context.textAlign = "right";
      context.fillText("x = −1", 48, baseline + 18);
      context.fillText("x = +1", width - 12, baseline + 18);
      context.textAlign = "left";
    }

    function moveBarrier(event) {
      const point = pointerPosition(event);
      params.barrierCenter = clamp(point.nx * 2 - 1, -0.65, 0.65);
      rebuildPotential();
      draw();
    }

    function onPointerDown(event) {
      dragging = true;
      canvas.setPointerCapture?.(event.pointerId);
      moveBarrier(event);
    }
    function onPointerMove(event) {
      if (dragging) moveBarrier(event);
    }
    function onPointerUp(event) {
      dragging = false;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    function loop(now) {
      if (!running) return;
      const delta = Math.min(40, now - lastTime);
      lastTime = now;
      const substeps = Math.max(1, Math.round((delta / 16.67) * 4 * params.speed));
      const dt = 0.000055;
      for (let index = 0; index < substeps; index += 1) propagate(dt);
      draw();
      frame = requestAnimationFrame(loop);
    }

    function syncControls() {
      controlsByKey.momentum.set(params.momentum);
      controlsByKey.packetWidth.set(params.packetWidth);
      controlsByKey.barrierHeight.set(params.barrierHeight);
      controlsByKey.barrierWidth.set(params.barrierWidth);
      controlsByKey.separation.set(params.separation);
      controlsByKey.speed.set(params.speed);
    }

    function applyPreset(id) {
      params = { ...(presets[id] || presets.tunnel) };
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

