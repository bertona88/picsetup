export const C = (re = 0, im = 0) => ({ re, im });
export const cloneC = z => ({ re: z?.re ?? 0, im: z?.im ?? 0 });
export const add = (a, b) => C(a.re + b.re, a.im + b.im);
export const sub = (a, b) => C(a.re - b.re, a.im - b.im);
export const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a, s) => C(a.re * s, a.im * s);
export const conj = a => C(a.re, -a.im);
export const abs2 = a => a.re * a.re + a.im * a.im;
export const abs = a => Math.hypot(a.re, a.im);
export const arg = a => Math.atan2(a.im, a.re);
export const expi = phase => C(Math.cos(phase), Math.sin(phase));
export const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  if (d < 1e-30) return C(Number.NaN, Number.NaN);
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};

export const zeros = n => Array.from({ length: n }, () => C());
export const zeroMatrix = (rows, cols = rows) => Array.from({ length: rows }, () => zeros(cols));
export const identityMatrix = n => {
  const out = zeroMatrix(n);
  for (let i = 0; i < n; i += 1) out[i][i] = C(1, 0);
  return out;
};

export function matrixMultiply(a, b) {
  const rows = a.length;
  const inner = b.length;
  const cols = b[0]?.length ?? 0;
  const out = zeroMatrix(rows, cols);
  for (let i = 0; i < rows; i += 1) {
    for (let k = 0; k < inner; k += 1) {
      const aik = a[i][k];
      if (Math.abs(aik.re) + Math.abs(aik.im) < 1e-15) continue;
      for (let j = 0; j < cols; j += 1) {
        const bkj = b[k][j];
        if (Math.abs(bkj.re) + Math.abs(bkj.im) < 1e-15) continue;
        out[i][j] = add(out[i][j], mul(aik, bkj));
      }
    }
  }
  return out;
}

export function matrixVectorMultiply(a, v) {
  return a.map(row => row.reduce((sum, value, idx) => add(sum, mul(value, v[idx])), C()));
}

/**
 * Complex Gaussian elimination with partial pivoting.
 * Returns null for a singular or numerically invalid system.
 */
export function solveLinearSystem(matrix, rhs, epsilon = 1e-11) {
  const n = matrix.length;
  if (!n || rhs.length !== n) return [];
  const a = matrix.map((row, i) => [...row.map(cloneC), cloneC(rhs[i])]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let pivotSize = abs2(a[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const size = abs2(a[row][col]);
      if (size > pivotSize) {
        pivot = row;
        pivotSize = size;
      }
    }
    if (!Number.isFinite(pivotSize) || pivotSize < epsilon * epsilon) return null;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];

    const diagonal = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] = div(a[col][j], diagonal);

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (abs2(factor) < epsilon * epsilon) continue;
      for (let j = col; j <= n; j += 1) {
        a[row][j] = sub(a[row][j], mul(factor, a[col][j]));
      }
    }
  }

  const solution = a.map(row => row[n]);
  return solution.every(z => Number.isFinite(z.re) && Number.isFinite(z.im)) ? solution : null;
}

export function formatPhase(value) {
  if (!Number.isFinite(value)) return '—';
  let wrapped = ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (Math.abs(wrapped) < 5e-4) wrapped = 0;
  return `${wrapped.toFixed(2)} rad`;
}
