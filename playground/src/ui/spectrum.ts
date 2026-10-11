import type { Circuit, SolveResult } from '../model/types';
import { exportSweepCsv, type SweepRequest, type SweepResponse, type SweepSample } from '../solver/sweep';
import { icon } from './icons';

const escapeHtml=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const format=(value:number,digits=5)=>Number.isFinite(value)?Number(value.toPrecision(digits)).toString():'—';
const colors=['#648d73','#a086b5','#c28e56','#6a97ad','#be767c','#95924f'];
const physicsKey=(c:Circuit)=>JSON.stringify({...c,wavelengthM:0,components:c.components.map(({label,...component})=>component)});

type SpectrumOptions={circuit:()=>Circuit;onWavelength:(wavelengthM:number)=>void;onToggle:(open:boolean)=>void;onError:(message:string)=>void;rangeNm:[number,number]};

/** A spectrum belongs to a physical circuit snapshot, never to a moving canvas. */
export class SpectrumPanel {
 private worker:Worker|null=null;
 private request:SweepRequest|null=null;
 private samples:SweepSample[]=[];
 private key='';
 private id=0;
 private running=false;
 private open=true;
 private status:'idle'|'running'|'complete'|'cancelled'|'error'|'stale'='idle';
 private message='Run a sweep to follow light across the spectrum.';
 private width=850;
 private height=170;
 private selectedWavelength=1550e-9;
 private sourcePowerW=0;
 private currentResult:SolveResult|null=null;
 private plot:SVGSVGElement;
 private drag=false;
 constructor(private el:HTMLElement,private options:SpectrumOptions){
  el.innerHTML=`<div class="spectrum-intro"><div class="spectrum-eyebrow">${icon('spectrum',16)} SPECTRAL EXPLORER</div><h2>Follow the wavelength.</h2><p id="spectrum-description">Every curve is a solved circuit.<br>Click the spectrum to tune your light.</p><div class="spectrum-source" data-testid="spectrum-source"></div><div class="spectrum-legend" data-testid="spectrum-legend"></div></div><div class="spectrum-main"><div class="spectrum-controls"><div class="sweep-range"><label>FROM <span><input aria-label="Sweep start wavelength" data-testid="sweep-start-nm" type="number" value="${options.rangeNm[0]}" min="1" step="any"> nm</span></label><span class="range-arrow">→</span><label>TO <span><input aria-label="Sweep stop wavelength" data-testid="sweep-stop-nm" type="number" value="${options.rangeNm[1]}" min="1" step="any"> nm</span></label><label class="points-label">SAMPLES <span><input aria-label="Sweep sample count" data-testid="sweep-points" type="number" value="201" min="2" max="1001" step="1"></span></label></div><div class="sweep-actions"><button class="primary" data-testid="sweep-run">${icon('play',12)} Sweep</button><button class="outline" data-testid="sweep-cancel" hidden>Stop</button><button class="text-button" data-testid="sweep-csv" disabled title="Export solved spectrum as CSV">${icon('download',14)} CSV</button><button class="spectrum-close" data-testid="spectrum-toggle" title="Collapse spectrum" aria-label="Collapse spectrum">${icon('close',14)}</button></div></div><div class="spectrum-chart-wrap"><svg class="spectrum-chart" data-testid="spectrum-plot" role="slider" tabindex="0" aria-label="Detector power spectrum; use left and right arrows to tune wavelength" aria-valuemin="${options.rangeNm[0]}" aria-valuemax="${options.rangeNm[1]}" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="spectrum-bottom"><span role="status" data-testid="spectrum-status"></span><span class="spectrum-selected" data-testid="selected-wavelength"></span></div></div>`;
  this.plot=this.query<SVGSVGElement>('[data-testid=spectrum-plot]');
  this.query('[data-testid=sweep-run]').addEventListener('click',()=>this.run());
  this.query('[data-testid=sweep-cancel]').addEventListener('click',()=>this.cancel());
  this.query('[data-testid=sweep-csv]').addEventListener('click',()=>this.export());
  this.query('[data-testid=spectrum-toggle]').addEventListener('click',()=>this.toggle());
  this.plot.addEventListener('pointerdown',e=>{this.drag=true;this.plot.setPointerCapture(e.pointerId);this.selectAt(e.clientX);});
  this.plot.addEventListener('pointermove',e=>{if(this.drag)this.selectAt(e.clientX);});
  this.plot.addEventListener('pointerup',()=>{this.drag=false;});
  this.plot.addEventListener('pointercancel',()=>{this.drag=false;});
  this.plot.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||!this.samples.length)return;e.preventDefault();const supported=this.samples.filter(sample=>sample.ok);const next=e.key==='Home'?supported[0]:e.key==='End'?supported.at(-1):e.key==='ArrowRight'?supported.find(sample=>sample.wavelengthM>this.selectedWavelength+1e-18):supported.slice().reverse().find(sample=>sample.wavelengthM<this.selectedWavelength-1e-18);if(next)this.options.onWavelength(next.wavelengthM);});
  new ResizeObserver(entries=>{const r=entries[0].contentRect;if(r.width>0&&r.height>0){this.width=r.width;this.height=r.height;this.renderPlot();}}).observe(this.plot);
  this.render();
 }
 private query<T extends Element=HTMLElement>(selector:string){return this.el.querySelector<T>(selector)!;}
 toggle(force?:boolean){this.open=force??!this.open;this.el.hidden=!this.open;this.options.onToggle(this.open);}
 configure(rangeNm:[number,number]){this.query<HTMLInputElement>('[data-testid=sweep-start-nm]').value=String(rangeNm[0]);this.query<HTMLInputElement>('[data-testid=sweep-stop-nm]').value=String(rangeNm[1]);}
 sync(circuit:Circuit,result:SolveResult){
  const nextKey=physicsKey(circuit);
  if(this.key&&this.key!==nextKey){if(this.running&&this.request)this.worker?.postMessage({type:'cancel',id:this.request.id});this.request=null;this.samples=[];this.running=false;this.status='stale';this.message='Circuit changed · run a fresh sweep.';}
  this.key=nextKey;this.currentResult=result;this.selectedWavelength=circuit.wavelengthM;this.sourcePowerW=result.budget.emittedW;this.render();
 }
 run(){
  const start=Number(this.query<HTMLInputElement>('[data-testid=sweep-start-nm]').value),stop=Number(this.query<HTMLInputElement>('[data-testid=sweep-stop-nm]').value),points=Number(this.query<HTMLInputElement>('[data-testid=sweep-points]').value);
  if(!Number.isFinite(start)||!Number.isFinite(stop)||start<=0||stop<=start||!Number.isInteger(points)||points<2||points>1001){if(this.running&&this.request)this.worker?.postMessage({type:'cancel',id:this.request.id});this.request=null;this.samples=[];this.running=false;this.status='error';this.message='Choose increasing positive wavelengths and 2–1001 samples.';this.render();return;}
  if(this.running&&this.request)this.worker?.postMessage({type:'cancel',id:this.request.id});
  this.request={id:++this.id,circuit:structuredClone(this.options.circuit()),startM:start*1e-9,stopM:stop*1e-9,points};this.key=physicsKey(this.request.circuit);this.samples=[];this.running=true;this.status='running';this.message=`Solving 0 / ${points} wavelengths…`;this.toggle(true);this.render();
  try{
   if(!this.worker){this.worker=new Worker(new URL('../workers/sweep.worker.ts',import.meta.url),{type:'module'});this.worker.addEventListener('message',(event:MessageEvent<SweepResponse>)=>this.receive(event.data));this.worker.addEventListener('error',()=>{this.worker?.terminate();this.worker=null;this.request=null;this.samples=[];this.running=false;this.status='error';this.message='The sweep worker could not run. Reload and try again.';this.render();});}
   this.worker.postMessage({type:'run',...this.request});
  }catch(error){this.running=false;this.status='error';this.message=error instanceof Error?error.message:'Could not start spectrum.';this.render();this.options.onError(this.message);}
 }
 cancel(){if(!this.running||!this.request)return;this.worker?.postMessage({type:'cancel',id:this.request.id});this.running=false;this.status='cancelled';this.message=`Stopped after ${this.samples.length} samples.`;this.render();}
 private receive(response:SweepResponse){
  if(!this.request||response.id!==this.request.id||this.status==='cancelled')return;
  if(response.type==='progress'){this.samples=response.samples;this.message=`Solving ${response.completed} / ${response.total} wavelengths…`;}
  else if(response.type==='complete'){this.samples=response.samples;this.running=false;const failed=this.samples.filter(s=>!s.ok).length;this.status=failed?'error':'complete';this.message=failed?`${failed} unsupported sample${failed===1?'':'s'} · ${this.samples.find(s=>!s.ok)?.diagnostics.find(d=>d.severity==='error')?.message??'See model range.'}`:`${this.samples.length} wavelengths solved · click to explore`;
  }else if(response.type==='cancelled'){this.running=false;this.status='cancelled';this.message=`Stopped after ${response.completed} samples.`;
  }else if(response.type==='error'){this.running=false;this.samples=[];this.status='error';this.message=response.message;}
  this.render();
 }
 private export(){if(!this.request||!this.samples.length)return;const blob=new Blob([exportSweepCsv(this.request,this.samples)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='picsetup-spectrum.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 private selectAt(clientX:number){if(!this.request||!this.samples.some(s=>s.ok))return;const bounds=this.plot.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(clientX-bounds.left-43)/(this.width-60)));const index=Math.round(fraction*(this.request.points-1)),sample=this.samples[index];if(sample?.ok)this.options.onWavelength(sample.wavelengthM);}
 private render(){
  this.query<HTMLButtonElement>('[data-testid=sweep-run]').disabled=this.running;
  this.query<HTMLElement>('[data-testid=sweep-cancel]').hidden=!this.running;
  this.query<HTMLButtonElement>('[data-testid=sweep-csv]').disabled=!this.samples.length||this.running;
  this.query('[data-testid=spectrum-status]').textContent=this.message;
  this.query('[data-testid=spectrum-status]').classList.toggle('spectrum-error',this.status==='error');
  this.query('[data-testid=selected-wavelength]').textContent=`λ ${format(this.selectedWavelength*1e9,7)} nm`;
  this.query('[data-testid=spectrum-source]').innerHTML=`<span>POWER REFERENCE</span><strong>${format(this.sourcePowerW*1e3)} mW input</strong><small>Detector power / emitted power (%)</small>`;
  const detectors=(this.request?.circuit??this.options.circuit()).components.filter(c=>c.model==='detector');
  this.query('[data-testid=spectrum-legend]').innerHTML=detectors.map((c,i)=>`<span><i style="background:${colors[i%colors.length]}"></i>${escapeHtml(c.label)}</span>`).join('');
  this.renderPlot();
 }
 private renderPlot(){
  const width=this.width,height=this.height,left=43,right=17,top=13,bottom=25,plotW=Math.max(1,width-left-right),plotH=Math.max(1,height-top-bottom);
  const inputStart=Number(this.query<HTMLInputElement>('[data-testid=sweep-start-nm]').value)*1e-9,inputStop=Number(this.query<HTMLInputElement>('[data-testid=sweep-stop-nm]').value)*1e-9;
  const start=this.request?.startM??(Number.isFinite(inputStart)&&inputStart>0?inputStart:1500e-9),stop=this.request?.stopM??(Number.isFinite(inputStop)&&inputStop>start?inputStop:start+100e-9);
  const x=(nm:number)=>left+(nm-start)/(stop-start)*plotW;
  const detectors=(this.request?.circuit??this.options.circuit()).components.filter(c=>c.model==='detector');
  const values=this.samples.flatMap(s=>s.ok&&s.budget&&s.budget.emittedW>0?Object.values(s.detectors).map(d=>100*d.powerW/s.budget!.emittedW):[]);
  const maximum=Math.max(100,...values),yMax=Math.ceil(maximum/25)*25,y=(value:number)=>top+(1-value/yMax)*plotH;
  this.plot.setAttribute('viewBox',`0 0 ${width} ${height}`);this.plot.dataset.status=this.status;this.plot.dataset.requestId=this.request?String(this.request.id):'';this.plot.dataset.sampleCount=String(this.samples.length);this.plot.setAttribute('aria-valuemin',String(start*1e9));this.plot.setAttribute('aria-valuemax',String(stop*1e9));this.plot.setAttribute('aria-valuenow',String(this.selectedWavelength*1e9));this.plot.setAttribute('aria-valuetext',`${format(this.selectedWavelength*1e9)} nanometres`);
  let html='';
  for(let i=0;i<=4;i++){const value=yMax*i/4,yy=y(value);html+=`<line class="spectrum-grid" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="spectrum-axis" x="${left-10}" y="${yy+3}" text-anchor="end">${format(value,4)}${i===4?'%':''}</text>`;}
  for(let i=0;i<=4;i++){const wavelength=start+(stop-start)*i/4,xx=x(wavelength);html+=`<text class="spectrum-axis" x="${xx}" y="${height-7}" text-anchor="middle">${format(wavelength*1e9,6)}${i===4?' nm':''}</text>`;}
  detectors.forEach((detector,index)=>{let path='',inSegment=false;for(const sample of this.samples){const power=sample.detectors[detector.id]?.powerW;if(!sample.ok||!sample.budget||sample.budget.emittedW<=0||!Number.isFinite(power)){inSegment=false;continue;}path+=`${inSegment?'L':'M'}${x(sample.wavelengthM).toFixed(2)},${y(power/sample.budget.emittedW*100).toFixed(2)} `;inSegment=true;}if(path)html+=`<path class="spectrum-trace" data-detector-id="${escapeHtml(detector.id)}" d="${path}" fill="none" stroke="${colors[index%colors.length]}"/>`;});
  if(this.samples.some(s=>s.ok)&&this.selectedWavelength>=start&&this.selectedWavelength<=stop){const xx=x(this.selectedWavelength),nearest=this.currentResult;html+=`<line class="spectrum-cursor" x1="${xx}" y1="${top-5}" x2="${xx}" y2="${height-bottom+3}"/>`;if(nearest?.ok&&nearest.budget&&nearest.budget.emittedW>0)detectors.forEach((detector,index)=>{const power=nearest.detectors[detector.id]?.powerW;if(Number.isFinite(power))html+=`<circle class="spectrum-point" cx="${xx}" cy="${y(power/nearest.budget!.emittedW*100)}" r="4" fill="${colors[index%colors.length]}"/>`;});}
  if(!this.samples.some(s=>s.ok)||!values.length)html+=`<text class="spectrum-empty" x="${left+plotW/2}" y="${top+plotH/2}" text-anchor="middle">${this.status==='running'?'Tracing the light…':this.status==='stale'?'Your circuit changed. Sweep to see what happens.':this.status==='error'?'No supported spectrum to display.':this.samples.some(s=>s.ok)&&!values.length?(detectors.length?'Zero input power · normalized output is undefined.':'Add a detector to trace the spectrum.'):'A whole spectrum of possibilities.'}</text>`;
  this.plot.innerHTML=html;
 }
}
