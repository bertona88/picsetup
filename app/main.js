import { DETECTORS } from "../src/detectors/catalog.js";
import { cloneDefaultSignal, measureSignal } from "../src/detectors/measure.js";

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(["catalog","connect","disconnect","port","portSymbol","portName","screenTitle","description","visuals","metrics","caveat","power","diameter","wavelength","divergence","pulsed","powerOut","diameterOut","wavelengthOut","divergenceOut","sourceWavelength","sourcePower"].map((id)=>[id,$(id)]));
const signal = cloneDefaultSignal();
let selected = null;
let connected = null;

const prefixes = [[1e9,"G"],[1e6,"M"],[1e3,"k"],[1,""],[1e-3,"m"],[1e-6,"µ"],[1e-9,"n"],[1e-12,"p"],[1e-15,"f"]];
function format(value, unit="") {
  if (value === Infinity) return `∞ ${unit}`.trim();
  const absolute = Math.abs(value);
  const [scale,prefix] = prefixes.find(([threshold])=>absolute>=threshold) ?? prefixes.at(-1);
  const scaled = value/scale;
  return `${scaled.toFixed(Math.abs(scaled)>=100?0:Math.abs(scaled)>=10?1:2)} ${prefix}${unit}`.trim();
}

function renderCatalog(){
  ui.catalog.replaceChildren(...DETECTORS.map((detector)=>{
    const button=document.createElement("button");
    button.className=`detector${selected===detector.id?" selected":""}`;
    button.type="button";
    button.innerHTML=`<b>${detector.symbol}</b><span>${detector.name}</span><small>${detector.description}</small>${detector.idealized?'<small class="ideal">Idealized composite</small>':""}`;
    button.onclick=()=>{selected=detector.id;ui.connect.disabled=false;renderCatalog();};
    return button;
  }));
}

function renderVisuals(visuals){
  const cards=[];
  if(visuals.intensityMap){
    const card=document.createElement("div"); card.className="visual";
    const map=visuals.intensityMap; const sample=[];
    for(let y=0;y<map.length;y+=2) for(let x=0;x<map[0].length;x+=2) sample.push(`<i style="--a:${Math.max(.04,map[y][x]).toFixed(3)}"></i>`);
    card.innerHTML=`<div style="width:100%"><small>SPATIAL INTENSITY</small><div class="heatmap">${sample.join("")}</div></div>`; cards.push(card);
  }
  if(visuals.wavefront){const card=document.createElement("div");card.className="visual";card.textContent=visuals.wavefront.collimated?"∣ ∣ ∣  Collimated":")))  Diverging wavefront";cards.push(card);}
  if(visuals.polarization){const card=document.createElement("div");card.className="visual";card.textContent=`◯ ${visuals.polarization.label}`;cards.push(card);}
  if(visuals.spectrum){const card=document.createElement("div");card.className="visual";card.textContent="▁▂▄▇█▇▄▂▁  Spectrum";cards.push(card);}
  ui.visuals.replaceChildren(...cards);
}

function renderScreen(){
  if(!connected){
    ui.screenTitle.textContent="No detector connected"; ui.description.textContent="Select an instrument and connect it to show only the properties it measures."; ui.metrics.replaceChildren(); ui.visuals.replaceChildren(); ui.caveat.hidden=true; ui.disconnect.disabled=true; ui.port.classList.remove("connected"); ui.portSymbol.textContent="+"; ui.portName.textContent="Connect a detector"; return;
  }
  const result=measureSignal(connected,signal);
  ui.screenTitle.textContent=result.detector.name; ui.description.textContent=result.detector.description; ui.disconnect.disabled=false; ui.port.classList.add("connected"); ui.portSymbol.textContent=result.detector.symbol; ui.portName.textContent=result.detector.name;
  ui.metrics.replaceChildren(...result.readouts.map((readout)=>{const card=document.createElement("div");card.className=`metric${readout.available?"":" unavailable"}`;const value=readout.kind==="number"?format(readout.value,readout.unit):readout.value;card.innerHTML=`<span>${readout.label}</span><strong>${readout.available?value:"Not available"}</strong>${readout.qualifier?`<small>${readout.qualifier}</small>`:""}`;return card;}));
  renderVisuals(result.visuals); ui.caveat.hidden=result.caveats.length===0; ui.caveat.textContent=result.caveats.join(" ");
}

function sync(){
  signal.powerW=Number(ui.power.value)*1e-3; const diameter=Number(ui.diameter.value)*1e-3; signal.beam.diameterXM=diameter; signal.beam.diameterYM=diameter*.75; signal.wavelengthM=Number(ui.wavelength.value)*1e-9; signal.bandwidthM=Math.max(.2e-9,signal.wavelengthM*.00225); signal.wavefront.divergenceRad=Number(ui.divergence.value)*1e-3; signal.wavefront.radiusM=signal.wavefront.divergenceRad<=.2e-3?Infinity:Math.max(.2,diameter/(2*signal.wavefront.divergenceRad)); signal.pulse.isPulsed=ui.pulsed.checked;
  ui.powerOut.textContent=format(signal.powerW,"W"); ui.diameterOut.textContent=format(diameter,"m"); ui.wavelengthOut.textContent=format(signal.wavelengthM,"m"); ui.divergenceOut.textContent=format(signal.wavefront.divergenceRad,"rad"); ui.sourceWavelength.textContent=format(signal.wavelengthM,"m"); ui.sourcePower.textContent=format(signal.powerW,"W"); renderScreen();
}

ui.connect.onclick=()=>{connected=selected;renderScreen();}; ui.disconnect.onclick=()=>{connected=null;renderScreen();}; [ui.power,ui.diameter,ui.wavelength,ui.divergence,ui.pulsed].forEach((control)=>control.addEventListener("input",sync));
renderCatalog(); sync();
