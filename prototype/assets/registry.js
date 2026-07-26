import { setup as pic } from "./simulations/pic.js";
import { setup as electrical } from "./simulations/electrical.js";
import { setup as biological } from "./simulations/biological.js";
import { setup as gravity } from "./simulations/gravity.js";
import { setup as twoPhoton } from "./simulations/two-photon.js";
import { setup as ego } from "./simulations/ego.js";
import { setup as quantum } from "./simulations/quantum.js";
import { setup as noetic } from "./simulations/noetic.js";
import { setup as computation } from "./simulations/computation.js";
import { setup as logistic } from "./simulations/logistic.js";
import { setup as molecular } from "./simulations/molecular.js";

export const setups = [
  pic,
  electrical,
  biological,
  gravity,
  twoPhoton,
  ego,
  quantum,
  noetic,
  computation,
  logistic,
  molecular,
];

export const opticalSetup = {
  id: "optical",
  host: "opticalsetup.com",
  name: "OpticalSetup",
  field: "Free-space optics",
  accent: "#8aa8ff",
  summary: "Place components and trace qualitative optical paths live.",
  url: "https://opticalsetup.com/sketch/",
};

const byId = new Map(setups.map((setup) => [setup.id, setup]));
const byHost = new Map(setups.map((setup) => [setup.host, setup]));

function normalizedHostname(hostname = "") {
  return String(hostname).replace(/^www\./i, "").replace(/\.$/, "").toLowerCase();
}

export function resolveSetup(location = window.location) {
  const hostname = normalizedHostname(location.hostname);
  const hostedSetup = byHost.get(hostname);
  if (hostedSetup) return hostedSetup;

  const params = new URLSearchParams(location.search || "");
  const requested = params.get("setup");
  if (requested && byId.has(requested)) return byId.get(requested);
  return pic;
}

export function setupUrlForLocation(location, setup) {
  const url = new URL(location instanceof URL || typeof location === "string" ? location : location.href);
  if (byHost.has(normalizedHostname(url.hostname))) {
    url.searchParams.delete("setup");
  } else {
    url.searchParams.set("setup", setup.id);
  }
  return url;
}

export function universeEntries() {
  return [opticalSetup, ...setups];
}
