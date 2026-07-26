const GRID_WIDTH = 120;
const GRID_HEIGHT = 72;
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const X_MIN = -6;
const X_MAX = 6;
const Z_MIN = 0;
const Z_MAX = 8;
const DX = (X_MAX - X_MIN) / (GRID_WIDTH - 1);
const DZ = (Z_MAX - Z_MIN) / (GRID_HEIGHT - 1);
const FIXED_DT = 0.025;
const TAU = Math.PI * 2;

const DEFAULTS = Object.freeze({
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
});

const PRESET_STATES = {
  voxel: DEFAULTS,
  line: {
    ...DEFAULTS,
    powerMw: 11.5,
    scanSpeed: 2.1,
    scanMode: "line",
    focusZ: 4,
  },
  hatch: {
    ...DEFAULTS,
    powerMw: 12.5,
    waistUm: 0.5,
    scanSpeed: 3.4,
    diffusion: 0.055,
    threshold: 0.46,
    scanMode: "raster",
    focusZ: 1.3,
  },
  bloom: {
    ...DEFAULTS,
    powerMw: 16,
    waistUm: 0.78,
    scanSpeed: 1.1,
    diffusion: 0.17,
    threshold: 0.3,
    scanMode: "line",
    focusZ: 4.2,
  },
};

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

function drawLabel(context, text, x, y, align = "left", color = "rgba(224,235,240,.58)") {
  context.fillStyle = color;
  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = align;
  context.fillText(text, x, y);
}

