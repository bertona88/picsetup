const TAU = Math.PI * 2;
const REFERENCE_WAVELENGTH_NM = 1550;
const EFFECTIVE_INDEX = 2.42;
const GROUP_INDEX = 4.2;

const DEFAULTS = Object.freeze({
  wavelengthNm: 1550,
  phasePi: 0,
  inputCoupling: 0.5,
  outputCoupling: 0.5,
  armLossDb: 0,
  pathDeltaUm: 0,
  inputPort: "0",
  inputPowerMw: 1,
});

const PRESET_STATES = {
  balanced: DEFAULTS,
  quadrature: {
    ...DEFAULTS,
    phasePi: 0.5,
  },
  spectrometer: {
    ...DEFAULTS,
    phasePi: 0.18,
    pathDeltaUm: 5.4,
    inputCoupling: 0.5,
    outputCoupling: 0.5,
  },
  lossy: {
    ...DEFAULTS,
    phasePi: 0.72,
    inputCoupling: 0.42,
    outputCoupling: 0.64,
    armLossDb: 3.2,
    pathDeltaUm: 1.1,
  },
};

const complex = (re = 0, im = 0) => ({ re, im });
const add = (a, b) => complex(a.re + b.re, a.im + b.im);
const multiply = (a, b) => complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a, scalar) => complex(a.re * scalar, a.im * scalar);
const magnitudeSquared = (value) => value.re * value.re + value.im * value.im;
const phasor = (phase) => complex(Math.cos(phase), Math.sin(phase));

function couplingMatrix(vector, powerCoupling) {
  const cross = complex(0, Math.sqrt(powerCoupling));
  const through = Math.sqrt(1 - powerCoupling);
  return [
    add(scale(vector[0], through), multiply(cross, vector[1])),
    add(multiply(cross, vector[0]), scale(vector[1], through)),
  ];
}

function transfer(state, wavelengthNm = state.wavelengthNm) {
  const inputAmplitude = Math.sqrt(state.inputPowerMw);
  const input =
    state.inputPort === "1"
      ? [complex(0, 0), complex(inputAmplitude, 0)]
      : [complex(inputAmplitude, 0), complex(0, 0)];
  const split = couplingMatrix(input, state.inputCoupling);
  const pathPhase = (TAU * EFFECTIVE_INDEX * state.pathDeltaUm * 1000) / wavelengthNm;
  const heaterPhase = Math.PI * state.phasePi * (REFERENCE_WAVELENGTH_NM / wavelengthNm);
  const totalPhase = heaterPhase + pathPhase;
  const lowerAmplitude = 10 ** (-0.25 / 20);
  const upperAmplitude = 10 ** (-(0.25 + state.armLossDb) / 20);
  const arms = [
    multiply(scale(split[0], upperAmplitude), phasor(totalPhase)),
    scale(split[1], lowerAmplitude),
  ];
  const output = couplingMatrix(arms, state.outputCoupling);
  return {
    input,
    split,
    arms,
    output,
    powers: output.map(magnitudeSquared),
    armPowers: arms.map(magnitudeSquared),
    totalPhase,
    heaterPhase,
    pathPhase,
  };
}

function wrapPhase(value) {
  return ((value % TAU) + TAU) % TAU;
}

function db(value) {
  return 10 * Math.log10(Math.max(value, 1e-12));
}

function formatPower(value) {
  if (value >= 0.1) return `${value.toFixed(3)} mW`;
  if (value >= 0.001) return `${(value * 1000).toFixed(1)} µW`;
  return `${(value * 1e6).toFixed(1)} nW`;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawLabel(context, text, x, y, align = "left", color = "rgba(221,237,240,.58)") {
  context.fillStyle = color;
  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = align;
  context.fillText(text, x, y);
}

function waveguidePath(context, points, intensity, color) {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = "rgba(188,211,219,.15)";
  context.lineWidth = 10;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
  context.strokeStyle = color;
  context.globalAlpha = 0.22 + 0.68 * Math.min(1, intensity);
  context.lineWidth = 2.2 + 2.4 * Math.sqrt(Math.max(0, intensity));
  context.shadowColor = color;
  context.shadowBlur = 10 + 14 * Math.min(1, intensity);
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function pointOnPolyline(points, progress) {
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    lengths.push(length);
    total += length;
  }
  let distance = ((progress % 1) + 1) % 1 * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (distance <= lengths[index]) {
      const t = distance / Math.max(lengths[index], 1);
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t,
      };
    }
    distance -= lengths[index];
  }
  return points.at(-1);
}

