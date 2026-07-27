import { componentPorts, getConnectionPoints, couplerCoefficients, connectionDomain } from './physics.js';
import { getDefinition, getPorts } from './models.js';
import { smoothPath } from './geometry.js';

const NS = 'http://www.w3.org/2000/svg';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const svgEl = (tag, attrs = {}, text = null) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
};

export { smoothPath };

export function componentBounds(component) {
  const raw = getDefinition(component.type).bounds ?? { x: -40, y: -40, width: 80, height: 80, rx: 16 };
  const bounds = typeof raw === 'function' ? raw(component) : raw;
  return { x: Number(bounds.x ?? -40), y: Number(bounds.y ?? -40), width: Number(bounds.width ?? 80), height: Number(bounds.height ?? 80), rx: Number(bounds.rx ?? 16) };
}


function sourceMode(component) {
  return component?.params?.sourceMode === 'pulsed' ? 'pulsed' : 'cw';
}
function sourceVisualization(component) {
  return component?.params?.cwVisualization === 'tracers' ? 'tracers' : 'solid';
}
function primarySource(circuit) {
  return circuit.components.find(component => component.type === 'source' || (getDefinition(component.type).sourceBoundary && ['input', 'bidirectional'].includes(component.params?.direction))) ?? null;
}

function label(group, component, subtitle = '', y = -51, subtitleY = 55) {
  const params = component.params ?? {};
  const placement = ['auto', 'above', 'below', 'left', 'right', 'hidden'].includes(params.labelPosition) ? params.labelPosition : 'auto';
  if (placement === 'hidden') return;
  const bounds = componentBounds(component);
  let nameX = 0, nameY = y, subX = 0, subY = subtitleY, anchor = 'middle';
  if (placement === 'above') { nameY = bounds.y - 24; subY = bounds.y - 9; }
  else if (placement === 'below') { nameY = bounds.y + bounds.height + 18; subY = bounds.y + bounds.height + 34; }
  else if (placement === 'left') { nameX = bounds.x - 14; subX = nameX; nameY = -4; subY = 12; anchor = 'end'; }
  else if (placement === 'right') { nameX = bounds.x + bounds.width + 14; subX = nameX; nameY = -4; subY = 12; anchor = 'start'; }
  const dx = finite(params.labelOffsetX, 0), dy = finite(params.labelOffsetY, 0);
  group.append(svgEl('text', { class: 'component-label', x: nameX + dx, y: nameY + dy, 'text-anchor': anchor }, component.name ?? getDefinition(component.type).shortLabel));
  if (subtitle && params.subtitleVisibility !== 'hide') group.append(svgEl('text', { class: 'component-sub', x: subX + dx, y: subY + dy, 'text-anchor': anchor }, subtitle));
}
function body(group, attrs = {}) {
  group.append(svgEl('rect', { class: 'component-body', x: -36, y: -32, width: 72, height: 64, rx: 16, ...attrs }));
}

function renderSource(group, component) {
  body(group, { x: -32, y: -32, width: 64, height: 64 });
  group.append(svgEl('circle', { class: 'source-core', cx: 0, cy: 0, r: 5 }));
  for (let angle = 0; angle < 360; angle += 45) {
    const rad = angle * Math.PI / 180;
    group.append(svgEl('line', { class: 'source-rays', x1: Math.cos(rad) * 10, y1: Math.sin(rad) * 10, x2: Math.cos(rad) * 20, y2: Math.sin(rad) * 20 }));
  }
  const mode = sourceMode(component);
  label(group, component, mode === 'pulsed' ? `${Number(component.params?.pulseDurationPs ?? 12).toFixed(1)} ps · ${Number(component.params?.repetitionRateMHz ?? 80).toFixed(0)} MHz` : `CW · λ ${Number(component.params?.wavelengthNm ?? 1550).toFixed(0)} nm`, -51, -40);
}

function inspectButton(group, component, action = 'open-physics') {
  const inspect = svgEl('g', { class: 'component-inspect', 'data-action': action, 'data-id': component.id, transform: 'translate(34,-29)', tabindex: '0', role: 'button', 'aria-label': action === 'open-block' ? 'Inspect block hierarchy' : 'Inspect local physics' });
  inspect.append(svgEl('circle', { cx: 0, cy: 0, r: 10, fill: 'rgba(4,12,14,.92)', stroke: 'rgba(37,232,255,.7)' }));
  if (action === 'open-block') inspect.append(svgEl('path', { d: 'M -4 -4h8v8h-8zM-1-1h8v8', fill: 'none', stroke: '#25e8ff', 'stroke-width': 1.1 }));
  else {
    inspect.append(svgEl('circle', { cx: -2, cy: -2, r: 3.5, fill: 'none', stroke: '#25e8ff', 'stroke-width': 1.3 }));
    inspect.append(svgEl('line', { x1: 1, y1: 1, x2: 5, y2: 5, stroke: '#25e8ff', 'stroke-width': 1.3, 'stroke-linecap': 'round' }));
  }
  group.append(inspect);
}

function renderCoupler(group, component, wavelengthNm) {
  body(group, { x: -44, y: -34, width: 88, height: 68, rx: 17 });
  group.append(svgEl('path', { class: 'coupler-lines', d: 'M -40 -16 C -13 -16 -13 16 40 16' }));
  group.append(svgEl('path', { class: 'coupler-lines', d: 'M -40 16 C -13 16 -13 -16 40 -16' }));
  group.append(svgEl('path', { class: 'coupler-field', d: 'M -21 -5 C -8 -1 8 1 21 5' }));
  group.append(svgEl('path', { class: 'coupler-field', d: 'M -21 5 C -8 1 8 -1 21 -5', opacity: '.58' }));
  const coeff = couplerCoefficients(component.params, wavelengthNm);
  label(group, component, `${(Math.min(1, coeff.crossPower) * 100).toFixed(1)}% cross · g ${Number(component.params?.gapUm ?? .2).toFixed(3)} µm`);
  inspectButton(group, component);
}

