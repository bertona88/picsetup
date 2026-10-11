import './comparison.css';
import type { CircuitDocument } from '../model/types';
import {
 createNotebook, addVariant, removeVariant, renameVariant, replaceVariant,
 selectVariantDetector, setSweep, parseNotebook, serializeNotebook, clearStudy, setStudy, MAX_NOTEBOOK_BYTES,
 type Notebook, type ExperimentVariant,
} from '../experiments/notebook';
import { exportComparisonCsv, type CompareRequest, type CompareResponse, type ComparisonResult } from '../experiments/compare';
import { icon } from './icons';
import { getAuthoringStatus } from '../api/authoring';
import type { SweepSample } from '../solver/sweep';
import { assessSampleQuality } from '../solver/quality';
import { exportStudyCsv, formatDbMetric, semanticDifferences, type StudyResult, type StudyResponse } from '../experiments/study';

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
 private studyWorker: Worker | null = null;
 private studyResult: StudyResult | null = null;
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
 private unit: 'percent' | 'db' = 'percent';
 private bothOutputs = false;
 private scenarioId = 'nominal';

 constructor(private el: HTMLElement, private options: ComparisonOptions) {
  el.classList.add('comparison-overlay');
  el.dataset.testid = 'compare-panel';
  el.hidden = true;
  el.dataset.open = 'false';
  el.innerHTML = `<section class="comparison-window" role="dialog" aria-modal="true" aria-labelledby="compare-heading"><header class="comparison-header"><div><div class="comparison-kicker">${icon('duplicate', 15)} THE EXPERIMENT NOTEBOOK</div><h2 id="compare-heading">Keep the idea. Change the possibility.</h2><p>Independent circuit snapshots, one shared wavelength sweep.</p></div><button class="comparison-close" data-testid="compare-close" aria-label="Close comparison notebook">${icon('close', 19)}</button></header><div class="comparison-body"><aside class="comparison-sidebar"><div class="comparison-sidebar-heading"><h3>Your variants <span data-testid="compare-count">0 / 6</span></h3><button class="primary" data-testid="compare-capture">${icon('plus', 13)} Pin current circuit</button></div><div class="comparison-variants" data-testid="compare-variants"></div><div class="comparison-snapshot-note">${icon('duplicate', 15)}<p>Each pin keeps its own circuit.<br>Keep sketching; your variants stay put.</p></div></aside><main class="comparison-main"><div class="comparison-chart-heading"><div><div class="comparison-kicker">COMPARE THE RESPONSE</div><h3>Where do the ideas diverge?</h3></div><div class="comparison-chart-unit">DETECTOR POWER<br><strong data-testid="compare-unit-label">% of each input</strong></div></div><div class="comparison-study-summary" data-testid="study-summary" hidden></div><div class="comparison-sweep-controls"><label>FROM <span><input type="number" step="any" min="0" aria-label="Comparison start wavelength" data-testid="compare-start-nm"> nm</span></label><span class="comparison-range-arrow">→</span><label>TO <span><input type="number" step="any" min="0" aria-label="Comparison stop wavelength" data-testid="compare-stop-nm"> nm</span></label><label>SAMPLES <span><input type="number" min="2" max="1001" step="1" aria-label="Comparison sample count" data-testid="compare-points"></span></label><div class="comparison-run-actions"><button class="primary" data-testid="compare-run">${icon('play', 12)} Compare</button><button class="outline" data-testid="compare-cancel" hidden>Stop</button></div></div><div class="comparison-display-controls"><label>SHOW <select data-testid="compare-units" aria-label="Spectrum units"><option value="percent">% of input</option><option value="db">dB relative to input</option></select></label><label class="comparison-checkbox"><input type="checkbox" data-testid="compare-both-outputs">Both outputs</label><label data-testid="study-scenario-control" hidden>SCENARIO <select data-testid="study-scenario" aria-label="Study phase-error scenario"></select></label><span>● solved samples · lines do not prove resolution</span></div><div class="comparison-chart-wrap"><svg class="comparison-chart" data-testid="compare-plot" role="slider" tabindex="0" aria-label="Variant detector power spectra; use arrow keys to explore wavelength" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="comparison-status" data-testid="compare-status" role="status"></div><div class="comparison-readout"><div class="comparison-wavelength" data-testid="compare-wavelength"></div><div class="comparison-legend" data-testid="compare-legend"></div></div><details class="comparison-quality" data-testid="compare-quality"><summary data-testid="compare-quality-summary">Point diagnostics appear after solving</summary><div data-testid="compare-diagnostics"></div></details><section class="comparison-study-results" data-testid="study-results" hidden></section><details class="comparison-assumptions"><summary>Model assumptions &amp; verified differences</summary><div data-testid="compare-assumptions"></div></details><div class="comparison-footnote">Every line is a solved snapshot. Unsupported wavelengths appear as gaps. Open-data model warnings are retained in the exported results.</div></main></div><footer class="comparison-footer"><span class="comparison-storage" data-testid="compare-storage"></span><div><button class="text-button" data-testid="compare-open-json">${icon('upload', 14)} Open notebook</button><button class="outline" data-testid="compare-export-json">${icon('download', 14)} Save notebook</button><button class="text-button" data-testid="compare-export-csv" disabled>${icon('download', 14)} Results CSV</button></div></footer><input type="file" accept="application/json,.json" data-testid="compare-import-json" hidden></section>`;
  this.plot = this.query<SVGSVGElement>('[data-testid=compare-plot]');
  this.restore();
  this.query<HTMLSelectElement>('[data-testid=study-scenario]').addEventListener('change', event => { this.scenarioId = (event.target as HTMLSelectElement).value; this.selectScenario(); this.renderResults(); });
  this.query('[data-testid=study-summary]').addEventListener('click', event => {
   if ((event.target as Element).closest('[data-testid=study-detach]')) this.change(clearStudy(this.notebook), 'Study targets detached. These independent snapshots can now be added or removed.');
  });
  this.query('[data-testid=study-summary]').addEventListener('change', () => {
   if (this.notebook.schema !== 'picsetup-notebook/2') return;
   try {
    const targets = { maxInsertionLossDb: Number(this.query<HTMLInputElement>('[data-testid=study-il-target]').value), maxCrosstalkDb: Number(this.query<HTMLInputElement>('[data-testid=study-xt-target]').value) };
    this.change(setStudy(this.notebook, { ...this.notebook.study, targets }), 'Targets changed. Run the study again.');
   } catch (error) { this.fail(error); }
  });
  this.query<HTMLSelectElement>('[data-testid=compare-units]').addEventListener('change', event => { this.unit = (event.target as HTMLSelectElement).value as 'percent' | 'db'; this.renderResults(); });
  this.query<HTMLInputElement>('[data-testid=compare-both-outputs]').addEventListener('change', event => { this.bothOutputs = (event.target as HTMLInputElement).checked; this.renderResults(); });
  this.query('[data-testid=compare-close]').addEventListener('click', () => this.toggle(false));
  this.query('[data-testid=compare-capture]').addEventListener('click', () => this.captureCurrent());
  this.query('[data-testid=compare-run]').addEventListener('click', () => this.run());
  this.query('[data-testid=compare-cancel]').addEventListener('click', () => this.cancel());
  this.query('[data-testid=compare-export-json]').addEventListener('click', () => {
   try { this.download(serializeNotebook(this.notebook), 'picsetup-notebook.json', 'application/json'); }
   catch (error) { this.fail(error); }
  });
  this.query('[data-testid=compare-export-csv]').addEventListener('click', () => {
   try { if (this.studyResult) this.download(exportStudyCsv(this.studyResult), 'picsetup-study.csv', 'text/csv;charset=utf-8'); else if (this.request && this.results.length) this.download(exportComparisonCsv(this.request, this.results), 'picsetup-comparison.csv', 'text/csv;charset=utf-8'); }
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
    this.loadNotebook(await file.text());
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

 /** Independent notebook snapshot for agents and export. */
 getNotebook(): Notebook { return structuredClone(this.notebook); }

 /** Validate completely before changing state; stale worker replies cannot overwrite an import. */
 loadNotebook(input: string | Notebook): void {
  const notebook = parseNotebook(typeof input === 'string' ? input : serializeNotebook(input));
  if (notebook.schema === 'picsetup-notebook/2') { this.bothOutputs = true; this.unit = 'db'; }
  this.scenarioId = 'nominal';
  this.change(notebook, `Opened ${notebook.variants.length} saved variants. Run a comparison to see their response.`);
  this.toggle(true);
 }

 /** Open an agent-authored study, preserving its exact snapshots and targets, and evaluate it. */
 startStudy(notebook: Notebook): void { this.loadNotebook(notebook); this.run(); }

 /** Canvas state is deliberately not copied into saved variants. */
 sync() { this.query<HTMLButtonElement>('[data-testid=compare-capture]').disabled = this.running || this.notebook.variants.length >= 6 || this.notebook.schema === 'picsetup-notebook/2'; }

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
  if (notebook.schema === 'picsetup-notebook/2') invalidate = true;
  if (invalidate) {
   if (this.running && this.request) { this.worker?.postMessage({ type: 'cancel', id: this.request.id }); this.studyWorker?.postMessage({ type: 'cancel', id: this.request.id }); }
   this.requestId++; this.running = false; this.request = null; this.results = []; this.studyResult = null; this.status = 'idle';
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
   if (this.notebook.schema === 'picsetup-notebook/2') { this.runStudyWorker(); this.render(); return; }
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
  this.studyWorker?.postMessage({ type: 'cancel', id: this.request.id });
  this.running = false; this.status = 'cancelled'; this.message = this.notebook.schema === 'picsetup-notebook/2' ? 'Study stopped. Run again to evaluate all scenarios and produce complete metrics.' : 'Comparison stopped. Exported results include only completed samples.'; this.render();
 }

 private runStudyWorker() {
  if (!this.request || this.notebook.schema !== 'picsetup-notebook/2') return;
  this.message = `Evaluating ${this.notebook.variants.length} alternatives × ${1 + this.notebook.study.phaseScenarios.length} explicit scenarios…`;
  if (!this.studyWorker) {
   this.studyWorker = new Worker(new URL('../workers/study.worker.ts', import.meta.url), { type: 'module' });
   this.studyWorker.addEventListener('message', (event: MessageEvent<StudyResponse>) => this.receiveStudy(event.data));
   this.studyWorker.addEventListener('error', () => { this.studyWorker?.terminate(); this.studyWorker = null; this.running = false; this.fail(new Error('The study worker stopped. Run the study again.')); });
  }
  this.studyWorker.postMessage({ type: 'run', ...this.request });
 }

 private receiveStudy(response: StudyResponse) {
  if (!this.request || response.id !== this.request.id || this.status === 'cancelled') return;
  if (response.type === 'progress') { this.message = `Study · ${response.completed} / ${response.total} solved samples across nominal and assumed phase offsets…`; this.renderResults(); return; }
  this.running = false;
  if (response.type === 'complete') {
   this.studyResult = response.result; this.selectScenario();
   this.status = 'complete';
   const unresolved = response.result.curves.filter(curve => curve.metrics.status === 'unresolved').length;
   this.message = `${this.notebook.variants.length} alternatives · ${response.result.curves.length} scenario curves · ${unresolved ? `${unresolved} numerically unresolved` : 'sampled decisions only'} · inspect point diagnostics below`;
  } else if (response.type === 'cancelled') { this.status = 'cancelled'; this.message = `Study stopped after ${response.completed} / ${response.total} samples. No complete band decision.`; }
  else { this.status = 'error'; this.message = response.message; this.results = []; this.studyResult = null; }
  this.render();
 }

 private selectScenario() {
  if (this.studyResult) this.results = this.studyResult.curves.filter(curve => curve.scenarioId === this.scenarioId);
 }

 private renderStudyControls() {
  const summary = this.query('[data-testid=study-summary]'), scenarioControl = this.query<HTMLElement>('[data-testid=study-scenario-control]');
  const isStudy = this.notebook.schema === 'picsetup-notebook/2';
  summary.hidden = !isStudy; scenarioControl.hidden = !isStudy;
  this.el.classList.toggle('comparison-is-study', isStudy);
  const results = this.query('[data-testid=study-results]'), quality = this.query('[data-testid=compare-quality]'), readout = this.query('.comparison-readout');
  if (isStudy) { readout.before(quality); quality.after(results); } else { readout.after(quality); quality.after(results); }
  this.query('[data-testid=compare-run]').innerHTML = `${icon('play', 12)} ${isStudy ? 'Run study' : 'Compare'}`;
  if (this.notebook.schema !== 'picsetup-notebook/2') { summary.innerHTML = ''; return; }
  const { targets, phaseScenarios } = this.notebook.study;
  summary.innerHTML = `<div><span class="comparison-kicker">DESIGN TARGET · ${fmt(this.notebook.sweep.startM * 1e9)}–${fmt(this.notebook.sweep.stopM * 1e9)} NM</span><strong>${esc(this.notebook.title)}</strong></div><div class="comparison-targets"><label>IL ≤ <input data-testid="study-il-target" type="number" step="any" value="${targets.maxInsertionLossDb}" aria-label="Maximum desired-output insertion loss in dB" ${this.running ? 'disabled' : ''}> dB</label><label>XT ≤ <input data-testid="study-xt-target" type="number" step="any" value="${targets.maxCrosstalkDb}" aria-label="Maximum unwanted to desired output crosstalk in dB" ${this.running ? 'disabled' : ''}> dB</label><button class="text-button" data-testid="study-detach" title="Remove targets and phase scenarios, keeping snapshots" ${this.running ? 'disabled' : ''}>Detach targets</button></div>`;
  const scenario = this.query<HTMLSelectElement>('[data-testid=study-scenario]');
  scenario.innerHTML = `<option value="nominal">Nominal</option>${phaseScenarios.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;
  if (!['nominal', ...phaseScenarios.map(item => item.id)].includes(this.scenarioId)) this.scenarioId = 'nominal';
  scenario.value = this.scenarioId;
 }

 private renderStudyResults() {
  const el = this.query('[data-testid=study-results]'); el.hidden = this.notebook.schema !== 'picsetup-notebook/2';
  if (this.notebook.schema !== 'picsetup-notebook/2') { el.innerHTML = ''; return; }
  const study = this.notebook.study;
  const rows = this.notebook.variants.map((variant, index) => {
   const curve = this.studyResult?.curves.find(curve => curve.variantId === variant.id && curve.scenarioId === this.scenarioId);
   const all = this.studyResult?.curves.filter(curve => curve.variantId === variant.id) ?? [];
   const mapping = study.outputs.find(output => output.variantId === variant.id)!;
   return `<tr data-testid="study-metric-row" data-variant-id="${esc(variant.id)}" data-status="${curve?.metrics.status ?? 'pending'}" data-il-db="${curve?.metrics.worstInsertionLossDb.value ?? ''}" data-xt-db="${curve?.metrics.worstCrosstalkDb.value ?? ''}" data-il-status="${curve?.metrics.worstInsertionLossDb.status ?? 'unavailable'}" data-xt-status="${curve?.metrics.worstCrosstalkDb.status ?? 'unavailable'}"><th><span style="color:${colors[index]}">${esc(variant.name)}</span><small>${esc(mapping.desiredDetectorId)} desired / ${esc(mapping.unwantedDetectorId)} unwanted</small></th><td data-testid="study-il">${curve ? formatDbMetric(curve.metrics.worstInsertionLossDb) : '—'}</td><td data-testid="study-xt">${curve ? formatDbMetric(curve.metrics.worstCrosstalkDb) : '—'}</td><td><span class="comparison-decision" data-testid="study-decision" data-status="${curve?.metrics.status ?? 'pending'}">${curve?.metrics.status.replace('sampled-', 'sampled ') ?? 'not run'}</span><small>${all.length ? `${all.filter(item => item.metrics.status === 'sampled-pass').length}/${all.length} scenarios pass sampled targets` : 'Nominal + explicit error cases'}</small></td></tr>`;
  }).join('');
  el.innerHTML = `<div class="comparison-study-results-heading"><h4>Does it meet the sampled target?</h4><span>Worst point across the displayed band · ${esc(this.scenarioId === 'nominal' ? 'Nominal' : study.phaseScenarios.find(item => item.id === this.scenarioId)?.name ?? this.scenarioId)}</span></div><div class="comparison-metrics-scroll"><table><thead><tr><th>Alternative / outputs</th><th>Insertion loss</th><th>Crosstalk</th><th>Decision</th></tr></thead><tbody>${rows}</tbody></table></div><p>IL = −10 log₁₀(P desired / P input). XT = 10 log₁₀(P unwanted / P desired). Numerical failures are excluded from decisions; incomplete or ineligible bands are unresolved. Finite grids can miss narrow features; a sampled pass does not establish a continuous-band pass.</p><details><summary>Explicit phase assumptions · ${study.phaseScenarios.length} cases</summary>${study.phaseScenarios.length ? study.phaseScenarios.map(scenario => `<div class="comparison-scenario-assumption"><strong>${esc(scenario.name)}</strong><span>${scenario.offsets.map(offset => `${esc(this.notebook.variants.find(variant => variant.id === offset.variantId)?.name ?? offset.variantId)} / ${esc(offset.componentId)}: ${offset.phaseOffsetRad >= 0 ? '+' : ''}${fmt(offset.phaseOffsetRad)} rad`).join(' · ')}</span></div>`).join('') : '<p>No phase-error scenarios supplied.</p>'}<p>These bounded offsets are stated assumptions, not process distributions, manufacturing tolerance or a yield estimate.</p></details>`;
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
   this.message = failed.length ? `${failed.length} unsupported samples · ${failed[0].diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message ?? 'Check model limits.'}` : `${this.results.length} variants · ${this.notebook.sweep.points} sampled wavelengths each${warnings.length ? ' · inspect point warnings below' : ''} · move across the plot to compare`;
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
  this.query<HTMLSelectElement>('[data-testid=compare-units]').value = this.unit;
  this.query<HTMLInputElement>('[data-testid=compare-both-outputs]').checked = this.bothOutputs;
  this.renderStudyControls(); this.sync(); this.renderVariants(); this.renderResults();
 }

 private renderVariants() {
  this.query('[data-testid=compare-variants]').innerHTML = this.notebook.variants.length ? this.notebook.variants.map((variant, index) => {
   const detectors = variant.document.circuit.components.filter(component => component.model === 'detector');
   return `<article class="comparison-variant" data-testid="compare-variant" data-variant-id="${esc(variant.id)}" style="--variant-color:${colors[index]}"><div class="comparison-variant-name"><span class="comparison-letter">${String.fromCharCode(65 + index)}</span><input data-testid="compare-name" type="text" maxlength="100" aria-label="Variant ${String.fromCharCode(65 + index)} name" value="${esc(variant.name)}" ${this.running ? 'disabled' : ''}><button data-action="remove" aria-label="Remove ${esc(variant.name)}" title="Remove snapshot (detach study first when targets are bound)" ${this.running || this.notebook.schema === 'picsetup-notebook/2' ? 'disabled' : ''}>${icon('close', 12)}</button></div>${this.thumbnail(variant)}<div class="comparison-variant-meta">${variant.document.circuit.components.length} components <span>·</span> ${variant.document.circuit.connections.length} connections</div>${this.variantContext(variant)}<label class="comparison-detector-label">TRACE <select data-testid="compare-detector" aria-label="Detector for ${esc(variant.name)}" ${this.running || !detectors.length ? 'disabled' : ''}>${detectors.length ? detectors.map(detector => `<option value="${esc(detector.id)}" ${variant.detectorId === detector.id ? 'selected' : ''}>${esc(detector.label)}</option>`).join('') : '<option value="">No detector in this circuit</option>'}</select></label><div class="comparison-variant-actions"><button data-action="load" title="Open an editable copy of this snapshot">${icon('arrow', 12)} Fork to canvas</button><button data-action="update" title="Replace this snapshot with the current canvas" ${this.running ? 'disabled' : ''}>Update from canvas</button></div></article>`;
  }).join('') : `<div class="comparison-empty"><svg viewBox="0 0 140 90" fill="none" aria-hidden="true"><path d="M20 46h25c18 0 15-23 31-23h35M45 46c18 0 15 23 31 23h35" stroke="#90a88c" stroke-width="2"/><circle cx="21" cy="46" r="7" fill="#f9faf5" stroke="#73937b"/><rect x="107" y="16" width="18" height="14" rx="4" stroke="#9d85b5"/><rect x="107" y="62" width="18" height="14" rx="4" stroke="#91a68b"/></svg><h4>What if you changed<br>just one thing?</h4><p>Pin the circuit on your canvas.<br>Make a change. Pin it again.</p></div>`;
 }

 private baseline() {
  const id = this.notebook.schema === 'picsetup-notebook/2' ? this.notebook.study.baselineVariantId : this.notebook.variants[0]?.id;
  return this.notebook.variants.find(variant => variant.id === id);
 }

 private variantDifferences(variant: ExperimentVariant): string[] {
  const baseline = this.baseline();
  if (!baseline || baseline.id === variant.id) return ['Baseline circuit'];
  const value = (key: string, item: unknown) => typeof item === 'number' ? key.endsWith('M') ? `${fmt(item * 1e6, 6)} µm` : key.endsWith('Rad') ? `${fmt(item, 5)} rad` : fmt(item, 6) : JSON.stringify(item);
  const differences = semanticDifferences(baseline.document, variant.document).map(diff => `${diff.path.replace(/^components\./, '').replace(/^connections\./, '')}: ${value(diff.path, diff.before)} → ${value(diff.path, diff.after)}`);
  return differences.length ? differences : ['Same physics as baseline'];
 }

 private variantContext(variant: ExperimentVariant) {
  const differences = this.variantDifferences(variant), source = getAuthoringStatus(variant.document);
  const guide = variant.document.circuit.connections.some(link => link.waveguide) ? 'Dispersive SiEPIC guide' : 'Constant-index guides';
  const coupler = variant.document.circuit.components.some(component => component.model === 'siepic-coupler') ? 'SiEPIC coupler' : 'Analytical coupler';
  return `<div class="comparison-variant-diff" data-testid="study-variant-diff" data-variant-id="${esc(variant.id)}">${differences.slice(0, 2).map(text => `<span>${esc(text)}</span>`).join('')}${differences.length > 2 ? `<small>+ ${differences.length - 2} changes in assumptions</small>` : ''}<small class="comparison-variant-guide">${guide} · ${coupler}</small></div>${source !== 'none' ? `<div class="comparison-recipe-status" data-testid="compare-recipe-status" data-status="${source}">Recipe source ${source === 'current' ? 'matches circuit' : 'stale · physics changed'}</div>` : ''}`;
 }

 private renderAssumptions() {
  this.query('[data-testid=compare-assumptions]').innerHTML = this.notebook.variants.map(variant => {
   const connections = variant.document.circuit.connections;
   const guides = connections.filter(link => link.lengthM > 0);
   const dataset = variant.document.circuit.components.some(component => component.model === 'siepic-coupler');
   const dispersive = guides.filter(link => 'waveguide' in link && link.waveguide !== undefined);
   const indices = [...new Set(guides.filter(link => !('waveguide' in link) || link.waveguide === undefined).map(link => link.neff))];
   const guideText = `${dispersive.length ? `${dispersive.length} explicitly dispersive guide links; ` : ''}${indices.length ? `constant n_eff = ${indices.map(index => fmt(index)).join(', ')}; ` : ''}${guides.length ? 'explicit propagation lengths and loss' : 'zero-length connections'}`;
   return `<article><h4>${esc(variant.name)}</h4><p>${esc(guideText)}. ${dataset ? 'SiEPIC 200 nm gap / 10 µm coupler · native TE mode 1 · opaque port planes · source grid 101 frequency samples · RI interpolation may add apparent loss.' : 'Analytical couplers · scalar TE0 declaration · ideal matched abstract ports.'}</p><p>Mode matching between connected parts is assumed, not established. Recipe ${getAuthoringStatus(variant.document)}.</p><ul>${this.variantDifferences(variant).map(text => `<li>${esc(text)}</li>`).join('')}</ul></article>`;
  }).join('') + '<p>Differences compare component identities and reciprocal endpoint pairs against the baseline; labels, connection direction and drawing positions are excluded. A renamed component is shown as removal/addition. Phase readouts use the saved abstract reference planes and are undefined at vanishing fields.</p>';
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
  const stepNm = (this.notebook.sweep.stopM - this.notebook.sweep.startM) / (this.notebook.sweep.points - 1) * 1e9;
  note.textContent = `Sampling Δλ = ${fmt(stepNm, 5)} nm. Dots are solved points; connecting lines do not establish resolved extinction or linewidth. ${datasetWarning?.message ?? (usesDataset ? 'SiEPIC snapshots use experimental imported data with slight passivity violations and unknown native port planes. No calibrated-device claim.' : 'Unsupported wavelengths appear as gaps.')} Raw powers, phase, budgets and diagnostics remain in CSV.`;
  this.renderAssumptions(); this.renderStudyResults(); this.renderPlot(); this.renderReadout();
 }

 private selectedSample(result: ComparisonResult) {
  const sweep = this.request?.notebook.sweep ?? this.notebook.sweep;
  return result.samples[Math.round(this.cursor * (sweep.points - 1))];
 }

 private detectorIds(variant: ExperimentVariant): string[] {
  if (!this.bothOutputs) return variant.detectorId ? [variant.detectorId] : [];
  if (this.notebook.schema === 'picsetup-notebook/2') { const output = this.notebook.study.outputs.find(item => item.variantId === variant.id); if (output) return [output.desiredDetectorId, output.unwantedDetectorId]; }
  return variant.document.circuit.components.filter(component => component.model === 'detector').map(component => component.id).slice(0, 2);
 }

 private pointPower(sample: SweepSample | undefined, detectorId: string): number | null {
  const input = sample?.budget?.emittedW ?? 0, value = sample?.detectors[detectorId]?.powerW;
  return sample?.ok && input > 0 && value !== undefined && Number.isFinite(value) && value >= 0 ? value / input : null;
 }

 private powerLabel(value: number | null) {
  if (value === null) return '—';
  return this.unit === 'percent' ? `${fmt(value * 100, 5)}%` : value === 0 ? '−∞ dB' : `${fmt(10 * Math.log10(value), 4)} dB`;
 }

 private renderReadout() {
  const sweep = this.request?.notebook.sweep ?? this.notebook.sweep;
  const index = Math.round(this.cursor * (sweep.points - 1));
  const wavelength = sweep.startM + (sweep.stopM - sweep.startM) * index / (sweep.points - 1);
  this.query('[data-testid=compare-wavelength]').innerHTML = `<span>SAMPLED WAVELENGTH</span><strong>${fmt(wavelength * 1e9, 7)} <small>nm</small></strong><small>Point ${index + 1} / ${sweep.points}</small>`;
  this.query('[data-testid=compare-legend]').innerHTML = this.notebook.variants.map((variant, index) => {
   const result = this.results.find(result => result.variantId === variant.id), sample = result ? this.selectedSample(result) : undefined;
   return this.detectorIds(variant).map((detectorId, output) => {
    const detector = variant.document.circuit.components.find(component => component.id === detectorId);
    const phase = sample && assessSampleQuality(sample).eligible ? sample.detectors[detectorId]?.phaseRad : null;
    return `<div class="comparison-legend-item" data-variant-id="${esc(variant.id)}" data-detector-id="${esc(detectorId)}"><span class="comparison-legend-dot ${output ? 'comparison-secondary-dot' : ''}" style="background:${colors[index]}"></span><span class="comparison-legend-name" title="${esc(variant.name)} / ${esc(detector?.label ?? detectorId)}">${esc(variant.name)}${this.bothOutputs ? ` · ${esc(detector?.label ?? detectorId)}` : ''}</span><span class="comparison-output-readout"><strong>${this.powerLabel(this.pointPower(sample, detectorId))}</strong><small>φ ${phase !== null && phase !== undefined && Number.isFinite(phase) ? `${fmt(phase, 4)} rad` : 'undefined'}</small></span></div>`;
   }).join('');
  }).join('') || '<p class="comparison-legend-empty">Your pinned ideas will appear here.</p>';
  this.renderDiagnostics(wavelength);
 }

 private renderDiagnostics(wavelength: number) {
  const diagnostics = this.notebook.variants.flatMap(variant => {
   const result = this.results.find(result => result.variantId === variant.id), sample = result ? this.selectedSample(result) : undefined;
   if (!sample) return [];
   const sweep = this.request?.notebook.sweep ?? this.notebook.sweep;
   const measurement = this.studyResult?.curves.find(curve => curve.variantId === variant.id && curve.scenarioId === this.scenarioId)?.measurements[Math.round(this.cursor * (sweep.points - 1))];
   const merged = [...sample.diagnostics];
   for (const reason of measurement?.reasons ?? []) if (!merged.some(item => item.code === reason.code && item.message === reason.message)) merged.push(reason);
   return merged.map(diagnostic => ({ variant, sample, diagnostic }));
  });
  const numerical = diagnostics.filter(({ diagnostic }) => diagnostic.severity === 'error' || ['POWER_IMBALANCE', 'SMALL_PIVOT'].includes(diagnostic.code));
  const summary = this.query('[data-testid=compare-quality-summary]');
  const quality = this.query('[data-testid=compare-quality]');
  quality.dataset.quality = numerical.length ? 'unresolved' : diagnostics.length ? 'warnings' : this.results.length ? 'eligible' : 'pending';
  summary.textContent = this.results.length ? `${numerical.length ? '⚠ Numerical quality unresolved' : diagnostics.length ? 'Model warnings' : 'No point diagnostics'} · ${fmt(wavelength * 1e9, 7)} nm${diagnostics.length ? ` · ${diagnostics.length} diagnostics${numerical.length ? ` · ${numerical[0].diagnostic.code}` : ''}` : ''}` : 'Point diagnostics appear after solving';
  this.query('[data-testid=compare-diagnostics]').innerHTML = diagnostics.length ? diagnostics.map(({ variant, sample, diagnostic }) => `<div class="comparison-diagnostic" data-severity="${diagnostic.severity}" data-code="${esc(diagnostic.code)}"><strong>${esc(variant.name)} · ${fmt(sample.wavelengthM * 1e9, 7)} nm${diagnostic.componentId ? ` · component ${esc(diagnostic.componentId)}` : diagnostic.connectionId ? ` · connection ${esc(diagnostic.connectionId)}` : ''}</strong><span>${esc(diagnostic.code)} — ${esc(diagnostic.message)}</span></div>`).join('') : `<p>${this.results.length ? 'All selected points solved without reported warnings. This does not establish spectral resolution or physical calibration.' : 'Run the comparison to inspect each solved point.'}</p>`;
 }

 private renderPlot() {
  const { width, height } = this, left = 44, right = 20, top = 22, bottom = 30, plotW = Math.max(1, width - left - right), plotH = Math.max(1, height - top - bottom);
  const sweep = this.request?.notebook.sweep ?? this.notebook.sweep;
  const allValues: number[] = [];
  for (const variant of this.notebook.variants) {
   const result = this.results.find(result => result.variantId === variant.id);
   for (const detectorId of this.detectorIds(variant)) for (const sample of result?.samples ?? []) {
    const power = this.pointPower(sample, detectorId); if (power !== null) allValues.push(power);
   }
  }
  const finiteDb = allValues.filter(value => value > 0).map(value => 10 * Math.log10(value));
  const yMin = this.unit === 'db' ? Math.max(-120, Math.min(-20, Math.floor(Math.min(0, ...finiteDb) / 20) * 20)) : 0;
  const yMax = this.unit === 'db' ? Math.max(0, Math.ceil(Math.max(0, ...finiteDb) / 10) * 10) : Math.ceil(Math.max(100, ...allValues.map(value => value * 100)) / 25) * 25;
  const x = (wavelength: number) => left + (wavelength - sweep.startM) / (sweep.stopM - sweep.startM) * plotW;
  const displayValue = (power: number) => this.unit === 'db' ? Math.max(yMin, power > 0 ? 10 * Math.log10(power) : yMin) : power * 100;
  const y = (value: number) => top + (1 - (value - yMin) / (yMax - yMin)) * plotH;
  this.plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
  this.plot.dataset.status = this.status; this.plot.dataset.requestId = String(this.request?.id ?? ''); this.plot.dataset.variantCount = String(this.results.length);
  this.plot.setAttribute('aria-valuemin', String(sweep.startM * 1e9)); this.plot.setAttribute('aria-valuemax', String(sweep.stopM * 1e9)); this.plot.setAttribute('aria-valuenow', String((sweep.startM + this.cursor * (sweep.stopM - sweep.startM)) * 1e9));
  this.query('[data-testid=compare-unit-label]').textContent = this.unit === 'db' ? `dB / input · display floor ${yMin} dB` : '% of each input';
  let html = '';
  for (let i = 0; i <= 4; i++) { const value = yMin + (yMax - yMin) * i / 4, yy = y(value); html += `<line class="comparison-grid" x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}"/><text class="comparison-axis" x="${left - 10}" y="${yy + 3}" text-anchor="end">${fmt(value, 4)}${i === 4 ? this.unit === 'db' ? 'dB' : '%' : ''}</text>`; }
  for (let i = 0; i <= 4; i++) { const wavelength = sweep.startM + (sweep.stopM - sweep.startM) * i / 4, xx = x(wavelength); html += `<text class="comparison-axis" x="${xx}" y="${height - 8}" text-anchor="middle">${fmt(wavelength * 1e9, 6)}${i === 4 ? ' nm' : ''}</text>`; }
  this.notebook.variants.forEach((variant, index) => {
   const result = this.results.find(result => result.variantId === variant.id);
   this.detectorIds(variant).forEach((detectorId, output) => {
    let path = '', dots = '', segment = false;
    for (const sample of result?.samples ?? []) {
     const power = this.pointPower(sample, detectorId);
     if (power === null) { segment = false; continue; }
     const xx = x(sample.wavelengthM).toFixed(2), yy = y(displayValue(power)).toFixed(2);
     path += `${segment ? 'L' : 'M'}${xx} ${yy} `; segment = true;
     dots += `<circle class="comparison-sample" cx="${xx}" cy="${yy}" r="${sweep.points > 301 ? .8 : 1.5}" fill="${colors[index]}"/>`;
    }
    if (path) html += `<path class="comparison-trace" data-variant-id="${esc(variant.id)}" data-detector-id="${esc(detectorId)}" stroke="${colors[index]}" ${output ? 'stroke-dasharray="5 4" opacity=".55"' : ''} d="${path}"/><g opacity="${output ? '.45' : '.65'}">${dots}</g>`;
   });
  });
  if (allValues.length) {
   const cursorIndex = Math.round(this.cursor * (sweep.points - 1)), wavelength = sweep.startM + (sweep.stopM - sweep.startM) * cursorIndex / (sweep.points - 1), xx = x(wavelength);
   html += `<line class="comparison-cursor" x1="${xx}" y1="${top - 7}" x2="${xx}" y2="${height - bottom + 5}"/>`;
   this.notebook.variants.forEach((variant, index) => {
    const result = this.results.find(result => result.variantId === variant.id), sample = result ? this.selectedSample(result) : undefined;
    for (const detectorId of this.detectorIds(variant)) { const power = this.pointPower(sample, detectorId); if (power !== null) html += `<circle class="comparison-point" cx="${xx}" cy="${y(displayValue(power))}" r="4" fill="${colors[index]}"/>`; }
   });
  } else html += `<text class="comparison-plot-empty" x="${left + plotW / 2}" y="${top + plotH / 2}" text-anchor="middle">${this.running ? 'Tracing your possibilities…' : this.status === 'error' ? 'No supported detector response to display.' : this.results.length ? 'Choose a detector with nonzero input power.' : 'A little change can make a different spectrum.'}</text>`;
  this.plot.innerHTML = html;
 }
}
