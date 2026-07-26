const ACCENT = "#68e4ff";
const AMBER = "#ffbc62";
const STEP = 1 / 120;
const HISTORY_LENGTH = 220;

const PRESETS = {
  tuned: {
    target: 0.78,
    kp: 1.9,
    ki: 0.72,
    kd: 0.075,
    latency: 24,
    noise: 0.008,
    plantTau: 240,
  },
  underdamped: {
    target: 0.9,
    kp: 3.45,
    ki: 1.18,
    kd: 0.012,
    latency: 52,
    noise: 0.005,
    plantTau: 180,
  },
  delayed: {
    target: 0.74,
    kp: 2.25,
    ki: 0.82,
    kd: 0.1,
    latency: 128,
    noise: 0.012,
    plantTau: 390,
  },
  noisy: {
    target: 0.64,
    kp: 1.35,
    ki: 0.58,
    kd: 0.24,
    latency: 36,
    noise: 0.06,
    plantTau: 270,
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

function drawTrace(context, values, rect, min, max, color, width = 1.5) {
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

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export const setup = {
  id: "electrical",
  host: "electricalsetup.com",
  name: "ElectricalSetup",
  field: "Feedback electronics",
  accent: ACCENT,
  themeColor: "#071016",
  code: "ELEC–01",
  experiment: "FPGA optoelectronic loop",
  summary:
    "Tune a sampled PID loop that drives a laser, reads a photodiode, and rejects disturbances in real time.",
  scope:
    "A deterministic lumped model couples a delayed digital PID controller to a saturating second-order optical plant with sensor noise and slow thermal droop.",
  limits: [
    "Blocks are behavioral transfer models, not transistor-, HDL-, or PCB-level simulation.",
    "Timing is represented as a fixed sample delay; clock-domain crossings and quantization spurs are omitted.",
    "The optical plant is normalized and does not predict absolute irradiance, device lifetime, or safety.",
  ],
  interaction:
    "Press or drag on the signal chain: above its center injects drive, below it blocks the plant. Watch the controller recover.",
  canvasHint: "DRAG VERTICALLY TO INJECT A PLANT DISTURBANCE",
  presets: [
    {
      id: "tuned",
      label: "Critically tuned",
      description: "Fast lock with modest overshoot and a quiet sensor.",
    },
    {
      id: "underdamped",
      label: "High-gain ringing",
      description: "Aggressive gain exposes overshoot and control saturation.",
    },
    {
      id: "delayed",
      label: "Latency margin",
      description: "A slow plant and long digital path test loop stability.",
    },
    {
      id: "noisy",
      label: "Noisy photodiode",
      description: "Derivative filtering fights a deliberately rough measurement.",
    },
  ],

  mount(context) {
    const {
      canvas,
      clamp,
      createDivider,
      createRange,
      resizeCanvas,
      setMetrics,
      setStatus,
      setTick,
    } = context;

    let params = { ...PRESETS.tuned };
    let currentPreset = "tuned";
    let running = true;
    let destroyed = false;
    let animationFrame = 0;
    let previousFrameTime = performance.now();
    let accumulator = 0;
    let metricClock = 0;
    let pointerDown = false;
    let randomState = 0x9e3779b9;

    const histories = {
      target: makeHistory(params.target),
      measured: makeHistory(0.18),
      drive: makeHistory(0),
      error: makeHistory(params.target - 0.18),
    };

    const state = {
      tick: 0,
      plant: 0.18,
      plantVelocity: 0,
      measured: 0.18,
      drive: 0,
      integral: 0,
      derivative: 0,
      previousError: params.target - 0.18,
      thermal: 0,
      perturbation: 0,
      peak: 0.18,
      delayBuffer: Array.from({ length: 96 }, () => 0.18),
    };

    function random() {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    }

    function touchTick(amount = 1) {
      state.tick += amount;
      setTick(state.tick);
    }

    function resetDynamics() {
      randomState = 0x9e3779b9;
      accumulator = 0;
      metricClock = 0;
      previousFrameTime = performance.now();
      Object.assign(state, {
        tick: 0,
        plant: 0.18,
        plantVelocity: 0,
        measured: 0.18,
        drive: 0,
        integral: 0,
        derivative: 0,
        previousError: params.target - 0.18,
        thermal: 0,
        perturbation: 0,
        peak: 0.18,
        delayBuffer: Array.from({ length: 96 }, () => 0.18),
      });
      histories.target.reset(params.target);
      histories.measured.reset(state.measured);
      histories.drive.reset(0);
      histories.error.reset(params.target - state.measured);
      setTick(0);
      updateMetrics(true);
      draw();
    }

    function onParameterChange() {
      touchTick();
      updateMetrics(true);
    }

    createDivider("Setpoint + plant");
    const controls = {
      target: createRange({
        id: "electrical-target",
        label: "Target irradiance",
        min: 0.2,
        max: 1.2,
        step: 0.01,
        value: params.target,
        format: (value) => `${Math.round(Number(value) * 100)} %`,
        description: "Normalized optical output requested from the loop.",
        onInput(value) {
          params.target = value;
          onParameterChange();
        },
      }),
      plantTau: createRange({
        id: "electrical-plant-tau",
        label: "Plant response",
        min: 100,
        max: 800,
        step: 10,
        value: params.plantTau,
        unit: "ms",
        description: "Effective laser, driver, and detector response time.",
        onInput(value) {
          params.plantTau = value;
          onParameterChange();
        },
      }),
    };

    createDivider("Digital controller");
    controls.kp = createRange({
      id: "electrical-kp",
      label: "Proportional gain",
      min: 0,
      max: 4,
      step: 0.01,
      value: params.kp,
      description: "Immediate correction from the present error.",
      onInput(value) {
        params.kp = value;
        onParameterChange();
      },
    });
    controls.ki = createRange({
      id: "electrical-ki",
      label: "Integral gain",
      min: 0,
      max: 1.8,
      step: 0.01,
      value: params.ki,
      description: "Slow correction that removes persistent offset.",
      onInput(value) {
        params.ki = value;
        onParameterChange();
      },
    });
    controls.kd = createRange({
      id: "electrical-kd",
      label: "Derivative gain",
      min: 0,
      max: 0.45,
      step: 0.005,
      value: params.kd,
      description: "Filtered prediction that damps fast changes.",
      onInput(value) {
        params.kd = value;
        onParameterChange();
      },
    });

    createDivider("Acquisition path");
    controls.latency = createRange({
      id: "electrical-latency",
      label: "Loop latency",
      min: 0,
      max: 180,
      step: 2,
      value: params.latency,
      unit: "ms",
      description: "ADC, FPGA, DAC, and transport delay.",
      onInput(value) {
        params.latency = value;
        onParameterChange();
      },
    });
    controls.noise = createRange({
      id: "electrical-noise",
      label: "Sensor noise",
      min: 0,
      max: 0.1,
      step: 0.001,
      value: params.noise,
      format: (value) => `${(Number(value) * 100).toFixed(1)} %`,
      description: "Deterministic pseudo-random photodiode and ADC noise.",
      onInput(value) {
        params.noise = value;
        onParameterChange();
      },
    });

    function syncControls() {
      for (const [key, control] of Object.entries(controls)) control.set(params[key]);
    }

    function stepModel(dt) {
      const delaySteps = Math.round((params.latency / 1000) / STEP);
      const delayedIndex = Math.max(0, state.delayBuffer.length - 1 - delaySteps);
      const delayedPlant = state.delayBuffer[delayedIndex] ?? state.plant;
      const shapedNoise = (random() + random() + random() - 1.5) * 1.15 * params.noise;
      state.measured = clampValue(delayedPlant + shapedNoise, 0, 1.5);

      const error = params.target - state.measured;
      state.integral = clampValue(state.integral + error * dt, -0.75, 0.95);
      const rawDerivative = (error - state.previousError) / Math.max(dt, 1e-5);
      state.derivative += (rawDerivative - state.derivative) * Math.min(1, dt * 20);
      state.previousError = error;

      const feedback =
        params.kp * error + params.ki * state.integral + params.kd * state.derivative;
      state.drive = clampValue(params.target * 0.48 + feedback, 0, 1.35);

      state.thermal += (state.drive * state.drive - state.thermal) * dt * 0.42;
      const thermalDroop = 1 - Math.min(0.18, state.thermal * 0.11);
      const commandedPlant = clampValue(
        state.drive * thermalDroop + state.perturbation,
        0,
        1.45,
      );
      const omega = 4.6 / Math.max(0.1, params.plantTau / 1000);
      const damping = 0.78;
      state.plantVelocity +=
        ((commandedPlant - state.plant) * omega * omega -
          2 * damping * omega * state.plantVelocity) *
        dt;
      state.plant = clampValue(state.plant + state.plantVelocity * dt, 0, 1.5);
      state.peak = Math.max(state.peak * 0.9992, state.plant);

      if (!pointerDown) state.perturbation *= Math.exp(-dt * 2.8);
      state.delayBuffer.push(state.plant);
      if (state.delayBuffer.length > 128) state.delayBuffer.shift();

      if (state.tick % 3 === 0) {
        histories.target.push(params.target);
        histories.measured.push(state.measured);
        histories.drive.push(state.drive);
        histories.error.push(error);
      }
      touchTick();
      metricClock += dt;
      if (metricClock >= 0.09) {
        metricClock = 0;
        updateMetrics();
      }
    }

    function updateMetrics(force = false) {
      const error = params.target - state.measured;
      const overshoot = Math.max(0, state.peak - params.target);
      const locked = Math.abs(error) < 0.025 && Math.abs(state.plantVelocity) < 0.08;
      setMetrics([
        {
          id: "output",
          label: "Measured output",
          value: formatPercent(state.measured),
          tone: locked ? "good" : "default",
        },
        {
          id: "error",
          label: "Tracking error",
          value: `${error >= 0 ? "+" : ""}${(error * 100).toFixed(1)} %`,
          tone: Math.abs(error) > 0.12 ? "warning" : "default",
        },
        {
          id: "drive",
          label: "DAC drive",
          value: formatPercent(state.drive / 1.35),
          tone: state.drive > 1.31 ? "warning" : "default",
        },
        {
          id: "latency",
          label: "Loop latency",
          value: `${Math.round(params.latency)} ms`,
        },
        {
          id: "overshoot",
          label: "Peak overshoot",
          value: `${(overshoot * 100).toFixed(1)} %`,
        },
        {
          id: "thermal",
          label: "Thermal load",
          value: formatPercent(clampValue(state.thermal / 1.5, 0, 1)),
        },
      ]);
      if (running || force) {
        setStatus(
          locked ? "loop locked" : Math.abs(error) > 0.15 ? "rejecting disturbance" : "settling",
          Math.abs(error) > 0.15 ? "warn" : "live",
        );
      }
    }

    function drawGrid(g, width, height) {
      g.save();
      g.fillStyle = "rgba(104, 228, 255, 0.055)";
      const spacing = width < 600 ? 26 : 34;
      for (let x = spacing / 2; x < width; x += spacing) {
        for (let y = spacing / 2; y < height; y += spacing) {
          g.beginPath();
          g.arc(x, y, 0.8, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
    }

    function drawArrow(g, fromX, fromY, toX, toY, color, phase) {
      g.save();
      g.strokeStyle = color;
      g.globalAlpha = 0.42;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(fromX, fromY);
      g.lineTo(toX, toY);
      g.stroke();
      const x = fromX + (toX - fromX) * phase;
      const y = fromY + (toY - fromY) * phase;
      g.globalAlpha = 1;
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 12;
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    function drawNode(g, x, y, width, height, label, value, active) {
      g.save();
      roundedRect(g, x, y, width, height, 7);
      g.fillStyle = active ? "rgba(104, 228, 255, 0.1)" : "rgba(11, 18, 26, 0.94)";
      g.fill();
      g.strokeStyle = active ? "rgba(104, 228, 255, 0.62)" : "rgba(255,255,255,0.12)";
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = active ? ACCENT : "rgba(238,244,251,0.78)";
      g.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.textAlign = "center";
      g.fillText(label, x + width / 2, y + height / 2 - 3);
      g.fillStyle = active ? "rgba(104,228,255,0.7)" : "rgba(160,173,189,0.55)";
      g.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.fillText(value, x + width / 2, y + height / 2 + 11);
      g.restore();
    }

    function drawScope(g, rect) {
      g.save();
      roundedRect(g, rect.x, rect.y, rect.width, rect.height, 10);
      g.fillStyle = "rgba(5, 10, 16, 0.88)";
      g.fill();
      g.clip();

      g.strokeStyle = "rgba(255,255,255,0.055)";
      g.lineWidth = 1;
      for (let row = 1; row < 4; row += 1) {
        const y = rect.y + (rect.height * row) / 4;
        g.beginPath();
        g.moveTo(rect.x, y);
        g.lineTo(rect.x + rect.width, y);
        g.stroke();
      }
      for (let column = 1; column < 8; column += 1) {
        const x = rect.x + (rect.width * column) / 8;
        g.beginPath();
        g.moveTo(x, rect.y);
        g.lineTo(x, rect.y + rect.height);
        g.stroke();
      }

      const inner = {
        x: rect.x + 10,
        y: rect.y + 9,
        width: rect.width - 20,
        height: rect.height - 18,
      };
      g.setLineDash([5, 6]);
      drawTrace(g, histories.target.values, inner, 0, 1.4, "rgba(238,244,251,0.35)", 1);
      g.setLineDash([]);
      drawTrace(g, histories.measured.values, inner, 0, 1.4, ACCENT, 1.8);
      drawTrace(g, histories.drive.values, inner, 0, 1.4, AMBER, 1.25);
      g.restore();

      g.save();
      g.fillStyle = "rgba(196,208,222,0.62)";
      g.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.fillText("TARGET", rect.x + 12, rect.y + 16);
      g.fillStyle = ACCENT;
      g.fillText("SENSOR", rect.x + 68, rect.y + 16);
      g.fillStyle = AMBER;
      g.fillText("DRIVE", rect.x + 122, rect.y + 16);
      g.restore();
    }

    function draw() {
      const { context: g, width, height } = resizeCanvas();
      g.clearRect(0, 0, width, height);
      const background = g.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#071118");
      background.addColorStop(0.58, "#090d13");
      background.addColorStop(1, "#0b0b10");
      g.fillStyle = background;
      g.fillRect(0, 0, width, height);
      drawGrid(g, width, height);

      const labels = width < 560
        ? ["LASER", "PLANT", "PD", "ADC", "FPGA", "DAC"]
        : ["LASER", "OPTICAL PLANT", "PHOTODIODE", "ADC", "FPGA · PID", "DAC · DRIVER"];
      const nodeGap = width < 560 ? 6 : 10;
      const side = width < 560 ? 12 : 24;
      const nodeWidth = Math.max(42, (width - side * 2 - nodeGap * 5) / 6);
      const nodeHeight = width < 560 ? 48 : 54;
      const chainY = Math.max(52, Math.min(height * 0.27, 160));
      const values = [
        formatPercent(state.drive / 1.35),
        formatPercent(state.plant),
        formatPercent(state.measured),
        `${Math.round(params.noise * 4095)} LSB`,
        `${(params.target - state.measured).toFixed(2)} e`,
        `${Math.round(state.drive * 3.3)} V`,
      ];
      const nodeXs = labels.map((_, index) => side + index * (nodeWidth + nodeGap));
      const phaseBase = (state.tick * 0.018) % 1;

      for (let index = 0; index < labels.length - 1; index += 1) {
        drawArrow(
          g,
          nodeXs[index] + nodeWidth,
          chainY + nodeHeight / 2,
          nodeXs[index + 1],
          chainY + nodeHeight / 2,
          index < 2 ? AMBER : ACCENT,
          (phaseBase + index * 0.19) % 1,
        );
      }

      labels.forEach((label, index) => {
        const active = index === 1
          ? Math.abs(state.perturbation) > 0.04
          : index === 4
            ? Math.abs(params.target - state.measured) > 0.05
            : index === 0 && state.drive > 1.2;
        drawNode(g, nodeXs[index], chainY, nodeWidth, nodeHeight, label, values[index], active);
      });

      const loopY = chainY - 28;
      g.save();
      g.strokeStyle = "rgba(104,228,255,0.2)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(nodeXs[5] + nodeWidth / 2, chainY);
      g.lineTo(nodeXs[5] + nodeWidth / 2, loopY);
      g.lineTo(nodeXs[0] + nodeWidth / 2, loopY);
      g.lineTo(nodeXs[0] + nodeWidth / 2, chainY);
      g.stroke();
      g.fillStyle = "rgba(104,228,255,0.62)";
      g.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.textAlign = "center";
      g.fillText(
        `SAMPLED LOOP · ${Math.round(params.latency)} ms`,
        width / 2,
        loopY - 7,
      );
      g.restore();

      if (Math.abs(state.perturbation) > 0.015) {
        const plantX = nodeXs[1] + nodeWidth / 2;
        const radius = 18 + Math.abs(state.perturbation) * 28;
        g.save();
        g.strokeStyle = state.perturbation > 0 ? AMBER : "#ff6b76";
        g.globalAlpha = clampValue(Math.abs(state.perturbation), 0.15, 0.8);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(plantX, chainY + nodeHeight / 2, radius, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }

      const scopeTop = Math.max(chainY + nodeHeight + 42, height * 0.53);
      const scopeRect = {
        x: side,
        y: scopeTop,
        width: width - side * 2,
        height: Math.max(96, height - scopeTop - 22),
      };
      drawScope(g, scopeRect);

      g.save();
      g.fillStyle = "rgba(238,244,251,0.68)";
      g.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.fillText(
        `${formatPercent(state.measured)} OUT  ·  ${formatPercent(params.target)} SET`,
        side,
        scopeTop - 13,
      );
      g.textAlign = "right";
      g.fillStyle = Math.abs(params.target - state.measured) < 0.025 ? ACCENT : AMBER;
      g.fillText(
        Math.abs(params.target - state.measured) < 0.025 ? "LOCKED" : "ACQUIRING",
        width - side,
        scopeTop - 13,
      );
      g.restore();
    }

    function pointerPerturb(event) {
      const point = context.pointerPosition(event);
      const vertical = clampValue((0.5 - point.ny) * 1.65, -0.78, 0.78);
      const focus = 0.45 + 0.55 * Math.sin(Math.PI * point.nx);
      state.perturbation = vertical * focus;
      touchTick();
      updateMetrics(true);
      draw();
    }

    function onPointerDown(event) {
      pointerDown = true;
      canvas.setPointerCapture?.(event.pointerId);
      pointerPerturb(event);
    }

    function onPointerMove(event) {
      if (pointerDown) pointerPerturb(event);
    }

    function onPointerUp(event) {
      pointerDown = false;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    function frame(now) {
      if (destroyed) return;
      const elapsed = Math.min(0.05, Math.max(0, (now - previousFrameTime) / 1000));
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

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", draw);

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
        const preset = PRESETS[id] ?? PRESETS.tuned;
        currentPreset = PRESETS[id] ? id : "tuned";
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
            plant: state.plant,
            plantVelocity: state.plantVelocity,
            integral: state.integral,
            thermal: state.thermal,
            perturbation: state.perturbation,
          },
        };
      },
      setState(saved) {
        const source = saved?.parameters ?? {};
        params = {
          target: clampValue(Number(source.target ?? params.target), 0.2, 1.2),
          kp: clampValue(Number(source.kp ?? params.kp), 0, 4),
          ki: clampValue(Number(source.ki ?? params.ki), 0, 1.8),
          kd: clampValue(Number(source.kd ?? params.kd), 0, 0.45),
          latency: clampValue(Number(source.latency ?? params.latency), 0, 180),
          noise: clampValue(Number(source.noise ?? params.noise), 0, 0.1),
          plantTau: clampValue(Number(source.plantTau ?? params.plantTau), 100, 800),
        };
        currentPreset = typeof saved?.preset === "string" ? saved.preset : "custom";
        syncControls();
        resetDynamics();
        const dynamics = saved?.dynamics ?? {};
        state.tick = Math.max(0, Math.floor(Number(dynamics.tick) || 0));
        state.plant = clampValue(Number(dynamics.plant ?? state.plant), 0, 1.5);
        state.plantVelocity = clampValue(
          Number(dynamics.plantVelocity ?? state.plantVelocity),
          -4,
          4,
        );
        state.integral = clampValue(Number(dynamics.integral ?? state.integral), -0.75, 0.95);
        state.thermal = clampValue(Number(dynamics.thermal ?? state.thermal), 0, 2);
        state.perturbation = clampValue(
          Number(dynamics.perturbation ?? state.perturbation),
          -0.78,
          0.78,
        );
        state.measured = state.plant;
        state.delayBuffer.fill(state.plant);
        histories.target.reset(params.target);
        histories.measured.reset(state.plant);
        histories.drive.reset(state.drive);
        histories.error.reset(params.target - state.plant);
        setTick(state.tick);
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
