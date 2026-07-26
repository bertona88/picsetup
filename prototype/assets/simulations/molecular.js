import {
  clamp,
  drawGrid,
  makeHistory,
  rgba,
  seededRandom,
} from "../ui.js";

const presets = {
  gas: {
    count: 52,
    temperature: 1.85,
    attraction: 0.42,
    packing: 0.52,
    thermostat: 0.16,
    timeScale: 1,
    phase: "gas",
  },
  liquid: {
    count: 76,
    temperature: 0.78,
    attraction: 1.08,
    packing: 0.82,
    thermostat: 0.1,
    timeScale: 0.86,
    phase: "liquid",
  },
  crystal: {
    count: 88,
    temperature: 0.18,
    attraction: 1.3,
    packing: 0.92,
    thermostat: 0.18,
    timeScale: 0.72,
    phase: "crystal",
  },
  quench: {
    count: 82,
    temperature: 0.34,
    attraction: 1.55,
    packing: 0.74,
    thermostat: 0.24,
    timeScale: 0.75,
    phase: "gas",
  },
};

function minimumImage(delta) {
  if (delta > 0.5) return delta - 1;
  if (delta < -0.5) return delta + 1;
  return delta;
}

export const setup = {
  id: "molecular",
  defaultPreset: "liquid",
  host: "molecularsetup.com",
  name: "MolecularSetup",
  field: "Molecular dynamics",
  experiment: "From gas to droplet to crystal",
  code: "MOL–12",
  accent: "#70edb1",
  summary:
    "A live two-dimensional Lennard–Jones fluid where thermal motion competes with short-range repulsion and attraction.",
  interaction:
    "Press the fluid to inject a radial heat pulse. Drag a particle to seed a defect, collision, or nucleation site.",
  canvasHint: "Click: heat pulse · Drag a particle: move it · Watch energy redistribute",
  scope:
    "Particles follow classical reduced-unit dynamics with pairwise Lennard–Jones forces, periodic boundaries, and an optional weak Berendsen thermostat.",
  limits: [
    "The model is two-dimensional and uses reduced units rather than a specific molecule.",
    "The thermostat rescales velocities gently; it does not reproduce a full canonical ensemble.",
    "Pair forces are softened at very short range and truncated for real-time stability.",
  ],
  presets: [
    { id: "gas", label: "Hot gas", description: "Kinetic energy overwhelms weak attraction." },
    { id: "liquid", label: "Bound liquid", description: "Cohesion and motion reach a dense balance." },
    { id: "crystal", label: "Cold lattice", description: "A low-temperature triangular order." },
    { id: "quench", label: "Nucleation quench", description: "Cool a dispersed state and watch domains condense." },
  ],

  mount(ctx) {
    const { canvas, controls, setTick, setMetrics, resizeCanvas, pointerPosition } = ctx;
    let params = { ...presets.liquid };
    let particles = [];
    let random = seededRandom(12121);
    let running = true;
    let frame = 0;
    let tick = 0;
    let lastTime = performance.now();
    let selected = null;
    let dragging = false;
    let heatPulse = null;
    let potentialEnergy = 0;
    let virial = 0;
    const temperatureHistory = makeHistory(160, params.temperature);
    const energyHistory = makeHistory(160, 0);
    const controlsByKey = {};

    function sigma() {
      return 0.039 + params.packing * 0.018;
    }

    function addControls() {
      controlsByKey.count = ctx.createRange({
        id: "particle-count",
        label: "Particles",
        min: 28,
        max: 112,
        step: 4,
        value: params.count,
        format: (value) => `${Math.round(value)} atoms`,
        description: "Changing particle count reseeds the box.",
        onInput(value) {
          params.count = Math.round(value);
          reset();
        },
      });
      controlsByKey.temperature = ctx.createRange({
        id: "target-temperature",
        label: "Target temperature",
        min: 0.05,
        max: 2.5,
        step: 0.01,
        value: params.temperature,
        format: (value) => `${Number(value).toFixed(2)} ε/k`,
        onInput(value) {
          params.temperature = value;
        },
      });
      controlsByKey.attraction = ctx.createRange({
        id: "well-depth",
        label: "Attraction ε",
        min: 0.05,
        max: 2.2,
        step: 0.01,
        value: params.attraction,
        format: (value) => Number(value).toFixed(2),
        onInput(value) {
          params.attraction = value;
        },
      });
      controlsByKey.packing = ctx.createRange({
        id: "packing",
        label: "Effective diameter",
        min: 0.3,
        max: 1,
        step: 0.01,
        value: params.packing,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput(value) {
          params.packing = value;
        },
      });
      controlsByKey.thermostat = ctx.createRange({
        id: "thermostat",
        label: "Thermostat coupling",
        min: 0,
        max: 0.45,
        step: 0.01,
        value: params.thermostat,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput(value) {
          params.thermostat = value;
        },
      });
      controlsByKey.timeScale = ctx.createRange({
        id: "molecular-time",
        label: "Time scale",
        min: 0.2,
        max: 1.6,
        step: 0.05,
        value: params.timeScale,
        format: (value) => `${Number(value).toFixed(2)}×`,
        onInput(value) {
          params.timeScale = value;
        },
      });
      ctx.createDivider("Energy");
      ctx.createAction({
        id: "remove-drift",
        label: "Remove center-of-mass drift",
        onClick: removeDrift,
      });
    }

    function gaussian() {
      const u = Math.max(1e-9, random());
      const v = random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    }

    function initializePositions() {
      particles = [];
      const columns = Math.ceil(Math.sqrt(params.count * 1.15));
      const rows = Math.ceil(params.count / columns);
      for (let index = 0; index < params.count; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const triangularOffset = row % 2 ? 0.5 : 0;
        let x = (column + 0.7 + triangularOffset) / (columns + 0.4);
        let y = (row + 0.8) / (rows + 0.6);
        if (params.phase !== "crystal") {
          x += (random() - 0.5) * 0.025;
          y += (random() - 0.5) * 0.025;
        }
        const speedScale = Math.sqrt(Math.max(0.05, params.temperature));
        particles.push({
          x: ((x % 1) + 1) % 1,
          y: ((y % 1) + 1) % 1,
          vx: gaussian() * speedScale,
          vy: gaussian() * speedScale,
          fx: 0,
          fy: 0,
          kinetic: 0,
        });
      }
      removeDrift();
      rescaleTemperature(params.temperature);
    }

    function removeDrift() {
      if (!particles.length) return;
      const meanVx = particles.reduce((sum, particle) => sum + particle.vx, 0) / particles.length;
      const meanVy = particles.reduce((sum, particle) => sum + particle.vy, 0) / particles.length;
      for (const particle of particles) {
        particle.vx -= meanVx;
        particle.vy -= meanVy;
      }
    }

    function rescaleTemperature(target) {
      const kinetic = particles.reduce(
        (sum, particle) => sum + 0.5 * (particle.vx ** 2 + particle.vy ** 2),
        0,
      );
      const current = kinetic / Math.max(1, particles.length);
      if (current <= 1e-12) return;
      const scale = Math.sqrt(Math.max(0.05, target) / current);
      for (const particle of particles) {
        particle.vx *= scale;
        particle.vy *= scale;
      }
    }

    function reset() {
      random = seededRandom(12121);
      initializePositions();
      tick = 0;
      selected = null;
      heatPulse = null;
      temperatureHistory.reset(params.temperature);
      energyHistory.reset(0);
      computeForces();
      updateMetrics();
      setTick(0);
      draw();
    }

    function computeForces() {
      for (const particle of particles) {
        particle.fx = 0;
        particle.fy = 0;
      }
      potentialEnergy = 0;
      virial = 0;
      const sig = sigma();
      const cutoff = sig * 2.5;
      const cutoffSquared = cutoff * cutoff;
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const first = particles[i];
          const second = particles[j];
          let dx = minimumImage(second.x - first.x);
          let dy = minimumImage(second.y - first.y);
          let rSquared = dx * dx + dy * dy;
          if (rSquared > cutoffSquared) continue;
          const minimumDistance = sig * 0.62;
          if (rSquared < minimumDistance * minimumDistance) {
            const scale = minimumDistance / Math.sqrt(Math.max(rSquared, 1e-12));
            dx *= scale;
            dy *= scale;
            rSquared = minimumDistance * minimumDistance;
          }
          const sr2 = (sig * sig) / rSquared;
          const sr6 = sr2 * sr2 * sr2;
          const sr12 = sr6 * sr6;
          const coefficient = clamp(24 * params.attraction * (sr6 - 2 * sr12) / rSquared, -1800, 650);
          const fx = coefficient * dx;
          const fy = coefficient * dy;
          first.fx += fx;
          first.fy += fy;
          second.fx -= fx;
          second.fy -= fy;
          potentialEnergy += 4 * params.attraction * (sr12 - sr6);
          virial += dx * fx + dy * fy;
        }
      }
    }

    function instantaneousTemperature() {
      const kinetic = particles.reduce(
        (sum, particle) => sum + 0.5 * (particle.vx * particle.vx + particle.vy * particle.vy),
        0,
      );
      return {
        kinetic,
        temperature: kinetic / Math.max(1, particles.length),
      };
    }

    function integrate(dt) {
      const half = dt * 0.5;
      for (const particle of particles) {
        if (particle === selected && dragging) continue;
        particle.vx += particle.fx * half;
        particle.vy += particle.fy * half;
        const speed = Math.hypot(particle.vx, particle.vy);
        if (speed > 2.8) {
          particle.vx *= 2.8 / speed;
          particle.vy *= 2.8 / speed;
        }
        particle.x = ((particle.x + particle.vx * dt) % 1 + 1) % 1;
        particle.y = ((particle.y + particle.vy * dt) % 1 + 1) % 1;
      }
      computeForces();
      for (const particle of particles) {
        if (particle === selected && dragging) continue;
        particle.vx += particle.fx * half;
        particle.vy += particle.fy * half;
        particle.kinetic = 0.5 * (particle.vx * particle.vx + particle.vy * particle.vy);
      }

      if (params.thermostat > 0 && tick % 4 === 0) {
        const current = instantaneousTemperature().temperature;
        if (current > 1e-7) {
          const lambda = Math.sqrt(
            clamp(1 + params.thermostat * 0.08 * (params.temperature / current - 1), 0.82, 1.18),
          );
          for (const particle of particles) {
            particle.vx *= lambda;
            particle.vy *= lambda;
          }
        }
      }
      tick += 1;
      if (heatPulse) heatPulse.life *= 0.94;
      if (heatPulse?.life < 0.02) heatPulse = null;
      if (tick % 8 === 0) {
        const thermal = instantaneousTemperature();
        temperatureHistory.push(thermal.temperature);
        energyHistory.push((thermal.kinetic + potentialEnergy) / particles.length);
        updateMetrics(thermal);
      }
      setTick(tick);
    }

    function localOrder() {
      const sig = sigma();
      let orderReal = 0;
      let orderImag = 0;
      let pairs = 0;
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const dx = minimumImage(particles[j].x - particles[i].x);
          const dy = minimumImage(particles[j].y - particles[i].y);
          if (Math.hypot(dx, dy) > sig * 1.55) continue;
          const angle = Math.atan2(dy, dx) * 6;
          orderReal += Math.cos(angle);
          orderImag += Math.sin(angle);
          pairs += 1;
        }
      }
      return pairs ? Math.hypot(orderReal, orderImag) / pairs : 0;
    }

    function updateMetrics(thermal = instantaneousTemperature()) {
      const totalEnergy = thermal.kinetic + potentialEnergy;
      const pressure = particles.length * thermal.temperature + virial * 0.5;
      const order = localOrder();
      setMetrics([
        { id: "temperature", label: "Temperature", value: `${thermal.temperature.toFixed(3)} ε/k`, tone: "accent" },
        { id: "kinetic", label: "Kinetic / particle", value: `${(thermal.kinetic / particles.length).toFixed(3)} ε` },
        { id: "potential", label: "Potential / particle", value: `${(potentialEnergy / particles.length).toFixed(3)} ε` },
        { id: "total", label: "Total / particle", value: `${(totalEnergy / particles.length).toFixed(3)} ε` },
        { id: "pressure", label: "Reduced pressure", value: pressure.toFixed(2) },
        { id: "order", label: "Hexatic order |ψ₆|", value: order.toFixed(3) },
      ]);
    }

    function particleColor(particle) {
      const thermal = clamp(particle.kinetic / 0.08, 0, 1);
      const hue = 158 - thermal * 110;
      return `hsl(${hue}, 82%, ${63 + thermal * 5}%)`;
    }

    function draw() {
      const { context, width, height } = resizeCanvas();
      context.clearRect(0, 0, width, height);
      drawGrid(context, width, height, { spacing: 38, color: "rgba(255,255,255,.024)" });
      const radius = Math.max(2.5, sigma() * Math.min(width, height) * 0.42);

      context.save();
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const first = particles[i];
          const second = particles[j];
          const dx = minimumImage(second.x - first.x);
          const dy = minimumImage(second.y - first.y);
          const distance = Math.hypot(dx, dy);
          if (distance > sigma() * 1.5) continue;
          if (Math.abs(second.x - first.x) > 0.5 || Math.abs(second.y - first.y) > 0.5) continue;
          context.beginPath();
          context.moveTo(first.x * width, first.y * height);
          context.lineTo(second.x * width, second.y * height);
          context.strokeStyle = rgba(setup.accent, clamp((1.5 - distance / sigma()) * 0.13, 0.015, 0.11));
          context.lineWidth = 1;
          context.stroke();
        }
      }
      context.restore();

      for (const particle of particles) {
        const x = particle.x * width;
        const y = particle.y * height;
        const color = particleColor(particle);
        context.beginPath();
        context.arc(x, y, particle === selected ? radius * 1.45 : radius, 0, Math.PI * 2);
        context.fillStyle = particle === selected ? "#ffffff" : color;
        context.shadowColor = color;
        context.shadowBlur = particle === selected ? 14 : 5;
        context.fill();
        context.shadowBlur = 0;
        context.beginPath();
        context.arc(x - radius * 0.22, y - radius * 0.22, Math.max(0.7, radius * 0.18), 0, Math.PI * 2);
        context.fillStyle = "rgba(255,255,255,.65)";
        context.fill();
      }

      if (heatPulse) {
        context.beginPath();
        context.arc(
          heatPulse.x * width,
          heatPulse.y * height,
          (1 - heatPulse.life) * Math.min(width, height) * 0.22 + 10,
          0,
          Math.PI * 2,
        );
        context.strokeStyle = `rgba(255,142,99,${heatPulse.life * 0.45})`;
        context.lineWidth = 2;
        context.stroke();
      }

      const chartWidth = Math.min(260, width * 0.34);
      const chartHeight = 50;
      const chartX = width - chartWidth - 18;
      const chartY = height - chartHeight - 32;
      const maxTemperature = Math.max(2.5, ...temperatureHistory.values);
      context.beginPath();
      temperatureHistory.values.forEach((value, index) => {
        const x = chartX + (index / (temperatureHistory.values.length - 1)) * chartWidth;
        const y = chartY + chartHeight * (1 - value / maxTemperature);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = setup.accent;
      context.lineWidth = 1.3;
      context.stroke();
      context.strokeStyle = "rgba(255,255,255,.09)";
      context.strokeRect(chartX, chartY, chartWidth, chartHeight);
      context.fillStyle = "rgba(255,255,255,.42)";
      context.font = "9px ui-monospace, monospace";
      context.fillText("TEMPERATURE", chartX, chartY - 7);
    }

    function nearestParticle(point) {
      return particles
        .map((particle) => ({
          particle,
          distance: Math.hypot(particle.x - point.nx, particle.y - point.ny),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
    }

    function injectHeat(point) {
      heatPulse = { x: point.nx, y: point.ny, life: 1 };
      for (const particle of particles) {
        const dx = minimumImage(particle.x - point.nx);
        const dy = minimumImage(particle.y - point.ny);
        const distance = Math.hypot(dx, dy);
        if (distance > 0.2 || distance < 1e-5) continue;
        const impulse = (1 - distance / 0.2) * 0.5;
        particle.vx += (dx / distance) * impulse;
        particle.vy += (dy / distance) * impulse;
      }
    }

    function onPointerDown(event) {
      const point = pointerPosition(event);
      const nearest = nearestParticle(point);
      if (nearest?.distance < 0.035) {
        selected = nearest.particle;
        dragging = true;
        canvas.setPointerCapture?.(event.pointerId);
        selected.vx = 0;
        selected.vy = 0;
      } else {
        selected = null;
        injectHeat(point);
      }
      draw();
    }

    function onPointerMove(event) {
      if (!dragging || !selected) return;
      const point = pointerPosition(event);
      selected.x = point.nx;
      selected.y = point.ny;
      selected.vx = 0;
      selected.vy = 0;
      draw();
    }

    function onPointerUp(event) {
      dragging = false;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    function loop(now) {
      if (!running) return;
      const delta = Math.min(38, now - lastTime);
      lastTime = now;
      const substeps = Math.max(1, Math.round((delta / 16.67) * 3 * params.timeScale));
      for (let index = 0; index < substeps; index += 1) integrate(0.0017);
      draw();
      frame = requestAnimationFrame(loop);
    }

    function syncControls() {
      for (const [key, control] of Object.entries(controlsByKey)) control.set(params[key]);
    }

    function applyPreset(id) {
      params = { ...(presets[id] || presets.liquid) };
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

const TAU = Math.PI * 2;
