export const icons: Record<string, string> = {
 source: '<circle cx="16" cy="16" r="9"/><path d="M3 16h5m16 0h5M12 16h8m-3-3 3 3-3 3"/>',
 coupler: '<path d="M3 8h7c7 0 5 16 12 16h7M3 24h7c7 0 5-16 12-16h7"/>',
 phase: '<path d="M3 16h6m14 0h6"/><rect x="9" y="6" width="14" height="20" rx="4"/><path d="M19 11c-6-3-7 11-2 10m0-13-2 16"/>',
 attenuator: '<path d="M3 16h5m16 0h5"/><rect x="8" y="7" width="16" height="18" rx="3"/><path d="m12 21 8-10m-4 0h4v4"/>',
 detector: '<path d="M3 16h8M11 6v20h5a10 10 0 0 0 0-20z"/><path d="m15 18 4-7-1 6h4l-5 7"/>',
 termination: '<path d="M3 16h10m0-8v16m5-13v10m5-7v4"/>',
 undo: '<path d="M10 9H4V3m0 6c5-7 18-4 18 5 0 5-4 8-8 8"/>',
 redo: '<path d="M14 9h6V3m0 6C15 2 2 5 2 14c0 5 4 8 8 8"/>',
 rotate: '<path d="M20 8V3m0 5h-5m5 0C14-1 2 4 3 13s13 12 17 4"/>',
 trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
 duplicate: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
 fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
 upload: '<path d="M12 17V5m-5 5 5-5 5 5M4 17v4h16v-4"/>',
 plus: '<path d="M12 4v16M4 12h16"/>',
 close: '<path d="m6 6 12 12M6 18 18 6"/>',
 help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5m0 3v1"/>',
 light: '<path d="m3 12 4-6 6 12 4-12 4 6"/>',
 arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};
export function icon(name: string, size = 20) { return `<svg width="${size}" height="${size}" viewBox="0 0 ${['source','coupler','phase','attenuator','detector','termination'].includes(name)?32:24} ${['source','coupler','phase','attenuator','detector','termination'].includes(name)?32:24}" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.light}</svg>`; }

/** Schematic device geometry terminates exactly at the editor's optical ports. */
export function componentShape(model: string): string {
 const guide=(path:string)=>`<path class="device-guide" d="${path}"/><path class="device-core" d="${path}"/>`;
 const shapes:Record<string,string>={
  source: `${guide('M 8 0 H 56')}<circle class="emitter-halo" cx="-10" cy="0" r="25"/><circle class="emitter-body" cx="-10" cy="0" r="16"/><path class="emitter-wave" d="M -21 0 C -17 -10 -14 -10 -10 0 S -3 10 1 0"/><path class="emitter-rays" d="M 16 -9 Q 22 0 16 9 M 23 -13 Q 32 0 23 13"/>`,
  coupler: `<rect class="coupling-region" x="-25" y="-14" width="50" height="28" rx="12"/>${guide('M -66 -20 H -51 C -34 -20 -35 -5 -17 -5 H 17 C 35 -5 34 -20 51 -20 H 66')}${guide('M -66 20 H -51 C -34 20 -35 5 -17 5 H 17 C 35 5 34 20 51 20 H 66')}<path class="coupling-ticks" d="M -12 -1 V 1 M -4 -1 V 1 M 4 -1 V 1 M 12 -1 V 1"/>`,
  phase: `<rect class="phase-region" x="-28" y="-14" width="56" height="28" rx="8"/>${guide('M -56 0 H 56')}<path class="phase-electrode" d="M -20 -9 H 20 M -20 9 H 20"/><text class="device-symbol" x="0" y="-18">φ</text>`,
  attenuator: `<rect class="attenuation-region" x="-24" y="-13" width="48" height="26" rx="6"/>${guide('M -56 0 H 56')}<path class="absorption-hatching" d="m -17 -10 10 20 m -1 -20 10 20 m -1 -20 10 20"/>`,
  detector: `${guide('M -56 0 H -9')}<path class="detector-body" d="M -9 -17 H 5 Q 26 -17 26 0 Q 26 17 5 17 H -9 Z"/><path class="detector-stripes" d="M -3 -11 V 11 M 3 -11 V 11 M 9 -10 V 10 M 15 -7 V 7"/><path class="detector-lead" d="M 6 -17 V -23 H 25"/>`,
  termination: `${guide('M -56 0 H -7')}<path class="termination-body" d="M -7 -15 V 15 M 0 -12 V 12 M 7 -8 V 8 M 14 -4 V 4"/>`,
 };
 return `<g class="device-structure" aria-hidden="true">${shapes[model]??''}</g>`;
}
