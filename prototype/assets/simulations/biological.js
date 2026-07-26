const ACCENT = "#71f2bd";
const MAGENTA = "#ff65b7";
const CYAN = "#69d8ff";
const STEP = 1 / 30;
const GRID = 64;
const GRID_SIZE = GRID * GRID;
const HISTORY_LENGTH = 180;

const PRESETS = {
  homeostasis: {
    condition: "healthy",
    microscopy: "phase",
    metabolism: 1,
    diffusion: 1,
    stress: 0.08,
    permeability: 0.12,
    pulseStrength: 0.62,
    organelles: true,
  },
  apoptosis: {
    condition: "apoptosis",
    microscopy: "fluorescence",
    metabolism: 0.72,
    diffusion: 0.86,
    stress: 0.7,
    permeability: 0.58,
    pulseStrength: 0.78,
    organelles: true,
  },
  mitosis: {
    condition: "mitosis",
    microscopy: "fluorescence",
    metabolism: 1.18,
    diffusion: 1.08,
    stress: 0.16,
    permeability: 0.18,
    pulseStrength: 0.52,
    organelles: true,
  },
  signalling: {
    condition: "healthy",
    microscopy: "brightfield",
    metabolism: 0.9,
    diffusion: 1.42,
    stress: 0.24,
    permeability: 0.34,
    pulseStrength: 0.92,
    organelles: false,
  },
};

const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));

function makeHistory(initial = 0) {
  const values = Array.from({ length: HISTORY_LENGTH }, () => initial);
  return {
    values,
    push(value) {
      values.push(value);
      values.shift();
    },
    reset(value) {
      values.fill(value);
    },
  };
}

