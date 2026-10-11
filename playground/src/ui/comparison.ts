import './comparison.css';
import type { CircuitDocument } from '../model/types';
import {
 createNotebook, addVariant, removeVariant, renameVariant, replaceVariant,
 selectVariantDetector, setSweep, parseNotebook, serializeNotebook, MAX_NOTEBOOK_BYTES,
 type Notebook, type ExperimentVariant,
} from '../experiments/notebook';
import { exportComparisonCsv, type CompareRequest, type CompareResponse, type ComparisonResult } from '../experiments/compare';
import { icon } from './icons';

type ComparisonOptions = {
 getDocument: () => CircuitDocument;
 onLoadDocument: (document: CircuitDocument) => void;
 onError: (message: string) => void;
 onChange?: () => void;
};
const STORAGE_KEY = 'picsetup.notebook.v1';
const colors = ['#3c806c', '#9270b0', '#cd8b43', '#538bac', '#b96879', '#909543'];
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (value: number, digits = 5) => Number.isFinite(value) ? Number(value.toPrecision(digits)).toString() : '—';
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A notebook contains independent circuit snapshots. Canvas edits never rewrite them. */
export class ComparisonPanel {
 private notebook: Notebook = createNotebook();
 private worker: Worker | null = null;
 private request: CompareRequest | null = null;
 private results: ComparisonResult[] = [];
 private requestId = 0;
 private running = false;
 private status = 'idle';
 private message = 'Pin a circuit, change one idea, then pin another.';
 private autosave = true;
 private storageMessage = 'Saved in this browser';
 private open = false;
 private returnFocus: HTMLElement | null = null;
 private width = 760;
 private height = 305;
 private cursor = 0.5;
 private plot: SVGSVGElement;

