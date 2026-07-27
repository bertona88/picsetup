const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function niceNumber(value) {
  const absolute = Math.abs(value);
  if (!Number.isFinite(value)) return '—';
  if (absolute >= 1e4 || (absolute > 0 && absolute < 1e-3)) return value.toExponential(2);
  if (absolute >= 100) return value.toFixed(1);
  if (absolute >= 1) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

const palette = ['#8eff42', '#25e8ff', '#ffcc66', '#c995ff', '#ff7f9a', '#8cb8ff'];

export class LabPlot {
  constructor(canvas, { onCursor = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onCursor = onCursor;
    this.result = null;
    this.baselines = [];
    this.cursorIndex = null;
    this.padding = { left: 56, right: 18, top: 30, bottom: 38 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', event => this.handlePointer(event, false));
    canvas.addEventListener('pointerdown', event => this.handlePointer(event, true));
    canvas.addEventListener('pointerleave', () => { if (!this.pinned) { this.cursorIndex = null; this.draw(); } });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(10, Math.round(rect.width * dpr));
    const height = Math.max(10, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.width = rect.width;
    this.height = rect.height;
    this.draw();
  }

  setData(result, { baselines = [], cursorIndex = null } = {}) {
    this.result = result;
    this.baselines = baselines;
    this.cursorIndex = cursorIndex ?? result?.currentIndex ?? null;
    this.pinned = false;
    this.draw();
  }

  clear() {
    this.result = null;
    this.baselines = [];
    this.draw();
  }

  plotRect() {
    return {
      x: this.padding.left,
      y: this.padding.top,
      width: Math.max(10, (this.width ?? 0) - this.padding.left - this.padding.right),
      height: Math.max(10, (this.height ?? 0) - this.padding.top - this.padding.bottom)
    };
  }

  handlePointer(event, pin) {
    if (!this.result || this.result.kind !== 'sweep') return;
    const rect = this.canvas.getBoundingClientRect();
    const plot = this.plotRect();
    const localX = event.clientX - rect.left;
    if (localX < plot.x || localX > plot.x + plot.width) return;
    const fraction = clamp((localX - plot.x) / plot.width, 0, 1);
    this.cursorIndex = Math.round(fraction * (this.result.x.length - 1));
    if (pin) this.pinned = true;
    this.draw();
    this.onCursor?.(this.cursorIndex, pin);
  }

  background() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, 'rgba(9,22,23,.96)');
    gradient.addColorStop(1, 'rgba(3,9,10,.96)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  draw() {
    if (!this.ctx || !this.width || !this.height) return;
    this.background();
    if (!this.result) return this.drawEmpty();
    if (this.result.kind === 'sweep') this.drawSweep();
    else if (this.result.kind === 'tolerance') this.drawTolerance();
    else if (this.result.kind === 'pulse') this.drawPulse();
  }

  drawEmpty() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(218,240,235,.68)';
    ctx.font = '600 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Pin a measurement and sweep a parameter', this.width / 2, this.height / 2 - 6);
    ctx.fillStyle = 'rgba(136,166,160,.65)';
    ctx.font = '10px system-ui';
    ctx.fillText('Spectra, tuning, tolerances, and pulse response appear here.', this.width / 2, this.height / 2 + 14);
  }

  rangesForSeries(x, series) {
    const xMin = Math.min(...x), xMax = Math.max(...x);
    const values = series.flatMap(item => item.values).filter(Number.isFinite);
    let yMin = Math.min(...values), yMax = Math.max(...values);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
    if (Math.abs(yMax - yMin) < 1e-15) { yMin -= .5; yMax += .5; }
    const pad = (yMax - yMin) * .08;
    return { xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMin: yMin - pad, yMax: yMax + pad };
  }

  axes(ranges, xLabel, yLabel) {
    const ctx = this.ctx;
    const plot = this.plotRect();
    const mapX = value => plot.x + (value - ranges.xMin) / (ranges.xMax - ranges.xMin) * plot.width;
    const mapY = value => plot.y + plot.height - (value - ranges.yMin) / (ranges.yMax - ranges.yMin) * plot.height;
    ctx.strokeStyle = 'rgba(113,165,157,.13)';
    ctx.lineWidth = 1;
    ctx.font = '9px system-ui';
    ctx.fillStyle = 'rgba(164,194,188,.7)';
    ctx.textAlign = 'center';
    for (let tick = 0; tick <= 5; tick += 1) {
      const fraction = tick / 5;
      const x = plot.x + plot.width * fraction;
      const y = plot.y + plot.height * fraction;
      ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.width, y); ctx.stroke();
      ctx.fillText(niceNumber(ranges.xMin + (ranges.xMax - ranges.xMin) * fraction), x, plot.y + plot.height + 16);
      ctx.textAlign = 'right';
      ctx.fillText(niceNumber(ranges.yMax - (ranges.yMax - ranges.yMin) * fraction), plot.x - 8, y + 3);
      ctx.textAlign = 'center';
    }
    ctx.strokeStyle = 'rgba(156,211,201,.32)';
    ctx.beginPath(); ctx.moveTo(plot.x, plot.y); ctx.lineTo(plot.x, plot.y + plot.height); ctx.lineTo(plot.x + plot.width, plot.y + plot.height); ctx.stroke();
    ctx.fillStyle = 'rgba(198,223,218,.78)';
    ctx.fillText(xLabel, plot.x + plot.width / 2, this.height - 8);
    ctx.save();
    ctx.translate(13, plot.y + plot.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
    return { mapX, mapY, plot };
  }

  pathSeries(x, values, mapX, mapY, color, width = 1.8, dashed = false, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [5, 5] : []);
    ctx.beginPath();
    let started = false;
    for (let index = 0; index < x.length; index += 1) {
      if (!Number.isFinite(values[index])) continue;
      const px = mapX(x[index]), py = mapY(values[index]);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  legend(items) {
    const ctx = this.ctx;
    let x = this.padding.left;
    const y = 17;
    ctx.font = '9px system-ui';
    for (const item of items) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(item.dashed ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 13, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(218,237,233,.82)';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, x + 18, y + 3);
      x += 24 + ctx.measureText(item.label).width;
      if (x > this.width - 100) break;
    }
  }

  drawSweep() {
    const result = this.result;
    const series = [...result.traces, ...this.baselines.flatMap(baseline => baseline.traces.map(trace => ({ ...trace, baseline: true, baselineName: baseline.name })))];
    const ranges = this.rangesForSeries(result.x, series);
    const yUnit = result.traces[0]?.unit ?? '';
    const axes = this.axes(ranges, `${result.parameter.label}${result.parameter.unit ? ` (${result.parameter.unit})` : ''}`, yUnit || 'value');
    this.baselines.forEach((baseline, baselineIndex) => baseline.traces.forEach((trace, index) => this.pathSeries(baseline.x, trace.values, axes.mapX, axes.mapY, palette[index % palette.length], 1.1, true, .48)));
    result.traces.forEach((trace, index) => this.pathSeries(result.x, trace.values, axes.mapX, axes.mapY, palette[index % palette.length], 2));
    this.legend(result.traces.map((trace, index) => ({ label: trace.label, color: palette[index % palette.length] })));

    if (this.cursorIndex !== null && result.x[this.cursorIndex] !== undefined) {
      const index = clamp(this.cursorIndex, 0, result.x.length - 1);
      const x = axes.mapX(result.x[index]);
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(237,255,250,.45)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, axes.plot.y); ctx.lineTo(x, axes.plot.y + axes.plot.height); ctx.stroke();
      ctx.setLineDash([]);
      result.traces.forEach((trace, traceIndex) => {
        const y = axes.mapY(trace.values[index]);
        ctx.fillStyle = palette[traceIndex % palette.length];
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      });
      const lines = [`${result.parameter.label}: ${niceNumber(result.x[index])} ${result.parameter.unit ?? ''}`.trim(), ...result.traces.map(trace => `${trace.label}: ${niceNumber(trace.values[index])} ${trace.unit ?? ''}`.trim())];
      ctx.font = '9px system-ui';
      const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + 16;
      const height = lines.length * 14 + 10;
      const boxX = clamp(x + 9, axes.plot.x + 4, axes.plot.x + axes.plot.width - width - 4);
      const boxY = axes.plot.y + 5;
      ctx.fillStyle = 'rgba(3,11,12,.9)';
      ctx.strokeStyle = 'rgba(75,218,199,.32)';
      ctx.beginPath(); ctx.roundRect(boxX, boxY, width, height, 8); ctx.fill(); ctx.stroke();
      lines.forEach((line, lineIndex) => { ctx.fillStyle = lineIndex ? palette[(lineIndex - 1) % palette.length] : 'rgba(226,242,238,.76)'; ctx.textAlign = 'left'; ctx.fillText(line, boxX + 8, boxY + 14 + lineIndex * 14); });
    }
  }

  drawTolerance() {
    const result = this.result;
    const bins = result.histogram ?? [];
    if (!bins.length) return this.drawEmpty();
    const x = bins.map(bin => (bin.x0 + bin.x1) / 2);
    const ranges = { xMin: bins[0].x0, xMax: bins.at(-1).x1, yMin: 0, yMax: Math.max(...bins.map(bin => bin.count)) * 1.12 };
    const axes = this.axes(ranges, 'Measured output', 'samples');
    const ctx = this.ctx;
    bins.forEach((bin, index) => {
      const left = axes.mapX(bin.x0), right = axes.mapX(bin.x1);
      const top = axes.mapY(bin.count), bottom = axes.mapY(0);
      const gradient = ctx.createLinearGradient(0, top, 0, bottom);
      gradient.addColorStop(0, 'rgba(142,255,66,.75)');
      gradient.addColorStop(1, 'rgba(37,232,255,.18)');
      ctx.fillStyle = gradient;
      ctx.fillRect(left + 1, top, Math.max(1, right - left - 2), bottom - top);
    });
    const markers = [
      { value: result.nominal, label: 'nominal', color: '#25e8ff' },
      { value: result.threshold, label: 'yield limit', color: '#ffcc66' },
      { value: result.mean, label: 'mean', color: '#8eff42' }
    ];
    markers.forEach(marker => {
      const px = axes.mapX(marker.value);
      ctx.strokeStyle = marker.color; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(px, axes.plot.y); ctx.lineTo(px, axes.plot.y + axes.plot.height); ctx.stroke();
      ctx.setLineDash([]);
    });
    this.legend(markers.map(marker => ({ label: marker.label, color: marker.color, dashed: true })));
  }

  drawPulse() {
    const result = this.result;
    const traces = [
      { label: 'Input envelope', values: result.inputIntensity },
      { label: 'Optical output', values: result.outputIntensity },
      ...(result.detectorBandwidthGhz ? [{ label: 'Electrical readout', values: result.electricalIntensity }] : [])
    ];
    const ranges = this.rangesForSeries(result.timePs, traces);
    ranges.yMin = Math.min(0, ranges.yMin);
    const axes = this.axes(ranges, 'Time (ps)', 'normalized intensity');
    traces.forEach((trace, index) => this.pathSeries(result.timePs, trace.values, axes.mapX, axes.mapY, palette[index % palette.length], 2));
    this.legend(traces.map((trace, index) => ({ label: trace.label, color: palette[index % palette.length] })));
  }
}