function roundedRect(context, x, y, width, height, radius = 8) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawTrace(context, values, rect, min, max, color, width = 1.4) {
  const span = max - min || 1;
  context.beginPath();
  values.forEach((value, index) => {
    const x = rect.x + (index / (values.length - 1)) * rect.width;
    const y = rect.y + rect.height - ((value - min) / span) * rect.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function phaseName(value) {
  if (value < 0.25) return "G1";
  if (value < 0.58) return "S";
  if (value < 0.8) return "G2";
  return "M";
}

export const setup = {
  id: "biological",
  host: "biologicalsetup.com",
  name: "BiologicalSetup",
  field: "Cell systems",
  accent: ACCENT,
  themeColor: "#07110f",
  code: "BIO–01",
  experiment: "Living cell field",
  summary:
    "Perturb a bounded intracellular reaction–diffusion field and watch metabolism, calcium, caspase activity, and membrane integrity respond.",
  scope:
    "A Gray–Scott field inside a deformable cell is coupled to bounded phenomenological ODEs for ATP, calcium, caspase activity, membrane integrity, and cell-cycle phase.",
  limits: [
    "Parameters are qualitative and normalized; the model cannot predict treatment response or patient biology.",
    "Organelles and microscopy modes are explanatory renderings, not reconstructed microscope images.",
    "Reaction–diffusion chemistry and pathway ODEs omit molecular identity, stochastic gene expression, and tissue mechanics.",
  ],
  interaction:
    "Tap or drag inside the cell to uncage a local signalling pulse. Change condition or microscopy and follow the field and pathway readouts.",
  canvasHint: "TAP OR DRAG INSIDE THE MEMBRANE TO UNCAGE A SIGNAL",
  presets: [
    {
      id: "homeostasis",
      label: "Healthy homeostasis",
      description: "A low-stress cell maintains ATP and membrane integrity.",
    },
    {
      id: "apoptosis",
      label: "Apoptotic commitment",
      description: "Stress and calcium leakage recruit a caspase-like response.",
    },
    {
      id: "mitosis",
      label: "Mitotic entry",
      description: "Elevated metabolism advances the cycle into a dividing geometry.",
    },
    {
      id: "signalling",
      label: "Diffusion pulse",
      description: "A strong local pulse spreads through a permissive membrane.",
    },
  ],

  mount(context) {
    const {
      canvas,
      createDivider,
      createRange,
      createSelect,
      createToggle,
      resizeCanvas,
      setMetrics,
      setStatus,
      setTick,
    } = context;

    let params = { ...PRESETS.homeostasis };
    let currentPreset = "homeostasis";
    let running = true;
    let destroyed = false;
    let pointerDown = false;
    let animationFrame = 0;
    let previousFrameTime = performance.now();
    let accumulator = 0;
    let metricClock = 0;
    let lastGeometry = null;

    let u = new Float32Array(GRID_SIZE);
    let v = new Float32Array(GRID_SIZE);
    let uNext = new Float32Array(GRID_SIZE);
    let vNext = new Float32Array(GRID_SIZE);
    const mask = new Uint8Array(GRID_SIZE);

    const fieldCanvas = document.createElement("canvas");
    fieldCanvas.width = GRID;
    fieldCanvas.height = GRID;
    const fieldContext = fieldCanvas.getContext("2d", { alpha: true });
    const fieldImage = fieldContext.createImageData(GRID, GRID);

    const histories = {
      atp: makeHistory(0.88),
      calcium: makeHistory(0.12),
      caspase: makeHistory(0.02),
      membrane: makeHistory(0.98),
    };

    const state = {
      tick: 0,
      atp: 0.88,
      calcium: 0.12,
      caspase: 0.02,
      membrane: 0.98,
      cycle: 0.18,
      pulse: 0,
      pulseX: 0.5,
      pulseY: 0.5,
      pulseAge: 99,
      fieldContrast: 0,
    };

    function buildMask() {
      for (let y = 0; y < GRID; y += 1) {
        for (let x = 0; x < GRID; x += 1) {
          const nx = (x + 0.5) / GRID - 0.5;
          const ny = (y + 0.5) / GRID - 0.5;
          mask[y * GRID + x] = nx * nx + ny * ny <= 0.238 ? 1 : 0;
        }
      }
    }

    function seedSpot(cx, cy, radius, amount = 0.86) {
      for (let y = Math.max(1, cy - radius); y <= Math.min(GRID - 2, cy + radius); y += 1) {
        for (
          let x = Math.max(1, cx - radius);
          x <= Math.min(GRID - 2, cx + radius);
          x += 1
        ) {
          const dx = x - cx;
          const dy = y - cy;
          const index = y * GRID + x;
          if (mask[index] && dx * dx + dy * dy <= radius * radius) {
            const falloff = 1 - Math.sqrt(dx * dx + dy * dy) / Math.max(1, radius);
            v[index] = Math.max(v[index], amount * (0.62 + 0.38 * falloff));
            u[index] = Math.min(u[index], 0.24 + 0.2 * (1 - falloff));
          }
        }
      }
    }

    function initializeField() {
      u.fill(1);
      v.fill(0);
      for (let index = 0; index < GRID_SIZE; index += 1) {
        if (mask[index]) u[index] = 0.985;
      }
      if (params.condition === "apoptosis") {
        seedSpot(23, 26, 5, 0.96);
        seedSpot(40, 36, 4, 0.8);
        seedSpot(32, 45, 3, 0.72);
      } else if (params.condition === "mitosis") {
        seedSpot(23, 32, 5, 0.78);
        seedSpot(41, 32, 5, 0.78);
        seedSpot(32, 22, 3, 0.62);
      } else {
        seedSpot(27, 28, 4, 0.78);
        seedSpot(38, 37, 3, 0.68);
      }
      uNext.set(u);
      vNext.set(v);
    }

    function initialDynamics() {
      if (params.condition === "apoptosis") {
        return {
          atp: 0.66,
          calcium: 0.42,
          caspase: 0.2,
          membrane: 0.84,
          cycle: 0.12,
        };
      }
      if (params.condition === "mitosis") {
        return {
          atp: 0.84,
          calcium: 0.16,
          caspase: 0.025,
          membrane: 0.96,
          cycle: 0.81,
        };
      }
      return {
        atp: 0.88,
        calcium: 0.12,
        caspase: 0.02,
        membrane: 0.98,
        cycle: 0.18,
      };
    }

    function touchTick(amount = 1) {
      state.tick += amount;
      setTick(state.tick);
    }

    function resetDynamics() {
      const initial = initialDynamics();
      accumulator = 0;
      metricClock = 0;
      previousFrameTime = performance.now();
      Object.assign(state, {
        tick: 0,
        ...initial,
        pulse: 0,
        pulseX: 0.5,
        pulseY: 0.5,
        pulseAge: 99,
        fieldContrast: 0,
      });
      initializeField();
      histories.atp.reset(state.atp);
      histories.calcium.reset(state.calcium);
      histories.caspase.reset(state.caspase);
      histories.membrane.reset(state.membrane);
      setTick(0);
      updateFieldContrast();
      updateMetrics(true);
      draw();
    }

    createDivider("Cell state");
    const controls = {
      condition: createSelect({
        id: "biological-condition",
        label: "Biological condition",
        value: params.condition,
        choices: [
          { value: "healthy", label: "Healthy" },
          { value: "apoptosis", label: "Apoptosis" },
          { value: "mitosis", label: "Mitosis" },
        ],
        description: "Selects pathway biases and cell geometry.",
        onChange(value) {
          params.condition = value;
          currentPreset = "custom";
          resetDynamics();
        },
      }),
      microscopy: createSelect({
        id: "biological-microscopy",
        label: "Microscopy",
        value: params.microscopy,
        choices: [
          { value: "phase", label: "Phase contrast" },
          { value: "fluorescence", label: "Fluorescence" },
          { value: "brightfield", label: "Brightfield" },
        ],
        description: "Changes the observation model, not the underlying cell state.",
        onChange(value) {
          params.microscopy = value;
          touchTick();
          draw();
        },
      }),
    };

    createDivider("Pathway + transport");
    controls.metabolism = createRange({
      id: "biological-metabolism",
      label: "Metabolic capacity",
      min: 0.35,
      max: 1.5,
      step: 0.01,
      value: params.metabolism,
      format: (value) => `${Math.round(Number(value) * 100)} %`,
      description: "Recovery drive for the normalized ATP pool.",
      onInput(value) {
        params.metabolism = value;
        touchTick();
      },
    });
    controls.diffusion = createRange({
      id: "biological-diffusion",
      label: "Cytosolic diffusion",
      min: 0.35,
        max: 1.55,
      step: 0.01,
      value: params.diffusion,
      format: (value) => `${Number(value).toFixed(2)} ×`,
      description: "Scales diffusion of the reaction field inside the membrane.",
      onInput(value) {
        params.diffusion = value;
        touchTick();
      },
    });
    controls.stress = createRange({
      id: "biological-stress",
      label: "Oxidative stress",
      min: 0,
      max: 1,
      step: 0.01,
      value: params.stress,
      format: (value) => `${Math.round(Number(value) * 100)} %`,
      description: "Raises calcium load and caspase-like activation.",
      onInput(value) {
        params.stress = value;
        touchTick();
      },
    });
    controls.permeability = createRange({
      id: "biological-permeability",
      label: "Membrane permeability",
      min: 0,
      max: 1,
      step: 0.01,
      value: params.permeability,
      format: (value) => `${Math.round(Number(value) * 100)} %`,
      description: "Couples extracellular perturbation into the calcium pool.",
      onInput(value) {
        params.permeability = value;
        touchTick();
      },
    });
    controls.pulseStrength = createRange({
      id: "biological-pulse",
      label: "Uncaging pulse",
      min: 0.15,
      max: 1,
      step: 0.01,
      value: params.pulseStrength,
      format: (value) => `${Math.round(Number(value) * 100)} %`,
      description: "Concentration injected by a tap or drag inside the cell.",
      onInput(value) {
        params.pulseStrength = value;
        touchTick();
      },
    });
    controls.organelles = createToggle({
      id: "biological-organelles",
      label: "Organelle overlay",
      checked: params.organelles,
      description: "Shows explanatory nucleus, mitochondria, and spindle forms.",
      onChange(value) {
        params.organelles = value;
        touchTick();
        draw();
      },
    });

    function syncControls() {
      for (const [key, control] of Object.entries(controls)) control.set(params[key]);
    }

    function neighbor(array, index, fallback) {
      return mask[index] ? array[index] : fallback;
    }

    function reactionDiffusionStep() {
      const conditionParameters = params.condition === "apoptosis"
        ? { feed: 0.028, kill: 0.061 }
        : params.condition === "mitosis"
          ? { feed: 0.041, kill: 0.059 }
          : { feed: 0.0367, kill: 0.0649 };
      const du = 0.16 * params.diffusion;
      const dv = 0.078 * params.diffusion;
      const feed = conditionParameters.feed + params.stress * 0.002;
      const kill = conditionParameters.kill - params.permeability * 0.0015;

      for (let y = 1; y < GRID - 1; y += 1) {
        for (let x = 1; x < GRID - 1; x += 1) {
          const index = y * GRID + x;
          if (!mask[index]) {
            uNext[index] = 1;
            vNext[index] = 0;
            continue;
          }
          const currentU = u[index];
          const currentV = v[index];
          const lapU =
            neighbor(u, index - 1, currentU) +
            neighbor(u, index + 1, currentU) +
            neighbor(u, index - GRID, currentU) +
            neighbor(u, index + GRID, currentU) -
            4 * currentU;
          const lapV =
            neighbor(v, index - 1, currentV) +
            neighbor(v, index + 1, currentV) +
            neighbor(v, index - GRID, currentV) +
            neighbor(v, index + GRID, currentV) -
            4 * currentV;
          const reaction = currentU * currentV * currentV;
          uNext[index] = clampValue(
            currentU + du * lapU - reaction + feed * (1 - currentU),
            0,
            1,
          );
          vNext[index] = clampValue(
            currentV + dv * lapV + reaction - (feed + kill) * currentV,
            0,
            1,
          );
        }
      }
      [u, uNext] = [uNext, u];
      [v, vNext] = [vNext, v];
    }

    function pathwayStep(dt) {
      const activeStress = clampValue(params.stress + state.pulse * 0.55, 0, 1.4);
      const apoptosisBias = params.condition === "apoptosis" ? 0.36 : 0;
      const mitosisDemand = params.condition === "mitosis" ? 0.16 : 0.04;
      const recovery =
        0.48 * params.metabolism * (1 - state.atp) -
        (0.2 + mitosisDemand) * activeStress -
        state.caspase * 0.14;
      state.atp = clampValue(state.atp + recovery * dt, 0.03, 1);

      const calciumTarget =
        0.08 +
        params.permeability * (0.12 + activeStress * 0.52) +
        state.pulse * 0.42 +
        apoptosisBias * 0.35;
      const calciumPump = 0.72 * state.atp * state.calcium;
      state.calcium = clampValue(
        state.calcium + (calciumTarget - state.calcium - calciumPump * 0.35) * dt * 1.15,
        0.015,
        1.35,
      );

      const activation =
        Math.max(0, state.calcium - 0.28) * (0.42 + activeStress * 0.82) +
        apoptosisBias * 0.23;
      const clearance = (params.condition === "apoptosis" ? 0.08 : 0.28) * state.caspase;
      state.caspase = clampValue(state.caspase + (activation - clearance) * dt, 0, 1.2);

      const repair = 0.12 * state.atp * (1 - state.membrane);
      const damage =
        Math.max(0, activeStress - 0.34) * 0.09 +
        Math.max(0, state.caspase - 0.32) * 0.13;
      state.membrane = clampValue(state.membrane + (repair - damage) * dt, 0.18, 1);

      if (params.condition === "mitosis") {
        state.cycle = (state.cycle + dt * 0.055 * params.metabolism) % 1;
      } else if (params.condition === "healthy") {
        state.cycle = (state.cycle + dt * 0.006 * params.metabolism) % 1;
      }
      state.pulse *= Math.exp(-dt * (0.48 + params.diffusion * 0.24));
      state.pulseAge += dt;
    }

    function updateFieldContrast() {
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      for (let index = 0; index < GRID_SIZE; index += 1) {
        if (!mask[index]) continue;
        const value = v[index];
        sum += value;
        sumSquares += value * value;
        count += 1;
      }
      const mean = sum / Math.max(1, count);
      state.fieldContrast = Math.sqrt(Math.max(0, sumSquares / Math.max(1, count) - mean * mean));
    }

    function stepModel(dt) {
      reactionDiffusionStep();
      pathwayStep(dt);
      if (state.tick % 2 === 0) {
        histories.atp.push(state.atp);
        histories.calcium.push(state.calcium);
        histories.caspase.push(state.caspase);
        histories.membrane.push(state.membrane);
      }
      touchTick();
      metricClock += dt;
      if (metricClock > 0.12) {
        metricClock = 0;
        updateFieldContrast();
        updateMetrics();
      }
    }

    function updateMetrics(force = false) {
      const commitment = state.caspase > 0.62 || state.membrane < 0.52;
      const calciumNm = Math.round(65 + state.calcium * 720);
      setMetrics([
        {
          id: "atp",
          label: "ATP pool",
          value: `${Math.round(state.atp * 100)} %`,
          tone: state.atp < 0.35 ? "warning" : "good",
        },
        {
          id: "calcium",
          label: "Cytosolic Ca²⁺",
          value: `${calciumNm} nM`,
          tone: calciumNm > 430 ? "warning" : "default",
        },
        {
          id: "caspase",
          label: "Caspase-like activity",
          value: state.caspase.toFixed(2),
          tone: commitment ? "warning" : "default",
        },
        {
          id: "membrane",
          label: "Membrane integrity",
          value: `${Math.round(state.membrane * 100)} %`,
          tone: state.membrane < 0.58 ? "warning" : "good",
        },
        {
          id: "cycle",
          label: "Cell-cycle phase",
          value: params.condition === "apoptosis" ? "arrested" : phaseName(state.cycle),
        },
        {
          id: "contrast",
          label: "Field contrast",
          value: state.fieldContrast.toFixed(3),
        },
      ]);

      if (running || force) {
        if (commitment) setStatus("commitment threshold crossed", "warn");
        else if (state.pulse > 0.08) setStatus("signal pulse dispersing", "live");
        else if (params.condition === "mitosis") setStatus("cell cycle advancing", "live");
        else setStatus("homeostasis live", "live");
      }
    }

    function renderField() {
      const pixels = fieldImage.data;
      for (let index = 0; index < GRID_SIZE; index += 1) {
        const offset = index * 4;
        if (!mask[index]) {
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 0;
          continue;
        }
        const activator = clampValue(v[index], 0, 1);
        const substrate = clampValue(u[index], 0, 1);
        if (params.microscopy === "fluorescence") {
          pixels[offset] = Math.round(18 + activator * 232 + state.caspase * 18);
          pixels[offset + 1] = Math.round(18 + substrate * 68 + activator * 42);
          pixels[offset + 2] = Math.round(35 + substrate * 96 + activator * 118);
          pixels[offset + 3] = Math.round(178 + activator * 77);
        } else if (params.microscopy === "brightfield") {
          const transmission = clampValue(0.84 - activator * 0.48 + substrate * 0.08, 0, 1);
          pixels[offset] = Math.round(232 * transmission);
          pixels[offset + 1] = Math.round(218 * transmission);
          pixels[offset + 2] = Math.round(172 * transmission);
          pixels[offset + 3] = 224;
        } else {
          const phase = clampValue(0.22 + substrate * 0.26 + activator * 0.58, 0, 1);
          pixels[offset] = Math.round(70 + phase * 88);
          pixels[offset + 1] = Math.round(92 + phase * 118);
          pixels[offset + 2] = Math.round(104 + phase * 104);
          pixels[offset + 3] = 218;
        }
      }
      fieldContext.putImageData(fieldImage, 0, 0);
    }

    function membranePath(g, geometry) {
      const { cx, cy, rx, ry } = geometry;
      const bleb = params.condition === "apoptosis"
        ? (1 - state.membrane) * 0.12 + state.caspase * 0.025
        : 0.008;
      const constriction =
        params.condition === "mitosis"
          ? Math.max(0, Math.sin(Math.PI * state.cycle)) * 0.2
          : 0;
      g.beginPath();
      for (let index = 0; index <= 96; index += 1) {
        const angle = (index / 96) * Math.PI * 2;
        const wobble =
          1 +
          bleb *
            (0.48 * Math.sin(angle * 7 + state.tick * 0.025) +
              0.32 * Math.sin(angle * 11 - state.tick * 0.017));
        const waist = 1 - constriction * Math.pow(Math.cos(angle), 8);
        const x = cx + Math.cos(angle) * rx * wobble * waist;
        const y = cy + Math.sin(angle) * ry * wobble;
        if (index === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    }

    function drawOrganelles(g, geometry) {
      if (!params.organelles) return;
      const { cx, cy, rx, ry } = geometry;
      g.save();

      if (params.condition === "mitosis") {
        const separation = rx * (0.18 + 0.16 * Math.sin(Math.PI * state.cycle));
        g.strokeStyle = "rgba(105,216,255,0.38)";
        g.lineWidth = 1;
        for (let index = 0; index < 7; index += 1) {
          const offset = (index - 3) * ry * 0.075;
          g.beginPath();
          g.moveTo(cx - separation, cy + offset);
          g.quadraticCurveTo(cx, cy - offset * 0.5, cx + separation, cy - offset);
          g.stroke();
        }
        for (const direction of [-1, 1]) {
          g.fillStyle = "rgba(255,101,183,0.72)";
          g.beginPath();
          g.ellipse(cx + direction * separation, cy, rx * 0.085, ry * 0.23, 0, 0, Math.PI * 2);
          g.fill();
        }
      } else if (params.condition === "apoptosis" && state.caspase > 0.42) {
        for (let index = 0; index < 6; index += 1) {
          const angle = index * 2.399 + 0.5;
          const distance = rx * (0.08 + index * 0.038);
          g.fillStyle = `rgba(255,101,183,${0.38 + index * 0.05})`;
          g.beginPath();
          g.arc(
            cx + Math.cos(angle) * distance,
            cy + Math.sin(angle) * distance * 0.74,
            Math.max(2.5, rx * (0.045 - index * 0.003)),
            0,
            Math.PI * 2,
          );
          g.fill();
        }
      } else {
        const nucleusGradient = g.createRadialGradient(
          cx - rx * 0.07,
          cy - ry * 0.08,
          2,
          cx,
          cy,
          rx * 0.25,
        );
        nucleusGradient.addColorStop(0, "rgba(105,216,255,0.3)");
        nucleusGradient.addColorStop(1, "rgba(32,64,88,0.78)");
        g.fillStyle = nucleusGradient;
        g.strokeStyle = "rgba(105,216,255,0.42)";
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(cx, cy, rx * 0.24, ry * 0.27, -0.12, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }

      for (let index = 0; index < 12; index += 1) {
        const angle = index * 2.399963 + state.tick * 0.0009 * (index % 2 ? 1 : -1);
        const radius = 0.34 + (index % 4) * 0.095;
        const x = cx + Math.cos(angle) * rx * radius;
        const y = cy + Math.sin(angle) * ry * radius;
        if (Math.hypot((x - cx) / rx, (y - cy) / ry) > 0.82) continue;
        g.save();
        g.translate(x, y);
        g.rotate(angle + 0.7);
        g.fillStyle =
          params.microscopy === "fluorescence"
            ? `rgba(113,242,189,${0.22 + state.atp * 0.42})`
            : `rgba(218,232,208,${0.12 + state.atp * 0.25})`;
        g.beginPath();
        g.ellipse(0, 0, Math.max(3, rx * 0.055), Math.max(1.5, ry * 0.018), 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.restore();
    }

    function drawScope(g, rect) {
      g.save();
      roundedRect(g, rect.x, rect.y, rect.width, rect.height, 9);
      g.fillStyle = "rgba(5, 12, 13, 0.88)";
      g.fill();
      g.clip();
      g.strokeStyle = "rgba(255,255,255,0.05)";
      g.lineWidth = 1;
      for (let row = 1; row < 4; row += 1) {
        const y = rect.y + (rect.height * row) / 4;
        g.beginPath();
        g.moveTo(rect.x, y);
        g.lineTo(rect.x + rect.width, y);
        g.stroke();
      }
      const inner = {
        x: rect.x + 8,
        y: rect.y + 8,
        width: rect.width - 16,
        height: rect.height - 16,
      };
      drawTrace(g, histories.atp.values, inner, 0, 1.2, ACCENT, 1.6);
      drawTrace(g, histories.calcium.values, inner, 0, 1.2, CYAN, 1.2);
      drawTrace(g, histories.caspase.values, inner, 0, 1.2, MAGENTA, 1.5);
      g.restore();
    }

    function drawGrid(g, width, height) {
      g.save();
      g.fillStyle = "rgba(113,242,189,0.045)";
      const spacing = width < 600 ? 25 : 34;
      for (let x = spacing / 2; x < width; x += spacing) {
        for (let y = spacing / 2; y < height; y += spacing) {
          g.beginPath();
          g.arc(x, y, 0.75, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
    }

    function draw() {
      const { context: g, width, height } = resizeCanvas();
      g.clearRect(0, 0, width, height);
      const background = g.createRadialGradient(
        width * 0.48,
        height * 0.36,
        12,
        width * 0.48,
        height * 0.38,
        Math.max(width, height) * 0.72,
      );
      background.addColorStop(0, "#0c1718");
      background.addColorStop(0.58, "#081010");
      background.addColorStop(1, "#070a0d");
      g.fillStyle = background;
      g.fillRect(0, 0, width, height);
      drawGrid(g, width, height);

      const compact = width < 600;
      const scopeHeight = compact ? 92 : 108;
      const availableCellHeight = Math.max(150, height - scopeHeight - 68);
      const baseRadius = Math.max(
        68,
        Math.min(width * (compact ? 0.36 : 0.29), availableCellHeight * 0.42),
      );
      const mitoticStretch = params.condition === "mitosis"
        ? 1 + 0.18 * Math.sin(Math.PI * state.cycle)
        : 1;
      const geometry = {
        cx: width * 0.5,
        cy: 26 + availableCellHeight * 0.48,
        rx: baseRadius * mitoticStretch,
        ry: baseRadius * (params.condition === "mitosis" ? 0.86 : 1),
      };
      lastGeometry = geometry;

      g.save();
      membranePath(g, geometry);
      g.shadowColor = params.condition === "apoptosis" ? MAGENTA : ACCENT;
      g.shadowBlur = 28;
      g.fillStyle =
        params.microscopy === "brightfield"
          ? "rgba(218,205,160,0.2)"
          : "rgba(34,77,69,0.28)";
      g.fill();
      g.restore();

      renderField();
      g.save();
      membranePath(g, geometry);
      g.clip();
      g.globalAlpha = params.microscopy === "phase" ? 0.82 : 0.94;
      g.imageSmoothingEnabled = true;
      g.drawImage(
        fieldCanvas,
        geometry.cx - geometry.rx,
        geometry.cy - geometry.ry,
        geometry.rx * 2,
        geometry.ry * 2,
      );
      if (params.microscopy === "phase") {
        const phaseShade = g.createLinearGradient(
          geometry.cx - geometry.rx,
          geometry.cy - geometry.ry,
          geometry.cx + geometry.rx,
          geometry.cy + geometry.ry,
        );
        phaseShade.addColorStop(0, "rgba(255,255,255,0.12)");
        phaseShade.addColorStop(0.5, "rgba(0,0,0,0)");
        phaseShade.addColorStop(1, "rgba(0,0,0,0.28)");
        g.fillStyle = phaseShade;
        g.fillRect(
          geometry.cx - geometry.rx,
          geometry.cy - geometry.ry,
          geometry.rx * 2,
          geometry.ry * 2,
        );
      }
      g.restore();

      drawOrganelles(g, geometry);

      g.save();
      membranePath(g, geometry);
      g.strokeStyle =
        params.condition === "apoptosis"
          ? `rgba(255,101,183,${0.38 + (1 - state.membrane) * 0.5})`
          : `rgba(113,242,189,${0.32 + state.membrane * 0.36})`;
      g.lineWidth = compact ? 1.5 : 2;
      g.shadowColor = params.condition === "apoptosis" ? MAGENTA : ACCENT;
      g.shadowBlur = 12;
      g.stroke();
      g.restore();

      if (state.pulseAge < 3.2) {
        const px = geometry.cx + (state.pulseX - 0.5) * geometry.rx * 2;
        const py = geometry.cy + (state.pulseY - 0.5) * geometry.ry * 2;
        const radius = 8 + state.pulseAge * 24 * params.diffusion;
        g.save();
        g.strokeStyle = `rgba(105,216,255,${clampValue(0.8 - state.pulseAge * 0.22, 0, 0.8)})`;
        g.lineWidth = 1.5;
        g.shadowColor = CYAN;
        g.shadowBlur = 12;
        g.beginPath();
        g.arc(px, py, radius, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }

      const scopeRect = {
        x: compact ? 12 : 24,
        y: height - scopeHeight - 18,
        width: width - (compact ? 24 : 48),
        height: scopeHeight,
      };
      drawScope(g, scopeRect);
      g.save();
      g.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.fillStyle = ACCENT;
      g.fillText("ATP", scopeRect.x + 10, scopeRect.y + 14);
      g.fillStyle = CYAN;
      g.fillText("Ca²⁺", scopeRect.x + 42, scopeRect.y + 14);
      g.fillStyle = MAGENTA;
      g.fillText("CASPASE", scopeRect.x + 82, scopeRect.y + 14);
      g.textAlign = "right";
      g.fillStyle = "rgba(220,232,228,0.6)";
      g.fillText(
        `${params.microscopy.toUpperCase()} · ${params.condition.toUpperCase()}`,
        scopeRect.x + scopeRect.width - 10,
        scopeRect.y + 14,
      );
      g.restore();
    }

    function injectAt(event) {
      if (!lastGeometry) return;
      const point = context.pointerPosition(event);
      const localX = (point.x - lastGeometry.cx) / (lastGeometry.rx * 2) + 0.5;
      const localY = (point.y - lastGeometry.cy) / (lastGeometry.ry * 2) + 0.5;
      const radial =
        Math.pow((point.x - lastGeometry.cx) / lastGeometry.rx, 2) +
        Math.pow((point.y - lastGeometry.cy) / lastGeometry.ry, 2);
      if (radial > 1.04) {
        setStatus("perturbation must land inside the membrane", "warn");
        return;
      }

      const gx = clampValue(Math.round(localX * (GRID - 1)), 2, GRID - 3);
      const gy = clampValue(Math.round(localY * (GRID - 1)), 2, GRID - 3);
      const radius = 2 + Math.round(params.pulseStrength * 4);
      seedSpot(gx, gy, radius, params.pulseStrength);
      state.pulse = clampValue(state.pulse + params.pulseStrength * 0.72, 0, 1.35);
      state.pulseX = localX;
      state.pulseY = localY;
      state.pulseAge = 0;
      state.calcium = clampValue(
        state.calcium + params.pulseStrength * (0.08 + params.permeability * 0.2),
        0,
        1.35,
      );
      touchTick();
      updateMetrics(true);
      draw();
    }

    function onPointerDown(event) {
      pointerDown = true;
      canvas.setPointerCapture?.(event.pointerId);
      injectAt(event);
    }

    function onPointerMove(event) {
      if (pointerDown) injectAt(event);
    }

    function onPointerUp(event) {
      pointerDown = false;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    function frame(now) {
      if (destroyed) return;
      const elapsed = Math.min(0.06, Math.max(0, (now - previousFrameTime) / 1000));
      previousFrameTime = now;
      if (running) {
        accumulator += elapsed;
        while (accumulator >= STEP) {
          stepModel(STEP);
          accumulator -= STEP;
        }
      }
      draw();
      animationFrame = requestAnimationFrame(frame);
    }

    buildMask();
    initializeField();
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", draw);

    updateFieldContrast();
    updateMetrics(true);
    animationFrame = requestAnimationFrame(frame);

    return {
      reset: resetDynamics,
      play() {
        running = true;
        previousFrameTime = performance.now();
      },
      pause() {
        running = false;
      },
      applyPreset(id) {
        const preset = PRESETS[id] ?? PRESETS.homeostasis;
        currentPreset = PRESETS[id] ? id : "homeostasis";
        params = { ...preset };
        syncControls();
        resetDynamics();
      },
      getState() {
        return {
          version: 1,
          preset: currentPreset,
          parameters: { ...params },
          dynamics: {
            tick: state.tick,
            atp: state.atp,
            calcium: state.calcium,
            caspase: state.caspase,
            membrane: state.membrane,
            cycle: state.cycle,
            pulse: state.pulse,
            pulseX: state.pulseX,
            pulseY: state.pulseY,
          },
        };
      },
      setState(saved) {
        const source = saved?.parameters ?? {};
        const condition = ["healthy", "apoptosis", "mitosis"].includes(source.condition)
          ? source.condition
          : params.condition;
        const microscopy = ["phase", "fluorescence", "brightfield"].includes(
          source.microscopy,
        )
          ? source.microscopy
          : params.microscopy;
        params = {
          condition,
          microscopy,
          metabolism: clampValue(Number(source.metabolism ?? params.metabolism), 0.35, 1.5),
          diffusion: clampValue(Number(source.diffusion ?? params.diffusion), 0.35, 1.55),
          stress: clampValue(Number(source.stress ?? params.stress), 0, 1),
          permeability: clampValue(
            Number(source.permeability ?? params.permeability),
            0,
            1,
          ),
          pulseStrength: clampValue(
            Number(source.pulseStrength ?? params.pulseStrength),
            0.15,
            1,
          ),
          organelles:
            typeof source.organelles === "boolean" ? source.organelles : params.organelles,
        };
        currentPreset = typeof saved?.preset === "string" ? saved.preset : "custom";
        syncControls();
        resetDynamics();

        const dynamics = saved?.dynamics ?? {};
        state.tick = Math.max(0, Math.floor(Number(dynamics.tick) || 0));
        state.atp = clampValue(Number(dynamics.atp ?? state.atp), 0.03, 1);
        state.calcium = clampValue(Number(dynamics.calcium ?? state.calcium), 0.015, 1.35);
        state.caspase = clampValue(Number(dynamics.caspase ?? state.caspase), 0, 1.2);
        state.membrane = clampValue(Number(dynamics.membrane ?? state.membrane), 0.18, 1);
        state.cycle = clampValue(Number(dynamics.cycle ?? state.cycle), 0, 1);
        state.pulse = clampValue(Number(dynamics.pulse ?? 0), 0, 1.35);
        state.pulseX = clampValue(Number(dynamics.pulseX ?? 0.5), 0, 1);
        state.pulseY = clampValue(Number(dynamics.pulseY ?? 0.5), 0, 1);
        state.pulseAge = state.pulse > 0 ? 0 : 99;
        if (state.pulse > 0) {
          seedSpot(
            Math.round(state.pulseX * (GRID - 1)),
            Math.round(state.pulseY * (GRID - 1)),
            2 + Math.round(params.pulseStrength * 4),
            Math.min(1, state.pulse),
          );
        }
        histories.atp.reset(state.atp);
        histories.calcium.reset(state.calcium);
        histories.caspase.reset(state.caspase);
        histories.membrane.reset(state.membrane);
        setTick(state.tick);
        updateFieldContrast();
        updateMetrics(true);
        draw();
      },
      destroy() {
        destroyed = true;
        cancelAnimationFrame(animationFrame);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("resize", draw);
      },
    };
  },
};
