import { describe, expect, it } from 'vitest';
import { createRingDocument, createRingRunner, idealRingTransmission, ringPreset, ringSeed, runRingExperiment, type RingRequest, type RingResponse } from '../src/experiments/ring';
import { solveCircuit } from '../src/solver/solve';
const fast={yieldControl:async()=>{}};
describe('resolved ideal ring measurement',()=>{
 it('resolves both reviewer critical rings despite shifted broad grids',async()=>{
  const cases:RingRequest[]=[{...ringPreset},{...ringPreset,coupling:1-10**(-.1/10),roundTripLengthM:100e-6,lossDbPerM:1000,centerM:2.4*100e-6/155}];
  for(const request of cases)for(const shift of [0,.071e-9]){
   const result=await runRingExperiment({...request,startM:1500e-9+shift,stopM:1600e-9+shift},fast);
   expect(result.status,result.reason).toBe('resolved');expect(result.metrics).not.toBeNull();
   const {metrics,seed}=result;
   expect(Math.abs(metrics!.resonanceM-seed.resonanceM)).toBeLessThan(seed.estimatedLinewidthM*.01);
   expect(metrics!.minimumTransmission).toBeLessThan(.01);
   expect(Math.abs(metrics!.linewidthM/seed.estimatedLinewidthM-1)).toBeLessThan(.005);
   expect(metrics!.extinctionDb).toBeNull();expect(metrics!.extinctionReportingThresholdDb).toBe(120);
   expect(result.evaluations).toBeLessThan(request.maxEvaluations);
   expect(result.convergence.maximumReferenceError).toBeLessThan(1e-6);
  }
 });
 it('retains raw actual samples, phase, immutable requests and a solver-loadable flat document',async()=>{
  const request={...ringPreset};const result=await runRingExperiment(request,fast);
  expect(result.coarse).toHaveLength(101);expect(Math.min(...result.coarse.map(sample=>sample.transmission!))).toBeGreaterThan(.99);
  for(const sample of result.local.filter((_,i)=>i%13===0)){
   const actual=solveCircuit({...result.document.circuit,wavelengthM:sample.wavelengthM});
   expect(sample.powerW).toBe(actual.detectors.through.powerW);expect(sample.phaseRad).toBe(actual.detectors.through.phaseRad);
  }
  request.coupling=.5;expect(result.request.coupling).toBe(.001);expect(Object.isFrozen(result.request)).toBe(true);
 });
 it('checks complex network power against an independent trigonometric critical-ring expression away from zero',()=>{
  const request={...ringPreset};const doc=createRingDocument(request),a2=1-request.coupling;
  for(const detuning of [-1.2e-12,-.25e-12,.1e-12,.8e-12]){
   const wavelength=ringPreset.centerM+detuning;
   const delta=-2*Math.PI*155*detuning/wavelength;
   const expected=4*a2*Math.sin(delta/2)**2/(request.coupling**2+4*a2*Math.sin(delta/2)**2);
   expect(idealRingTransmission(request,wavelength)).toBeCloseTo(expected,8);
   expect(solveCircuit({...doc.circuit,wavelengthM:wavelength}).detectors.through.powerW/.001).toBeCloseTo(expected,8);
  }
 });
 it('does not publish metrics when budget, no-notch, precision or quality gates fail',async()=>{
  const exhausted=await runRingExperiment({...ringPreset,maxEvaluations:32},fast);expect(exhausted.status).toBe('unresolved');expect(exhausted.metrics).toBeNull();expect(exhausted.evaluations).toBe(32);
  const noNotch=await runRingExperiment({...ringPreset,lossDbPerM:0},fast);expect(noNotch.status).toBe('unresolved');expect(noNotch.reason).toMatch(/no measurable/);
  const tiny=await runRingExperiment({...ringPreset,coupling:1e-13,lossDbPerM:-10*Math.log10(1-1e-13)/ringPreset.roundTripLengthM},fast);expect(tiny.status).toBe('unresolved');expect(tiny.metrics).toBeNull();
  const bad=await runRingExperiment({...ringPreset},{...fast,solve:circuit=>{const result=solveCircuit(circuit);result.diagnostics.push({severity:'warning',code:'POWER_IMBALANCE',message:'Injected accounting failure'});return result;}});expect(bad.status).toBe('unresolved');expect(bad.metrics).toBeNull();expect(bad.convergence.rejectedSamples).toBeGreaterThan(0);
 });
 it('cancels bounded work and suppresses stale worker completion',async()=>{
  let cancelled=false;const result=await runRingExperiment({...ringPreset},{isCancelled:()=>cancelled,yieldControl:async()=>{cancelled=true;}});expect(result.status).toBe('cancelled');expect(result.metrics).toBeNull();expect(result.evaluations).toBe(0);
  const responses:RingResponse[]=[];const yields:(()=>void)[]=[];const runner=createRingRunner(message=>responses.push(message),{yieldControl:()=>new Promise<void>(resolve=>yields.push(resolve))});
  runner.handle({type:'run',...ringPreset,id:1});runner.handle({type:'run',...ringPreset,id:2,maxEvaluations:32});
  for(let i=0;i<80;i++){yields.splice(0).forEach(resolve=>resolve());await Promise.resolve();}
  expect(responses.some(message=>message.type==='complete'&&message.id===1)).toBe(false);
  expect(responses.some(message=>message.type==='cancelled'&&message.id===1)).toBe(true);
  expect(responses.some(message=>message.type==='complete'&&message.id===2)).toBe(true);
 });
 it('rejects unsupported and malformed requests',async()=>{
  for(const change of [{coupling:0},{neff:0},{maxEvaluations:1601},{coarsePoints:2},{phaseRad:Infinity},{unexpected:1}])await expect(runRingExperiment({...ringPreset,...change},fast)).rejects.toThrow();
  expect(ringSeed({...ringPreset,phaseRad:.1}).resonanceM).toBeGreaterThan(ringPreset.centerM);
 });
});
