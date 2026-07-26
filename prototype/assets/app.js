import { resolveSetup, setupUrlForLocation, universeEntries } from "./registry.js";
import { decodeSharedState, encodeSharedState } from "./state.js";
import {
  clamp,
  createAction,
  createDivider,
  createRange,
  createSelect,
  createToggle,
  lerp,
  pointerPosition,
  resizeCanvas,
  setMetrics,
} from "./ui.js";

const setup = resolveSetup();
const elements = {
  brand: document.querySelector(".instrument-brand"),
  canvas: document.querySelector("#simulationCanvas"),
  controls: document.querySelector("#controlsRoot"),
  metrics: document.querySelector("#metricsRoot"),
  toolbar: document.querySelector(".toolbar-center"),
  scenario: document.querySelector("#scenarioSelect"),
  play: document.querySelector("#playToggle"),
  playIcon: document.querySelector(".play-icon"),
  playLabel: document.querySelector(".play-label"),
  reset: document.querySelector("#resetButton"),
  share: document.querySelector("#shareButton"),
  status: document.querySelector("#simulationStatus"),
  tick: document.querySelector("#simulationTick"),
  name: document.querySelector("#setupName"),
  field: document.querySelector("#setupField"),
  title: document.querySelector("#experimentTitle"),
  summary: document.querySelector("#experimentSummary"),
  interaction: document.querySelector("#interactionCopy"),
  scope: document.querySelector("#modelScope"),
  limits: document.querySelector("#modelLimits"),
  hint: document.querySelector("#canvasHint"),
  signature: document.querySelector("#signatureCode"),
  presets: document.querySelector("#presetList"),
  toast: document.querySelector("#toast"),
  drawer: document.querySelector("#universeDrawer"),
  backdrop: document.querySelector("#universeBackdrop"),
  universeOpen: document.querySelector("#universeOpen"),
  universeClose: document.querySelector("#universeClose"),
  universeList: document.querySelector("#universeList"),
  experimentRail: document.querySelector("#experimentRail"),
  inspector: document.querySelector("#simulationInspector"),
  mobileGuide: document.querySelector("#mobileGuideButton"),
  mobileShare: document.querySelector("#mobileShareButton"),
  mobileToggle: document.querySelector("#mobilePanelToggle"),
  mobileReset: document.querySelector("#mobileResetButton"),
};

document.body.dataset.setupId = setup.id;
document.documentElement.style.setProperty("--accent", setup.accent);
document.title = `${setup.name} — live ${setup.field.toLowerCase()} setup`;
document.querySelector('meta[name="theme-color"]').content = setup.themeColor || "#0a0d12";
elements.name.textContent = setup.name;
elements.field.textContent = setup.field;
elements.title.textContent = setup.experiment || setup.field;
elements.summary.textContent = setup.summary;
elements.interaction.textContent = setup.interaction;
elements.scope.textContent = setup.scope;
elements.hint.textContent = setup.canvasHint || setup.interaction;
elements.signature.textContent = setup.code || `SYS–${String(universeEntries().findIndex((entry) => entry.id === setup.id)).padStart(2, "0")}`;
const reloadUrl = setupUrlForLocation(window.location, setup);
reloadUrl.hash = "";
elements.brand.href = reloadUrl.toString();

for (const limit of setup.limits || []) {
  const item = document.createElement("li");
  item.textContent = limit;
  elements.limits.append(item);
}

for (const preset of setup.presets || []) {
  const option = document.createElement("option");
  option.value = preset.id;
  option.textContent = preset.label;
  elements.scenario.append(option);

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.preset = preset.id;
  button.innerHTML = `<strong>${preset.label}</strong><span>${preset.description || ""}</span>`;
  elements.presets.append(button);
}

const presetIds = new Set((setup.presets || []).map(({ id }) => id));
const defaultPreset = presetIds.has(setup.defaultPreset)
  ? setup.defaultPreset
  : setup.presets?.[0]?.id;
const customScenario = document.createElement("option");
customScenario.value = "custom";
customScenario.textContent = "Custom / shared";
customScenario.disabled = true;
customScenario.hidden = true;
elements.scenario.append(customScenario);

