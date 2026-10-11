import './goals.css';
import type { CircuitDocument } from '../model/types';
import { solveCircuit } from '../solver/solve';
import { validateGoalRequest, type GoalParameter, type GoalRequest, type GoalResponse, type GoalResult, type GoalSample } from '../experiments/goals';
import { icon } from './icons';

export type GoalTarget = { kind: 'component'; id: string; param: 'phaseRad' | 'coupling' } | { kind: 'connection'; id: string; param: 'lengthM' };
type GoalOptions = { getDocument: () => CircuitDocument; onApply: (document: CircuitDocument) => void; onError: (message: string) => void };
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const fmt = (value: number, precision = 5) => Number.isFinite(value) ? Number(value.toPrecision(precision)).toString() : '—';
const fingerprint = (document: CircuitDocument) => JSON.stringify({
 wavelengthM: document.circuit.wavelengthM,
 components: document.circuit.components.map(({ id, model, version, params }) => ({ id, model, version, params })),
 connections: document.circuit.connections,
});

/** A bounded one-parameter experiment. Applying its sampled best is an explicit edit. */
export class GoalPanel {
 private target: GoalTarget | null = null;
 private worker: Worker | null = null;
 private request: GoalRequest | null = null;
 private result: GoalResult | null = null;
 private samples: GoalSample[] = [];
 private requestId = 0;
 private running = false;
 private stale = false;
 private sourceFingerprint = '';
 private baselinePower: number | null = null;
 private unit = 'rad';
 private scale = 1;
 private previousFocus: HTMLElement | null = null;

 constructor(private el: HTMLElement, private options: GoalOptions) {
  el.classList.add('goal-overlay'); el.dataset.testid = 'goal-panel'; el.hidden = true;
  el.innerHTML = `<section class="goal-window" role="dialog" aria-modal="true" aria-labelledby="goal-title"><header class="goal-header"><div><span class="goal-eyebrow">ONE PARAMETER · ONE QUESTION</span><h2 id="goal-title">Find a useful setting.</h2><p>Try a bounded range and inspect the best sampled result.</p></div><button class="goal-dismiss" data-testid="goal-close" aria-label="Close design goal">${icon('close',20)}</button></header><div class="goal-body"><div class="goal-controls"><div class="goal-target"><span>ADJUST</span><strong data-goal-target></strong><small data-goal-current></small></div><label>DETECTOR<select data-testid="goal-detector" aria-label="Goal detector"></select></label><div class="goal-control-row"><label>GOAL<select data-testid="goal-objective" aria-label="Goal objective"><option value="minimize">Minimize power</option><option value="maximize">Maximize power</option></select></label><label>AT WAVELENGTH<span class="goal-input-unit"><input data-testid="goal-wavelength" aria-label="Goal wavelength in nanometres" type="number" step="any" min="0"><small>nm</small></span></label></div><div class="goal-control-row"><label>FROM<span class="goal-input-unit"><input data-testid="goal-min" aria-label="Minimum parameter value" type="number" step="any"><small data-goal-unit></small></span></label><label>TO<span class="goal-input-unit"><input data-testid="goal-max" aria-label="Maximum parameter value" type="number" step="any"><small data-goal-unit></small></span></label></div><label>SAMPLED CANDIDATES<input data-testid="goal-points" aria-label="Number of goal candidates" type="number" min="2" max="201" step="1" value="61"></label><p class="goal-domain-note">Uniform sampling at one wavelength. Narrow features can fall between candidates.</p><div class="goal-actions"><button class="primary" data-testid="goal-run">Search this range ${icon('arrow',14)}</button><button class="outline" data-testid="goal-cancel" hidden>Cancel</button></div></div><div class="goal-results"><div class="goal-results-heading"><span>THE EXPERIMENT</span><span data-goal-count>0 candidates</span></div><svg class="goal-chart" data-testid="goal-chart" viewBox="0 0 470 205" role="img" aria-label="Detector power over the sampled parameter range"></svg><div class="goal-readouts"><div><span>CURRENT AT TARGET λ</span><strong data-testid="goal-current-power">—</strong></div><div class="goal-best-readout"><span>BEST SAMPLED POWER</span><strong data-testid="goal-best-power">—</strong><small data-testid="goal-best-value">Run a search to compare.</small></div></div><div class="goal-result-flags"><span data-testid="goal-failed-count">0 failed candidates</span><span data-testid="goal-boundary">Bounds not yet searched</span></div><p class="goal-status" data-testid="goal-status" data-state="idle" role="status">Choose a detector and range, then search.</p><div class="goal-diagnostics" data-goal-diagnostics></div><div class="goal-apply-row"><span>Only the selected parameter and target wavelength change.</span><button class="primary" data-testid="goal-apply" disabled>Apply best setting</button></div></div></div><footer class="goal-footer">A sampled best is a design lead. It is not a guaranteed optimum or a calibrated device prediction.</footer></section>`;
  this.query('[data-testid=goal-close]').addEventListener('click', () => this.close());
  this.query('[data-testid=goal-run]').addEventListener('click', () => this.run());
  this.query('[data-testid=goal-cancel]').addEventListener('click', () => this.cancel());
  this.query('[data-testid=goal-apply]').addEventListener('click', () => this.apply());
  for (const control of Array.from(el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select'))) {
   control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => this.settingsChanged());
  }
  el.addEventListener('click', event => { if (event.target === el) this.close(); });
  el.addEventListener('keydown', event => {
   event.stopPropagation();
   if (event.key === 'Escape') { event.preventDefault(); this.close(); }
   if (event.key === 'Tab') {
    const focusable = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')).filter(node => node.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
   }
  });
  this.renderPlot();
 }

