import type { Complex } from './types';

export const complex = (re = 0, im = 0): Complex => ({ re, im });
export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const magnitude = (a: Complex): number => Math.hypot(a.re, a.im);
export const power = (a: Complex): number => a.re * a.re + a.im * a.im;
export const finite = (a: Complex): boolean => Number.isFinite(a.re) && Number.isFinite(a.im);
export const polar = (amplitude: number, phase: number): Complex => ({ re: amplitude * Math.cos(phase), im: amplitude * Math.sin(phase) });

/** Ratio form avoids squaring the denominator and unnecessary overflow. */
export function div(a: Complex, b: Complex): Complex {
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const ratio = b.im / b.re;
    const denominator = b.re + b.im * ratio;
    return { re: (a.re + a.im * ratio) / denominator, im: (a.im - a.re * ratio) / denominator };
  }
  const ratio = b.re / b.im;
  const denominator = b.im + b.re * ratio;
  return { re: (a.re * ratio + a.im) / denominator, im: (a.im * ratio - a.re) / denominator };
}