 constructor(private el: HTMLElement, private options: ComparisonOptions) {
  el.classList.add('comparison-overlay');
  el.dataset.testid = 'compare-panel';
  el.hidden = true;
  el.dataset.open = 'false';
  el.innerHTML = `<section class="comparison-window" role="dialog" aria-modal="true" aria-labelledby="compare-heading"><header class="comparison-header"><div><div class="comparison-kicker">${icon('duplicate', 15)} THE EXPERIMENT NOTEBOOK</div><h2 id="compare-heading">Keep the idea. Change the possibility.</h2><p>Independent circuit snapshots, one shared wavelength sweep.</p></div><button class="comparison-close" data-testid="compare-close" aria-label="Close comparison notebook">${icon('close', 19)}</button></header><div class="comparison-body"><aside class="comparison-sidebar"><div class="comparison-sidebar-heading"><h3>Your variants <span data-testid="compare-count">0 / 6</span></h3><button class="primary" data-testid="compare-capture">${icon('plus', 13)} Pin current circuit</button></div><div class="comparison-variants" data-testid="compare-variants"></div><div class="comparison-snapshot-note">${icon('duplicate', 15)}<p>Each pin keeps its own circuit.<br>Keep sketching; your variants stay put.</p></div></aside><main class="comparison-main"><div class="comparison-chart-heading"><div><div class="comparison-kicker">COMPARE THE RESPONSE</div><h3>Where do the ideas diverge?</h3></div><div class="comparison-chart-unit">DETECTOR POWER<br><strong>% of each input</strong></div></div><div class="comparison-sweep-controls"><label>FROM <span><input type="number" step="any" min="0" aria-label="Comparison start wavelength" data-testid="compare-start-nm"> nm</span></label><span class="comparison-range-arrow">→</span><label>TO <span><input type="number" step="any" min="0" aria-label="Comparison stop wavelength" data-testid="compare-stop-nm"> nm</span></label><label>SAMPLES <span><input type="number" min="2" max="1001" step="1" aria-label="Comparison sample count" data-testid="compare-points"></span></label><div class="comparison-run-actions"><button class="primary" data-testid="compare-run">${icon('play', 12)} Compare</button><button class="outline" data-testid="compare-cancel" hidden>Stop</button></div></div><div class="comparison-chart-wrap"><svg class="comparison-chart" data-testid="compare-plot" role="slider" tabindex="0" aria-label="Variant detector power spectra; use arrow keys to explore wavelength" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="comparison-status" data-testid="compare-status" role="status"></div><div class="comparison-readout"><div class="comparison-wavelength" data-testid="compare-wavelength"></div><div class="comparison-legend" data-testid="compare-legend"></div></div><div class="comparison-footnote">Every line is a solved snapshot. Unsupported wavelengths appear as gaps. Open-data model warnings are retained in the exported results.</div></main></div><footer class="comparison-footer"><span class="comparison-storage" data-testid="compare-storage"></span><div><button class="text-button" data-testid="compare-open-json">${icon('upload', 14)} Open notebook</button><button class="outline" data-testid="compare-export-json">${icon('download', 14)} Save notebook</button><button class="text-button" data-testid="compare-export-csv" disabled>${icon('download', 14)} Results CSV</button></div></footer><input type="file" accept="application/json,.json" data-testid="compare-import-json" hidden></section>`;
  this.plot = this.query<SVGSVGElement>('[data-testid=compare-plot]');
  this.restore();
  this.query('[data-testid=compare-close]').addEventListener('click', () => this.toggle(false));
  this.query('[data-testid=compare-capture]').addEventListener('click', () => this.captureCurrent());
  this.query('[data-testid=compare-run]').addEventListener('click', () => this.run());
  this.query('[data-testid=compare-cancel]').addEventListener('click', () => this.cancel());
  this.query('[data-testid=compare-export-json]').addEventListener('click', () => {
   try { this.download(serializeNotebook(this.notebook), 'picsetup-notebook.json', 'application/json'); }
   catch (error) { this.fail(error); }
  });
  this.query('[data-testid=compare-export-csv]').addEventListener('click', () => {
   try { if (this.request && this.results.length) this.download(exportComparisonCsv(this.request, this.results), 'picsetup-comparison.csv', 'text/csv;charset=utf-8'); }
   catch (error) { this.fail(error); }
  });
  const fileInput = this.query<HTMLInputElement>('[data-testid=compare-import-json]');
  this.query('[data-testid=compare-open-json]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
   const file = fileInput.files?.[0];
   fileInput.value = '';
   if (!file) return;
   try {
    if (file.size > MAX_NOTEBOOK_BYTES) throw new Error(`Notebook exceeds the ${fmt(MAX_NOTEBOOK_BYTES / 1024 / 1024, 4)} MiB size limit.`);
    const imported = parseNotebook(await file.text());
    this.change(imported, `Opened ${imported.variants.length} saved variants. Run a comparison to see their response.`);
   } catch (error) { this.fail(error); }
  });
  this.query('[data-testid=compare-variants]').addEventListener('click', event => {
   const target = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
   const row = target?.closest<HTMLElement>('[data-variant-id]');
   if (!target || !row) return;
   const variant = this.notebook.variants.find(v => v.id === row.dataset.variantId);
   if (!variant) return;
   try {
    if (target.dataset.action === 'load') {
     this.options.onLoadDocument(structuredClone(variant.document));
     this.toggle(false);
    } else if (target.dataset.action === 'remove') this.change(removeVariant(this.notebook, variant.id), 'Variant removed. Run the updated comparison.');
    else if (target.dataset.action === 'update') this.change(replaceVariant(this.notebook, variant.id, this.options.getDocument()), 'Snapshot updated from the canvas. Run the updated comparison.');
   } catch (error) { this.fail(error); }
  });
  this.query('[data-testid=compare-variants]').addEventListener('change', event => {
   const input = event.target as HTMLInputElement | HTMLSelectElement;
   const id = input.closest<HTMLElement>('[data-variant-id]')?.dataset.variantId;
   if (!id) return;
   try {
    if (input.dataset.testid === 'compare-name') this.change(renameVariant(this.notebook, id, input.value.trim()), this.message, false);
    if (input.dataset.testid === 'compare-detector') this.change(selectVariantDetector(this.notebook, id, input.value || null), this.message, false);
   } catch (error) { this.fail(error); this.renderVariants(); }
  });
  for (const testid of ['compare-start-nm', 'compare-stop-nm', 'compare-points']) this.query(`[data-testid=${testid}]`).addEventListener('change', () => {
   try { this.change(setSweep(this.notebook, this.readSweep()), 'Sweep range changed. Compare the variants again.'); }
   catch (error) { this.fail(error); }
  });
  this.plot.addEventListener('pointermove', event => {
   const rect = this.plot.getBoundingClientRect();
   this.cursor = Math.max(0, Math.min(1, (event.clientX - rect.left - 44) / Math.max(1, this.width - 64)));
   this.renderPlot(); this.renderReadout();
  });
  this.plot.addEventListener('keydown', event => {
   const step = 1 / Math.max(1, (this.request?.notebook.sweep.points ?? this.notebook.sweep.points) - 1);
   if (event.key === 'ArrowLeft') this.cursor = Math.max(0, this.cursor - step);
   else if (event.key === 'ArrowRight') this.cursor = Math.min(1, this.cursor + step);
   else if (event.key === 'Home') this.cursor = 0;
   else if (event.key === 'End') this.cursor = 1;
   else return;
   event.preventDefault(); this.renderPlot(); this.renderReadout();
  });
  el.addEventListener('keydown', event => {
   event.stopPropagation();
   if (event.key === 'Escape') { event.preventDefault(); this.toggle(false); }
   if (event.key === 'Tab') {
    const focusable = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')).filter(node => !node.hidden && node.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
   }
  });
  el.addEventListener('click', event => { if (event.target === el) this.toggle(false); });
  new ResizeObserver(entries => {
   const { width, height } = entries[0].contentRect;
   if (width > 0 && height > 0) { this.width = width; this.height = height; this.renderPlot(); }
  }).observe(this.plot);
  this.render();
 }

 private query<T extends Element = HTMLElement>(selector: string): T { return this.el.querySelector<T>(selector)!; }

 toggle(force?: boolean) {
  const next = force ?? !this.open;
  if (next && !this.open) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  this.open = next; this.el.hidden = !next; this.el.dataset.open = String(next);
  if (next) this.query<HTMLButtonElement>('[data-testid=compare-close]').focus();
  else this.returnFocus?.focus();
 }

 captureCurrent() {
  return this.captureDocument(this.options.getDocument());
 }

 captureDocument(document: CircuitDocument, label?: string) {
  return this.captureDocuments([{ document, label }]);
 }

 /** Validate the whole group before changing the notebook, so a full tray cannot half-import a study. */
 captureDocuments(documents: { document: CircuitDocument; label?: string }[]): boolean {
  try {
   let next = this.notebook;
   for (const { document, label } of documents) next = addVariant(next, document, label ?? (document.title.slice(0, 100) || 'Untitled idea'));
   this.change(next, documents.length > 1 ? `${documents.length} snapshots pinned. Compare their response on the same wavelength grid.` : 'Snapshot pinned. Change the canvas and pin another, or compare now.');
   this.toggle(true);
   return true;
  } catch (error) { this.fail(error); return false; }
 }

 /** Canvas state is deliberately not copied into saved variants. */
 sync() { this.query<HTMLButtonElement>('[data-testid=compare-capture]').disabled = this.running || this.notebook.variants.length >= 6; }

 private restore() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); if (saved) { this.notebook = parseNotebook(saved); this.storageMessage = 'Restored from this browser'; this.message = 'Your pinned variants are ready. Run a fresh comparison.'; } }
  catch (error) {
   this.message = `Saved notebook could not be restored: ${messageOf(error)}`;
   if (saved) {
    try { localStorage.setItem(`${STORAGE_KEY}.recovery`, saved); this.storageMessage = 'Original notebook kept in a recovery backup'; }
    catch { this.autosave = false; this.storageMessage = 'Autosave paused; save a notebook file to keep this session'; }
   } else { this.autosave = false; this.storageMessage = 'Browser storage unavailable; save a notebook file'; }
  }
 }

 private persist() {
  if (this.autosave) {
   try { localStorage.setItem(STORAGE_KEY, serializeNotebook(this.notebook)); this.storageMessage = 'Saved in this browser'; }
   catch { this.autosave = false; this.storageMessage = 'Browser storage is full or unavailable; save a notebook file'; }
  }
  this.options.onChange?.();
 }

 private change(notebook: Notebook, message: string, invalidate = true) {
  if (invalidate) {
   if (this.running && this.request) this.worker?.postMessage({ type: 'cancel', id: this.request.id });
   this.running = false; this.request = null; this.results = []; this.status = 'idle';
  } else if (this.request) {
   this.request = { ...this.request, notebook: structuredClone(notebook) };
   this.results = this.results.map(result => ({ ...result, variantName: notebook.variants.find(variant => variant.id === result.variantId)?.name ?? result.variantName }));
  }
  this.notebook = notebook; this.message = message; this.persist(); this.render();
 }

 private readSweep() {
  return { startM: Number(this.query<HTMLInputElement>('[data-testid=compare-start-nm]').value) * 1e-9, stopM: Number(this.query<HTMLInputElement>('[data-testid=compare-stop-nm]').value) * 1e-9, points: Number(this.query<HTMLInputElement>('[data-testid=compare-points]').value) };
 }

 run() {
  try {
   const notebook = setSweep(this.notebook, this.readSweep());
   if (!notebook.variants.length) throw new Error('Pin at least one circuit to compare.');
   this.change(notebook, 'Preparing the comparison…');
   this.request = { id: ++this.requestId, notebook: structuredClone(this.notebook) };
   this.running = true; this.status = 'running'; this.message = `Solving ${notebook.variants.length} variants across ${notebook.sweep.points} wavelengths…`;
   if (!this.worker) {
    this.worker = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<CompareResponse>) => this.receive(event.data));
    this.worker.addEventListener('error', () => {
     this.worker?.terminate(); this.worker = null; this.running = false; this.request = null; this.results = []; this.fail(new Error('The comparison worker stopped. Run the comparison again.'));
    });
   }
   this.worker.postMessage({ type: 'run', ...this.request }); this.render();
  } catch (error) { this.running = false; this.fail(error); }
 }

 private cancel() {
  if (!this.running || !this.request) return;
  this.worker?.postMessage({ type: 'cancel', id: this.request.id });
  this.running = false; this.status = 'cancelled'; this.message = 'Comparison stopped. Exported results include only completed samples.'; this.render();
 }

 private receive(response: CompareResponse) {
  if (!this.request || response.id !== this.request.id || this.status === 'cancelled') return;
  if (response.type === 'progress') { this.results = response.results; this.message = `Solving ${response.completed} / ${response.total} circuit samples…`; }
  else if (response.type === 'complete') {
   this.results = response.results; this.running = false;
   const samples = this.results.flatMap(result => result.samples);
   const failed = samples.filter(sample => !sample.ok);
   const warnings = samples.flatMap(sample => sample.diagnostics).filter(diagnostic => diagnostic.severity === 'warning');
   this.status = failed.length ? 'error' : 'complete';
   this.message = failed.length ? `${failed.length} unsupported samples · ${failed[0].diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message ?? 'Check model limits.'}` : `${this.results.length} variants · ${this.notebook.sweep.points} wavelengths each${warnings.length ? ' · model warnings in CSV' : ''} · move across the plot to compare`;
  } else if (response.type === 'cancelled') { this.running = false; this.status = 'cancelled'; this.message = `Stopped after ${response.completed} / ${response.total} samples.`; }
  else { this.running = false; this.results = []; this.status = 'error'; this.message = response.message; }
  if (this.running) this.renderResults(); else this.render();
 }

 private fail(error: unknown) { this.message = messageOf(error); this.status = 'error'; this.options.onError(this.message); this.render(); }

 private download(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
 }

 private render() {
  this.query<HTMLInputElement>('[data-testid=compare-start-nm]').value = fmt(this.notebook.sweep.startM * 1e9, 12);
  this.query<HTMLInputElement>('[data-testid=compare-stop-nm]').value = fmt(this.notebook.sweep.stopM * 1e9, 12);
  this.query<HTMLInputElement>('[data-testid=compare-points]').value = String(this.notebook.sweep.points);
  for (const testid of ['compare-start-nm', 'compare-stop-nm', 'compare-points']) this.query<HTMLInputElement>(`[data-testid=${testid}]`).disabled = this.running;
  this.query<HTMLButtonElement>('[data-testid=compare-run]').disabled = this.running || !this.notebook.variants.length;
  this.query<HTMLElement>('[data-testid=compare-cancel]').hidden = !this.running;
  this.query<HTMLButtonElement>('[data-testid=compare-open-json]').disabled = this.running;
  this.query<HTMLButtonElement>('[data-testid=compare-export-csv]').disabled = this.running || !this.results.some(result => result.samples.length);
  this.query('[data-testid=compare-count]').textContent = `${this.notebook.variants.length} / 6`;
  this.query('[data-testid=compare-storage]').textContent = this.storageMessage;
  this.sync(); this.renderVariants(); this.renderResults();
 }

 private renderVariants() {
  this.query('[data-testid=compare-variants]').innerHTML = this.notebook.variants.length ? this.notebook.variants.map((variant, index) => {
   const detectors = variant.document.circuit.components.filter(component => component.model === 'detector');
   return `<article class="comparison-variant" data-testid="compare-variant" data-variant-id="${esc(variant.id)}" style="--variant-color:${colors[index]}"><div class="comparison-variant-name"><span class="comparison-letter">${String.fromCharCode(65 + index)}</span><input data-testid="compare-name" type="text" maxlength="100" aria-label="Variant ${String.fromCharCode(65 + index)} name" value="${esc(variant.name)}" ${this.running ? 'disabled' : ''}><button data-action="remove" aria-label="Remove ${esc(variant.name)}" title="Remove snapshot" ${this.running ? 'disabled' : ''}>${icon('close', 12)}</button></div>${this.thumbnail(variant)}<div class="comparison-variant-meta">${variant.document.circuit.components.length} components <span>·</span> ${variant.document.circuit.connections.length} connections</div><label class="comparison-detector-label">TRACE <select data-testid="compare-detector" aria-label="Detector for ${esc(variant.name)}" ${this.running || !detectors.length ? 'disabled' : ''}>${detectors.length ? detectors.map(detector => `<option value="${esc(detector.id)}" ${variant.detectorId === detector.id ? 'selected' : ''}>${esc(detector.label)}</option>`).join('') : '<option value="">No detector in this circuit</option>'}</select></label><div class="comparison-variant-actions"><button data-action="load" title="Open an editable copy of this snapshot">${icon('arrow', 12)} Fork to canvas</button><button data-action="update" title="Replace this snapshot with the current canvas" ${this.running ? 'disabled' : ''}>Update from canvas</button></div></article>`;
  }).join('') : `<div class="comparison-empty"><svg viewBox="0 0 140 90" fill="none" aria-hidden="true"><path d="M20 46h25c18 0 15-23 31-23h35M45 46c18 0 15 23 31 23h35" stroke="#90a88c" stroke-width="2"/><circle cx="21" cy="46" r="7" fill="#f9faf5" stroke="#73937b"/><rect x="107" y="16" width="18" height="14" rx="4" stroke="#9d85b5"/><rect x="107" y="62" width="18" height="14" rx="4" stroke="#91a68b"/></svg><h4>What if you changed<br>just one thing?</h4><p>Pin the circuit on your canvas.<br>Make a change. Pin it again.</p></div>`;
 }

 private thumbnail(variant: ExperimentVariant) {
  const components = variant.document.circuit.components;
  if (!components.length) return '<div class="comparison-thumbnail-empty">Blank canvas snapshot</div>';
  const positions = variant.document.layout.components;
  const xs = components.map(component => positions[component.id].x), ys = components.map(component => positions[component.id].y);
  const minX = Math.min(...xs), minY = Math.min(...ys), dx = Math.max(100, Math.max(...xs) - minX), dy = Math.max(100, Math.max(...ys) - minY);
  const x = (id: string) => 12 + (positions[id].x - minX) / dx * 204, y = (id: string) => 10 + (positions[id].y - minY) / dy * 36;
  const wires = variant.document.circuit.connections.map(connection => { const x1 = x(connection.from.component), x2 = x(connection.to.component), y1 = y(connection.from.component), y2 = y(connection.to.component); return `<path d="M${x1} ${y1}C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}"/>`; }).join('');
  const nodes = components.map(component => component.model === 'source' ? `<circle cx="${x(component.id)}" cy="${y(component.id)}" r="3.5"/>` : `<rect x="${x(component.id) - 4}" y="${y(component.id) - 3}" width="8" height="6" rx="${component.model === 'detector' ? 1 : 2}"/>`).join('');
  return `<svg class="comparison-thumbnail" viewBox="0 0 228 56" aria-hidden="true"><g class="comparison-thumbnail-wires">${wires}</g><g class="comparison-thumbnail-nodes">${nodes}</g></svg>`;
 }

 private renderResults() {
  const status = this.query('[data-testid=compare-status]'); status.textContent = this.message; status.dataset.status = this.status;
  const note = this.query('.comparison-footnote');
  const datasetWarning = this.results.flatMap(result => result.samples).flatMap(sample => sample.diagnostics).find(diagnostic => diagnostic.code === 'EXPERIMENTAL_DATASET');
  const usesDataset = this.notebook.variants.some(variant => variant.document.circuit.components.some(component => component.model === 'siepic-coupler'));
  note.textContent = datasetWarning?.message ?? (usesDataset ? 'SiEPIC snapshots use experimental imported data with slight passivity violations and unknown native port planes. No calibrated-device claim. Full per-sample diagnostics are in CSV.' : 'Every line is a solved snapshot. Unsupported wavelengths appear as gaps. Full per-sample diagnostics are retained in the exported results.');
  this.renderPlot(); this.renderReadout();
 }

 private selectedSample(result: ComparisonResult) {
  const sweep = this.request?.notebook.sweep ?? this.notebook.sweep;
  return result.samples[Math.round(this.cursor * (sweep.points - 1))];
 }

 private renderReadout() {
  const sweep = this.request?.notebook.sweep ?? this.notebook.sweep;
  const index = Math.round(this.cursor * (sweep.points - 1));
  const wavelength = sweep.startM + (sweep.stopM - sweep.startM) * index / (sweep.points - 1);
  this.query('[data-testid=compare-wavelength]').innerHTML = `<span>AT WAVELENGTH</span><strong>${fmt(wavelength * 1e9, 7)} <small>nm</small></strong>`;
  this.query('[data-testid=compare-legend]').innerHTML = this.notebook.variants.map((variant, index) => {
   const result = this.results.find(result => result.variantId === variant.id), sample = result ? this.selectedSample(result) : undefined;
   const detector = variant.detectorId ? sample?.detectors[variant.detectorId] : undefined;
   const input = sample?.budget?.emittedW ?? 0;
   const power = sample?.ok && detector && input > 0 ? detector.powerW / input * 100 : NaN;
   return `<div class="comparison-legend-item"><span class="comparison-legend-dot" style="background:${colors[index]}"></span><span class="comparison-legend-name">${esc(variant.name)}</span><strong>${Number.isFinite(power) ? `${fmt(power, 5)}<small>%</small>` : '<small>—</small>'}</strong></div>`;
  }).join('') || '<p class="comparison-legend-empty">Your pinned ideas will appear here.</p>';
 }

 private renderPlot() {
  const { width, height } = this, left = 44, right = 20, top = 22, bottom = 30, plotW = Math.max(1, width - left - right), plotH = Math.max(1, height - top - bottom);
  const sweep = this.request?.notebook.sweep ?? this.notebook.sweep;
  const allValues: number[] = [];
  for (const variant of this.notebook.variants) {
   const result = this.results.find(result => result.variantId === variant.id);
   if (!variant.detectorId || !result) continue;
   for (const sample of result.samples) { const power = sample.detectors[variant.detectorId]?.powerW, input = sample.budget?.emittedW ?? 0; if (sample.ok && input > 0 && Number.isFinite(power)) allValues.push(power / input * 100); }
  }
  const yMax = Math.ceil(Math.max(100, ...allValues) / 25) * 25;
  const x = (wavelength: number) => left + (wavelength - sweep.startM) / (sweep.stopM - sweep.startM) * plotW;
  const y = (power: number) => top + (1 - power / yMax) * plotH;
  this.plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
  this.plot.dataset.status = this.status; this.plot.dataset.requestId = String(this.request?.id ?? ''); this.plot.dataset.variantCount = String(this.results.length);
  this.plot.setAttribute('aria-valuemin', String(sweep.startM * 1e9)); this.plot.setAttribute('aria-valuemax', String(sweep.stopM * 1e9)); this.plot.setAttribute('aria-valuenow', String((sweep.startM + this.cursor * (sweep.stopM - sweep.startM)) * 1e9));
  let html = '';
  for (let i = 0; i <= 4; i++) { const value = yMax * i / 4, yy = y(value); html += `<line class="comparison-grid" x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}"/><text class="comparison-axis" x="${left - 10}" y="${yy + 3}" text-anchor="end">${fmt(value, 4)}${i === 4 ? '%' : ''}</text>`; }
  for (let i = 0; i <= 4; i++) { const wavelength = sweep.startM + (sweep.stopM - sweep.startM) * i / 4, xx = x(wavelength); html += `<text class="comparison-axis" x="${xx}" y="${height - 8}" text-anchor="middle">${fmt(wavelength * 1e9, 6)}${i === 4 ? ' nm' : ''}</text>`; }
  this.notebook.variants.forEach((variant, index) => {
   const result = this.results.find(result => result.variantId === variant.id);
   if (!variant.detectorId || !result) return;
   let path = '', segment = false;
   for (const sample of result.samples) {
    const power = sample.detectors[variant.detectorId]?.powerW, input = sample.budget?.emittedW ?? 0;
    if (!sample.ok || input <= 0 || !Number.isFinite(power)) { segment = false; continue; }
    path += `${segment ? 'L' : 'M'}${x(sample.wavelengthM).toFixed(2)} ${y(power / input * 100).toFixed(2)} `; segment = true;
   }
   if (path) html += `<path class="comparison-trace" data-variant-id="${esc(variant.id)}" data-detector-id="${esc(variant.detectorId)}" stroke="${colors[index]}" d="${path}"/>`;
  });
  if (allValues.length) {
   const cursorIndex = Math.round(this.cursor * (sweep.points - 1)), wavelength = sweep.startM + (sweep.stopM - sweep.startM) * cursorIndex / (sweep.points - 1), xx = x(wavelength);
   html += `<line class="comparison-cursor" x1="${xx}" y1="${top - 7}" x2="${xx}" y2="${height - bottom + 5}"/>`;
   this.notebook.variants.forEach((variant, index) => { const result = this.results.find(result => result.variantId === variant.id), sample = result ? this.selectedSample(result) : undefined, detector = variant.detectorId ? sample?.detectors[variant.detectorId] : undefined, input = sample?.budget?.emittedW ?? 0; if (sample?.ok && detector && input > 0) html += `<circle class="comparison-point" cx="${xx}" cy="${y(detector.powerW / input * 100)}" r="4.5" fill="${colors[index]}"/>`; });
  } else html += `<text class="comparison-plot-empty" x="${left + plotW / 2}" y="${top + plotH / 2}" text-anchor="middle">${this.running ? 'Tracing your possibilities…' : this.status === 'error' ? 'No supported detector response to display.' : this.results.length ? 'Choose a detector with nonzero input power.' : 'A little change can make a different spectrum.'}</text>`;
  this.plot.innerHTML = html;
 }
}