 private query<T extends HTMLElement = HTMLElement>(selector: string): T { return this.el.querySelector<T>(selector)!; }
 private input(id: string) { return this.query<HTMLInputElement>(`[data-testid=${id}]`); }
 private status(message: string, state: string) {
  const status = this.query('[data-testid=goal-status]');
  status.textContent = message; status.dataset.state = state; status.classList.toggle('error', state === 'error' || state === 'stale');
 }
 private buttons() {
  this.query<HTMLButtonElement>('[data-testid=goal-run]').disabled = this.running || this.query<HTMLSelectElement>('[data-testid=goal-detector]').options.length === 0;
  this.query('[data-testid=goal-cancel]').hidden = !this.running;
  this.query<HTMLButtonElement>('[data-testid=goal-apply]').disabled = this.running || this.stale || !this.result?.best || this.result.cancelled;
 }
 private parameter(): GoalParameter {
  if (!this.target) throw new Error('Choose a phase shifter, ideal coupler, or guide first.');
  return this.target.kind === 'component'
   ? { kind: 'component', componentId: this.target.id, name: this.target.param }
   : { kind: 'connection', connectionId: this.target.id, name: this.target.param };
 }
 private detectors(document: CircuitDocument) {
  const select = this.query<HTMLSelectElement>('[data-testid=goal-detector]'), previous = select.value;
  const detectors = document.circuit.components.filter(component => component.model === 'detector');
  select.innerHTML = detectors.map(component => `<option value="${esc(component.id)}">${esc(component.label)}</option>`).join('');
  if (detectors.some(component => component.id === previous)) select.value = previous;
 }

