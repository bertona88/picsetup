import { arrangeDocument } from '../editor/arrange';
import type { Circuit, CircuitDocument, Diagnostic, SolveResult } from '../model/types';
import { solveCircuit } from '../solver/solve';
import { assessSampleQuality } from '../solver/quality';
import { freezeSnapshot } from './notebook';

/** Restricted experiment: one ideal single-bus, constant-index ring. All quantities use SI. */
export interface RingRequest { id: number; coupling: number; roundTripLengthM: number; neff: number; lossDbPerM: number; phaseRad: number; centerM: number; startM: number; stopM: number; coarsePoints: number; maxEvaluations: number }
export interface RingSample { wavelengthM: number; powerW: number | null; transmission: number | null; phaseRad: number | null; eligible: boolean; diagnostics: Diagnostic[]; rejectionReasons: Diagnostic[]; referenceTransmission: number }
export interface RingSeed { resonanceM: number; estimatedLinewidthM: number; order: number; minimumTransmission: number; peakTransmission: number; phaseHalfWidthRad: number }
export interface RingMetrics { resonanceM: number; minimumTransmission: number; peakTransmission: number; linewidthM: number; q: number; /** Computed estimate, null below the relative-transmission reporting cutoff; absolute-power agreement does not certify extinction accuracy. */ extinctionDb: number | null; /** Reporting cutoff only, never a measured extinction lower bound. */ extinctionReportingThresholdDb: number }
export interface RingResult { request: RingRequest; document: CircuitDocument; status: 'resolved' | 'unresolved' | 'cancelled'; reason: string; coarse: RingSample[]; local: RingSample[]; reference: RingSample[]; seed: RingSeed; metrics: RingMetrics | null; evaluations: number; convergence: { locationBracketM: number | null; linewidthBracketM: number | null; maximumReferenceError: number; rejectedSamples: number }; assumptions: string[] }
export type RingResponse = { type: 'progress'; id: number; completed: number; total: number } | { type: 'complete'; id: number; result: RingResult } | { type: 'cancelled'; id: number } | { type: 'error'; id: number; message: string };
export interface RingOptions { yieldControl?: () => Promise<void>; isCancelled?: () => boolean; onProgress?: (completed: number, total: number) => void; solve?: (circuit: Circuit) => SolveResult }
export const ringPreset: Readonly<RingRequest> = Object.freeze({ id: 0, coupling: .001, roundTripLengthM: 155 * 1550.05e-9 / 2.4, neff: 2.4, lossDbPerM: -10 * Math.log10(1 - .001) / (155 * 1550.05e-9 / 2.4), phaseRad: 0, centerM: 1550.05e-9, startM: 1500e-9, stopM: 1600e-9, coarsePoints: 101, maxEvaluations: 600 });
const fields = ['id', 'coupling', 'roundTripLengthM', 'neff', 'lossDbPerM', 'phaseRad', 'centerM', 'startM', 'stopM', 'coarsePoints', 'maxEvaluations'];
export function validateRingRequest(value: unknown): asserts value is RingRequest {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw new Error('Ring request must contain exactly the declared ideal-ring parameters and sampling bounds.');
 const r = value as RingRequest;
 if (fields.some(key => typeof r[key as keyof RingRequest] !== 'number' || !Number.isFinite(r[key as keyof RingRequest]))) throw new Error('Ring inputs must be finite numbers in SI units.');
 if (!Number.isSafeInteger(r.id) || r.id < 0) throw new Error('Ring request ID must be a nonnegative safe integer.');
 if (r.coupling <= 0 || r.coupling >= 1 || r.roundTripLengthM <= 0 || r.neff <= 0 || r.lossDbPerM < 0) throw new Error('Use 0 < coupling < 1, positive length/index, and nonnegative loss.');
 if (r.startM <= 0 || r.stopM <= r.startM || r.centerM < r.startM || r.centerM > r.stopM || !Number.isFinite(r.stopM - r.startM)) throw new Error('The selected center must lie inside a finite positive wavelength range.');
 if (!Number.isInteger(r.coarsePoints) || r.coarsePoints < 21 || r.coarsePoints > 1001 || !Number.isInteger(r.maxEvaluations) || r.maxEvaluations < 32 || r.maxEvaluations > 1600) throw new Error('Use 21–1001 broad samples and an evaluation budget of 32–1600.');
 if (!(r.neff * r.roundTripLengthM > 0) || !Number.isFinite(r.neff * r.roundTripLengthM / r.centerM) || !Number.isFinite(r.lossDbPerM * r.roundTripLengthM) || Math.abs(r.phaseRad) > 1e6) throw new Error('Ring optical path, loss and phase exceed the supported finite domain.');
 if (Math.sqrt(1-r.coupling) === 1) throw new Error('Coupling is below floating-point coefficient resolution; this model cannot represent it.');
}
export function createRingDocument(request: RingRequest): CircuitDocument {
 validateRingRequest(request);
 const component = (id: string, model: 'source'|'coupler'|'phase'|'detector', label: string, params: Record<string, number>) => ({id,model,label,version:'1' as const,params});
 const line = (id: string, from: string, a: number, to: string, b: number, lengthM = 0) => ({id,from:{component:from,port:a},to:{component:to,port:b},lengthM,neff:request.neff,lossDbPerM:lengthM ? request.lossDbPerM : 0});
 return arrangeDocument({schema:'picsetup-playground/1',title:'Resolved ideal ring experiment',circuit:{wavelengthM:request.centerM,components:[component('laser','source','Laser',{powerW:.001,phaseRad:0}),component('ring_coupler','coupler','Ideal ring coupler',{coupling:request.coupling}),component('ring_phase','phase','Round-trip phase',{phaseRad:request.phaseRad}),component('through','detector','Through',{})],connections:[line('input','laser',0,'ring_coupler',0),line('output','ring_coupler',2,'through',0),line('roundtrip_a','ring_coupler',3,'ring_phase',0,request.roundTripLengthM/2),line('roundtrip_b','ring_phase',1,'ring_coupler',1,request.roundTripLengthM/2)]},layout:{components:{laser:{x:0,y:0,rotation:0},ring_coupler:{x:200,y:0,rotation:0},ring_phase:{x:200,y:180,rotation:0},through:{x:400,y:0,rotation:0}},connections:{input:{bend:0},output:{bend:0},roundtrip_a:{bend:0},roundtrip_b:{bend:0}},viewport:{x:0,y:0,zoom:1}}});
}
/** Stable closed form independently reduced from h=(t-a exp(-iθ))/(1-ta exp(-iθ)). */
export function idealRingTransmission(request: RingRequest, wavelengthM: number): number {
 const t = Math.sqrt(1-request.coupling), a = Math.exp(-request.lossDbPerM*request.roundTripLengthM*Math.LN10/20), r=t*a;
 const turns = request.neff*request.roundTripLengthM/wavelengthM+request.phaseRad/(2*Math.PI);
 const s = Math.sin(Math.PI*(turns-Math.round(turns)));
 return ((t-a)**2+4*r*s*s)/((1-r)**2+4*r*s*s);
}
export function ringSeed(request: RingRequest): RingSeed {
 const optical = request.neff*request.roundTripLengthM, offset=request.phaseRad/(2*Math.PI), order=Math.max(Math.floor(offset)+1,Math.round(optical/request.centerM+offset)), d=order-offset;
 const t=Math.sqrt(1-request.coupling), a=Math.exp(-request.lossDbPerM*request.roundTripLengthM*Math.LN10/20), r=t*a;
 const phaseHalfWidthRad=2*Math.asin(Math.min(1,Math.abs(1-r)/Math.sqrt(2*(1+r*r))));
 return {resonanceM:optical/d,estimatedLinewidthM:optical/(d-phaseHalfWidthRad/(2*Math.PI))-optical/(d+phaseHalfWidthRad/(2*Math.PI)),order,minimumTransmission:((t-a)/(1-r))**2,peakTransmission:((t+a)/(1+r))**2,phaseHalfWidthRad};
}
const assumptions = ['Known ideal single-bus topology; matched ports; 1 mW input; exp(+iωt).', 'Constant effective index: group index equals effective index. Loss, coupling and added phase are wavelength independent.', 'Resonance is seeded from the declared optical path, then independently sampled and bracketed. This cannot discover arbitrary unknown resonances.', 'Linewidth is the full width at half the notch depth between local minimum and adjacent antiresonance peak. Q = resonance wavelength / linewidth.', 'Numerical resolution is not calibrated device accuracy. The 120 dB reporting cutoff suppresses finite extinction at or below 1e-12 relative transmission; it is not a certified extinction bound. The absolute transmission agreement gate does not certify extinction accuracy; any finite extinction is a computed estimate.'];
export async function runRingExperiment(input: RingRequest, options: RingOptions = {}): Promise<RingResult> {
 validateRingRequest(input);
 const request=freezeSnapshot(structuredClone(input)), document=createRingDocument(request), seed=ringSeed(request);
 const coarse:RingSample[]=[],local:RingSample[]=[],reference:RingSample[]=[];
 const convergence:RingResult['convergence']={locationBracketM:null,linewidthBracketM:null,maximumReferenceError:0,rejectedSamples:0};
 let evaluations=0; const solve=options.solve??solveCircuit, yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
 const finish=(status:RingResult['status'],reason:string,metrics:RingMetrics|null=null):RingResult=>freezeSnapshot({request,document,status,reason,coarse,local:local.sort((a,b)=>a.wavelengthM-b.wavelengthM),reference,seed,metrics,evaluations,convergence,assumptions:[...assumptions]});
 const evaluate=async(wavelengthM:number,list:RingSample[]):Promise<RingSample>=>{
  if(evaluations%8===0){options.onProgress?.(evaluations,request.maxEvaluations);await yieldControl();}
  if(options.isCancelled?.()) throw new Error('cancelled');
  if(evaluations>=request.maxEvaluations) throw new Error('budget');
  evaluations++;
  let sample:RingSample;
  try { const result=solve({...document.circuit,wavelengthM}),detector=result.detectors.through;
   const quality=assessSampleQuality({ok:result.ok,diagnostics:result.diagnostics,values:[detector?.powerW,result.residual,...Object.values(result.budget)]});
   const transmission=detector&&Number.isFinite(detector.powerW)?detector.powerW/.001:null;
   sample={wavelengthM,powerW:transmission===null?null:detector.powerW,transmission,phaseRad:detector?.phaseRad??null,eligible:quality.eligible,diagnostics:[...result.diagnostics],rejectionReasons:quality.reasons,referenceTransmission:idealRingTransmission(request,wavelengthM)};
  } catch(error){const diagnostic:Diagnostic={severity:'error',code:'RING_SAMPLE_FAILED',message:error instanceof Error?error.message:'Ring sample unavailable.'};sample={wavelengthM,powerW:null,transmission:null,phaseRad:null,eligible:false,diagnostics:[diagnostic],rejectionReasons:[diagnostic],referenceTransmission:idealRingTransmission(request,wavelengthM)};}
  list.push(sample);
  if(!sample.eligible)convergence.rejectedSamples++;
  if(sample.transmission!==null)convergence.maximumReferenceError=Math.max(convergence.maximumReferenceError,Math.abs(sample.transmission-sample.referenceTransmission));
  return sample;
 };
 const value=(sample:RingSample):number=>{if(!sample.eligible||sample.transmission===null)throw new Error('quality');return sample.transmission;};
 try {
  if(!Number.isFinite(seed.resonanceM)||!Number.isFinite(seed.estimatedLinewidthM)||seed.resonanceM<request.startM||seed.resonanceM>request.stopM)return finish('unresolved','The nearest model-predicted resonance is outside this wavelength range.');
  if(seed.estimatedLinewidthM<=1024*Number.EPSILON*seed.resonanceM||Math.abs(seed.order)>1e10)return finish('unresolved','The estimated linewidth is too close to wavelength/phase floating-point resolution.');
  if(seed.peakTransmission-seed.minimumTransmission<1e-6)return finish('unresolved','This parameter set has no measurable power notch under the declared minimum depth of 1e-6.');
  const w=seed.estimatedLinewidthM, center=seed.resonanceM;
  if(center-4*w<request.startM||center+4*w>request.stopM)return finish('unresolved','The selected range must contain four estimated linewidths on both sides of this resonance.');
  for(let i=0;i<request.coarsePoints;i++)await evaluate(i===request.coarsePoints-1?request.stopM:request.startM+(request.stopM-request.startM)*i/(request.coarsePoints-1),coarse);
  // A known optical-path seed avoids the blind spot of midpoint-only refinement.
  for(let i=0;i<=64;i++)await evaluate(center+(i-32)*w/8,local);
  const seeded=local[32]; let lo=center-w/2,hi=center+w/2; const ratio=(Math.sqrt(5)-1)/2;
  let x1=hi-ratio*(hi-lo),x2=lo+ratio*(hi-lo),y1=value(await evaluate(x1,local)),y2=value(await evaluate(x2,local));
  while(hi-lo>w*.002){if(y1<y2){hi=x2;x2=x1;y2=y1;x1=hi-ratio*(hi-lo);y1=value(await evaluate(x1,local));}else{lo=x1;x1=x2;y1=y2;x2=lo+ratio*(hi-lo);y2=value(await evaluate(x2,local));}}
  convergence.locationBracketM=hi-lo;
  const minimumSample=[seeded,...local.filter(sample=>sample.wavelengthM>=lo&&sample.wavelengthM<=hi)].reduce((best,sample)=>value(sample)<value(best)?sample:best),minimum=value(minimumSample);
  const offset=request.phaseRad/(2*Math.PI), optical=request.neff*request.roundTripLengthM;
  const peaks=[optical/(seed.order-offset-.5),optical/(seed.order-offset+.5)].filter(lambda=>lambda>=request.startM&&lambda<=request.stopM);
  if(!peaks.length)return finish('unresolved','The selected range contains no adjacent antiresonance for the half-depth reference.');
  let peak=0;for(const lambda of peaks)peak+=value(await evaluate(lambda,reference))/peaks.length;
  const half=(peak+minimum)/2;
  const crossing=async(direction:number):Promise<{point:number;span:number}>=>{
   let inner=center,outer=center+direction*2*w;
   if(value(await evaluate(outer,local))<=half)throw new Error('bracket');
   while(Math.abs(outer-inner)>w*.0005){const mid=(inner+outer)/2;if(value(await evaluate(mid,local))<half)inner=mid;else outer=mid;}
   return {point:(inner+outer)/2,span:Math.abs(outer-inner)};
  };
  const left=await crossing(-1),right=await crossing(1),linewidth=right.point-left.point;
  convergence.linewidthBracketM=left.span+right.span;
  if(convergence.rejectedSamples||convergence.maximumReferenceError>1e-6)return finish('unresolved','Solver quality or independent closed-form agreement failed; raw samples are retained.');
  if(Math.abs(minimumSample.wavelengthM-center)>w*.01||Math.abs(minimum-seed.minimumTransmission)>.01||Math.abs(linewidth-w)>w*.005||convergence.linewidthBracketM>linewidth*.002)return finish('unresolved','Location, depth or linewidth failed the declared convergence tolerances.');
  const belowReportingCutoff=minimum<=1e-12*peak;
  return finish('resolved','The selected known-model notch is resolved: location bracket <0.2% and linewidth bracket <0.2% of linewidth; closed-form power agreement ≤1e-6.',{resonanceM:minimumSample.wavelengthM,minimumTransmission:minimum,peakTransmission:peak,linewidthM:linewidth,q:minimumSample.wavelengthM/linewidth,extinctionDb:belowReportingCutoff?null:10*Math.log10(peak/minimum),extinctionReportingThresholdDb:120});
 }catch(error){const why=error instanceof Error?error.message:'';return why==='cancelled'?finish('cancelled','Cancelled; retained samples do not establish resolution.'):finish('unresolved',why==='budget'?'Evaluation budget exhausted before convergence; increase the budget.':why==='quality'?'A required sample failed numerical quality checks; no notch metrics are reported.':why==='bracket'?'The half-depth crossing could not be bracketed.':'The measurement could not be completed.');}
}
export function createRingRunner(emit:(message:RingResponse)=>void,options:Omit<RingOptions,'onProgress'|'isCancelled'>={}) {
 let active:{id:number;cancelled:boolean}|undefined;
 return {handle(message:unknown){
  if(!message||typeof message!=='object')return emit({type:'error',id:-1,message:'Expected a ring run or cancel request.'});
  const data=message as Record<string,unknown>,id=typeof data.id==='number'?data.id:-1;
  if(data.type==='cancel'){if(active?.id===id)active.cancelled=true;return;}
  if(data.type!=='run')return emit({type:'error',id,message:'Expected a ring run or cancel request.'});
  if(active)active.cancelled=true;const {type:_,...request}=data;
  try{validateRingRequest(request);}catch(error){return emit({type:'error',id,message:error instanceof Error?error.message:'Invalid ring request.'});}
  const job={id,cancelled:false};active=job;
  void runRingExperiment(request,{...options,isCancelled:()=>job.cancelled||active!==job,onProgress:(completed,total)=>{if(active===job&&!job.cancelled)emit({type:'progress',id,completed,total});}}).then(result=>{if(active!==job||job.cancelled||result.status==='cancelled')emit({type:'cancelled',id});else emit({type:'complete',id,result});}).catch(error=>emit({type:'error',id,message:error instanceof Error?error.message:'Ring experiment failed.'})).finally(()=>{if(active===job)active=undefined;});
 }};
}
