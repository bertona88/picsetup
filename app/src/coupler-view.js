import { localCouplerState, couplerCoefficients } from './physics.js';
import { C, add, mul, scale, abs2, arg, expi } from './complex.js';

const VIEW_ORDER = ['circuit', 'power', 'phase', 'field', 'supermodes'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = t => t * t * (3 - 2 * t);

function rgba(r, g, b, a = 1) { return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`; }

function blendFieldColor(value, intensity) {
  const magnitude = clamp(Math.abs(value), 0, 1);
  const alpha = clamp((0.08 + magnitude * 0.8) * intensity, 0, 1);
  if (value >= 0) return [142, 255, 66, alpha];
  return [37, 232, 255, alpha];
}

export class CouplerView {
  constructor(canvas, { onViewChange = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.onViewChange = onViewChange;
    this.view = 'power';
    this.circuit = null;
    this.coupler = null;
    this.solve = null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.lastFieldFrame = -1;
    this.fieldCache = document.createElement('canvas');
    this.fieldCtx = this.fieldCache.getContext('2d');
    this.pointerState = new Map();
    this.pinchStartDistance = 0;
    this.wheelAccumulator = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.installGestures();
  }

  destroy() { this.resizeObserver.disconnect(); }

  installGestures() {
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.wheelAccumulator += event.deltaY;
      if (Math.abs(this.wheelAccumulator) > 80) {
        this.stepView(this.wheelAccumulator > 0 ? -1 : 1);
        this.wheelAccumulator = 0;
      }
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', event => {
      this.canvas.setPointerCapture?.(event.pointerId);
      this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointerState.size === 2) this.pinchStartDistance = this.currentPinchDistance();
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!this.pointerState.has(event.pointerId)) return;
      this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointerState.size === 2) {
        const distance = this.currentPinchDistance();
        if (this.pinchStartDistance && Math.abs(distance - this.pinchStartDistance) > 45) {
          this.stepView(distance > this.pinchStartDistance ? 1 : -1);
          this.pinchStartDistance = distance;
        }
      }
    });
    const release = event => {
      this.pointerState.delete(event.pointerId);
      if (this.pointerState.size < 2) this.pinchStartDistance = 0;
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  currentPinchDistance() {
    const values = [...this.pointerState.values()];
    if (values.length < 2) return 0;
    return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
  }

  stepView(direction) {
    const current = VIEW_ORDER.indexOf(this.view);
    const next = clamp(current + direction, 0, VIEW_ORDER.length - 1);
    if (next !== current) this.setView(VIEW_ORDER[next]);
  }

  setView(view, notify = true) {
    if (!VIEW_ORDER.includes(view)) return;
    this.view = view;
    this.lastFieldFrame = -1;
    if (notify) this.onViewChange?.(view);
  }

  setData(circuit, coupler, solve) {
    this.circuit = circuit;
    this.coupler = coupler;
    this.solve = solve;
    this.lastFieldFrame = -1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.lastFieldFrame = -1;
  }

  geometry() {
    const w = this.width;
    const h = this.height;
    const x0 = w * 0.16;
    const x1 = w * 0.84;
    const couplingStart = w * 0.35;
    const couplingEnd = w * 0.69;
    const center = h * 0.52;
    const outerSeparation = clamp(h * 0.22, 80, 180);
    const physicalGap = Number(this.coupler?.params?.gapUm ?? .2);
    const innerSeparation = clamp(44 + (physicalGap - .08) / .72 * 76, 42, 118);
    return { w, h, x0, x1, couplingStart, couplingEnd, center, outerSeparation, innerSeparation };
  }

  centerY(x, branch) {
    const g = this.geometry();
    const sign = branch === 0 ? -1 : 1;
    const outer = sign * g.outerSeparation / 2;
    const inner = sign * g.innerSeparation / 2;
    if (x <= g.couplingStart) {
      const t = smoothstep(clamp((x - g.x0) / Math.max(1, g.couplingStart - g.x0), 0, 1));
      return g.center + lerp(outer, inner, t);
    }
    if (x >= g.couplingEnd) {
      const t = smoothstep(clamp((x - g.couplingEnd) / Math.max(1, g.x1 - g.couplingEnd), 0, 1));
      return g.center + lerp(inner, outer, t);
    }
    return g.center + inner;
  }

  zFraction(x) {
    const g = this.geometry();
    return clamp((x - g.couplingStart) / Math.max(1, g.couplingEnd - g.couplingStart), 0, 1);
  }

  localAtX(x) {
    if (!this.coupler || !this.solve) return null;
    return localCouplerState(this.coupler, this.solve, this.zFraction(x));
  }

  draw(timeSeconds = 0, speed = 1, paused = false) {
    if (!this.width || !this.height) this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.coupler || !this.solve) {
      this.drawEmpty();
      return;
    }
    if (this.view === 'circuit') this.drawCircuit(timeSeconds, speed, paused);
    else if (this.view === 'power') this.drawPower(timeSeconds, speed, paused);
    else if (this.view === 'phase') this.drawPhase(timeSeconds, speed, paused);
    else if (this.view === 'field') this.drawField(timeSeconds, speed, paused);
    else this.drawSupermodes(timeSeconds, speed, paused);
    this.drawDimensions();
  }

  drawEmpty() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Select a directional coupler to inspect local physics.', this.width / 2, this.height / 2);
  }

  drawGuideOutline(alpha = 1) {
    const ctx = this.ctx;
    const g = this.geometry();
    for (let branch = 0; branch < 2; branch += 1) {
      ctx.beginPath();
      for (let x = g.x0; x <= g.x1; x += 2) {
        const y = this.centerY(x, branch);
        if (x === g.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(220, 250, 244, .18 * alpha);
      ctx.lineWidth = 18;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = rgba(221, 255, 249, .68 * alpha);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawCircuit(timeSeconds, speed, paused) {
    const ctx = this.ctx;
    const g = this.geometry();
    this.drawGuideOutline(.7);
    const boxX = g.couplingStart - 18;
    const boxW = g.couplingEnd - g.couplingStart + 36;
    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = 'rgba(37,232,255,.55)';
    ctx.lineWidth = 1.5;
    this.roundRectPath(ctx, boxX, g.center - g.innerSeparation / 2 - 38, boxW, g.innerSeparation + 76, 18);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(6,16,18,.86)';
    ctx.strokeStyle = 'rgba(102,236,220,.24)';
    ctx.lineWidth = 1;
    this.roundRectPath(ctx, g.center ? g.w / 2 - 86 : 0, g.center - 38, 172, 76, 17);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#eefaf7';
    ctx.font = '600 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('4-port scattering element', g.w / 2, g.center - 8);
    ctx.fillStyle = '#25e8ff';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('b = S(g, L, λ) a', g.w / 2, g.center + 14);

    const phase = paused ? 0 : timeSeconds * speed;
    ctx.strokeStyle = 'rgba(142,255,66,.95)';
    ctx.lineWidth = 4;
    ctx.setLineDash([2, 18]);
    ctx.lineDashOffset = -phase * 45;
    ctx.beginPath();
    for (let x = g.x0; x <= g.x1; x += 2) {
      const y = this.centerY(x, 0);
      if (x === g.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawPower(timeSeconds, speed, paused) {
    const ctx = this.ctx;
    const g = this.geometry();
    this.drawGuideOutline(.8);
    for (let branch = 0; branch < 2; branch += 1) {
      for (let x = g.x0; x < g.x1; x += 3) {
        const local = this.localAtX(x);
        if (!local) continue;
        const p = branch === 0 ? local.p1 : local.p2;
        const y = this.centerY(x, branch);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 10 + 17 * Math.sqrt(p));
        if (branch === 0) {
          glow.addColorStop(0, rgba(224, 255, 178, .95 * clamp(Math.sqrt(p), 0, 1)));
          glow.addColorStop(.25, rgba(142, 255, 66, .62 * clamp(Math.sqrt(p), 0, 1)));
          glow.addColorStop(1, rgba(142, 255, 66, 0));
        } else {
          glow.addColorStop(0, rgba(209, 251, 255, .95 * clamp(Math.sqrt(p), 0, 1)));
          glow.addColorStop(.25, rgba(37, 232, 255, .62 * clamp(Math.sqrt(p), 0, 1)));
          glow.addColorStop(1, rgba(37, 232, 255, 0));
        }
        ctx.fillStyle = glow;
        ctx.fillRect(x - 30, y - 30, 60, 60);
      }
    }

    const phase = paused ? 0 : timeSeconds * speed;
    for (let branch = 0; branch < 2; branch += 1) {
      ctx.beginPath();
      for (let x = g.x0; x <= g.x1; x += 2) {
        const y = this.centerY(x, branch);
        if (x === g.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = branch === 0 ? 'rgba(230,255,213,.9)' : 'rgba(210,250,255,.9)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([1, 22]);
      ctx.lineDashOffset = -phase * 48 + branch * 11;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawPhase(timeSeconds, speed, paused) {
    const ctx = this.ctx;
    const g = this.geometry();
    this.drawGuideOutline(.5);
    const animation = paused ? 0 : timeSeconds * speed * 2.2;
    for (let branch = 0; branch < 2; branch += 1) {
      for (let x = g.x0; x < g.x1; x += 4) {
        const local = this.localAtX(x);
        if (!local) continue;
        const phase = (branch === 0 ? local.phase1 : local.phase2) + animation + x * .055;
        const value = Math.cos(phase);
        const p = branch === 0 ? local.p1 : local.p2;
        const color = value >= 0 ? [142, 255, 66] : [37, 232, 255];
        const y = this.centerY(x, branch);
        ctx.fillStyle = rgba(color[0], color[1], color[2], .1 + .74 * Math.abs(value) * clamp(Math.sqrt(p), 0, 1));
        ctx.beginPath();
        ctx.arc(x, y, 3.5 + 5 * Math.abs(value), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(230,248,244,.7)';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Signed phase fronts — green and cyan indicate opposite field sign', g.w / 2, g.center + g.outerSeparation / 2 + 75);
  }

  drawField(timeSeconds, speed, paused) {
    const frameKey = Math.floor((paused ? 0 : timeSeconds * speed) * 24);
    if (frameKey !== this.lastFieldFrame) {
      this.lastFieldFrame = frameKey;
      this.buildFieldImage(timeSeconds, speed, paused);
    }
    const g = this.geometry();
    this.ctx.drawImage(this.fieldCache, g.x0 - 24, g.center - g.outerSeparation / 2 - 55, g.x1 - g.x0 + 48, g.outerSeparation + 110);
    this.drawGuideOutline(.55);
    this.ctx.fillStyle = 'rgba(230,248,244,.62)';
    this.ctx.font = '9px system-ui';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Re(E) from compact transverse modes · carrier wavelength visually magnified', g.w / 2, g.center + g.outerSeparation / 2 + 76);
  }

  buildFieldImage(timeSeconds, speed, paused) {
    const g = this.geometry();
    const width = 300;
    const height = 170;
    this.fieldCache.width = width;
    this.fieldCache.height = height;
    const image = this.fieldCtx.createImageData(width, height);
    const data = image.data;
    const animation = paused ? 0 : timeSeconds * speed * 2.6;
    const sigma = Math.max(8, 11 + (this.coupler?.params?.gapUm ?? .2) * 6);

    for (let ix = 0; ix < width; ix += 1) {
      const xWorld = lerp(g.x0 - 24, g.x1 + 24, ix / (width - 1));
      const local = this.localAtX(xWorld);
      if (!local) continue;
      const y1World = this.centerY(xWorld, 0);
      const y2World = this.centerY(xWorld, 1);
      const carrier = animation + ix * .17;
      const carrierFactor = expi(carrier);
      for (let iy = 0; iy < height; iy += 1) {
        const yWorld = lerp(g.center - g.outerSeparation / 2 - 55, g.center + g.outerSeparation / 2 + 55, iy / (height - 1));
        const mode1 = Math.exp(-((yWorld - y1World) ** 2) / (2 * sigma ** 2));
        const mode2 = Math.exp(-((yWorld - y2World) ** 2) / (2 * sigma ** 2));
        const field = mul(add(scale(local.a1, mode1), scale(local.a2, mode2)), carrierFactor);
        const intensity = clamp(abs2(field) * 1.7, 0, 1.2);
        const signed = clamp(field.re * 1.6, -1, 1);
        const [r, gg, b, a] = blendFieldColor(signed, Math.sqrt(intensity));
        const idx = (iy * width + ix) * 4;
        data[idx] = r;
        data[idx + 1] = gg;
        data[idx + 2] = b;
        data[idx + 3] = Math.round(a * 255);
      }
    }
    this.fieldCtx.putImageData(image, 0, 0);
  }

  drawSupermodes(timeSeconds, speed, paused) {
    const ctx = this.ctx;
    const g = this.geometry();
    const panelGap = 24;
    const panelHeight = Math.min(150, this.height * .22);
    const topCenter = g.center - panelHeight / 2 - panelGap;
    const bottomCenter = g.center + panelHeight / 2 + panelGap;
    const animation = paused ? 0 : timeSeconds * speed * 1.7;

    this.drawModePanel(topCenter, panelHeight, +1, 'Even supermode', animation);
    this.drawModePanel(bottomCenter, panelHeight, -1, 'Odd supermode', animation + Math.PI / 2);

    ctx.fillStyle = 'rgba(226,246,241,.66)';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Their propagation-constant difference produces the observed power beating.', g.w / 2, bottomCenter + panelHeight / 2 + 42);
  }

  drawModePanel(centerY, height, parity, label, animation) {
    const ctx = this.ctx;
    const g = this.geometry();
    const xStart = g.x0 + 20;
    const xEnd = g.x1 - 20;
    const separation = clamp(g.innerSeparation * .7, 34, 70);
    const sigma = 13;
    ctx.save();
    ctx.beginPath();
    this.roundRectPath(ctx, xStart - 15, centerY - height / 2, xEnd - xStart + 30, height, 17);
    ctx.clip();
    ctx.fillStyle = 'rgba(6,14,16,.72)';
    ctx.fillRect(xStart - 15, centerY - height / 2, xEnd - xStart + 30, height);
    for (let x = xStart; x <= xEnd; x += 3) {
      const carrier = Math.cos(animation + x * .09);
      for (let y = centerY - height / 2; y <= centerY + height / 2; y += 3) {
        const upper = Math.exp(-((y - (centerY - separation / 2)) ** 2) / (2 * sigma ** 2));
        const lower = Math.exp(-((y - (centerY + separation / 2)) ** 2) / (2 * sigma ** 2));
        const value = (upper + parity * lower) * carrier;
        if (Math.abs(value) < .035) continue;
        const color = value >= 0 ? [142,255,66] : [37,232,255];
        ctx.fillStyle = rgba(color[0],color[1],color[2],clamp(Math.abs(value)*.55,0,.7));
        ctx.fillRect(x, y, 4, 4);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(99,221,208,.2)';
    ctx.lineWidth = 1;
    this.roundRectPath(ctx, xStart - 15, centerY - height / 2, xEnd - xStart + 30, height, 17);
    ctx.stroke();
    ctx.fillStyle = '#dff7f1';
    ctx.font = '600 10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(label, xStart, centerY - height / 2 + 18);
    ctx.fillStyle = 'rgba(173,200,195,.7)';
    ctx.font = '8px system-ui';
    ctx.fillText(parity > 0 ? 'same field sign across the guides' : 'π phase flip across the guides', xStart, centerY - height / 2 + 32);
  }

  drawDimensions() {
    if (this.view === 'circuit') return;
    const ctx = this.ctx;
    const g = this.geometry();
    ctx.save();
    ctx.strokeStyle = 'rgba(213,242,236,.42)';
    ctx.fillStyle = 'rgba(213,242,236,.68)';
    ctx.lineWidth = 1;
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    const y = g.center - g.innerSeparation / 2 - 48;
    ctx.beginPath();
    ctx.moveTo(g.couplingStart, y);
    ctx.lineTo(g.couplingEnd, y);
    ctx.moveTo(g.couplingStart, y - 6); ctx.lineTo(g.couplingStart, y + 6);
    ctx.moveTo(g.couplingEnd, y - 6); ctx.lineTo(g.couplingEnd, y + 6);
    ctx.stroke();
    ctx.fillText(`L = ${(this.coupler.params?.interactionLengthUm ?? 20).toFixed(2)} µm`, (g.couplingStart + g.couplingEnd) / 2, y - 8);

    const x = g.w / 2;
    const yTop = g.center - g.innerSeparation / 2;
    const yBottom = g.center + g.innerSeparation / 2;
    ctx.beginPath();
    ctx.moveTo(x, yTop + 8); ctx.lineTo(x, yBottom - 8);
    ctx.moveTo(x - 5, yTop + 8); ctx.lineTo(x + 5, yTop + 8);
    ctx.moveTo(x - 5, yBottom - 8); ctx.lineTo(x + 5, yBottom - 8);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillText(`g = ${(this.coupler.params?.gapUm ?? .2).toFixed(3)} µm`, x + 9, g.center + 3);
    ctx.restore();
  }

  roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}

export function couplerViewMeta(view) {
  const index = VIEW_ORDER.indexOf(view);
  const map = {
    circuit: { depth: '1× · scattering overview', model: '4-port scattering model', scale: 'Ports and circuit context' },
    power: { depth: '10× · power flow', model: 'Distributed coupled-mode model', scale: 'Normalized power 0 → 1' },
    phase: { depth: '30× · complex phase', model: 'Complex coupled amplitudes', scale: 'Signed field phase' },
    field: { depth: '100× · reconstructed field', model: 'Compact local field reconstruction', scale: 'Re(E), normalized' },
    supermodes: { depth: '300× · supermodes', model: 'Even / odd modal basis', scale: 'Signed modal field' }
  };
  return { ...map[view], index };
}
