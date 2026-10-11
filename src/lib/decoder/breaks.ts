// Gap classes from a kernel density estimate in log time: each peak is a class
// (element, character, word gaps) and the deepest valley between two peaks is
// the boundary. No assumption about how wide or how full each class is, so a
// jittery hand or a lopsided count (V V V has three element gaps per letter
// gap) does not move the boundary into a class.

export interface GapClasses {
  /** Class centres, log seconds, ascending. */
  modes: number[];
  /** Boundaries between neighbouring classes, log seconds. */
  valleys: number[];
  /** Gaps in each class. */
  counts: number[];
}

/** `logs` in log seconds; `h` the kernel width (0.14 is about 15% timing spread). */
export function gapClasses(logs: number[], h = 0.14): GapClasses {
  const xs = [...logs].sort((a, b) => a - b);
  if (!xs.length) return { modes: [], valleys: [], counts: [] };
  const step = h / 6;
  const lo = xs[0] - 3 * h;
  const hi = xs[xs.length - 1] + 3 * h;
  const grid: number[] = [];
  const dens: number[] = [];
  for (let x = lo; x <= hi; x += step) {
    let d = 0;
    for (const v of xs) d += Math.exp(-0.5 * ((x - v) / h) ** 2);
    grid.push(x);
    dens.push(d);
  }
  // Peaks and the valleys between them.
  let peaks: number[] = [];
  for (let i = 1; i < dens.length - 1; i++) if (dens[i] >= dens[i - 1] && dens[i] > dens[i + 1]) peaks.push(i);
  // Merge neighbours without a real dip between them, or too close to be separate classes.
  let merged = true;
  while (merged && peaks.length > 1) {
    merged = false;
    for (let p = 0; p < peaks.length - 1; p++) {
      const a = peaks[p];
      const b = peaks[p + 1];
      let v = a;
      for (let i = a; i <= b; i++) if (dens[i] < dens[v]) v = i;
      const shallow = Math.min(dens[a], dens[b]) < 1.2 * dens[v];
      // Letter gaps sit at least about 2x the gaps inside a letter, so the
      // lowest two peaks closer than 1.8x are one jittery class. Word gaps can
      // be hurried to under 2x letter gaps, so higher peaks merge below 1.5x.
      const close = grid[b] - grid[a] < Math.log(p === 0 ? 1.8 : 1.5);
      if (shallow || close) {
        peaks = [...peaks.slice(0, p), dens[a] >= dens[b] ? a : b, ...peaks.slice(p + 2)];
        merged = true;
        break;
      }
    }
  }
  const valleys: number[] = [];
  for (let p = 0; p < peaks.length - 1; p++) {
    let v = peaks[p];
    for (let i = peaks[p]; i <= peaks[p + 1]; i++) if (dens[i] < dens[v]) v = i;
    valleys.push(grid[v]);
  }
  const counts = peaks.map((_, p) => xs.filter((x) => (p === 0 || x >= valleys[p - 1]) && (p === peaks.length - 1 || x < valleys[p])).length);
  return { modes: peaks.map((i) => grid[i]), valleys, counts };
}