let activePreset = null;
function selectPresetUi(id) {
  const namedPreset = presetIds.has(id) ? id : null;
  activePreset = namedPreset;
  customScenario.hidden = Boolean(namedPreset);
  elements.scenario.value = namedPreset || "custom";
  document.querySelectorAll("[data-preset]").forEach((node) => {
    node.classList.toggle("active", node.dataset.preset === namedPreset);
  });
}
selectPresetUi(defaultPreset);

for (const entry of universeEntries()) {
  const link = document.createElement("a");
  const isCurrent = entry.id === setup.id;
  link.className = isCurrent ? "universe-link current" : "universe-link";
  link.href = entry.url || `https://${entry.host}/`;
  link.style.setProperty("--entry-accent", entry.accent);
  link.innerHTML = `
    <span class="universe-node" aria-hidden="true"></span>
    <span class="universe-link-copy">
      <strong>${entry.name}</strong>
      <small>${entry.field}</small>
    </span>
    <span class="universe-arrow">${isCurrent ? "LIVE" : "↗"}</span>
  `;
  if (isCurrent) link.setAttribute("aria-current", "page");
  elements.universeList.append(link);
}

let toastTimer = 0;
function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2200);
}

let latestTick = 0;
function setTick(value) {
  latestTick = Number(value);
  elements.tick.textContent = String(Math.floor(latestTick));
}

function setStatus(message, tone = "live") {
  elements.status.textContent = message;
  document.querySelector(".live-dot").dataset.tone = tone;
}

let running = true;
const context = {
  setup,
  canvas: elements.canvas,
  controls: elements.controls,
  metrics: elements.metrics,
  toolbar: elements.toolbar,
  setStatus,
  setTick,
  showToast,
  createRange: (options) => createRange(elements.controls, options),
  createSelect: (options) => createSelect(elements.controls, options),
  createToggle: (options) => createToggle(elements.controls, options),
  createAction: (options) => createAction(elements.controls, options),
  createDivider: (label) => createDivider(elements.controls, label),
  setMetrics: (metrics) => setMetrics(elements.metrics, metrics),
  resizeCanvas: () => resizeCanvas(elements.canvas),
  pointerPosition: (event) => pointerPosition(event, elements.canvas),
  clamp,
  lerp,
};

let instrument;
try {
  instrument = setup.mount(context);
  setStatus("simulation live");
} catch (error) {
  console.error(error);
  setStatus("model failed to initialize", "error");
  elements.summary.textContent = "The setup could not initialize. Reload to try again.";
  throw error;
}

function updatePlayUi() {
  elements.play.dataset.running = String(running);
  elements.playIcon.textContent = running ? "Ⅱ" : "▶";
  elements.playLabel.textContent = running ? "Pause" : "Run";
  setStatus(running ? "simulation live" : "simulation paused", running ? "live" : "paused");
}

function setRunning(next) {
  running = Boolean(next);
  if (running) instrument?.play?.();
  else instrument?.pause?.();
  updatePlayUi();
}

elements.play.addEventListener("click", () => setRunning(!running));
function resetInstrument() {
  if (activePreset) instrument?.applyPreset?.(activePreset);
  else instrument?.reset?.();
  setTick(0);
  showToast("Experiment reset");
}
elements.reset.addEventListener("click", resetInstrument);
elements.mobileReset.addEventListener("click", resetInstrument);

elements.scenario.addEventListener("change", () => {
  const preset = elements.scenario.value;
  if (!presetIds.has(preset)) return;
  instrument?.applyPreset?.(preset);
  selectPresetUi(preset);
});

elements.presets.addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  elements.scenario.value = button.dataset.preset;
  elements.scenario.dispatchEvent(new Event("change"));
});

function markCustomFromInspector(event) {
  if (event.target.matches("input, select")) selectPresetUi(null);
}
elements.controls.addEventListener("input", markCustomFromInspector);
elements.controls.addEventListener("change", markCustomFromInspector);