export const setup = {
  id: "pic",
  host: "picsetup.com",
  name: "PicSetup",
  field: "Integrated photonics",
  accent: "#55e6d8",
  themeColor: "#071211",
  code: "PIC–MZI",
  experiment: "Mach–Zehnder transfer bench",
  summary: "Route a coherent input through two tunable couplers and read the interferometer’s ports and spectrum.",
  scope:
    "A coherent, single-mode 2 × 2 scattering-matrix model with wavelength-dependent phase and lumped arm loss.",
  limits: [
    "It does not solve waveguide modes, bends, reflections, or polarization.",
    "Dispersion is reduced to fixed effective/group indices; thermal crosstalk and detector noise are omitted.",
  ],
  interaction:
    "Drag the phase pad or either coupler. Drag across the spectrum to tune wavelength; tap an input port to reroute light.",
  canvasHint: "DRAG PHASE / COUPLERS · SCRUB SPECTRUM · TAP INPUT",
  presets: [
    {
      id: "balanced",
      label: "Balanced null",
      description: "Matched 50:50 couplers send a zero-phase input to one port.",
    },
    {
      id: "quadrature",
      label: "Quadrature",
      description: "A π/2 arm phase produces equal output powers.",
    },
    {
      id: "spectrometer",
      label: "Spectral fringes",
      description: "Path imbalance converts wavelength into a moving interference fringe.",
    },
    {
      id: "lossy",
      label: "Lossy asymmetry",
      description: "Unequal couplers and arm attenuation reduce fringe visibility.",
    },
  ],

  mount(context) {
    const {
      canvas,
      createRange,
      createSelect,
      createDivider,
      setMetrics,
      resizeCanvas,
      pointerPosition,
      clamp,
      setTick,
      setStatus,
    } = context;

    const drawing = canvas.getContext("2d");
    const state = { ...DEFAULTS };
    const controls = {};
    let running = true;
    let frameId = 0;
    let previousTimestamp = 0;
    let animationTime = 0;
    let tick = 0;
    let layout = null;
    let drag = null;

    canvas.style.touchAction = "none";

    function mutate(key, value) {
      state[key] = value;
      tick += 1;
      setTick(tick);
      draw();
    }

    controls.wavelengthNm = createRange({
      id: "pic-wavelength",
      label: "Wavelength",
      min: 1480,
      max: 1620,
      step: 0.5,
      value: state.wavelengthNm,
      unit: "nm",
      description: "Vacuum wavelength of the coherent input.",
      onInput: (value) => mutate("wavelengthNm", value),
    });
    controls.phasePi = createRange({
      id: "pic-phase",
      label: "Heater phase",
      min: 0,
      max: 2,
      step: 0.005,
      value: state.phasePi,
      format: (value) => `${Number(value).toFixed(3)} π`,
      description: "Phase added to the upper arm at 1550 nm.",
      onInput: (value) => mutate("phasePi", value),
    });
    controls.inputPowerMw = createRange({
      id: "pic-power",
      label: "Input power",
      min: 0.1,
      max: 5,
      step: 0.05,
      value: state.inputPowerMw,
      unit: "mW",
      onInput: (value) => mutate("inputPowerMw", value),
    });

    createDivider("Scattering network");
    controls.inputCoupling = createRange({
      id: "pic-coupler-a",
      label: "Coupler A · κ",
      min: 0.02,
      max: 0.98,
      step: 0.005,
      value: state.inputCoupling,
      format: (value) => `${(Number(value) * 100).toFixed(1)}%`,
      description: "Cross-port power coupling |κ|².",
      onInput: (value) => mutate("inputCoupling", value),
    });
    controls.outputCoupling = createRange({
      id: "pic-coupler-b",
      label: "Coupler B · κ",
      min: 0.02,
      max: 0.98,
      step: 0.005,
      value: state.outputCoupling,
      format: (value) => `${(Number(value) * 100).toFixed(1)}%`,
      description: "Cross-port power coupling |κ|².",
      onInput: (value) => mutate("outputCoupling", value),
    });
    controls.armLossDb = createRange({
      id: "pic-loss",
      label: "Upper-arm excess loss",
      min: 0,
      max: 6,
      step: 0.05,
      value: state.armLossDb,
      unit: "dB",
      onInput: (value) => mutate("armLossDb", value),
    });
    controls.pathDeltaUm = createRange({
      id: "pic-path",
      label: "Path imbalance",
      min: -8,
      max: 8,
      step: 0.05,
      value: state.pathDeltaUm,
      unit: "µm",
      description: "Upper minus lower optical path length.",
      onInput: (value) => mutate("pathDeltaUm", value),
    });
    controls.inputPort = createSelect({
      id: "pic-input-port",
      label: "Driven input",
      value: state.inputPort,
      choices: [
        { value: "0", label: "Port 0 · upper" },
        { value: "1", label: "Port 1 · lower" },
      ],
      onChange: (value) => mutate("inputPort", value),
    });

    function syncControls() {
      Object.entries(controls).forEach(([key, control]) => control.set(state[key]));
    }

    function spectrum() {
      const halfWindow = 55;
      const count = 121;
      const start = state.wavelengthNm - halfWindow;
      const values = [];
      for (let index = 0; index < count; index += 1) {
        const wavelength = start + (index / (count - 1)) * halfWindow * 2;
        const result = transfer(state, wavelength);
        values.push({ wavelength, p0: result.powers[0], p1: result.powers[1] });
      }
      return values;
    }

    function buildLayout(width, height) {
      const side = clamp(width * 0.08, 34, 72);
      const centerY = clamp(height * 0.34, 125, 230);
      const separation = clamp(height * 0.12, 54, 92);
      const x0 = side;
      const x1 = width * 0.25;
      const x2 = width * 0.74;
      const x3 = width - side;
      const graphTop = Math.max(centerY + separation + 68, height * 0.64);
      const graph = {
        x: side,
        y: graphTop,
        width: Math.max(120, width - side * 2),
        height: Math.max(72, height - graphTop - 42),
      };
      return {
        x0,
        x1,
        x2,
        x3,
        upperY: centerY - separation,
        lowerY: centerY + separation,
        centerY,
        phasePad: {
          x: x1 + (x2 - x1) * 0.42,
          y: centerY - separation - 21,
          width: Math.max(56, (x2 - x1) * 0.2),
          height: 42,
        },
        couplerA: { x: x1, y: centerY, radius: 24 },
        couplerB: { x: x2, y: centerY, radius: 24 },
        input0: { x: x0, y: centerY - 24 },
        input1: { x: x0, y: centerY + 24 },
        output0: { x: x3, y: centerY - 24 },
        output1: { x: x3, y: centerY + 24 },
        graph,
      };
    }

    function drawBackground(ctx, width, height) {
      const gradient = ctx.createRadialGradient(width * 0.5, height * 0.28, 10, width * 0.5, height * 0.35, width * 0.72);
      gradient.addColorStop(0, "rgba(24,75,72,.22)");
      gradient.addColorStop(0.5, "rgba(8,18,23,.08)");
      gradient.addColorStop(1, "rgba(5,8,12,0)");
      ctx.fillStyle = "#080d12";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "rgba(224,245,241,.035)";
      for (let x = 18; x < width; x += 32) {
        for (let y = 18; y < height; y += 32) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    function drawCoupler(ctx, item, coupling, label) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(-Math.PI / 4);
      roundedRect(ctx, -22, -22, 44, 44, 10);
      ctx.fillStyle = "rgba(12,25,29,.96)";
      ctx.fill();
      ctx.strokeStyle = "rgba(85,230,216,.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-13, -8);
      ctx.bezierCurveTo(-4, -8, 4, 8, 13, 8);
      ctx.moveTo(-13, 8);
      ctx.bezierCurveTo(-4, 8, 4, -8, 13, -8);
      ctx.strokeStyle = "rgba(211,255,248,.72)";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
      drawLabel(ctx, label, item.x, item.y + 42, "center");
      drawLabel(ctx, `${(coupling * 100).toFixed(0)}%`, item.x, item.y + 55, "center", "#55e6d8");
    }

    function drawPort(ctx, item, label, power, active = false) {
      const radius = active ? 7 : 5;
      ctx.beginPath();
      ctx.arc(item.x, item.y, radius, 0, TAU);
      ctx.fillStyle = active ? "#e9fffb" : "rgba(197,221,222,.34)";
      ctx.shadowColor = active ? "#55e6d8" : "transparent";
      ctx.shadowBlur = active ? 18 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      drawLabel(ctx, label, item.x, item.y - 13, "center", active ? "#dffcf7" : "rgba(221,237,240,.52)");
      if (Number.isFinite(power)) drawLabel(ctx, formatPower(power), item.x, item.y + 22, "center");
    }

    function drawPhotonPackets(ctx, result) {
      const upperPath = [
        { x: layout.x0, y: layout.input0.y },
        { x: layout.x1, y: layout.centerY },
        { x: layout.x1 + 55, y: layout.upperY },
        { x: layout.x2 - 55, y: layout.upperY },
        { x: layout.x2, y: layout.centerY },
        { x: layout.x3, y: layout.output0.y },
      ];
      const lowerPath = [
        { x: layout.x0, y: layout.input1.y },
        { x: layout.x1, y: layout.centerY },
        { x: layout.x1 + 55, y: layout.lowerY },
        { x: layout.x2 - 55, y: layout.lowerY },
        { x: layout.x2, y: layout.centerY },
        { x: layout.x3, y: layout.output1.y },
      ];
      const intensities = [
        Math.max(result.armPowers[0], result.powers[0]),
        Math.max(result.armPowers[1], result.powers[1]),
      ];
      [upperPath, lowerPath].forEach((path, pathIndex) => {
        for (let packet = 0; packet < 4; packet += 1) {
          const point = pointOnPolyline(path, animationTime * 0.22 + packet / 4 + pathIndex * 0.08);
          ctx.beginPath();
          ctx.arc(point.x, point.y, 2.2 + 1.8 * Math.sqrt(intensities[pathIndex]), 0, TAU);
          ctx.fillStyle = pathIndex === 0 ? "rgba(187,255,245,.82)" : "rgba(155,178,255,.82)";
          ctx.shadowColor = pathIndex === 0 ? "#55e6d8" : "#8aa8ff";
          ctx.shadowBlur = 13;
          ctx.fill();
        }
      });
      ctx.shadowBlur = 0;
    }

    function drawSpectrum(ctx, values) {
      const graph = layout.graph;
      roundedRect(ctx, graph.x, graph.y, graph.width, graph.height, 9);
      ctx.fillStyle = "rgba(5,9,14,.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(215,238,240,.1)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const peak = Math.max(state.inputPowerMw, 0.001);
      ctx.save();
      roundedRect(ctx, graph.x, graph.y, graph.width, graph.height, 9);
      ctx.clip();
      ctx.strokeStyle = "rgba(215,238,240,.06)";
      for (let division = 1; division < 4; division += 1) {
        const y = graph.y + (division / 4) * graph.height;
        ctx.beginPath();
        ctx.moveTo(graph.x, y);
        ctx.lineTo(graph.x + graph.width, y);
        ctx.stroke();
      }
      const traces = [
        { key: "p0", color: "#55e6d8" },
        { key: "p1", color: "#8aa8ff" },
      ];
      traces.forEach((trace) => {
        ctx.beginPath();
        values.forEach((sample, index) => {
          const x = graph.x + (index / (values.length - 1)) * graph.width;
          const y = graph.y + graph.height - (sample[trace.key] / peak) * graph.height * 0.92;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = trace.color;
        ctx.lineWidth = 1.8;
        ctx.shadowColor = trace.color;
        ctx.shadowBlur = 7;
        ctx.stroke();
      });
      const cursorX = graph.x + graph.width / 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, graph.y);
      ctx.lineTo(cursorX, graph.y + graph.height);
      ctx.strokeStyle = "rgba(255,255,255,.42)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.restore();

      drawLabel(ctx, `SPECTRAL TRANSFER · ±55 nm`, graph.x + 10, graph.y + 16);
      drawLabel(ctx, `${values[0].wavelength.toFixed(0)}`, graph.x, graph.y + graph.height + 16, "left");
      drawLabel(ctx, `${state.wavelengthNm.toFixed(1)} nm`, graph.x + graph.width / 2, graph.y + graph.height + 16, "center", "#edf7f5");
      drawLabel(ctx, `${values.at(-1).wavelength.toFixed(0)}`, graph.x + graph.width, graph.y + graph.height + 16, "right");
      drawLabel(ctx, "P0", graph.x + graph.width - 48, graph.y + 16, "left", "#55e6d8");
      drawLabel(ctx, "P1", graph.x + graph.width - 24, graph.y + 16, "left", "#8aa8ff");
    }

    function draw() {
      const { context: ctx, width, height } = resizeCanvas();
      if (width < 2 || height < 2) return;
      layout = buildLayout(width, height);
      drawBackground(ctx, width, height);

      const result = transfer(state);
      const values = spectrum();
      const upperInput = state.inputPort === "0" ? state.inputPowerMw : 0;
      const lowerInput = state.inputPort === "1" ? state.inputPowerMw : 0;

      ctx.save();
      waveguidePath(
        ctx,
        [
          { x: layout.x0, y: layout.input0.y },
          { x: layout.x1, y: layout.centerY },
        ],
        upperInput,
        "#55e6d8",
      );
      waveguidePath(
        ctx,
        [
          { x: layout.x0, y: layout.input1.y },
          { x: layout.x1, y: layout.centerY },
        ],
        lowerInput,
        "#8aa8ff",
      );
      waveguidePath(
        ctx,
        [
          { x: layout.x1, y: layout.centerY },
          { x: layout.x1 + 55, y: layout.upperY },
          { x: layout.x2 - 55, y: layout.upperY },
          { x: layout.x2, y: layout.centerY },
        ],
        result.armPowers[0] / state.inputPowerMw,
        "#55e6d8",
      );
      waveguidePath(
        ctx,
        [
          { x: layout.x1, y: layout.centerY },
          { x: layout.x1 + 55, y: layout.lowerY },
          { x: layout.x2 - 55, y: layout.lowerY },
          { x: layout.x2, y: layout.centerY },
        ],
        result.armPowers[1] / state.inputPowerMw,
        "#8aa8ff",
      );
      waveguidePath(
        ctx,
        [
          { x: layout.x2, y: layout.centerY },
          { x: layout.x3, y: layout.output0.y },
        ],
        result.powers[0] / state.inputPowerMw,
        "#55e6d8",
      );
      waveguidePath(
        ctx,
        [
          { x: layout.x2, y: layout.centerY },
          { x: layout.x3, y: layout.output1.y },
        ],
        result.powers[1] / state.inputPowerMw,
        "#8aa8ff",
      );
      ctx.restore();

      drawCoupler(ctx, layout.couplerA, state.inputCoupling, "COUPLER A");
      drawCoupler(ctx, layout.couplerB, state.outputCoupling, "COUPLER B");

      roundedRect(
        ctx,
        layout.phasePad.x,
        layout.phasePad.y,
        layout.phasePad.width,
        layout.phasePad.height,
        7,
      );
      const phaseGlow = ctx.createLinearGradient(
        layout.phasePad.x,
        layout.phasePad.y,
        layout.phasePad.x + layout.phasePad.width,
        layout.phasePad.y,
      );
      phaseGlow.addColorStop(0, "rgba(255,189,92,.16)");
      phaseGlow.addColorStop(0.5, "rgba(255,189,92,.54)");
      phaseGlow.addColorStop(1, "rgba(255,189,92,.16)");
      ctx.fillStyle = phaseGlow;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,206,123,.65)";
      ctx.stroke();
      drawLabel(
        ctx,
        `PHASE ${state.phasePi.toFixed(3)}π`,
        layout.phasePad.x + layout.phasePad.width / 2,
        layout.phasePad.y - 9,
        "center",
        "#ffd18a",
      );
      if (state.armLossDb > 0.02) {
        drawLabel(
          ctx,
          `−${state.armLossDb.toFixed(2)} dB`,
          layout.phasePad.x + layout.phasePad.width / 2,
          layout.phasePad.y + layout.phasePad.height + 15,
          "center",
          "#ffad82",
        );
      }

      drawPort(ctx, layout.input0, "IN 0", undefined, state.inputPort === "0");
      drawPort(ctx, layout.input1, "IN 1", undefined, state.inputPort === "1");
      drawPort(ctx, layout.output0, "OUT 0", result.powers[0], result.powers[0] >= result.powers[1]);
      drawPort(ctx, layout.output1, "OUT 1", result.powers[1], result.powers[1] > result.powers[0]);
      if (running) drawPhotonPackets(ctx, result);
      drawSpectrum(ctx, values);

      const throughput = (result.powers[0] + result.powers[1]) / state.inputPowerMw;
      const contrast = Math.abs(result.powers[0] - result.powers[1]) / Math.max(result.powers[0] + result.powers[1], 1e-12);
      const pathLengthNm = Math.abs(state.pathDeltaUm) * 1000;
      const fsrNm =
        pathLengthNm > 1e-6 ? (state.wavelengthNm * state.wavelengthNm) / (GROUP_INDEX * pathLengthNm) : Infinity;
      setMetrics([
        { id: "p0", label: "Output · port 0", value: formatPower(result.powers[0]), tone: result.powers[0] >= result.powers[1] ? "accent" : "default" },
        { id: "p1", label: "Output · port 1", value: formatPower(result.powers[1]), tone: result.powers[1] > result.powers[0] ? "accent" : "default" },
        { id: "phase", label: "Wrapped arm phase", value: `${(wrapPhase(result.totalPhase) / Math.PI).toFixed(3)} π` },
        { id: "contrast", label: "Port contrast", value: `${(contrast * 100).toFixed(1)}%` },
        { id: "loss", label: "Insertion loss", value: `${(-db(throughput)).toFixed(2)} dB`, tone: throughput < 0.75 ? "warning" : "default" },
        { id: "fsr", label: "Estimated FSR", value: Number.isFinite(fsrNm) ? `${fsrNm.toFixed(1)} nm` : "∞ · matched paths" },
      ]);
    }

    function frame(timestamp) {
      if (!running) return;
      const elapsed = previousTimestamp ? Math.min(0.05, (timestamp - previousTimestamp) / 1000) : 0;
      previousTimestamp = timestamp;
      animationTime += elapsed;
      tick += 1;
      setTick(tick);
      draw();
      frameId = requestAnimationFrame(frame);
    }

    function hitCircle(point, circle, padding = 0) {
      return Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.radius + padding;
    }

    function inside(point, rect, padding = 0) {
      return (
        point.x >= rect.x - padding &&
        point.x <= rect.x + rect.width + padding &&
        point.y >= rect.y - padding &&
        point.y <= rect.y + rect.height + padding
      );
    }

    function scrubWavelength(point) {
      const originX = drag?.type === "wavelength"
        ? drag.x
        : layout.graph.x + layout.graph.width * 0.5;
      const originWavelength = drag?.type === "wavelength"
        ? drag.value
        : state.wavelengthNm;
      state.wavelengthNm = clamp(
        originWavelength + (point.x - originX) / layout.graph.width * 110,
        1480,
        1620,
      );
      controls.wavelengthNm.set(state.wavelengthNm);
    }

    function onPointerDown(event) {
      if (!layout) return;
      const point = pointerPosition(event);
      if (inside(point, layout.graph)) {
        const fraction = clamp((point.x - layout.graph.x) / layout.graph.width, 0, 1);
        drag = {
          type: "wavelength",
          x: point.x,
          value: clamp(state.wavelengthNm - 55 + fraction * 110, 1480, 1620),
        };
        scrubWavelength(point);
      } else if (inside(point, layout.phasePad, 12)) {
        drag = { type: "phase", y: point.y, value: state.phasePi };
      } else if (hitCircle(point, layout.couplerA, 14)) {
        drag = { type: "couplerA", y: point.y, value: state.inputCoupling };
      } else if (hitCircle(point, layout.couplerB, 14)) {
        drag = { type: "couplerB", y: point.y, value: state.outputCoupling };
      } else if (Math.hypot(point.x - layout.input0.x, point.y - layout.input0.y) < 24) {
        state.inputPort = "0";
        controls.inputPort.set("0");
      } else if (Math.hypot(point.x - layout.input1.x, point.y - layout.input1.y) < 24) {
        state.inputPort = "1";
        controls.inputPort.set("1");
      } else {
        return;
      }
      canvas.setPointerCapture?.(event.pointerId);
      tick += 1;
      setTick(tick);
      draw();
      event.preventDefault();
    }

    function onPointerMove(event) {
      if (!layout) return;
      const point = pointerPosition(event);
      if (!drag) {
        const interactive =
          inside(point, layout.graph) ||
          inside(point, layout.phasePad, 12) ||
          hitCircle(point, layout.couplerA, 14) ||
          hitCircle(point, layout.couplerB, 14) ||
          Math.hypot(point.x - layout.input0.x, point.y - layout.input0.y) < 24 ||
          Math.hypot(point.x - layout.input1.x, point.y - layout.input1.y) < 24;
        canvas.style.cursor = interactive ? "grab" : "crosshair";
        return;
      }
      if (drag.type === "wavelength") {
        scrubWavelength(point);
      } else if (drag.type === "phase") {
        state.phasePi = clamp(drag.value + (drag.y - point.y) / 70, 0, 2);
        controls.phasePi.set(state.phasePi);
      } else if (drag.type === "couplerA") {
        state.inputCoupling = clamp(drag.value + (drag.y - point.y) / 180, 0.02, 0.98);
        controls.inputCoupling.set(state.inputCoupling);
      } else if (drag.type === "couplerB") {
        state.outputCoupling = clamp(drag.value + (drag.y - point.y) / 180, 0.02, 0.98);
        controls.outputCoupling.set(state.outputCoupling);
      }
      canvas.style.cursor = "grabbing";
      tick += 1;
      setTick(tick);
      draw();
      event.preventDefault();
    }

    function onPointerUp(event) {
      if (!drag) return;
      drag = null;
      canvas.releasePointerCapture?.(event.pointerId);
      canvas.style.cursor = "crosshair";
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    function setParameters(next) {
      state.wavelengthNm = clamp(Number(next.wavelengthNm ?? state.wavelengthNm), 1480, 1620);
      state.phasePi = clamp(Number(next.phasePi ?? state.phasePi), 0, 2);
      state.inputCoupling = clamp(Number(next.inputCoupling ?? state.inputCoupling), 0.02, 0.98);
      state.outputCoupling = clamp(Number(next.outputCoupling ?? state.outputCoupling), 0.02, 0.98);
      state.armLossDb = clamp(Number(next.armLossDb ?? state.armLossDb), 0, 6);
      state.pathDeltaUm = clamp(Number(next.pathDeltaUm ?? state.pathDeltaUm), -8, 8);
      state.inputPowerMw = clamp(Number(next.inputPowerMw ?? state.inputPowerMw), 0.1, 5);
      state.inputPort = String(next.inputPort) === "1" ? "1" : "0";
      syncControls();
    }

    function reset() {
      Object.assign(state, DEFAULTS);
      animationTime = 0;
      previousTimestamp = 0;
      tick = 0;
      setTick(0);
      syncControls();
      setStatus(running ? "simulation live" : "simulation paused", running ? "live" : "paused");
      draw();
    }

    function applyPreset(id) {
      const preset = PRESET_STATES[id] || DEFAULTS;
      Object.assign(state, preset);
      animationTime = 0;
      tick += 1;
      setTick(tick);
      syncControls();
      draw();
    }

    draw();
    frameId = requestAnimationFrame(frame);

    return {
      reset,
      applyPreset,
      play() {
        if (running) return;
        running = true;
        previousTimestamp = 0;
        setStatus("simulation live");
        frameId = requestAnimationFrame(frame);
      },
      pause() {
        running = false;
        cancelAnimationFrame(frameId);
        draw();
      },
      getState() {
        return { version: 1, ...state };
      },
      setState(next) {
        if (!next || typeof next !== "object") return;
        setParameters(next);
        tick += 1;
        setTick(tick);
        draw();
      },
      destroy() {
        running = false;
        cancelAnimationFrame(frameId);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
      },
    };
  },
};