 open(target: GoalTarget) {
  const document = this.options.getDocument();
  let current: number, title: string;
  if (target.kind === 'component') {
   const component = document.circuit.components.find(component => component.id === target.id);
   if (!component || !(component.model === 'phase' && target.param === 'phaseRad' || component.model === 'coupler' && target.param === 'coupling')) throw new Error('Select an analytical phase shifter or ideal coupler to tune.');
   current = component.params[target.param]; title = `${component.label} · ${target.param === 'phaseRad' ? 'phase' : 'power coupling'}`;
  } else {
   const connection = document.circuit.connections.find(connection => connection.id === target.id);
   if (!connection || target.param !== 'lengthM') throw new Error('Select a guide length to tune.');
   current = connection.lengthM; title = `Guide ${connection.id} · length`;
  }
  this.stopWorker(); this.target = structuredClone(target); this.result = null; this.request = null; this.samples = [];
  this.stale = false; this.sourceFingerprint = fingerprint(document); this.baselinePower = null;
  this.scale = target.kind === 'connection' ? 1e-6 : 1;
  this.unit = target.kind === 'connection' ? 'µm' : target.param === 'phaseRad' ? 'rad' : 'K';
  this.query('[data-goal-target]').textContent = title;
  this.query('[data-goal-current]').textContent = `Current setting: ${fmt(current / this.scale)} ${this.unit}`;
  for (const label of Array.from(this.el.querySelectorAll<HTMLElement>('[data-goal-unit]'))) label.textContent = this.unit;
  this.input('goal-min').value = '0';
  this.input('goal-max').value = target.kind === 'connection' ? fmt(Math.max(current * 2, 20e-6) / this.scale, 10) : target.param === 'phaseRad' ? String(2 * Math.PI) : '1';
  this.input('goal-wavelength').value = fmt(document.circuit.wavelengthM * 1e9, 12);
  this.input('goal-points').value = '61';
  this.query<HTMLSelectElement>('[data-testid=goal-objective]').value = 'minimize';
  this.detectors(document);
  this.resetReadouts(); this.renderPlot(); this.buttons();
  this.status(this.query<HTMLSelectElement>('[data-testid=goal-detector]').options.length ? 'Choose a detector and range, then search.' : 'Add a detector to the circuit before searching.', 'idle');
  if (this.el.hidden) this.previousFocus = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
  this.el.hidden = false; this.query('[data-testid=goal-close]').focus();
 }
 close() { if (this.running) this.cancel(); this.el.hidden = true; this.previousFocus?.focus(); }