function renderMmi(group, component) {
  body(group, { x: -44, y: -30, width: 88, height: 60, rx: 10 });
  group.append(svgEl('path', { class: 'generic-lines', d: 'M-42-16L-24-16M-42 16L-24 16M24-16L42-16M24 16L42 16M-24-20L24-12L24 12L-24 20Z' }));
  group.append(svgEl('text', { class: 'generic-symbol', x: 0, y: 5 }, 'MMI'));
  label(group, component, `${Number(component.params?.crossPower ?? 50).toFixed(1)}% cross`);
}

function renderPhaseLike(group, component) {
  const symbol = component.type === 'modulator' ? 'Vπ' : component.type === 'attenuator' ? '−dB' : 'φ';
  body(group, { x: -38, y: -31, width: 76, height: 62, rx: 15 });
  group.append(svgEl('text', { class: component.type === 'phase' ? 'phase-symbol' : 'generic-symbol', x: 0, y: component.type === 'phase' ? 10 : 5 }, symbol));
  let subtitle = '';
  if (component.type === 'phase') subtitle = `${Number(component.params?.phaseRad ?? 0).toFixed(3)} rad · ${Number(component.params?.lengthUm ?? 0).toFixed(0)} µm`;
  else if (component.type === 'modulator') subtitle = `${Number(component.params?.voltageV ?? 0).toFixed(2)} V / ${Number(component.params?.vpiV ?? 4).toFixed(2)} Vπ`;
  else subtitle = `${Number(component.params?.lossDb ?? 0).toFixed(2)} dB`;
  label(group, component, subtitle, -49, 48);
}

function renderDetector(group, component, result) {
  body(group, { x: -32, y: -32, width: 64, height: 64 });
  group.append(svgEl('line', { class: 'detector-beam', x1: -23, y1: 0, x2: -6, y2: 0 }));
  group.append(svgEl('path', { class: 'detector-arc', d: component.type === 'termination' ? 'M -5 -17L-5 17M5-17L5 17' : 'M -6 -16 A 18 18 0 0 1 -6 16' }));
  if (component.type !== 'termination') group.append(svgEl('line', { class: 'detector-arc', x1: 8, y1: -17, x2: 8, y2: 17 }));
  label(group, component, component.type === 'termination' ? 'matched' : `${Number(result?.measurementMw ?? 0).toFixed((result?.measurementMw ?? 0) < .01 ? 4 : 3)} mW`);
}

function renderProbe(group, component, result) {
  body(group, { x: -34, y: -27, width: 68, height: 54, rx: 14 });
  group.append(svgEl('line', { class: 'generic-lines', x1: -45, y1: 0, x2: 45, y2: 0 }));
  group.append(svgEl('circle', { class: 'probe-ring', cx: 0, cy: 0, r: 13 }));
  group.append(svgEl('circle', { class: 'probe-dot', cx: 0, cy: 0, r: 3 }));
  label(group, component, `${Number(result?.measurementMw ?? 0).toFixed(3)} mW`, -44, 42);
}

function renderSplitter(group, component) {
  body(group, { x: -39, y: -33, width: 78, height: 66, rx: 16 });
  group.append(svgEl('path', { class: 'generic-lines', d: 'M-46 0L-10 0M-10 0C8 0 13-18 46-18M-10 0C8 0 13 18 46 18' }));
  label(group, component, `${Number(component.params?.topPower ?? 50).toFixed(1)} / ${(100 - Number(component.params?.topPower ?? 50)).toFixed(1)}%`);
}

function renderRing(group, component) {
  body(group, { x: -46, y: -38, width: 92, height: 76, rx: 18 });
  group.append(svgEl('line', { class: 'generic-lines', x1: -46, y1: -16, x2: 46, y2: -16 }));
  group.append(svgEl('line', { class: 'generic-lines', x1: -46, y1: 16, x2: 46, y2: 16 }));
  group.append(svgEl('circle', { class: 'ring-shape', cx: 0, cy: 0, r: 19 }));
  label(group, component, `R ${Number(component.params?.radiusUm ?? 10).toFixed(1)} µm · κ² ${Number(component.params?.couplingPower ?? 12).toFixed(1)}%`, -56, 58);
}

function renderBragg(group, component) {
  body(group, { x: -42, y: -29, width: 84, height: 58, rx: 14 });
  group.append(svgEl('line', { class: 'generic-lines', x1: -48, y1: 0, x2: 48, y2: 0 }));
  for (let x = -24; x <= 24; x += 8) group.append(svgEl('line', { class: 'bragg-tooth', x1: x, y1: -13, x2: x, y2: 13 }));
  label(group, component, `${Number(component.params?.centerNm ?? 1550).toFixed(1)} nm · ${Number(component.params?.bandwidthNm ?? 5).toFixed(1)} nm`, -48, 46);
}

function renderCrossing(group, component) {
  body(group, { x: -34, y: -34, width: 68, height: 68, rx: 16 });
  group.append(svgEl('path', { class: 'generic-lines', d: 'M-46 0H46M0-46V46' }));
  group.append(svgEl('circle', { class: 'crossing-core', cx: 0, cy: 0, r: 7 }));
  label(group, component, `${Number(component.params?.crosstalkDb ?? -35).toFixed(1)} dB XT`, -57, 57);
}