async function shareInstrument() {
  let url;
  try {
    const state = instrument?.getState?.();
    if (!state) throw new TypeError("Simulation did not provide shareable state");
    url = setupUrlForLocation(window.location, setup);
    url.hash = `state=${encodeSharedState(setup.id, state)}`;
  } catch (error) {
    console.warn("Could not encode shared state", error);
    showToast("Current setup could not be shared");
    return;
  }
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast("Live setup link copied");
  } catch {
    window.prompt("Copy this setup link", url.toString());
  }
}
elements.share.addEventListener("click", shareInstrument);
elements.mobileShare.addEventListener("click", shareInstrument);

if (window.location.hash.startsWith("#state=")) {
  try {
    instrument?.setState?.(decodeSharedState(window.location.hash.slice(7), setup.id));
    selectPresetUi(null);
    showToast("Shared setup restored");
  } catch (error) {
    console.warn("Could not restore shared state", error);
    showToast("Shared state was not compatible");
  }
}

function setDrawer(open) {
  elements.drawer.hidden = !open;
  elements.backdrop.hidden = !open;
  elements.universeOpen.setAttribute("aria-expanded", String(open));
  requestAnimationFrame(() => document.body.classList.toggle("universe-open", open));
}

elements.universeOpen.addEventListener("click", () => setDrawer(true));
elements.universeClose.addEventListener("click", () => setDrawer(false));
elements.backdrop.addEventListener("click", () => setDrawer(false));

const mobileViewport = window.matchMedia("(max-width: 760px)");
const mobilePanels = {
  guide: {
    panel: elements.experimentRail,
    button: elements.mobileGuide,
    bodyClass: "mobile-guide-open",
    closedLabel: "Guide",
    openLabel: "Close guide",
  },
  inspector: {
    panel: elements.inspector,
    button: elements.mobileToggle,
    bodyClass: "mobile-inspector-open",
    closedLabel: "Controls",
    openLabel: "Close controls",
  },
};
let openMobilePanel = null;

function syncMobilePanels() {
  const mobile = mobileViewport.matches;
  for (const [id, entry] of Object.entries(mobilePanels)) {
    const open = mobile && openMobilePanel === id;
    document.body.classList.toggle(entry.bodyClass, open);
    entry.button.setAttribute("aria-expanded", String(open));
    entry.button.textContent = open ? entry.openLabel : entry.closedLabel;
    entry.panel.inert = mobile && !open;
    if (mobile) entry.panel.setAttribute("aria-hidden", String(!open));
    else entry.panel.removeAttribute("aria-hidden");
  }
}

function setMobilePanel(nextPanel, focus = true) {
  if (!mobileViewport.matches) return;
  const previousPanel = openMobilePanel;
  openMobilePanel = previousPanel === nextPanel ? null : nextPanel;
  syncMobilePanels();

  if (!focus) return;
  if (openMobilePanel) {
    const panel = mobilePanels[openMobilePanel].panel;
    requestAnimationFrame(() => {
      panel
        .querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
        ?.focus();
    });
  } else if (previousPanel) {
    mobilePanels[previousPanel].button.focus();
  }
}

elements.mobileGuide.addEventListener("click", () => setMobilePanel("guide"));
elements.mobileToggle.addEventListener("click", () => setMobilePanel("inspector"));
const onMobileViewportChange = () => {
  if (!mobileViewport.matches) openMobilePanel = null;
  syncMobilePanels();
};
if (typeof mobileViewport.addEventListener === "function") {
  mobileViewport.addEventListener("change", onMobileViewportChange);
} else {
  mobileViewport.addListener(onMobileViewportChange);
}
syncMobilePanels();

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setDrawer(false);
    if (openMobilePanel) setMobilePanel(null);
    return;
  }
  if (event.target.matches?.("input, select, textarea, button")) return;
  if (event.key === " ") {
    event.preventDefault();
    setRunning(!running);
  }
  if (event.key.toLowerCase() === "r") elements.reset.click();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) instrument?.pause?.();
  else if (running) instrument?.play?.();
});

window.addEventListener("beforeunload", () => instrument?.destroy?.(), { once: true });

updatePlayUi();
