import {
  clamp,
  drawGrid,
  makeHistory,
  rgba,
  seededRandom,
} from "../ui.js";

const presets = {
  commons: {
    population: 28,
    regeneration: 0.72,
    scarcity: 0.28,
    temptation: 0.24,
    visibility: 0.82,
    mutation: 0.02,
  },
  scarcity: {
    population: 34,
    regeneration: 0.28,
    scarcity: 0.76,
    temptation: 0.5,
    visibility: 0.62,
    mutation: 0.03,
  },
  cascade: {
    population: 32,
    regeneration: 0.42,
    scarcity: 0.58,
    temptation: 0.86,
    visibility: 0.35,
    mutation: 0.018,
  },
  transparent: {
    population: 30,
    regeneration: 0.46,
    scarcity: 0.52,
    temptation: 0.58,
    visibility: 1,
    mutation: 0.012,
  },
};

function gini(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-9) return 0;
  let weighted = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    weighted += (index + 1) * sorted[index];
  }
  return clamp((2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length, 0, 1);
}

export const setup = {
  id: "ego",
  host: "egosetup.com",
  name: "EgoSetup",
  field: "Agent systems",
  experiment: "Self-interest under scarcity",
  code: "EGO–07",
  accent: "#ff8d64",
  summary:
    "A spatial commons where private strategies, reputation, and finite resources co-evolve in real time.",
  interaction:
    "Click the field to inject a resource pulse. Click an agent to expose its private drive and public reputation.",
  canvasHint: "Click: add resources · Click an agent: inspect its private strategy",
  scope:
    "Agents use deterministic steering and bounded repeated-game rules. The EGO index is an interpretable heuristic, not a psychological measurement.",
  limits: [
    "No language model is called; behavior is reproducible in-browser.",
    "Strategy uses local information, stockpiles, trust memory, and mutation.",
    "EGO combines inequality, defection, and hoarding; it is not a universal social metric.",
  ],
  presets: [
    { id: "commons", label: "Working commons", description: "Visible actions and abundant renewal." },
    { id: "scarcity", label: "Resource winter", description: "Low regeneration tests collective resilience." },
    { id: "cascade", label: "Betrayal cascade", description: "High temptation and weak observability." },
    { id: "transparent", label: "Radical transparency", description: "Every action updates reputation." },
  ],

  mount(ctx) {
    const { canvas, controls, setTick, setStatus, setMetrics, resizeCanvas, pointerPosition } = ctx;
    let params = { ...presets.commons };
    let agents = [];
    let resources = [];
    let selected = null;
    let running = true;
    let frame = 0;
    let tick = 0;
    let lastTime = performance.now();
    let metricClock = 0;
    let random = seededRandom(7021);
    const egoHistory = makeHistory(150, 0.2);
    const cooperationHistory = makeHistory(150, 0.5);
    const controlsByKey = {};

    const strategyColors = {
      reciprocal: "#6ce7c7",
      opportunist: "#ffc45f",
      hoarder: "#ff766f",
    };

    function addControls() {
      controlsByKey.population = ctx.createRange({
        id: "population",
        label: "Population",
        min: 12,
        max: 52,
        step: 1,
        value: params.population,
        format: (value) => `${Math.round(value)} agents`,
        description: "Changing population reseeds the society.",
        onInput(value) {
          params.population = Math.round(value);
          reset();
        },
      });
      controlsByKey.regeneration = ctx.createRange({
        id: "regeneration",
        label: "Resource renewal",
        min: 0.08,
        max: 1,
        step: 0.01,
        value: params.regeneration,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput(value) {
          params.regeneration = value;
        },
      });
      controlsByKey.scarcity = ctx.createRange({
        id: "scarcity",
        label: "Scarcity pressure",
        min: 0,
        max: 1,
        step: 0.01,
        value: params.scarcity,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput(value) {
          params.scarcity = value;
        },
      });
      controlsByKey.temptation = ctx.createRange({
        id: "temptation",
        label: "Private temptation",
        min: 0,
        max: 1,
        step: 0.01,
        value: params.temptation,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput(value) {
          params.temptation = value;
        },
      });
      controlsByKey.visibility = ctx.createRange({
        id: "visibility",
        label: "Action visibility",
        min: 0.05,
        max: 1,
        step: 0.01,
        value: params.visibility,
        format: (value) => `${Math.round(value * 100)}%`,
        description: "How reliably neighbors learn who shared or defected.",
        onInput(value) {
          params.visibility = value;
        },
      });
      controlsByKey.mutation = ctx.createRange({
        id: "mutation",
        label: "Strategy drift",
        min: 0,
        max: 0.08,
        step: 0.001,
        value: params.mutation,
        format: (value) => `${(value * 100).toFixed(1)}%`,
        onInput(value) {
          params.mutation = value;
        },
      });
      ctx.createDivider("Field actions");
      ctx.createAction({
        id: "resource-rain",
        label: "Inject distributed resource rain",
        onClick() {
          for (let index = 0; index < 18; index += 1) {
            resources.push({
              x: 0.08 + random() * 0.84,
              y: 0.1 + random() * 0.8,
              value: 0.35 + random() * 0.65,
              pulse: 1,
            });
          }
        },
      });
    }

    function createAgent(index) {
      const greed = random();
      const strategy = greed > 0.72 ? "hoarder" : greed > 0.42 ? "opportunist" : "reciprocal";
      return {
        id: index + 1,
        x: 0.12 + random() * 0.76,
        y: 0.12 + random() * 0.76,
        vx: (random() - 0.5) * 0.001,
        vy: (random() - 0.5) * 0.001,
        energy: 0.45 + random() * 0.7,
        greed,
        trust: 0.35 + random() * 0.55,
        reputation: 0.5,
        strategy,
        lastAction: "seeking",
        defect: 0,
        share: 0,
        age: 0,
      };
    }

    function reset() {
      random = seededRandom(7021);
      agents = Array.from({ length: params.population }, (_, index) => createAgent(index));
      resources = Array.from({ length: 42 }, () => ({
        x: 0.07 + random() * 0.86,
        y: 0.08 + random() * 0.84,
        value: 0.25 + random() * 0.75,
        pulse: 0,
      }));
      selected = null;
      tick = 0;
      egoHistory.reset(0.2);
      cooperationHistory.reset(0.5);
      setTick(0);
      draw();
    }

    function nearestResource(agent) {
      let best = null;
      let bestDistance = Infinity;
      for (const resource of resources) {
        const dx = resource.x - agent.x;
        const dy = resource.y - agent.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = resource;
        }
      }
      return { resource: best, distance: Math.sqrt(bestDistance) };
    }

    function nearestNeighbor(agent) {
      let best = null;
      let bestDistance = Infinity;
      for (const other of agents) {
        if (other === agent) continue;
        const dx = other.x - agent.x;
        const dy = other.y - agent.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = other;
        }
      }
      return { other: best, distance: Math.sqrt(bestDistance) };
    }

    function update() {
      tick += 1;
      const metabolicCost = 0.0008 + params.scarcity * 0.0016;
      const senseRadius = 0.13 + params.visibility * 0.16;
      let shares = 0;
      let defections = 0;

      if (random() < params.regeneration * (1 - params.scarcity * 0.65) * 0.16 && resources.length < 110) {
        resources.push({
          x: 0.05 + random() * 0.9,
          y: 0.06 + random() * 0.88,
          value: 0.25 + random() * 0.62,
          pulse: 0.7,
        });
      }

      for (const resource of resources) resource.pulse *= 0.95;

      for (const agent of agents) {
        agent.age += 1;
        agent.energy = Math.max(0.02, agent.energy - metabolicCost);
        const { resource, distance } = nearestResource(agent);
        const neighborResult = nearestNeighbor(agent);
        const neighbor = neighborResult.other;
        const hunger = clamp(1 - agent.energy, 0, 1);

        if (resource) {
          const pull = 0.000018 + hunger * 0.000032;
          agent.vx += ((resource.x - agent.x) / Math.max(distance, 0.01)) * pull;
          agent.vy += ((resource.y - agent.y) / Math.max(distance, 0.01)) * pull;
          if (distance < 0.018) {
            const take = Math.min(resource.value, 0.025 + hunger * 0.035);
            resource.value -= take;
            agent.energy = Math.min(2.4, agent.energy + take);
            agent.lastAction = "harvest";
          }
        }

        if (neighbor && neighborResult.distance < senseRadius && agent.energy > 0.78) {
          const socialEvidence = neighbor.reputation * params.visibility + agent.trust * (1 - params.visibility);
          const defectionDrive =
            params.temptation * (0.45 + agent.greed * 0.75) +
            params.scarcity * 0.38 -
            socialEvidence * 0.62;
          const shouldDefect = random() < clamp(defectionDrive, 0.02, 0.95);
          if (shouldDefect && neighbor.energy > 0.18) {
            const stolen = Math.min(neighbor.energy - 0.1, 0.018 + params.temptation * 0.022);
            neighbor.energy -= stolen;
            agent.energy += stolen;
            agent.defect += 1;
            agent.lastAction = "defect";
            defections += 1;
            if (random() < params.visibility) {
              agent.reputation = clamp(agent.reputation - 0.035, 0, 1);
              neighbor.trust = clamp(neighbor.trust - 0.018, 0, 1);
            }
          } else if (neighbor.energy < agent.energy * 0.72) {
            const gift = Math.min(0.022, (agent.energy - neighbor.energy) * 0.08);
            agent.energy -= gift;
            neighbor.energy += gift * 0.96;
            agent.share += 1;
            agent.lastAction = "share";
            shares += 1;
            if (random() < params.visibility) {
              agent.reputation = clamp(agent.reputation + 0.022, 0, 1);
              neighbor.trust = clamp(neighbor.trust + 0.012, 0, 1);
            }
          }
        }

        if (random() < params.mutation * 0.025) {
          agent.greed = clamp(agent.greed + (random() - 0.5) * 0.28, 0, 1);
          agent.strategy =
            agent.greed > 0.72 ? "hoarder" : agent.greed > 0.42 ? "opportunist" : "reciprocal";
        }

        agent.vx += (random() - 0.5) * 0.000016;
        agent.vy += (random() - 0.5) * 0.000016;
        const speed = Math.hypot(agent.vx, agent.vy);
        const maxSpeed = 0.0024;
        if (speed > maxSpeed) {
          agent.vx *= maxSpeed / speed;
          agent.vy *= maxSpeed / speed;
        }
        agent.vx *= 0.982;
        agent.vy *= 0.982;
        agent.x += agent.vx;
        agent.y += agent.vy;
        if (agent.x < 0.035 || agent.x > 0.965) agent.vx *= -1;
        if (agent.y < 0.045 || agent.y > 0.955) agent.vy *= -1;
        agent.x = clamp(agent.x, 0.035, 0.965);
        agent.y = clamp(agent.y, 0.045, 0.955);
        agent.reputation += (0.5 - agent.reputation) * 0.0006;
      }

      resources = resources.filter((resource) => resource.value > 0.012);
      const inequality = gini(agents.map((agent) => agent.energy));
      const hoarding = agents.reduce((sum, agent) => sum + Math.max(0, agent.energy - 1.1), 0) /
        Math.max(1, agents.reduce((sum, agent) => sum + agent.energy, 0));
      const defectionRatio = defections / Math.max(1, defections + shares);
      const egoIndex = clamp(inequality * 0.42 + hoarding * 0.28 + defectionRatio * 0.3, 0, 1);
      egoHistory.push(egoIndex);
      cooperationHistory.push(shares / Math.max(1, shares + defections));

      if (tick % 8 === 0) {
        const meanEnergy = agents.reduce((sum, agent) => sum + agent.energy, 0) / agents.length;
        const reciprocal = agents.filter((agent) => agent.strategy === "reciprocal").length / agents.length;
        setMetrics([
          { id: "ego", label: "EGO index", value: egoIndex.toFixed(3), tone: egoIndex > 0.62 ? "warn" : "accent" },
          { id: "coop", label: "Cooperation", value: `${Math.round(cooperationHistory.values.at(-1) * 100)}%` },
          { id: "gini", label: "Resource Gini", value: inequality.toFixed(3) },
          { id: "energy", label: "Mean reserve", value: `${meanEnergy.toFixed(2)} u` },
          { id: "reciprocal", label: "Reciprocal agents", value: `${Math.round(reciprocal * 100)}%` },
          {
            id: "selected",
            label: selected ? `Agent ${selected.id}` : "Selected agent",
            value: selected
              ? `${selected.strategy} · ${(selected.reputation * 100).toFixed(0)} rep`
              : "none",
          },
        ]);
      }
      setTick(tick);
    }

    function draw() {
      const { context, width, height } = resizeCanvas();
      context.clearRect(0, 0, width, height);
      drawGrid(context, width, height, { spacing: 34, color: "rgba(255,255,255,.035)" });

      const fieldGradient = context.createRadialGradient(
        width * 0.5,
        height * 0.5,
        10,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.65,
      );
      fieldGradient.addColorStop(0, "rgba(255,141,100,.035)");
      fieldGradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = fieldGradient;
      context.fillRect(0, 0, width, height);

      for (const resource of resources) {
        const x = resource.x * width;
        const y = resource.y * height;
        const radius = 1.8 + resource.value * 2.5;
        context.beginPath();
        context.arc(x, y, radius + resource.pulse * 6, 0, Math.PI * 2);
        context.fillStyle = `rgba(156, 228, 111, ${0.08 + resource.pulse * 0.08})`;
        context.fill();
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(166, 237, 120, ${0.34 + resource.value * 0.46})`;
        context.shadowColor = "#a6ed78";
        context.shadowBlur = 7;
        context.fill();
        context.shadowBlur = 0;
      }

      for (const agent of agents) {
        const neighbor = nearestNeighbor(agent);
        if (!neighbor.other || neighbor.distance > 0.13) continue;
        const alpha = clamp((0.13 - neighbor.distance) * 2.6, 0.015, 0.09);
        context.beginPath();
        context.moveTo(agent.x * width, agent.y * height);
        context.lineTo(neighbor.other.x * width, neighbor.other.y * height);
        context.strokeStyle =
          agent.lastAction === "defect"
            ? `rgba(255,118,111,${alpha * 1.8})`
            : `rgba(108,231,199,${alpha})`;
        context.lineWidth = 1;
        context.stroke();
      }

      for (const agent of agents) {
        const x = agent.x * width;
        const y = agent.y * height;
        const radius = 4.2 + clamp(agent.energy, 0, 1.8) * 2.2;
        const color = strategyColors[agent.strategy];
        context.beginPath();
        context.arc(x, y, radius + 4, 0, Math.PI * 2);
        context.fillStyle = rgba(color, selected === agent ? 0.16 : 0.045);
        context.fill();
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = rgba(color, 0.18 + clamp(agent.energy, 0, 1.4) * 0.35);
        context.strokeStyle = selected === agent ? "#ffffff" : rgba(color, 0.82);
        context.lineWidth = selected === agent ? 1.6 : 1;
        context.shadowColor = color;
        context.shadowBlur = selected === agent ? 14 : 6;
        context.fill();
        context.stroke();
        context.shadowBlur = 0;

        const direction = Math.atan2(agent.vy, agent.vx);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(direction) * (radius + 5), y + Math.sin(direction) * (radius + 5));
        context.strokeStyle = rgba(color, 0.68);
        context.stroke();
      }

      const chartWidth = Math.min(260, width * 0.35);
      const chartHeight = 46;
      const chartX = width - chartWidth - 16;
      const chartY = height - chartHeight - 40;
      context.fillStyle = "rgba(8,11,16,.66)";
      context.fillRect(chartX - 8, chartY - 15, chartWidth + 16, chartHeight + 24);
      context.font = "9px ui-monospace, monospace";
      context.fillStyle = "rgba(255,255,255,.42)";
      context.fillText("EGO INDEX", chartX, chartY - 4);
      context.beginPath();
      egoHistory.values.forEach((value, index) => {
        const x = chartX + (index / (egoHistory.values.length - 1)) * chartWidth;
        const y = chartY + chartHeight - value * chartHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = setup.accent;
      context.lineWidth = 1.3;
      context.stroke();

      if (selected) {
        const x = selected.x * width;
        const y = selected.y * height;
        const boxX = clamp(x + 16, 14, width - 170);
        const boxY = clamp(y - 34, 14, height - 76);
        context.fillStyle = "rgba(8,11,16,.9)";
        context.strokeStyle = "rgba(255,255,255,.13)";
        context.fillRect(boxX, boxY, 154, 59);
        context.strokeRect(boxX + 0.5, boxY + 0.5, 153, 58);
        context.fillStyle = "#eef2f7";
        context.font = "600 10px ui-sans-serif, sans-serif";
        context.fillText(`AGENT ${selected.id} · ${selected.strategy}`, boxX + 9, boxY + 15);
        context.fillStyle = "rgba(255,255,255,.53)";
        context.font = "9px ui-monospace, monospace";
        context.fillText(`private drive  ${(selected.greed * 100).toFixed(0)}%`, boxX + 9, boxY + 31);
        context.fillText(`public rep.    ${(selected.reputation * 100).toFixed(0)}%`, boxX + 9, boxY + 45);
      }
    }

    function loop(now) {
      if (!running) return;
      const elapsed = Math.min(40, now - lastTime);
      lastTime = now;
      metricClock += elapsed;
      const steps = Math.max(1, Math.round(elapsed / 11));
      for (let index = 0; index < steps; index += 1) update();
      draw();
      frame = requestAnimationFrame(loop);
    }

    function onPointerDown(event) {
      const point = pointerPosition(event);
      const nearest = agents
        .map((agent) => ({
          agent,
          distance: Math.hypot(agent.x - point.nx, agent.y - point.ny),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest && nearest.distance < 0.035) {
        selected = nearest.agent;
      } else {
        selected = null;
        for (let index = 0; index < 12; index += 1) {
          const angle = random() * Math.PI * 2;
          const radius = random() * 0.06;
          resources.push({
            x: clamp(point.nx + Math.cos(angle) * radius, 0.03, 0.97),
            y: clamp(point.ny + Math.sin(angle) * radius, 0.04, 0.96),
            value: 0.3 + random() * 0.55,
            pulse: 1,
          });
        }
      }
      draw();
    }

    function syncControls() {
      for (const [key, control] of Object.entries(controlsByKey)) control.set(params[key]);
    }

    function applyPreset(id) {
      params = { ...(presets[id] || presets.commons) };
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

    function getState() {
      return { params, seed: 7021, tick };
    }

    function setState(state) {
      params = { ...params, ...(state?.params || {}) };
      syncControls();
      reset();
    }

    addControls();
    canvas.addEventListener("pointerdown", onPointerDown);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    reset();
    frame = requestAnimationFrame(loop);

    return {
      reset,
      play,
      pause,
      applyPreset,
      getState,
      setState,
      destroy() {
        running = false;
        cancelAnimationFrame(frame);
        observer.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
      },
    };
  },
};