 /** Main editor can call this after edits; apply independently repeats the check. */
 refresh() {
  if (this.el.hidden || !this.target) return;
  const document = this.options.getDocument();
  if (fingerprint(document) !== this.sourceFingerprint) {
   this.stopWorker(); this.stale = true; this.detectors(document);
   this.status('The circuit changed. Search again before applying a setting.', 'stale'); this.buttons();
  }
 }
 private stopWorker() {
  if (this.running) this.worker?.postMessage({ type: 'cancel', id: this.requestId });
  this.requestId++; this.running = false;
 }
 private cancel() {
  this.stopWorker(); this.result = null; this.status(`Cancelled after ${this.samples.length} sampled candidates.`, 'cancelled'); this.buttons();
 }
 private settingsChanged() {
  this.stopWorker(); this.result = null; this.request = null; this.samples = []; this.baselinePower = null;
  this.resetReadouts(); this.renderPlot(); this.status('Settings changed. Search this range to compare.', 'idle'); this.buttons();
 }
 private resetReadouts() {
  this.query('[data-testid=goal-current-power]').textContent = '—';
  this.query('[data-testid=goal-best-power]').textContent = '—';
  this.query('[data-testid=goal-best-value]').textContent = 'Run a search to compare.';
  this.query('[data-testid=goal-failed-count]').textContent = '0 failed candidates';
  this.query('[data-testid=goal-boundary]').textContent = 'Bounds not yet searched';
  this.query('[data-goal-diagnostics]').replaceChildren();
  this.query('[data-goal-count]').textContent = '0 candidates';
 }
 private makeWorker() {
  if (this.worker) return this.worker;
  const worker = new Worker(new URL('../workers/goal.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<GoalResponse>) => {
   if (this.worker !== worker || event.data.id !== this.requestId || !this.running) return;
   const message = event.data;
   if (message.type === 'progress') {
    this.samples = message.samples; this.query('[data-goal-count]').textContent = `${message.completed} / ${message.total} candidates`;
    this.status(`Searching ${message.completed} of ${message.total} candidates…`, 'running'); this.renderPlot();
   } else if (message.type === 'complete') {
    this.running = false; this.result = message.result; this.samples = message.result.samples;
    this.renderResult(); this.refresh(); this.buttons();
   } else if (message.type === 'cancelled') { this.running = false; this.status(`Cancelled after ${message.completed} sampled candidates.`, 'cancelled'); this.buttons(); }
   else { this.running = false; this.fail(message.message); }
  });
  worker.addEventListener('error', () => { if (this.worker !== worker) return; this.stopWorker(); worker.terminate(); this.worker = null; this.fail('The search worker could not finish. Please run the search again.'); });
  this.worker = worker; return worker;
 }
 private fail(message: string) { this.result = null; this.status(message, 'error'); this.buttons(); this.options.onError(message); }
 private run() {
  try {
   this.stopWorker();
   const document = structuredClone(this.options.getDocument());
   const read = (id: string) => { const raw = this.input(id).value; if (!raw.trim()) throw new Error('Fill in the wavelength, both bounds, and candidate count.'); return Number(raw); };
   const request: GoalRequest = {
    id: this.requestId, document, wavelengthM: read('goal-wavelength') * 1e-9,
    detectorId: this.query<HTMLSelectElement>('[data-testid=goal-detector]').value,
    objective: this.query<HTMLSelectElement>('[data-testid=goal-objective]').value as 'minimize' | 'maximize',
    parameter: this.parameter(), min: read('goal-min') * this.scale, max: read('goal-max') * this.scale, points: read('goal-points'),
   };
   validateGoalRequest(request);
   this.sourceFingerprint = fingerprint(document); this.stale = false; this.request = request; this.result = null; this.samples = [];
   const baseline = solveCircuit({ ...document.circuit, wavelengthM: request.wavelengthM });
   this.baselinePower = baseline.ok ? baseline.detectors[request.detectorId]?.powerW ?? null : null;
   this.resetReadouts();
   this.query('[data-testid=goal-current-power]').textContent = this.baselinePower === null ? 'Unavailable' : `${fmt(this.baselinePower * 1e3)} mW`;
   this.running = true; this.buttons(); this.renderPlot(); this.status(`Searching ${request.points} candidates at ${fmt(request.wavelengthM * 1e9)} nm…`, 'running');
   this.makeWorker().postMessage({ type: 'run', ...request });
  } catch (error) { this.running = false; this.fail(error instanceof Error ? error.message : String(error)); }
 }
 private renderResult() {
  const result = this.result!;
  this.query('[data-goal-count]').textContent = `${result.samples.length} candidates`;
  this.query('[data-testid=goal-failed-count]').textContent = `${result.failedCount} failed candidates`;
  this.query('[data-testid=goal-boundary]').textContent = result.boundaryHit ? 'Best is at a search boundary' : 'Best is inside the bounds';
  if (!result.best) {
   this.query('[data-testid=goal-boundary]').textContent = 'No valid candidate';
   this.status('No valid candidate was found. Review the model diagnostics or change the range.', 'error');
  } else {
   this.query('[data-testid=goal-best-power]').textContent = `${fmt(result.best.powerW * 1e3)} mW`;
   this.query('[data-testid=goal-best-value]').textContent = `at ${fmt(result.best.value / this.scale, 7)} ${this.unit}`;
   const difference = this.baselinePower === null ? '' : ` Change from current: ${fmt((result.best.powerW - this.baselinePower) * 1e6)} µW.`;
   this.status(`Best of ${result.samples.length - result.failedCount} valid sampled candidates.${difference}${result.boundaryHit ? ' Try wider bounds if the parameter allows it.' : ''}`, 'complete');
  }
  const diagnostics = new Map<string, string>();
  for (const sample of result.samples) for (const diagnostic of sample.diagnostics) {
   if (diagnostic.severity === 'error' || diagnostic.severity === 'warning' && diagnostic.code !== 'MATCHED_BOUNDARIES') diagnostics.set(diagnostic.code, diagnostic.message);
  }
  this.query('[data-goal-diagnostics]').innerHTML = [...diagnostics.values()].map(message => `<p>${esc(message)}</p>`).join('');
  this.renderPlot();
 }
 private apply() {
  try {
   if (!this.result?.best || this.result.cancelled || this.running) throw new Error('Finish a valid search before applying a setting.');
   const current = this.options.getDocument();
   if (fingerprint(current) !== this.sourceFingerprint) { this.stale = true; this.buttons(); throw new Error('The circuit changed. Search again before applying a setting.'); }
   const document = structuredClone(current);
   const parameter = this.result.request.parameter;
   if (parameter.kind === 'component') document.circuit.components.find(component => component.id === parameter.componentId)!.params[parameter.name] = this.result.best.value;
   else document.circuit.connections.find(connection => connection.id === parameter.connectionId)!.lengthM = this.result.best.value;
   document.circuit.wavelengthM = this.result.request.wavelengthM;
   this.options.onApply(document); this.close();
  } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
 }
 private renderPlot() {
  const svg = this.el.querySelector<SVGSVGElement>('[data-testid=goal-chart]')!;
  const values = this.samples.filter(sample => sample.ok && sample.powerW !== null);
  if (!this.request || !values.length) {
   svg.innerHTML = `<path d="M45 20V165H449" fill="none" stroke="#dce3d4"/><text x="240" y="93" class="goal-chart-empty" text-anchor="middle">${this.samples.length ? 'No valid sampled powers' : 'A small search can reveal a useful setting.'}</text>`;
   return;
  }
  const maximum = Math.max(...values.map(sample => sample.powerW!), this.baselinePower ?? 0) || 0.001;
  const ymax = maximum * 1.12, left = 45, top = 20, width = 404, height = 145;
  const x = (value: number) => left + (value - this.request!.min) / (this.request!.max - this.request!.min) * width;
  const y = (power: number) => top + height * (1 - power / ymax);
  const grid = [0, 0.5, 1].map(fraction => `<path d="M${left} ${top + height * fraction}H449" class="goal-grid"/><text x="36" y="${top + height * fraction + 3}" class="goal-axis" text-anchor="end">${fmt(ymax * (1 - fraction) * 1e3, 3)}</text>`).join('');
  let path = '', open = false;
  for (const sample of this.samples) {
   if (!sample.ok || sample.powerW === null) { open = false; continue; }
   path += `${open ? 'L' : 'M'}${x(sample.value).toFixed(3)} ${y(sample.powerW).toFixed(3)} `; open = true;
  }
  const best = this.result?.best;
  svg.innerHTML = `${grid}<text x="45" y="10" class="goal-axis">DETECTOR POWER · mW</text>${this.baselinePower !== null ? `<path d="M45 ${y(this.baselinePower)}H449" class="goal-baseline"/>` : ''}<path d="${path}" class="goal-curve"/>${best ? `<circle cx="${x(best.value)}" cy="${y(best.powerW)}" r="5" class="goal-best-dot"/>` : ''}<text x="45" y="186" class="goal-axis">${fmt(this.request.min / this.scale)} ${esc(this.unit)}</text><text x="449" y="186" class="goal-axis" text-anchor="end">${fmt(this.request.max / this.scale)} ${esc(this.unit)}</text><text x="247" y="202" class="goal-axis" text-anchor="middle">${this.baselinePower !== null ? 'Dashed line: current power at target wavelength' : 'Current power unavailable at target wavelength'}</text>`;
 }
}
