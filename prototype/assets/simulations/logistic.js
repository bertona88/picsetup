import {
  clamp,
  drawGrid,
  rgba,
  seededRandom,
} from "../ui.js";

const baseNodes = [
  { id: "P", name: "Port", x: 0.09, y: 0.5, type: "source" },
  { id: "X", name: "Cross-dock", x: 0.27, y: 0.3, type: "hub" },
  { id: "R", name: "Rail hub", x: 0.28, y: 0.72, type: "hub" },
  { id: "C", name: "Central DC", x: 0.52, y: 0.5, type: "hub" },
  { id: "N", name: "North DC", x: 0.7, y: 0.24, type: "hub" },
  { id: "S", name: "South DC", x: 0.72, y: 0.75, type: "hub" },
  { id: "A", name: "Market A", x: 0.91, y: 0.16, type: "sink" },
  { id: "B", name: "Market B", x: 0.92, y: 0.46, type: "sink" },
  { id: "D", name: "Market C", x: 0.9, y: 0.82, type: "sink" },
];

const baseEdges = [
  [0, 1, 6],
  [0, 2, 5],
  [0, 3, 2.5],
  [1, 3, 6],
  [1, 4, 3.5],
  [2, 3, 5],
  [2, 5, 4],
  [3, 4, 5],
  [3, 5, 5],
  [3, 7, 3],
  [4, 6, 5],
  [4, 7, 4],
  [5, 7, 4],
  [5, 8, 5],
  [4, 5, 2],
  [7, 6, 2.5],
  [7, 8, 2.5],
];

const presets = {
  balanced: {
    demand: 3.2,
    capacity: 1,
    speed: 1,
    congestionWeight: 1.8,
    disruption: "none",
  },
  portShock: {
    demand: 3.4,
    capacity: 0.82,
    speed: 0.92,
    congestionWeight: 2.2,
    disruption: "port-main",
  },
  surge: {
    demand: 7.6,
    capacity: 0.88,
    speed: 0.9,
    congestionWeight: 1.15,
    disruption: "none",
  },
  adaptive: {
    demand: 6.4,
    capacity: 1.1,
    speed: 1.08,
    congestionWeight: 4.2,
    disruption: "central-market",
  },
};

