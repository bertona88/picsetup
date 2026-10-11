/** SI physical state. Layout is deliberately separate. */
export type Complex = { re: number; im: number };
export type ModelId = 'source' | 'coupler' | 'siepic-coupler' | 'phase' | 'attenuator' | 'detector' | 'termination';
export interface Component { id: string; model: ModelId; version: '1'; label: string; params: Record<string, number> }
export interface Endpoint { component: string; port: number }
export interface Connection { id: string; from: Endpoint; to: Endpoint; lengthM: number; lossDbPerM: number; neff: number }
export interface Circuit { components: Component[]; connections: Connection[]; wavelengthM: number }
export interface Position { x: number; y: number; rotation: number }
export interface Layout { components: Record<string, Position>; connections: Record<string, { bend: number }>; viewport: { x: number; y: number; zoom: number } }
export interface CircuitDocument { schema: 'picsetup-playground/1'; title: string; circuit: Circuit; layout: Layout }
export interface Diagnostic { severity: 'info' | 'warning' | 'error'; code: string; message: string; componentId?: string; connectionId?: string }
export interface PortResult { componentId: string; port: number; incoming: Complex; outgoing: Complex }
export interface PowerBudget { emittedW: number; modelSuppliedW: number; detectedW: number; escapedW: number; componentAbsorbedW: number; returnedToSourceW: number; propagationLossW: number; imbalanceW: number }
export interface SolveResult { ok: boolean; ports: PortResult[]; detectors: Record<string, { powerW: number; phaseRad: number | null }>; budget: PowerBudget; residual: number; diagnostics: Diagnostic[] }