function triangularWave(value) {
  const phase = ((value % 2) + 2) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

export const setup = {
  id: "two-photon",
  host: "twophotonlithography.com",
  name: "TwoPhotonLithography",
  field: "Nonlinear fabrication",
  accent: "#e879ff",
  themeColor: "#120817",
  code: "TPL–XZ",
  experiment: "Two-photon resin scanner",
  summary: "Move a Gaussian focus through resin and watch nonlinear dose become radicals, polymer, and a developed feature.",
  scope:
    "A deterministic 2D XZ reaction–diffusion model: Gaussian intensity, two-photon source I², radical diffusion/decay, and thresholded development.",
  limits: [
    "The fields are pedagogical and dimensionless; they are not calibrated to a specific photoresist or objective.",
    "Vector diffraction, oxygen inhibition, heat, shrinkage, and 3D transport are not included.",
  ],
  interaction:
    "Drag through the resin to write a path directly. Pause to inspect, then switch on development to remove sub-threshold material.",
  canvasHint: "DRAG IN RESIN TO WRITE · DEVELOPMENT IS A PREVIEW",
  presets: [
    {
      id: "voxel",
      label: "Single voxel",
      description: "Hold a diffraction-limited focus and watch one feature cross threshold.",
    },
    {
      id: "line",
      label: "Written line",
      description: "Scan laterally at constant depth to compare dose and feature width.",
    },
    {
      id: "hatch",
      label: "Hatched wall",
      description: "Build a cross-section with stacked serpentine scan lines.",
    },
    {
      id: "bloom",
      label: "Diffusion bloom",
      description: "High power and mobile radicals broaden the retained region.",
    },
  ],

  mount(context) {
    const {
      canvas,
      createRange,
      createSelect,
      createToggle,
      createAction,
      createDivider,
      setMetrics,
      resizeCanvas,
      pointerPosition,
      clamp,
      setTick,
      setStatus,
    } = context;

    const state = { ...DEFAULTS };
    const controls = {};
    let dose = new Float32Array(CELL_COUNT);
    let radicals = new Float32Array(CELL_COUNT);
    let radicalScratch = new Float32Array(CELL_COUNT);
    let polymer = new Float32Array(CELL_COUNT);
    const fieldCanvas = document.createElement("canvas");
    fieldCanvas.width = GRID_WIDTH;
    fieldCanvas.height = GRID_HEIGHT;
    const fieldContext = fieldCanvas.getContext("2d");
    const fieldImage = fieldContext.createImageData(GRID_WIDTH, GRID_HEIGHT);

    let running = true;
    let frameId = 0;
    let previousTimestamp = 0;
    let accumulator = 0;
    let simulationTime = 0;
    let tick = 0;
    let layout = null;
    let pointer = null;
    let manualOverrideUntil = 0;

    canvas.style.touchAction = "none";
    canvas.style.cursor = "crosshair";

    function touch() {
      tick += 1;
      setTick(tick);
      draw();
    }

    controls.powerMw = createRange({
      id: "tpl-power",
      label: "Average power",
      min: 3,
      max: 20,
      step: 0.1,
      value: state.powerMw,
      unit: "mW",
      description: "Peak model intensity scales linearly; exposure scales as I².",
      onInput: (value) => {
        state.powerMw = value;
        touch();
      },
    });
    controls.waistUm = createRange({
      id: "tpl-waist",
      label: "Lateral waist",
      min: 0.3,
      max: 1.2,
      step: 0.01,
      value: state.waistUm,
      unit: "µm",
      description: "1/e² intensity radius; axial waist is 1.8× larger.",
      onInput: (value) => {
        state.waistUm = value;
        touch();
      },
    });
    controls.scanSpeed = createRange({
      id: "tpl-speed",
      label: "Scan speed",
      min: 0.4,
      max: 8,
      step: 0.1,
      value: state.scanSpeed,
      unit: "µm/s",
      onInput: (value) => {
        state.scanSpeed = value;
        touch();
      },
    });
    controls.scanMode = createSelect({
      id: "tpl-path",
      label: "Programmed path",
      value: state.scanMode,
      choices: [
        { value: "stationary", label: "Stationary voxel" },
        { value: "line", label: "Bidirectional line" },
        { value: "raster", label: "Serpentine hatch" },
      ],
      description: "Manual dragging temporarily takes control of the focus.",
      onChange: (value) => {
        state.scanMode = value;
        simulationTime = 0;
        touch();
      },
    });
    controls.autoScan = createToggle({
      id: "tpl-auto",
      label: "Automatic exposure",
      checked: state.autoScan,
      description: "Expose continuously along the selected programmed path.",
      onChange: (value) => {
        state.autoScan = value;
        touch();
      },
    });

    createDivider("Resist kinetics");
    controls.diffusion = createRange({
      id: "tpl-diffusion",
      label: "Radical diffusion",
      min: 0,
      max: 0.2,
      step: 0.002,
      value: state.diffusion,
      format: (value) => `${Number(value).toFixed(3)} µm²/s`,
      onInput: (value) => {
        state.diffusion = value;
        touch();
      },
    });
    controls.radicalLifetime = createRange({
      id: "tpl-lifetime",
      label: "Radical lifetime",
      min: 0.2,
      max: 2,
      step: 0.02,
      value: state.radicalLifetime,
      unit: "s",
      onInput: (value) => {
        state.radicalLifetime = value;
        touch();
      },
    });
    controls.threshold = createRange({
      id: "tpl-threshold",
      label: "Gel threshold",
      min: 0.12,
      max: 0.8,
      step: 0.01,
      value: state.threshold,
      format: (value) => `${(Number(value) * 100).toFixed(0)}% conversion`,
      description: "Polymer below this conversion is removed in development preview.",
      onInput: (value) => {
        state.threshold = value;
        touch();
      },
    });
    controls.developed = createToggle({
      id: "tpl-develop",
      label: "Development preview",
      checked: state.developed,
      description: "Hide material that has not crossed the gel threshold.",
      onChange: (value) => {
        state.developed = value;
        setStatus(value ? "development preview" : running ? "simulation live" : "simulation paused", value ? "preview" : running ? "live" : "paused");
        touch();
      },
    });
    createAction({
      id: "tpl-clear-resin",
      label: "Clear exposed resin",
      quiet: true,
      onClick: () => {
        clearFields();
        simulationTime = 0;
        tick = 0;
        setTick(0);
        draw();
      },
    });

    function syncControls() {
      controls.powerMw.set(state.powerMw);
      controls.waistUm.set(state.waistUm);
      controls.scanSpeed.set(state.scanSpeed);
      controls.scanMode.set(state.scanMode);
      controls.autoScan.set(state.autoScan);
      controls.diffusion.set(state.diffusion);
      controls.radicalLifetime.set(state.radicalLifetime);
      controls.threshold.set(state.threshold);
      controls.developed.set(state.developed);
    }

    function clearFields() {
      dose.fill(0);
      radicals.fill(0);
      radicalScratch.fill(0);
      polymer.fill(0);
    }

    function trajectory(time) {
      if (state.scanMode === "stationary") return { x: state.focusX, z: state.focusZ };
      const span = 10;
      const progress = (time * state.scanSpeed) / span;
      const x = -5 + triangularWave(progress) * span;
      if (state.scanMode === "line") return { x, z: state.focusZ };

      const lineDuration = span / Math.max(state.scanSpeed, 0.01);
      const rowCount = 13;
      const row = Math.floor(time / lineDuration) % rowCount;
      const rowProgress = (time % lineDuration) / lineDuration;
      const rasterX = row % 2 === 0 ? -5 + rowProgress * span : 5 - rowProgress * span;
      return { x: rasterX, z: 1.25 + row * 0.46 };
    }

    function applyExposure(duration, focusX = state.focusX, focusZ = state.focusZ) {
      if (duration <= 0) return;
      const waistX = state.waistUm;
      const waistZ = state.waistUm * 1.8;
      const xRadius = Math.ceil((waistX * 2.3) / DX);
      const zRadius = Math.ceil((waistZ * 2.3) / DZ);
      const centerX = Math.round(((focusX - X_MIN) / (X_MAX - X_MIN)) * (GRID_WIDTH - 1));
      const centerZ = Math.round(((focusZ - Z_MIN) / (Z_MAX - Z_MIN)) * (GRID_HEIGHT - 1));
      const peakIntensity = state.powerMw / 10;

      const minX = Math.max(0, centerX - xRadius);
      const maxX = Math.min(GRID_WIDTH - 1, centerX + xRadius);
      const minZ = Math.max(0, centerZ - zRadius);
      const maxZ = Math.min(GRID_HEIGHT - 1, centerZ + zRadius);

      for (let zIndex = minZ; zIndex <= maxZ; zIndex += 1) {
        const z = Z_MIN + zIndex * DZ;
        const zTerm = ((z - focusZ) / waistZ) ** 2;
        for (let xIndex = minX; xIndex <= maxX; xIndex += 1) {
          const x = X_MIN + xIndex * DX;
          const exponent = -2 * ((((x - focusX) / waistX) ** 2) + zTerm);
          if (exponent < -10) continue;
          const intensity = peakIntensity * Math.exp(exponent);
          const twoPhotonSource = intensity * intensity;
          const index = zIndex * GRID_WIDTH + xIndex;
          dose[index] = Math.min(4, dose[index] + twoPhotonSource * duration * 0.58);
          radicals[index] = Math.min(5, radicals[index] + twoPhotonSource * duration * 0.92);
        }
      }
    }

    function diffuseAndPolymerize(duration) {
      const maxCell = Math.min(DX, DZ);
      const requestedAlpha = (state.diffusion * duration) / (maxCell * maxCell);
      const substeps = Math.max(1, Math.ceil(requestedAlpha / 0.19));
      const subDuration = duration / substeps;
      const alphaX = (state.diffusion * subDuration) / (DX * DX);
      const alphaZ = (state.diffusion * subDuration) / (DZ * DZ);
      const decay = subDuration / state.radicalLifetime;

      for (let substep = 0; substep < substeps; substep += 1) {
        for (let z = 0; z < GRID_HEIGHT; z += 1) {
          const row = z * GRID_WIDTH;
          const rowAbove = Math.max(0, z - 1) * GRID_WIDTH;
          const rowBelow = Math.min(GRID_HEIGHT - 1, z + 1) * GRID_WIDTH;
          for (let x = 0; x < GRID_WIDTH; x += 1) {
            const index = row + x;
            const value = radicals[index];
            const left = radicals[row + Math.max(0, x - 1)];
            const right = radicals[row + Math.min(GRID_WIDTH - 1, x + 1)];
            const above = radicals[rowAbove + x];
            const below = radicals[rowBelow + x];
            const next =
              value +
              alphaX * (left + right - 2 * value) +
              alphaZ * (above + below - 2 * value) -
              value * decay;
            radicalScratch[index] = Math.max(0, next);
          }
        }
        const swap = radicals;
        radicals = radicalScratch;
        radicalScratch = swap;
      }

      for (let index = 0; index < CELL_COUNT; index += 1) {
        const conversion = polymer[index];
        polymer[index] = Math.min(1, conversion + 0.78 * radicals[index] * (1 - conversion) * duration);
      }
    }

    function simulationStep(duration, timestamp) {
      if (state.autoScan && timestamp >= manualOverrideUntil) {
        const next = trajectory(simulationTime);
        state.focusX = next.x;
        state.focusZ = next.z;
        applyExposure(duration);
      }
      diffuseAndPolymerize(duration);
      simulationTime += duration;
      tick += 1;
    }

    function buildLayout(width, height) {
      const side = clamp(width * 0.075, 38, 68);
      const top = clamp(height * 0.11, 54, 78);
      const bottom = 54;
      return {
        field: {
          x: side,
          y: top,
          width: Math.max(180, width - side * 2),
          height: Math.max(130, height - top - bottom),
        },
      };
    }

    function worldToCanvas(x, z) {
      return {
        x: layout.field.x + ((x - X_MIN) / (X_MAX - X_MIN)) * layout.field.width,
        y: layout.field.y + ((z - Z_MIN) / (Z_MAX - Z_MIN)) * layout.field.height,
      };
    }

    function canvasToWorld(point) {
      return {
        x: clamp(X_MIN + ((point.x - layout.field.x) / layout.field.width) * (X_MAX - X_MIN), X_MIN, X_MAX),
        z: clamp(Z_MIN + ((point.y - layout.field.y) / layout.field.height) * (Z_MAX - Z_MIN), Z_MIN, Z_MAX),
      };
    }

    function pointInField(point) {
      const field = layout.field;
      return (
        point.x >= field.x &&
        point.x <= field.x + field.width &&
        point.y >= field.y &&
        point.y <= field.y + field.height
      );
    }

    function renderField() {
      const pixels = fieldImage.data;
      let maximumDose = 0;
      let maximumRadicals = 0;
      let maximumPolymer = 0;
      let retainedCells = 0;
      let minRetainedX = GRID_WIDTH;
      let maxRetainedX = -1;
      let minRetainedZ = GRID_HEIGHT;
      let maxRetainedZ = -1;

      for (let index = 0; index < CELL_COUNT; index += 1) {
        const d = dose[index];
        const r = radicals[index];
        const p = polymer[index];
        maximumDose = Math.max(maximumDose, d);
        maximumRadicals = Math.max(maximumRadicals, r);
        maximumPolymer = Math.max(maximumPolymer, p);
        if (p >= state.threshold) {
          retainedCells += 1;
          const x = index % GRID_WIDTH;
          const z = Math.floor(index / GRID_WIDTH);
          minRetainedX = Math.min(minRetainedX, x);
          maxRetainedX = Math.max(maxRetainedX, x);
          minRetainedZ = Math.min(minRetainedZ, z);
          maxRetainedZ = Math.max(maxRetainedZ, z);
        }

        const offset = index * 4;
        if (state.developed) {
          if (p >= state.threshold) {
            const retained = clamp((p - state.threshold) / Math.max(0.01, 1 - state.threshold), 0, 1);
            pixels[offset] = 118 + retained * 110;
            pixels[offset + 1] = 74 + retained * 174;
            pixels[offset + 2] = 154 + retained * 101;
            pixels[offset + 3] = 255;
          } else {
            pixels[offset] = 5;
            pixels[offset + 1] = 9;
            pixels[offset + 2] = 15;
            pixels[offset + 3] = 255;
          }
        } else {
          const doseTone = clamp(d / 1.6, 0, 1);
          const radicalTone = clamp(r / 1.4, 0, 1);
          pixels[offset] = 7 + radicalTone * 122 + p * 80;
          pixels[offset + 1] = 14 + doseTone * 82 + p * 160;
          pixels[offset + 2] = 24 + doseTone * 142 + radicalTone * 54 + p * 46;
          pixels[offset + 3] = 255;
        }
      }
      fieldContext.putImageData(fieldImage, 0, 0);

      return {
        maximumDose,
        maximumRadicals,
        maximumPolymer,
        retainedCells,
        retainedWidth: retainedCells ? (maxRetainedX - minRetainedX + 1) * DX : 0,
        retainedDepth: retainedCells ? (maxRetainedZ - minRetainedZ + 1) * DZ : 0,
        retainedArea: retainedCells * DX * DZ,
      };
    }

    function drawBackground(ctx, width, height) {
      ctx.fillStyle = "#0b0810";
      ctx.fillRect(0, 0, width, height);
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.48, 0, width * 0.5, height * 0.48, width * 0.68);
      glow.addColorStop(0, "rgba(199,83,225,.15)");
      glow.addColorStop(0.52, "rgba(63,28,75,.06)");
      glow.addColorStop(1, "rgba(8,6,12,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "rgba(240,221,246,.04)";
      for (let x = 18; x < width; x += 30) {
        for (let y = 18; y < height; y += 30) ctx.fillRect(x, y, 1, 1);
      }
    }

    function drawProgrammedPath(ctx) {
      const field = layout.field;
      ctx.save();
      ctx.beginPath();
      roundedRect(ctx, field.x, field.y, field.width, field.height, 10);
      ctx.clip();
      ctx.strokeStyle = "rgba(232,121,255,.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 7]);
      if (state.scanMode === "line") {
        const left = worldToCanvas(-5, state.focusZ);
        const right = worldToCanvas(5, state.focusZ);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
      } else if (state.scanMode === "raster") {
        for (let row = 0; row < 13; row += 1) {
          const z = 1.25 + row * 0.46;
          const left = worldToCanvas(-5, z);
          const right = worldToCanvas(5, z);
          ctx.beginPath();
          ctx.moveTo(left.x, left.y);
          ctx.lineTo(right.x, right.y);
          ctx.stroke();
        }
      } else {
        const focus = worldToCanvas(state.focusX, state.focusZ);
        ctx.beginPath();
        ctx.arc(focus.x, focus.y, 16, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawFocus(ctx) {
      const focus = worldToCanvas(state.focusX, state.focusZ);
      const radiusX = (state.waistUm / (X_MAX - X_MIN)) * layout.field.width;
      const radiusZ = ((state.waistUm * 1.8) / (Z_MAX - Z_MIN)) * layout.field.height;
      const aura = ctx.createRadialGradient(focus.x, focus.y, 1, focus.x, focus.y, Math.max(radiusX, radiusZ) * 2.2);
      aura.addColorStop(0, "rgba(255,247,255,.92)");
      aura.addColorStop(0.18, "rgba(232,121,255,.52)");
      aura.addColorStop(1, "rgba(232,121,255,0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.ellipse(focus.x, focus.y, radiusX * 2.2, radiusZ * 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(focus.x, focus.y, radiusX, radiusZ, 0, 0, TAU);
      ctx.strokeStyle = "rgba(255,235,255,.82)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(focus.x - 12, focus.y);
      ctx.lineTo(focus.x + 12, focus.y);
      ctx.moveTo(focus.x, focus.y - 12);
      ctx.lineTo(focus.x, focus.y + 12);
      ctx.strokeStyle = "#fff1ff";
      ctx.shadowColor = "#e879ff";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    function draw() {
      const { context: ctx, width, height } = resizeCanvas();
      if (width < 2 || height < 2) return;
      layout = buildLayout(width, height);
      drawBackground(ctx, width, height);
      const stats = renderField();
      const field = layout.field;

      roundedRect(ctx, field.x - 1, field.y - 1, field.width + 2, field.height + 2, 11);
      ctx.fillStyle = "rgba(4,7,12,.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(240,204,247,.16)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      roundedRect(ctx, field.x, field.y, field.width, field.height, 10);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fieldCanvas, field.x, field.y, field.width, field.height);
      const depthShade = ctx.createLinearGradient(field.x, field.y, field.x, field.y + field.height);
      depthShade.addColorStop(0, "rgba(145,194,255,.05)");
      depthShade.addColorStop(1, "rgba(1,4,10,.22)");
      ctx.fillStyle = depthShade;
      ctx.fillRect(field.x, field.y, field.width, field.height);
      ctx.restore();

      drawProgrammedPath(ctx);
      drawFocus(ctx);

      ctx.beginPath();
      ctx.moveTo(field.x, field.y);
      ctx.lineTo(field.x + field.width, field.y);
      ctx.strokeStyle = "rgba(168,212,255,.55)";
      ctx.lineWidth = 1.4;
      ctx.shadowColor = "#80bfff";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      drawLabel(ctx, "AIR / RESIN INTERFACE", field.x, field.y - 12, "left", "#9bcaff");
      drawLabel(ctx, "XZ REACTION–DIFFUSION FIELD", field.x + field.width, field.y - 12, "right");
      drawLabel(ctx, `${X_MIN} µm`, field.x, field.y + field.height + 19, "left");
      drawLabel(ctx, "X", field.x + field.width / 2, field.y + field.height + 19, "center", "#e879ff");
      drawLabel(ctx, `+${X_MAX} µm`, field.x + field.width, field.y + field.height + 19, "right");
      drawLabel(ctx, "0", field.x - 12, field.y + 3, "right");
      drawLabel(ctx, `${Z_MAX} µm`, field.x - 12, field.y + field.height, "right");
      drawLabel(ctx, "Z", field.x - 12, field.y + field.height / 2, "right", "#e879ff");

      const badgeWidth = 164;
      roundedRect(ctx, field.x + 12, field.y + 12, badgeWidth, 27, 6);
      ctx.fillStyle = "rgba(8,7,13,.75)";
      ctx.fill();
      ctx.strokeStyle = "rgba(232,121,255,.22)";
      ctx.stroke();
      drawLabel(
        ctx,
        state.developed ? "DEVELOPED · P ≥ Pgel" : "EXPOSURE · SOURCE ∝ I²",
        field.x + 22,
        field.y + 30,
        "left",
        state.developed ? "#f1b5ff" : "#e879ff",
      );

      const lateralFwhm = state.waistUm * Math.sqrt(Math.log(2));
      const peakTwoPhoton = (state.powerMw / 10) ** 2;
      setMetrics([
        { id: "focus", label: "Focus · x / z", value: `${state.focusX.toFixed(2)} / ${state.focusZ.toFixed(2)} µm` },
        { id: "source", label: "Peak I² source", value: `${peakTwoPhoton.toFixed(2)} rel.`, tone: peakTwoPhoton > 2 ? "warning" : "accent" },
        { id: "fwhm", label: "I² lateral FWHM", value: `${lateralFwhm.toFixed(2)} µm` },
        { id: "dose", label: "Peak accumulated dose", value: `${stats.maximumDose.toFixed(2)} rel.` },
        { id: "radicals", label: "Peak radical density", value: `${stats.maximumRadicals.toFixed(2)} rel.` },
        { id: "conversion", label: "Peak conversion", value: `${(stats.maximumPolymer * 100).toFixed(1)}%`, tone: stats.maximumPolymer >= state.threshold ? "accent" : "default" },
        { id: "retained", label: "Retained XZ area", value: `${stats.retainedArea.toFixed(2)} µm²` },
        { id: "span", label: "Retained span · x / z", value: stats.retainedCells ? `${stats.retainedWidth.toFixed(2)} / ${stats.retainedDepth.toFixed(2)} µm` : "below threshold" },
      ]);
    }

    function exposeStroke(from, to, duration) {
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      const segments = Math.max(1, Math.ceil(distance / Math.max(0.06, state.waistUm * 0.28)));
      for (let index = 1; index <= segments; index += 1) {
        const fraction = index / segments;
        const x = from.x + (to.x - from.x) * fraction;
        const z = from.z + (to.z - from.z) * fraction;
        applyExposure(duration / segments, x, z);
      }
      diffuseAndPolymerize(duration);
    }

    function onPointerDown(event) {
      if (!layout) return;
      const point = pointerPosition(event);
      if (!pointInField(point)) return;
      const world = canvasToWorld(point);
      state.focusX = world.x;
      state.focusZ = world.z;
      pointer = {
        id: event.pointerId,
        world,
        timestamp: event.timeStamp,
      };
      manualOverrideUntil = performance.now() + 1200;
      applyExposure(0.055, world.x, world.z);
      diffuseAndPolymerize(0.02);
      canvas.setPointerCapture?.(event.pointerId);
      canvas.style.cursor = "grabbing";
      touch();
      event.preventDefault();
    }

    function onPointerMove(event) {
      if (!layout) return;
      const point = pointerPosition(event);
      if (!pointer) {
        canvas.style.cursor = pointInField(point) ? "crosshair" : "default";
        return;
      }
      const world = canvasToWorld(point);
      const duration = clamp((event.timeStamp - pointer.timestamp) / 1000, 0.015, 0.14);
      exposeStroke(pointer.world, world, duration);
      state.focusX = world.x;
      state.focusZ = world.z;
      pointer.world = world;
      pointer.timestamp = event.timeStamp;
      manualOverrideUntil = performance.now() + 1200;
      touch();
      event.preventDefault();
    }

    function onPointerUp(event) {
      if (!pointer || pointer.id !== event.pointerId) return;
      pointer = null;
      canvas.releasePointerCapture?.(event.pointerId);
      canvas.style.cursor = "crosshair";
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    function frame(timestamp) {
      if (!running) return;
      if (!previousTimestamp) previousTimestamp = timestamp;
      const elapsed = Math.min(0.05, (timestamp - previousTimestamp) / 1000);
      previousTimestamp = timestamp;
      accumulator += elapsed * 1.25;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 4) {
        simulationStep(FIXED_DT, timestamp);
        accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps > 0) setTick(tick);
      draw();
      frameId = requestAnimationFrame(frame);
    }

    function encodeField() {
      let any = false;
      const packed = new Uint8Array(CELL_COUNT);
      for (let index = 0; index < CELL_COUNT; index += 1) {
        const doseNibble = Math.round(clamp(dose[index] / 3, 0, 1) * 15);
        const polymerNibble = Math.round(clamp(polymer[index], 0, 1) * 15);
        const value = (doseNibble << 4) | polymerNibble;
        packed[index] = value;
        if (value) any = true;
      }
      return any ? btoa(String.fromCharCode(...packed)) : "";
    }

    function decodeField(value) {
      clearFields();
      if (typeof value !== "string" || !value) return;
      const binary = atob(value);
      if (binary.length !== CELL_COUNT) return;
      for (let index = 0; index < CELL_COUNT; index += 1) {
        const packed = binary.charCodeAt(index);
        dose[index] = ((packed >> 4) / 15) * 3;
        polymer[index] = (packed & 15) / 15;
      }
    }

    function setParameters(next) {
      state.powerMw = clamp(Number(next.powerMw ?? state.powerMw), 3, 20);
      state.waistUm = clamp(Number(next.waistUm ?? state.waistUm), 0.3, 1.2);
      state.scanSpeed = clamp(Number(next.scanSpeed ?? state.scanSpeed), 0.4, 8);
      state.diffusion = clamp(Number(next.diffusion ?? state.diffusion), 0, 0.2);
      state.threshold = clamp(Number(next.threshold ?? state.threshold), 0.12, 0.8);
      state.radicalLifetime = clamp(Number(next.radicalLifetime ?? state.radicalLifetime), 0.2, 2);
      state.scanMode = ["stationary", "line", "raster"].includes(next.scanMode) ? next.scanMode : state.scanMode;
      state.autoScan = next.autoScan === undefined ? state.autoScan : Boolean(next.autoScan);
      state.developed = next.developed === undefined ? state.developed : Boolean(next.developed);
      state.focusX = clamp(Number(next.focusX ?? state.focusX), X_MIN, X_MAX);
      state.focusZ = clamp(Number(next.focusZ ?? state.focusZ), Z_MIN, Z_MAX);
      syncControls();
    }

    function reset() {
      Object.assign(state, DEFAULTS);
      clearFields();
      simulationTime = 0;
      previousTimestamp = 0;
      accumulator = 0;
      tick = 0;
      setTick(0);
      syncControls();
      setStatus(running ? "simulation live" : "simulation paused", running ? "live" : "paused");
      draw();
    }

    function applyPreset(id) {
      Object.assign(state, PRESET_STATES[id] || DEFAULTS);
      clearFields();
      simulationTime = 0;
      accumulator = 0;
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
        setStatus(state.developed ? "development preview" : "simulation live", state.developed ? "preview" : "live");
        frameId = requestAnimationFrame(frame);
      },
      pause() {
        running = false;
        cancelAnimationFrame(frameId);
        draw();
      },
      getState() {
        return {
          version: 1,
          ...state,
          simulationTime: Number(simulationTime.toFixed(3)),
          field: encodeField(),
        };
      },
      setState(next) {
        if (!next || typeof next !== "object") return;
        setParameters(next);
        simulationTime = clamp(Number(next.simulationTime ?? 0), 0, 3600);
        decodeField(next.field);
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
