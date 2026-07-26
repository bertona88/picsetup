export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, value) => (value - a) / (b - a || 1);

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 10000 || abs < 0.001)) return value.toExponential(digits);
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createRange(root, options) {
  const {
    id,
    label,
    min,
    max,
    step = 1,
    value,
    unit = "",
    description = "",
    format = (next) => `${formatNumber(Number(next), 3)}${unit ? ` ${unit}` : ""}`,
    onInput,
  } = options;
  const wrap = element("label", "control control-range");
  const head = element("span", "control-head");
  const name = element("span", "control-label", label);
  const output = element("output", "control-value");
  output.htmlFor = id;
  head.append(name, output);
  const input = element("input");
  input.type = "range";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.dataset.testid = `control-${id}`;
  const note = description ? element("span", "control-description", description) : null;

  const update = (next, emit = true) => {
    input.value = String(next);
    output.textContent = format(next);
    const fraction = clamp((Number(next) - Number(min)) / (Number(max) - Number(min)), 0, 1);
    input.style.setProperty("--range-progress", `${fraction * 100}%`);
    if (emit) onInput?.(Number(next));
  };
  input.addEventListener("input", () => update(input.value));
  wrap.append(head, input);
  if (note) wrap.append(note);
  root.append(wrap);
  update(value, false);
  return { root: wrap, input, output, set: (next) => update(next, false), get: () => Number(input.value) };
}

export function createSelect(root, options) {
  const { id, label, value, choices, description = "", onChange } = options;
  const wrap = element("label", "control control-select");
  const head = element("span", "control-head");
  head.append(element("span", "control-label", label));
  const select = element("select");
  select.id = id;
  select.dataset.testid = `control-${id}`;
  for (const choice of choices) {
    const option = element("option", "", choice.label);
    option.value = choice.value;
    option.selected = choice.value === value;
    select.append(option);
  }
  select.addEventListener("change", () => onChange?.(select.value));
  wrap.append(head, select);
  if (description) wrap.append(element("span", "control-description", description));
  root.append(wrap);
  return {
    root: wrap,
    select,
    set(next) {
      select.value = next;
    },
    get: () => select.value,
  };
}

export function createToggle(root, options) {
  const { id, label, checked = false, description = "", onChange } = options;
  const wrap = element("label", "control control-toggle");
  const copy = element("span", "toggle-copy");
  copy.append(element("span", "control-label", label));
  if (description) copy.append(element("span", "control-description", description));
  const input = element("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  input.dataset.testid = `control-${id}`;
  const track = element("span", "toggle-track");
  track.append(element("span", "toggle-thumb"));
  input.addEventListener("change", () => onChange?.(input.checked));
  wrap.append(copy, input, track);
  root.append(wrap);
  return {
    root: wrap,
    input,
    set(next) {
      input.checked = Boolean(next);
    },
    get: () => input.checked,
  };
}

export function createAction(root, options) {
  const { id, label, quiet = false, onClick } = options;
  const button = element("button", quiet ? "inspector-action quiet" : "inspector-action", label);
  button.type = "button";
  button.id = id;
  button.dataset.testid = `action-${id}`;
  button.addEventListener("click", onClick);
  root.append(button);
  return button;
}

export function createDivider(root, label) {
  const divider = element("div", "control-divider");
  divider.append(element("span", "", label));
  root.append(divider);
  return divider;
}

export function setMetrics(root, metrics) {
  const previous = new Map(
    Array.from(root.querySelectorAll("[data-metric-id]")).map((node) => [node.dataset.metricId, node]),
  );
  const fragment = document.createDocumentFragment();
  for (const metric of metrics) {
    let row = previous.get(metric.id);
    if (!row) {
      row = element("div", "metric-row");
      row.dataset.metricId = metric.id;
      row.append(element("span", "metric-label"), element("strong", "metric-value"));
    }
    row.querySelector(".metric-label").textContent = metric.label;
    const valueNode = row.querySelector(".metric-value");
    valueNode.textContent = metric.value;
    valueNode.dataset.tone = metric.tone || "default";
    fragment.append(row);
  }
  root.replaceChildren(fragment);
}

export function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width: rect.width, height: rect.height, dpr };
}

export function pointerPosition(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
    nx: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    ny: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

export function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function drawGrid(context, width, height, options = {}) {
  const { spacing = 32, color = "rgba(255,255,255,.05)", dot = true } = options;
  context.save();
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 1;
  if (dot) {
    for (let x = spacing / 2; x < width; x += spacing) {
      for (let y = spacing / 2; y < height; y += spacing) {
        context.beginPath();
        context.arc(x, y, 1, 0, Math.PI * 2);
        context.fill();
      }
    }
  } else {
    context.beginPath();
    for (let x = 0; x <= width; x += spacing) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += spacing) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.stroke();
  }
  context.restore();
}

export function makeHistory(length = 180, initial = 0) {
  const values = Array.from({ length }, () => initial);
  return {
    values,
    push(value) {
      values.push(value);
      values.shift();
    },
    reset(value = initial) {
      values.fill(value);
    },
  };
}

export function drawTrace(context, values, rect, options = {}) {
  const {
    min = Math.min(...values),
    max = Math.max(...values),
    color = "#fff",
    lineWidth = 1.5,
    fill = null,
  } = options;
  const span = max - min || 1;
  context.save();
  context.beginPath();
  values.forEach((value, index) => {
    const x = rect.x + (index / Math.max(1, values.length - 1)) * rect.width;
    const y = rect.y + rect.height - ((value - min) / span) * rect.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.stroke();
  if (fill) {
    context.lineTo(rect.x + rect.width, rect.y + rect.height);
    context.lineTo(rect.x, rect.y + rect.height);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
  }
  context.restore();
}