function renderGrating(group, component) {
  body(group, { x: -37, y: -30, width: 74, height: 60, rx: 15 });
  group.append(svgEl('line', { class: 'generic-lines', x1: -47, y1: 0, x2: -20, y2: 0 }));
  for (let index = 0; index < 5; index += 1) group.append(svgEl('path', { class: 'grating-arc', d: `M ${-12 + index * 7} -${10 + index * 3} Q ${4 + index * 4} 0 ${-12 + index * 7} ${10 + index * 3}` }));
  label(group, component, `${Number(component.params?.peakEfficiency ?? 60).toFixed(0)}% peak`);
}

function renderBlock(group, component) {
  body(group, { x: -52, y: -38, width: 104, height: 76, rx: 18 });
  group.append(svgEl('rect', { class: 'block-inner', x: -39, y: -25, width: 78, height: 50, rx: 12 }));
  group.append(svgEl('text', { class: 'generic-symbol', x: 0, y: 5 }, component.type === 'block' ? 'SUB' : 'S(λ)'));
  const count = component.params?.subcircuit?.components?.length;
  label(group, component, component.type === 'block' ? `${count ?? 0} internal components · ${getPorts(component).length} ports` : `${getPorts(component).length}-port · ${component.params?.provenance ?? 'user model'}`, -58, 58);
  if (component.type === 'block') inspectButton(group, component, 'open-block');
}


function renderEdgeCoupler(group, component) {
  body(group, { x: -44, y: -30, width: 88, height: 60, rx: 14 });
  group.append(svgEl('path', { class: 'generic-lines', d: 'M-52 0H-22L28-18V18L-22 0M28 0H52' }));
  group.append(svgEl('path', { class: 'coupler-field', d: 'M-47 -10Q-28 0-47 10' }));
  label(group, component, `${Number(component.params?.peakEfficiency ?? 72).toFixed(0)}% · ${component.params?.facetKind ?? 'fiber-array'}`, -48, 47);
}

function renderOpticalBridge(group, component, result) {
  const bounds = componentBounds(component);
  group.append(svgEl('rect', { class: 'bridge-body', ...bounds }));
  group.append(svgEl('path', { class: 'bridge-arrow', d: component.params?.direction === 'input' ? 'M38 0H-24M-24 0l10-8M-24 0l10 8' : component.params?.direction === 'bidirectional' ? 'M-30-7H30M30-7l-9-7M30-7l-9 7M30 8H-30M-30 8l9-7M-30 8l9 7' : 'M-28 0H36M36 0l-10-8M36 0l-10 8' }));
  group.append(svgEl('text', { class: 'bridge-brand', x: 0, y: -17 }, 'OPTICALSETUP'));
  group.append(svgEl('text', { class: 'bridge-schema', x: 0, y: 24 }, 'setup-port/1'));
  const power = component.params?.direction === 'input' ? result?.ports?.pic?.outgoingPowerMw : result?.ports?.pic?.incomingPowerMw;
  label(group, component, `${component.params?.interfaceKind ?? 'free-space'} · ${Number(power ?? component.params?.powerMw ?? 0).toFixed(3)} mW`, -58, 60);
}

function renderSpiral(group, component) {
  body(group, { x: -46, y: -38, width: 92, height: 76, rx: 17 });
  group.append(svgEl('path', { class: 'generic-lines spiral-line', d: 'M-54 0H-30C-12 0-12-25 10-25C34-25 35 25 7 25C-15 25-15-12 5-12C18-12 18 12 3 12C-6 12-7 1 1 1H54' }));
  label(group, component, `${Number(component.params?.lengthUm ?? 5000).toFixed(0)} µm delay`, -54, 54);
}

function renderAwg(group, component) {
  body(group, { x: -50, y: -46, width: 100, height: 92, rx: 18 });
  group.append(svgEl('path', { class: 'generic-lines', d: 'M-58 0H-34Q-12-38 16-34Q38-30 50-30M-34 0Q-10-14 18-10Q40-8 50-10M-34 0Q-10 14 18 10Q40 8 50 10M-34 0Q-12 38 16 34Q38 30 50 30' }));
  for (let i=-2;i<=2;i+=1) group.append(svgEl('path', { class: 'awg-array-line', d: `M${-12+i*4} -25Q${5+i*2} 0${-12+i*4} 25` }));
  group.append(svgEl('text', { class: 'generic-symbol', x: 0, y: 5 }, 'AWG'));
  label(group, component, `${Number(component.params?.channelSpacingNm ?? 8).toFixed(1)} nm spacing`, -61, 62);
}

function renderHeater(group, component) {
  body(group, { x: -42, y: -33, width: 84, height: 66, rx: 15 });
  group.append(svgEl('line', { class: 'generic-lines', x1: -50, y1: 10, x2: 50, y2: 10 }));
  group.append(svgEl('path', { class: 'heater-coil', d: 'M-28-7q7-15 14 0t14 0t14 0t14 0' }));
  group.append(svgEl('line', { class: 'electrical-symbol-line', x1: 0, y1: 40, x2: 0, y2: 19 }));
  label(group, component, `${Number(component.params?.voltageV ?? 0).toFixed(2)} V · φ ${(Number(component.params?.biasRad ?? 0)+Number(component.params?.voltageV ?? 0)*Number(component.params?.phasePerV ?? .5)).toFixed(2)} rad`, -53, 53);
}

function renderFiberArray(group, component) {
  body(group, { x: -52, y: -45, width: 104, height: 90, rx: 16 });
  for (let i=0;i<4;i+=1) {
    const y=-30+i*20;
    group.append(svgEl('path', { class: 'fiber-line', d: `M-62 ${y}H-28Q-12 ${y} 0 ${y}H62` }));
    group.append(svgEl('circle', { class: 'fiber-core', cx: -23, cy: y, r: 5 }));
  }
  group.append(svgEl('text', { class: 'generic-symbol', x: 19, y: 5 }, '4×'));
  label(group, component, `${Number(component.params?.insertionLossDb ?? 1).toFixed(2)} dB / ch`, -61, 61);
}