export const setup = {
  id: "logistic",
  host: "logisticsetup.com",
  name: "LogisticSetup",
  field: "Flow networks",
  experiment: "Routes, queues, and cascading delay",
  code: "LOG–11",
  accent: "#ffc65f",
  summary:
    "A live freight network where finite edge capacity, demand, distance, and congestion determine every parcel route.",
  interaction:
    "Drag hubs to change the geometry. Click a route to close or reopen it, then watch flow discover—or fail to discover—another way.",
  canvasHint: "Drag hubs: reshape network · Click an edge: close/reopen route",
  scope:
    "Parcels use shortest paths with congestion-weighted edge costs. Capacity sharing creates queues and rerouting at each hub.",
  limits: [
    "Travel time is a stylized continuous flow model, not a carrier timetable.",
    "Demand and service rates are stochastic but seeded for deterministic reset.",
    "Costs include distance and live occupancy; inventory and pricing are outside the model.",
  ],
  presets: [
    { id: "balanced", label: "Balanced network", description: "Demand stays below nominal carrying capacity." },
    { id: "portShock", label: "Port corridor shock", description: "The direct port route closes and freight diverts." },
    { id: "surge", label: "Demand surge", description: "Queues expose the first structural bottleneck." },
    { id: "adaptive", label: "Adaptive routing", description: "Strong congestion awareness distributes load." },
  ],

  mount(ctx) {
    const { canvas, controls, setTick, setMetrics, resizeCanvas, pointerPosition } = ctx;
    let params = { ...presets.balanced };
    let nodes = [];
    let edges = [];
    let parcels = [];
    let random = seededRandom(11117);
    let running = true;
    let frame = 0;
    let tick = 0;
    let lastTime = performance.now();
    let spawnAccumulator = 0;
    let delivered = [];
    let failedRoutes = 0;
    let draggingNode = null;
    let highlightedEdge = null;
    const controlsByKey = {};

    function edgeKey(a, b) {
      return a < b ? `${a}-${b}` : `${b}-${a}`;
    }

    function resetNetwork() {
      nodes = baseNodes.map((node) => ({ ...node }));
      edges = baseEdges.map(([a, b, capacity], index) => ({
        id: index,
        a,
        b,
        baseCapacity: capacity,
        occupancy: 0,
        closed: false,
        pulse: 0,
      }));
      if (params.disruption === "port-main") {
        const edge = edges.find((candidate) => edgeKey(candidate.a, candidate.b) === edgeKey(0, 3));
        if (edge) edge.closed = true;
      }
      if (params.disruption === "central-market") {
        const edge = edges.find((candidate) => edgeKey(candidate.a, candidate.b) === edgeKey(3, 7));
        if (edge) edge.closed = true;
      }
    }

    function addControls() {
      controlsByKey.demand = ctx.createRange({
        id: "demand-rate",
        label: "Demand",
        min: 0.5,
        max: 10,
        step: 0.1,
        value: params.demand,
        format: (value) => `${Number(value).toFixed(1)} parcel/s`,
        onInput(value) {
          params.demand = value;
        },
      });
      controlsByKey.capacity = ctx.createRange({
        id: "network-capacity",
        label: "Network capacity",
        min: 0.35,
        max: 1.8,
        step: 0.01,
        value: params.capacity,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput(value) {
          params.capacity = value;
        },
      });
      controlsByKey.speed = ctx.createRange({
        id: "service-speed",
        label: "Service speed",
        min: 0.35,
        max: 1.8,
        step: 0.01,
        value: params.speed,
        format: (value) => `${Number(value).toFixed(2)}×`,
        onInput(value) {
          params.speed = value;
        },
      });
      controlsByKey.congestionWeight = ctx.createRange({
        id: "rerouting-sensitivity",
        label: "Congestion awareness",
        min: 0,
        max: 6,
        step: 0.05,
        value: params.congestionWeight,
        format: (value) => Number(value).toFixed(2),
        description: "Higher values make parcels avoid busy corridors earlier.",
        onInput(value) {
          params.congestionWeight = value;
        },
      });
      ctx.createDivider("Operations");
      ctx.createAction({
        id: "clear-disruptions",
        label: "Reopen every route",
        onClick() {
          for (const edge of edges) edge.closed = false;
          params.disruption = "none";
          draw();
        },
      });
      ctx.createAction({
        id: "dispatch-priority",
        label: "Dispatch priority batch",
        quiet: true,
        onClick() {
          for (let index = 0; index < 12; index += 1) spawnParcel(true);
        },
      });
    }

    function reset() {
      random = seededRandom(11117);
      resetNetwork();
      parcels = [];
      delivered = [];
      failedRoutes = 0;
      spawnAccumulator = 0;
      tick = 0;
      highlightedEdge = null;
      setTick(0);
      updateMetrics();
      draw();
    }

    function edgeLength(edge) {
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function edgeBetween(a, b) {
      return edges.find((edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
    }

    function shortestPath(source, target) {
      const distances = Array(nodes.length).fill(Infinity);
      const previous = Array(nodes.length).fill(-1);
      const unvisited = new Set(nodes.map((_, index) => index));
      distances[source] = 0;

      while (unvisited.size) {
        let current = -1;
        let currentDistance = Infinity;
        for (const candidate of unvisited) {
          if (distances[candidate] < currentDistance) {
            current = candidate;
            currentDistance = distances[candidate];
          }
        }
        if (current === -1 || current === target) break;
        unvisited.delete(current);
        for (const edge of edges) {
          if (edge.closed) continue;
          const neighbor = edge.a === current ? edge.b : edge.b === current ? edge.a : -1;
          if (neighbor < 0 || !unvisited.has(neighbor)) continue;
          const capacity = Math.max(0.1, edge.baseCapacity * params.capacity);
          const load = edge.occupancy / capacity;
          const cost = edgeLength(edge) * (1 + params.congestionWeight * load * load);
          const alternative = currentDistance + cost;
          if (alternative < distances[neighbor]) {
            distances[neighbor] = alternative;
            previous[neighbor] = current;
          }
        }
      }

      if (!Number.isFinite(distances[target])) return null;
      const path = [];
      for (let node = target; node !== -1; node = previous[node]) path.unshift(node);
      return path[0] === source ? path : null;
    }

    function spawnParcel(priority = false) {
      const target = 6 + Math.floor(random() * 3);
      const path = shortestPath(0, target);
      if (!path || path.length < 2) {
        failedRoutes += 1;
        return;
      }
      parcels.push({
        id: `${tick}-${Math.floor(random() * 1e6)}`,
        target,
        path,
        segment: 0,
        progress: 0,
        age: 0,
        due: priority ? 4.5 : 7 + random() * 5,
        priority,
        waiting: 0,
      });
    }

    function update(dt) {
      for (const edge of edges) {
        edge.occupancy = 0;
        edge.pulse *= 0.92;
      }
      for (const parcel of parcels) {
        const edge = edgeBetween(parcel.path[parcel.segment], parcel.path[parcel.segment + 1]);
        if (edge) edge.occupancy += 1;
      }

      spawnAccumulator += dt * params.demand;
      while (spawnAccumulator >= 1) {
        spawnParcel(false);
        spawnAccumulator -= 1;
      }

      const survivors = [];
      for (const parcel of parcels) {
        parcel.age += dt;
        let from = parcel.path[parcel.segment];
        let to = parcel.path[parcel.segment + 1];
        let edge = edgeBetween(from, to);
        if (!edge || edge.closed) {
          const rerouted = shortestPath(from, parcel.target);
          if (!rerouted || rerouted.length < 2) {
            parcel.waiting += dt;
            survivors.push(parcel);
            continue;
          }
          parcel.path = rerouted;
          parcel.segment = 0;
          parcel.progress = 0;
          from = parcel.path[0];
          to = parcel.path[1];
          edge = edgeBetween(from, to);
        }
        const capacity = Math.max(0.1, edge.baseCapacity * params.capacity);
        const congestion = edge.occupancy / capacity;
        const distance = Math.max(0.03, edgeLength(edge));
        const velocity = (0.075 * params.speed / distance) / (1 + Math.max(0, congestion - 0.75) ** 2);
        parcel.progress += dt * velocity;
        parcel.waiting += dt * Math.max(0, congestion - 1);
        if (parcel.progress >= 1) {
          parcel.segment += 1;
          parcel.progress = 0;
          edge.pulse = 1;
          if (parcel.segment >= parcel.path.length - 1) {
            delivered.push({ age: parcel.age, late: parcel.age > parcel.due, time: tick });
            continue;
          }
          const nextPath = shortestPath(parcel.path[parcel.segment], parcel.target);
          if (nextPath) {
            parcel.path = nextPath;
            parcel.segment = 0;
          }
        }
        survivors.push(parcel);
      }
      parcels = survivors;
      delivered = delivered.filter((item) => tick - item.time < 600);
      tick += 1;
      if (tick % 8 === 0) updateMetrics();
      setTick(tick);
    }

    function updateMetrics() {
      const recent = delivered.filter((item) => tick - item.time < 300);
      const late = recent.filter((item) => item.late).length;
      const backlog = parcels.filter((parcel) => parcel.waiting > 0.4).length;
      const loads = edges
        .filter((edge) => !edge.closed)
        .map((edge) => edge.occupancy / Math.max(0.1, edge.baseCapacity * params.capacity));
      const worst = loads.length ? Math.max(...loads) : 0;
      const averageTransit = recent.length
        ? recent.reduce((sum, item) => sum + item.age, 0) / recent.length
        : 0;
      setMetrics([
        { id: "throughput", label: "Recent throughput", value: `${recent.length} parcels`, tone: "accent" },
        { id: "transit", label: "In transit", value: `${parcels.length}` },
        { id: "backlog", label: "Congested parcels", value: `${backlog}`, tone: backlog > 20 ? "warn" : "default" },
        { id: "late", label: "Late deliveries", value: `${recent.length ? ((late / recent.length) * 100).toFixed(1) : "0.0"}%` },
        { id: "time", label: "Mean transit time", value: `${averageTransit.toFixed(2)} s` },
        { id: "utilization", label: "Peak utilization", value: `${Math.round(worst * 100)}%` },
        { id: "failed", label: "No-route events", value: `${failedRoutes}` },
      ]);
    }

    function parcelPosition(parcel) {
      const from = nodes[parcel.path[parcel.segment]];
      const to = nodes[parcel.path[parcel.segment + 1]];
      return {
        x: from.x + (to.x - from.x) * parcel.progress,
        y: from.y + (to.y - from.y) * parcel.progress,
      };
    }

    function draw() {
      const { context, width, height } = resizeCanvas();
      context.clearRect(0, 0, width, height);
      drawGrid(context, width, height, { spacing: 38, color: "rgba(255,255,255,.023)" });

      for (const edge of edges) {
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        const capacity = Math.max(0.1, edge.baseCapacity * params.capacity);
        const load = edge.occupancy / capacity;
        const color = edge.closed ? "#ff746c" : load > 1.2 ? "#ff9f5f" : setup.accent;
        context.beginPath();
        context.moveTo(a.x * width, a.y * height);
        context.lineTo(b.x * width, b.y * height);
        context.strokeStyle = rgba(color, edge.closed ? 0.55 : 0.14 + clamp(load, 0, 1.5) * 0.24 + edge.pulse * 0.15);
        context.lineWidth = edge === highlightedEdge ? 4 : 1.5 + clamp(load, 0, 2.2) * 1.25;
        if (edge.closed) context.setLineDash([6, 7]);
        context.stroke();
        context.setLineDash([]);

        if (edge.closed) {
          const x = (a.x + b.x) * 0.5 * width;
          const y = (a.y + b.y) * 0.5 * height;
          context.beginPath();
          context.moveTo(x - 5, y - 5);
          context.lineTo(x + 5, y + 5);
          context.moveTo(x + 5, y - 5);
          context.lineTo(x - 5, y + 5);
          context.strokeStyle = "#ff746c";
          context.lineWidth = 2;
          context.stroke();
        }
      }

      context.save();
      context.globalCompositeOperation = "lighter";
      for (const parcel of parcels) {
        const point = parcelPosition(parcel);
        const color = parcel.priority ? "#ffffff" : setup.accent;
        context.beginPath();
        context.arc(point.x * width, point.y * height, parcel.priority ? 3.4 : 2.3, 0, Math.PI * 2);
        context.fillStyle = rgba(color, parcel.age > parcel.due ? 0.45 : 0.9);
        context.shadowColor = color;
        context.shadowBlur = parcel.priority ? 10 : 4;
        context.fill();
      }
      context.restore();

      for (const node of nodes) {
        const x = node.x * width;
        const y = node.y * height;
        const radius = node.type === "hub" ? 10 : 12;
        const color = node.type === "source" ? "#7ae1ff" : node.type === "sink" ? "#73ecae" : setup.accent;
        context.beginPath();
        context.arc(x, y, radius + 6, 0, Math.PI * 2);
        context.fillStyle = rgba(color, 0.055);
        context.fill();
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = "#0d131b";
        context.strokeStyle = rgba(color, 0.85);
        context.lineWidth = draggingNode === node ? 2.3 : 1.2;
        context.shadowColor = color;
        context.shadowBlur = draggingNode === node ? 13 : 5;
        context.fill();
        context.stroke();
        context.shadowBlur = 0;
        context.fillStyle = color;
        context.font = "600 10px ui-monospace, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(node.id, x, y);
        context.fillStyle = "rgba(255,255,255,.46)";
        context.font = "9px ui-sans-serif, sans-serif";
        context.fillText(node.name, x, y + radius + 13);
      }
      context.textAlign = "left";
      context.textBaseline = "alphabetic";

      context.fillStyle = "rgba(255,255,255,.4)";
      context.font = "9px ui-monospace, monospace";
      context.fillText("LIVE LOAD / CAPACITY", 16, 22);
      const legendX = 16;
      const legendY = 35;
      for (let index = 0; index < 4; index += 1) {
        context.fillStyle = rgba(setup.accent, 0.16 + index * 0.19);
        context.fillRect(legendX + index * 17, legendY, 13, 3 + index);
      }
    }

    function pointToSegmentDistance(point, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = clamp(((point.nx - a.x) * dx + (point.ny - a.y) * dy) / (lengthSquared || 1), 0, 1);
      return Math.hypot(point.nx - (a.x + dx * t), point.ny - (a.y + dy * t));
    }

    function findNode(point) {
      return nodes
        .map((node) => ({ node, distance: Math.hypot(node.x - point.nx, node.y - point.ny) }))
        .sort((a, b) => a.distance - b.distance)[0];
    }

    function findEdge(point) {
      return edges
        .map((edge) => ({
          edge,
          distance: pointToSegmentDistance(point, nodes[edge.a], nodes[edge.b]),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
    }

    function onPointerDown(event) {
      const point = pointerPosition(event);
      const node = findNode(point);
      if (node?.distance < 0.035) {
        draggingNode = node.node;
        canvas.setPointerCapture?.(event.pointerId);
        return;
      }
      const edge = findEdge(point);
      if (edge?.distance < 0.018) {
        edge.edge.closed = !edge.edge.closed;
        highlightedEdge = edge.edge;
        draw();
      }
    }

    function onPointerMove(event) {
      const point = pointerPosition(event);
      if (draggingNode) {
        draggingNode.x = clamp(point.nx, 0.05, 0.95);
        draggingNode.y = clamp(point.ny, 0.08, 0.92);
        draw();
      } else {
        const edge = findEdge(point);
        highlightedEdge = edge?.distance < 0.018 ? edge.edge : null;
      }
    }

    function onPointerUp(event) {
      draggingNode = null;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    function loop(now) {
      if (!running) return;
      const dt = Math.min(0.06, Math.max(0.005, (now - lastTime) / 1000));
      lastTime = now;
      update(dt);
      draw();
      frame = requestAnimationFrame(loop);
    }

    function syncControls() {
      for (const [key, control] of Object.entries(controlsByKey)) control.set(params[key]);
    }

    function applyPreset(id) {
      params = { ...(presets[id] || presets.balanced) };
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
      getState: () => ({ params, nodes: nodes.map(({ x, y }) => ({ x, y })) }),
      setState(state) {
        params = { ...params, ...(state?.params || {}) };
        syncControls();
        reset();
        if (Array.isArray(state?.nodes) && state.nodes.length === nodes.length) {
          state.nodes.forEach((position, index) => {
            nodes[index].x = clamp(Number(position.x), 0.05, 0.95);
            nodes[index].y = clamp(Number(position.y), 0.08, 0.92);
          });
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