function renderPolarizationController(group, component) {
  body(group, { x: -40, y: -31, width: 80, height: 62, rx: 17 });
  group.append(svgEl('line', { class: 'fiber-line', x1: -48, y1: 0, x2: 48, y2: 0 }));
  for (const x of [-18,0,18]) group.append(svgEl('circle', { class: 'polarization-loop', cx: x, cy: 0, r: 11 }));
  label(group, component, `${component.params?.state ?? 'linear'} · ${Number(component.params?.lossDb ?? .2).toFixed(2)} dB`, -49, 49);
}

function renderOpticalInstrument(group, component) {
  const bounds = componentBounds(component);
  group.append(svgEl('rect', { class: 'instrument-body', ...bounds }));
  const kind = component.params?.instrumentKind ?? 'spectrometer';
  const symbol = { camera:'▣', photodetector:'◖', pmt:'PMT', 'power-meter':'P', wavefront:'≋', polarimeter:'↻', spectrometer:'λ', general:'Σ' }[kind] ?? 'λ';
  group.append(svgEl('rect', { class: 'instrument-screen', x: bounds.x+18, y: bounds.y+16, width: bounds.width-36, height: Math.max(28,bounds.height-45), rx: 8 }));
  group.append(svgEl('text', { class: 'instrument-symbol', x: 0, y: 7 }, symbol));
  label(group, component, component.params?.subtitle ?? kind, bounds.y-12, bounds.y+bounds.height+18);
}

function renderRfSource(group, component) {
  body(group, { x: -42, y: -31, width: 84, height: 62, rx: 15 });
  group.append(svgEl('path', { class: 'rf-wave', d: 'M-28 0C-20-20-10-20-2 0S16 20 28 0' }));
  label(group, component, `${Number(component.params?.frequencyGhz ?? 10).toFixed(2)} GHz · ${Number(component.params?.amplitudeV ?? 1).toFixed(2)} V`, -49, 49);
}

function renderElectricalAmplifier(group, component) {
  body(group, { x: -42, y: -31, width: 84, height: 62, rx: 14 });
  group.append(svgEl('path', { class: 'electrical-symbol-line amplifier-triangle', d: 'M-29-20L27 0L-29 20Z' }));
  group.append(svgEl('text', { class: 'generic-symbol', x: -6, y: 5 }, 'G'));
  label(group, component, `${Number(component.params?.gainDb ?? 20).toFixed(1)} dB · ${Number(component.params?.bandwidthGhz ?? 20).toFixed(1)} GHz`, -49, 49);
}

function renderOscilloscope(group, component) {
  body(group, { x: -50, y: -38, width: 100, height: 76, rx: 16 });
  group.append(svgEl('rect', { class: 'instrument-screen', x: -34, y: -23, width: 68, height: 42, rx: 7 }));
  group.append(svgEl('path', { class: 'scope-trace', d: 'M-29 5L-20 5L-15-11L-8 15L0-5L8 4L17 4L23-13L29 5' }));
  label(group, component, component.params?.subtitle ?? 'time trace', -57, 58);
}

function renderController(group, component) {
  const bounds = componentBounds(component);
  group.append(svgEl('rect', { class: 'control-body', ...bounds }));
  group.append(svgEl('rect', { class: 'instrument-screen', x: bounds.x+18, y: bounds.y+15, width: bounds.width-36, height: bounds.height-38, rx: 8 }));
  group.append(svgEl('path', { class: 'controller-nodes', d: `M${bounds.x+30} 0H${bounds.x+bounds.width-30}M-20-10L0 9L22-14` }));
  label(group, component, component.params?.subtitle ?? 'calibration · feedback · DSP', bounds.y-12, bounds.y+bounds.height+18);
}

function renderSystemBlock(group, component) {
  const bounds = componentBounds(component);
  group.append(svgEl('rect', { class: 'system-block-body', ...bounds }));
  const kind = component.params?.blockKind ?? 'generic';
  const symbol = { generic:'SYS', laser:'LASER', receiver:'RX', driver:'DRV', processor:'DSP', sample:'SAMPLE' }[kind] ?? 'SYS';
  group.append(svgEl('text', { class: 'system-symbol', x: 0, y: 4 }, symbol));
  label(group, component, component.params?.subtitle ?? 'subsystem', bounds.y-12, bounds.y+bounds.height+18);
}

function renderChipFrame(group, component) {
  const bounds = componentBounds(component);
  const fillClass = component.params?.fillStyle ?? 'tint';
  group.append(svgEl('rect', { class: `chip-frame-body chip-fill-${fillClass}`, ...bounds }));
  group.append(svgEl('text', { class: 'chip-frame-title', x: bounds.x+22, y: bounds.y+31, 'text-anchor':'start' }, component.name ?? 'PIC'));
  group.append(svgEl('text', { class: 'chip-frame-subtitle', x: bounds.x+22, y: bounds.y+51, 'text-anchor':'start' }, component.params?.subtitle ?? 'photonic integrated circuit'));
}

function renderImagePanel(group, component) {
  const bounds = componentBounds(component);
  group.append(svgEl('rect', { class: 'paper-panel-body', ...bounds }));
  const href = component.params?.imageDataUrl;
  if (href) group.append(svgEl('image', { class: 'paper-image', href, x: bounds.x+4, y: bounds.y+4, width: bounds.width-8, height: bounds.height-31, preserveAspectRatio: component.params?.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice' }));
  else {
    group.append(svgEl('path', { class: 'image-placeholder', d: `M${bounds.x+20} ${bounds.y+bounds.height-45}L${bounds.x+bounds.width*.42} ${bounds.y+bounds.height*.46}L${bounds.x+bounds.width*.58} ${bounds.y+bounds.height*.65}L${bounds.x+bounds.width-20} ${bounds.y+30}` }));
    group.append(svgEl('circle', { class: 'image-placeholder', cx: bounds.x+bounds.width*.7, cy: bounds.y+bounds.height*.28, r: 11 }));
  }
  group.append(svgEl('text', { class: 'panel-caption', x: 0, y: bounds.y+bounds.height-10 }, component.params?.caption ?? 'Microscope / SEM image'));
}

function plotTracePath(bounds, style) {
  const x0=bounds.x+38, x1=bounds.x+bounds.width-16, y0=bounds.y+bounds.height-38, y1=bounds.y+20;
  if (style === 'bars') return `M${x0+18} ${y0}V${y0-35}M${x0+48} ${y0}V${y0-65}M${x0+78} ${y0}V${y0-46}M${x0+108} ${y0}V${y0-80}`;
  if (style === 'time') return `M${x0} ${(y0+y1)/2}C${x0+18} ${y1} ${x0+28} ${y0} ${x0+45} ${(y0+y1)/2}S${x0+78} ${y1} ${x0+95} ${(y0+y1)/2}S${x1-18} ${y0} ${x1} ${(y0+y1)/2}`;
  if (style === 'spectrum') return `M${x0} ${y0-7}C${x0+30} ${y0-10} ${x0+42} ${y1+10} ${x0+58} ${y1+12}S${x0+78} ${y0-5} ${x0+96} ${y0-10}S${x1-26} ${y1+22} ${x1} ${y0-6}`;
  return `M${x0} ${y1+12}C${x0+35} ${y1+15} ${x0+46} ${y0-4} ${x0+61} ${y0-7}S${x0+80} ${y1+15} ${x0+100} ${y1+14}S${x1-30} ${y0-10} ${x1} ${y1+12}`;
}

function renderPlotPanel(group, component) {
  const bounds = componentBounds(component);
  group.append(svgEl('rect', { class: 'paper-panel-body', ...bounds }));
  const x0=bounds.x+38, x1=bounds.x+bounds.width-16, y0=bounds.y+bounds.height-38, y1=bounds.y+20;
  group.append(svgEl('path', { class: 'plot-axis', d: `M${x0} ${y1}V${y0}H${x1}` }));
  group.append(svgEl('path', { class: `plot-trace plot-${component.params?.traceStyle ?? 'resonance'}`, d: plotTracePath(bounds, component.params?.traceStyle ?? 'resonance') }));
  group.append(svgEl('text', { class: 'plot-label', x: (x0+x1)/2, y: bounds.y+bounds.height-14 }, component.params?.xLabel ?? 'Wavelength (nm)'));
  group.append(svgEl('text', { class: 'plot-label plot-y-label', x: bounds.x+12, y: (y0+y1)/2, transform: `rotate(-90 ${bounds.x+12} ${(y0+y1)/2})` }, component.params?.yLabel ?? 'Transmission'));
  group.append(svgEl('text', { class: 'panel-caption', x: 0, y: bounds.y-10 }, component.params?.caption ?? 'Response'));
}

function renderAnnotation(group, component) {
  const bounds=componentBounds(component), fontSize=Number(component.params?.fontSize ?? 15);
  const align=component.params?.align ?? 'left';
  const anchor=align==='center'?'middle':align==='right'?'end':'start';
  const x=align==='center'?0:align==='right'?bounds.x+bounds.width:bounds.x;
  const text=svgEl('text', { class:'annotation-text', x, y:bounds.y+fontSize, 'text-anchor':anchor, 'font-size':fontSize });
  String(component.params?.text ?? '').split('\n').forEach((line,index)=>text.append(svgEl('tspan',{x,dy:index?fontSize*1.35:0},line)));
  group.append(text);
}

function renderPanelLabel(group, component) {
  group.append(svgEl('text', { class:'panel-letter', x:0, y:Number(component.params?.fontSize ?? 30)*.34, 'font-size':Number(component.params?.fontSize ?? 30) }, component.params?.text ?? 'a'));
}

function renderComponent(group, component, result, wavelengthNm) {
  switch (component.type) {
    case 'source': renderSource(group, component); break;
    case 'coupler': renderCoupler(group, component, wavelengthNm); break;
    case 'mmi': renderMmi(group, component); break;
    case 'phase': case 'modulator': case 'attenuator': renderPhaseLike(group, component); break;
    case 'heater': renderHeater(group, component); break;
    case 'detector': case 'termination': renderDetector(group, component, result); break;
    case 'probe': renderProbe(group, component, result); break;
    case 'splitter': renderSplitter(group, component); break;
    case 'ring': renderRing(group, component); break;
    case 'bragg': renderBragg(group, component); break;
    case 'crossing': renderCrossing(group, component); break;
    case 'grating': renderGrating(group, component); break;
    case 'edge-coupler': renderEdgeCoupler(group, component); break;
    case 'optical-bridge': renderOpticalBridge(group, component, result); break;
    case 'spiral': renderSpiral(group, component); break;
    case 'awg': renderAwg(group, component); break;
    case 'fiber-array': renderFiberArray(group, component); break;
    case 'polarization-controller': renderPolarizationController(group, component); break;
    case 'optical-instrument': renderOpticalInstrument(group, component); break;
    case 'rf-source': renderRfSource(group, component); break;
    case 'electrical-amplifier': renderElectricalAmplifier(group, component); break;
    case 'oscilloscope': renderOscilloscope(group, component); break;
    case 'controller': renderController(group, component); break;
    case 'system-block': renderSystemBlock(group, component); break;
    case 'chip-frame': renderChipFrame(group, component); break;
    case 'image-panel': renderImagePanel(group, component); break;
    case 'plot-panel': renderPlotPanel(group, component); break;
    case 'annotation': renderAnnotation(group, component); break;
    case 'panel-label': renderPanelLabel(group, component); break;
    case 'generic': case 'block': renderBlock(group, component); break;
    default: {
      const bounds = componentBounds(component);
      group.append(svgEl('rect', { class: 'component-body', ...bounds }));
      group.append(svgEl('text', { class: 'generic-symbol', x: 0, y: 5 }, getDefinition(component.type).glyph ?? '•'));
      label(group, component, getDefinition(component.type).label);
    }
  }
}

export class CircuitRenderer {
  constructor(svg) {
    this.svg = svg;
    this.gridLayer = svg.querySelector('#gridLayer');
    this.backgroundLayer = svg.querySelector('#backgroundLayer');
    this.gridPattern = svg.querySelector('#physicalGrid');
    this.connectionLayer = svg.querySelector('#connectionLayer');
    this.pulseLayer = svg.querySelector('#pulseLayer');
    this.componentLayer = svg.querySelector('#componentLayer');
    this.interactionLayer = svg.querySelector('#interactionLayer');
    this.pathRecords = [];
    this.pulseRecords = [];
    this.currentTransform = { zoom: 1, panX: 0, panY: 0 };
  }

  setTransform({ zoom = 1, panX = 0, panY = 0 }) {
    this.currentTransform = { zoom, panX, panY };
    const transform = `translate(${panX} ${panY}) scale(${zoom})`;
    [this.gridLayer, this.backgroundLayer, this.connectionLayer, this.pulseLayer, this.componentLayer, this.interactionLayer].filter(Boolean).forEach(layer => layer.setAttribute('transform', transform));
    this.svg.dataset.semantic = zoom < .68 ? 'overview' : zoom > 1.35 ? 'detail' : 'normal';
  }

  screenToWorld(clientX, clientY) {
    const point = this.svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const matrix = this.componentLayer.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  worldToScreen(x, y) {
    const point = this.svg.createSVGPoint();
    point.x = x; point.y = y;
    const matrix = this.componentLayer.getScreenCTM();
    if (!matrix) return { x, y };
    const transformed = point.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  }

  render(circuit, solveResult, ui = {}) {
    this.backgroundLayer?.replaceChildren();
    this.connectionLayer.replaceChildren();
    this.pulseLayer.replaceChildren();
    this.componentLayer.replaceChildren();
    this.interactionLayer.replaceChildren();
    this.pathRecords = [];
    this.pulseRecords = [];

    const zoom = circuit.settings?.canvasZoom ?? 1;
    this.svg.dataset.figureMode = circuit.settings?.figureMode === 'paper' ? 'paper' : 'workbench';
    this.svg.dataset.paperBackground = circuit.settings?.paperBackground === 'transparent' ? 'transparent' : 'white';
    this.svg.dataset.showPorts = circuit.settings?.showPortsInFigure === false ? 'false' : 'true';
    this.setTransform({ zoom, panX: circuit.settings?.canvasPanX ?? 0, panY: circuit.settings?.canvasPanY ?? 0 });
    if (this.gridLayer && this.gridPattern) {
      const paperMode = circuit.settings?.figureMode === 'paper';
      const showGrid = paperMode ? Boolean(circuit.settings?.showGridInFigure) : circuit.settings?.routingMode === 'physical' && Boolean(circuit.settings?.snapToGrid);
      this.gridLayer.style.display = showGrid ? '' : 'none';
      let spacing = Math.max(1e-6, Number(circuit.settings?.gridUm ?? 5) / Math.max(1e-6, Number(circuit.settings?.worldToUm ?? .2)));
      while (spacing * zoom < 12) spacing *= 5;
      while (spacing * zoom > 180) spacing /= 5;
      this.gridPattern.setAttribute('width', spacing.toFixed(4));
      this.gridPattern.setAttribute('height', spacing.toFixed(4));
    }
    const selected = ui.selection;
    const selectedIds = new Set(selected?.kind === 'multi' ? selected.ids : selected?.kind === 'component' ? [selected.id] : []);
    const connectStart = ui.connectStart;
    const occupiedPorts = new Set();
    const leadSource = primarySource(circuit);
    const mode = sourceMode(leadSource);
    const cwVisual = sourceVisualization(leadSource);
    const showPackets = mode === 'pulsed' || cwVisual === 'tracers';
    const sourceColor = '#8eff42';
    const sourcePower = Math.max(solveResult?.sourcePowerMw ?? 1, 1e-9);
    const pinnedComponents = new Set((ui.pinnedMeasurements ?? []).map(item => item.componentId).filter(Boolean));
    const highlighted = new Set(ui.highlightIds ?? []);

    for (const connection of circuit.connections) {
      occupiedPorts.add(`${connection.a.component}:${connection.a.port}`);
      occupiedPorts.add(`${connection.b.component}:${connection.b.port}`);
    }

    for (const connection of circuit.connections) {
      const points = getConnectionPoints(connection, circuit.components);
      if (points.length < 2) continue;
      const d = smoothPath(points);
      const isSelected = selected?.kind === 'connection' && selected.id === connection.id;
      const domain = connectionDomain(connection, circuit.components);
      const solved = solveResult?.connections?.get(connection.id);
      const group = svgEl('g', { class: `connection connection-domain-${domain} ${isSelected ? 'connection-selected' : ''} ${highlighted.has(connection.id) ? 'analysis-highlight' : ''} ${solved?.bendViolation ? 'connection-tight-bend' : ''}`, 'data-kind': 'connection', 'data-id': connection.id, 'data-domain': domain });
      const hit = svgEl('path', { class: 'connection-hit', d, 'data-kind': 'connection', 'data-id': connection.id });
      const base = svgEl('path', { class: 'connection-base', d });
      const normalized = domain === 'optical' ? Math.min(1, (solved?.maxPowerMw ?? 0) / sourcePower) : 0;
      const arrow = ['start', 'end', 'both'].includes(connection.params?.arrow) ? connection.params.arrow : 'none';
      const markerId = { optical: 'arrowOptical', electrical: 'arrowElectrical', rf: 'arrowRf', control: 'arrowControl', annotation: 'arrowAnnotation' }[domain] ?? 'arrowAnnotation';
      const signal = svgEl('path', {
        class: domain === 'optical' ? 'connection-power' : 'connection-signal', d,
        opacity: domain === 'optical' ? (0.08 + Math.sqrt(normalized) * 0.92).toFixed(3) : 1,
        'stroke-width': domain === 'optical' ? (3.4 + Math.sqrt(normalized) * 4.8).toFixed(2) : undefined,
        stroke: domain === 'optical' ? sourceColor : undefined,
        'marker-start': arrow === 'start' || arrow === 'both' ? `url(#${markerId})` : undefined,
        'marker-end': arrow === 'end' || arrow === 'both' ? `url(#${markerId})` : undefined
      });
      group.append(hit, base, signal);
      if (solved?.bendViolation && solved.bendPoint) {
        const marker = svgEl('g', { class: 'bend-warning', transform: `translate(${solved.bendPoint.x} ${solved.bendPoint.y})`, 'aria-label': 'Bend radius warning' });
        marker.append(svgEl('circle', { cx: 0, cy: 0, r: 7 }));
        marker.append(svgEl('text', { x: 0, y: 3 }, '!'));
        group.append(marker);
      }
      this.connectionLayer.append(group);
      if (String(connection.label ?? '').trim()) {
        let point = points[Math.floor(points.length / 2)] ?? points[0];
        try {
          const length = signal.getTotalLength();
          if (length > 0) point = signal.getPointAtLength(length * .5);
        } catch { /* SVG path geometry may be unavailable during detached tests */ }
        group.append(svgEl('text', {
          class: 'connection-label',
          x: point.x + finite(connection.params?.labelOffsetX, 0),
          y: point.y + finite(connection.params?.labelOffsetY, -11)
        }, String(connection.label).slice(0, 120)));
      }
      this.pathRecords.push({ id: connection.id, path: signal, solved, d, normalized, domain });

      if (domain !== 'optical' || !showPackets) continue;
      const directions = [];
      if ((solved?.powerFromAMw ?? 0) > sourcePower * 1e-5) directions.push({ reverse: false, power: solved.powerFromAMw, gradient: 'url(#packetGreen)', mode });
      if ((solved?.powerFromBMw ?? 0) > sourcePower * 1e-5) directions.push({ reverse: true, power: solved.powerFromBMw, gradient: 'url(#packetCyan)', mode });
      for (const direction of directions) {
        const repetition = Number(leadSource?.params?.repetitionRateMHz ?? 80);
        const count = mode === 'pulsed' ? clamp(Math.round(1 + Math.log10(Math.max(1, repetition)) * .8), 1, 4) : 2;
        for (let packetIndex = 0; packetIndex < count; packetIndex += 1) {
          const packetGroup = svgEl('g', { class: 'pulse' });
          const normalizedPower = Math.min(1, direction.power / sourcePower);
          const duration = Number(leadSource?.params?.pulseDurationPs ?? 12);
          const envelopeLength = mode === 'pulsed' ? clamp(9 + 12 * Math.log10(1 + duration), 10, 58) : 14 + normalizedPower * 8;
          const thickness = 3.8 + normalizedPower * 2.2;
          const halo = svgEl('rect', { class: 'pulse-halo', x: (-envelopeLength / 2 - 2).toFixed(2), y: (-thickness / 2 - 1.2).toFixed(2), width: (envelopeLength + 4).toFixed(2), height: (thickness + 2.4).toFixed(2), rx: 2, fill: direction.gradient });
          const core = svgEl('rect', { class: 'pulse-core', x: (-envelopeLength / 2).toFixed(2), y: (-thickness / 2).toFixed(2), width: envelopeLength.toFixed(2), height: thickness.toFixed(2), rx: 1.5, fill: direction.gradient });
          packetGroup.append(halo, core);
          this.pulseLayer.append(packetGroup);
          this.pulseRecords.push({ group: packetGroup, path: signal, reverse: direction.reverse, offset: packetIndex / count, power: direction.power, pulsed: mode === 'pulsed', repetitionRateMHz: repetition });
        }
      }
    }

    const orderedComponents = [...circuit.components].sort((a, b) => (getDefinition(a.type).layer === 'background' ? -1 : 0) - (getDefinition(b.type).layer === 'background' ? -1 : 0));
    for (const component of orderedComponents) {
      const definition = getDefinition(component.type);
      const isSelected = selectedIds.has(component.id);
      const bounds = componentBounds(component);
      const group = svgEl('g', {
        class: `component component-${component.type} ${definition.diagramOnly ? 'component-diagram-only' : ''} ${isSelected ? 'selected' : ''} ${highlighted.has(component.id) ? 'analysis-highlight' : ''}`,
        transform: `translate(${component.x} ${component.y}) rotate(${component.rotation ?? 0})`,
        'data-kind': 'component', 'data-id': component.id,
        tabindex: '0', role: 'button', 'aria-label': `${component.name ?? component.type} component`
      });
      group.append(svgEl('rect', { class: 'selection-ring', x: bounds.x - 9, y: bounds.y - 9, width: bounds.width + 18, height: bounds.height + 18, rx: bounds.rx + 7 }));
      const result = solveResult?.components?.get(component.id);
      renderComponent(group, component, result, solveResult?.wavelengthNm ?? 1550);

      const angle = (component.rotation ?? 0) * Math.PI / 180;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (const port of getPorts(component)) {
        const localX = port.x;
        const localY = port.y;
        const key = `${component.id}:${port.id}`;
        const isStart = connectStart?.component === component.id && connectStart?.port === port.id;
        group.append(svgEl('circle', { class: 'port-hit', cx: localX, cy: localY, r: Math.max(10, 14 / zoom), fill: 'transparent', 'data-kind': 'port', 'data-component': component.id, 'data-port': port.id }));
        group.append(svgEl('circle', { class: `port port-role-${port.role ?? 'optical'} port-medium-${port.medium ?? 'guided'} ${isStart ? 'active' : ''} ${occupiedPorts.has(key) ? 'occupied' : ''}`, cx: localX, cy: localY, r: 5, 'data-kind': 'port', 'data-component': component.id, 'data-port': port.id, 'aria-label': `${component.name ?? component.type} ${port.label} port` }));
        group.append(svgEl('text', { class: 'port-label', x: localX + (localX < 0 ? -9 : localX > 0 ? 9 : 0), y: localY + (localY < 0 ? -8 : localY > 0 ? 12 : -8), 'text-anchor': localX < 0 ? 'end' : localX > 0 ? 'start' : 'middle' }, port.label));
      }
      if (pinnedComponents.has(component.id)) {
        const badge = svgEl('g', { class: 'measurement-pin', transform: `translate(${bounds.x + bounds.width - 2},${bounds.y + bounds.height + 6})`, 'data-action': 'open-lab', 'data-id': component.id });
        badge.append(svgEl('circle', { r: 8 }));
        badge.append(svgEl('path', { d: 'M-3 1L-1 3L4-3', fill: 'none', 'stroke-width': 1.5 }));
        group.append(badge);
      }
      (definition.layer === 'background' ? this.backgroundLayer : this.componentLayer).append(group);
    }

    if (ui.previewPoints?.length > 1) {
      const d = smoothPath(ui.previewPoints);
      this.interactionLayer.append(svgEl('path', { class: `preview-path ${ui.previewValid === false ? 'preview-invalid' : ''}`, d }));
      const last = ui.previewPoints.at(-1);
      this.interactionLayer.append(svgEl('circle', { cx: last.x, cy: last.y, r: 5, fill: ui.previewValid === false ? '#ff6d7d' : '#25e8ff', filter: 'url(#softGlow)' }));
    }
  }

  animate(timeSeconds, speed, paused, sourcePower = 1) {
    const visualTime = paused ? 0 : timeSeconds * speed;
    for (const pulse of this.pulseRecords) {
      let length = 0;
      try { length = pulse.path.getTotalLength(); } catch { continue; }
      if (!length) continue;
      const baseVelocity = pulse.pulsed ? 0.085 : (0.12 + Math.min(1, pulse.power / Math.max(sourcePower, 1e-9)) * 0.05);
      let phase = paused ? pulse.offset : (visualTime * baseVelocity + pulse.offset) % 1;
      if (pulse.reverse) phase = 1 - phase;
      const distance = clamp(phase * length, 0, length);
      const point = pulse.path.getPointAtLength(distance);
      const ahead = pulse.path.getPointAtLength(Math.min(length, distance + 1.2));
      const behind = pulse.path.getPointAtLength(Math.max(0, distance - 1.2));
      const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI;
      pulse.group.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
      pulse.group.setAttribute('opacity', paused ? '.58' : '.96');
    }
  }

  renderMiniMap(targetSvg, circuit, selectedComponentId = null) {
    targetSvg.replaceChildren();
    targetSvg.append(svgEl('rect', { width: 240, height: 130, rx: 14, fill: '#04090a', stroke: 'rgba(104,221,207,.18)' }));
    const xs = circuit.components.map(component => component.x);
    const ys = circuit.components.map(component => component.y);
    if (!xs.length) return;
    const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 80;
    const scaleFactor = Math.min(214 / Math.max(1, maxX - minX), 104 / Math.max(1, maxY - minY));
    const tx = 13 + (214 - (maxX - minX) * scaleFactor) / 2;
    const ty = 13 + (104 - (maxY - minY) * scaleFactor) / 2;
    const mapPoint = point => ({ x: tx + (point.x - minX) * scaleFactor, y: ty + (point.y - minY) * scaleFactor });
    for (const connection of circuit.connections) {
      const points = getConnectionPoints(connection, circuit.components).map(mapPoint);
      const domain = connectionDomain(connection, circuit.components);
      const color = domain === 'electrical' ? '#ffb547' : domain === 'rf' ? '#ff68d0' : domain === 'control' ? '#6ba9ff' : '#8eff42';
      targetSvg.append(svgEl('path', { d: smoothPath(points), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: '.85', 'stroke-dasharray': domain === 'control' ? '4 3' : 'none' }));
    }
    for (const component of circuit.components) {
      const point = mapPoint(component);
      const selected = component.id === selectedComponentId;
      targetSvg.append(svgEl('rect', { x: point.x - (selected ? 8 : 4), y: point.y - (selected ? 8 : 4), width: selected ? 16 : 8, height: selected ? 16 : 8, rx: selected ? 4 : 2, fill: selected ? 'rgba(37,232,255,.16)' : '#0d1718', stroke: selected ? '#25e8ff' : '#91b4ae', 'stroke-dasharray': selected ? '3 2' : 'none' }));
    }
  }
}
