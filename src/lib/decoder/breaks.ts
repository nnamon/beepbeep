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

/**
 * Upper gap class over the larger of the gap inside a letter and the dit, at
 * and above which a class is word gaps rather than letter gaps, and below
 * which (down to `lo`) timing cannot tell. Letter gaps sit about 3 of these
 * (2.5 to 3.3 in the beginner fists of fists.ts and human.test.ts: short dahs,
 * hesitant, touch keys, heavy weighting), word gaps 4 to 7.5 (4.1 rushed, 5
 * to 5.4 newbie, 6.4 touch keys, 7 textbook). 4.6 is halfway (in log time)
 * between 3 and 7. A single gap must stand out further: one long letter gap
 * is a hesitation as often as a word gap.
 */
const WORD_RATIO = { lo: 3.7, hi: 4.6 };
const WORD_RATIO_ONE = { lo: 5, hi: 6 };

/**
 * With only two gap classes, the gaps inside letters and one class above
 * them: is that class letter gaps or word gaps? Word gaps when the over has
 * words of one letter (V V V, R R); letter gaps when it is one word (VVV,
 * TEST). A listener tells them apart by their length against the gaps inside
 * the letters and against the dits: letter gaps are about 3 of those, word
 * gaps 7. Log seconds; the larger of `elem` and `dit` is the unit, since
 * touch keys stretch every gap and heavy weighting shortens the gaps inside
 * letters. `count`: gaps in the upper class. 'open': timing cannot tell.
 */
export function upperRole(upper: number, elem: number, dit: number, count: number): 'char' | 'word' | 'open' {
  const r = upper - Math.max(elem, dit);
  const { lo, hi } = count >= 2 ? WORD_RATIO : WORD_RATIO_ONE;
  return r >= Math.log(hi) ? 'word' : r >= Math.log(lo) ? 'open' : 'char';
}

/**
 * Classes as a decoder reads them. Element gaps are a large share of all gaps
 * (even all-E/T text has more than a fifth), so a small group below them is a
 * few hurried gaps, not a class: it joins the class above. A single stray gap
 * between two classes joins the nearer one.
 */
export function settledClasses(c: GapClasses): GapClasses {
  const modes = [...c.modes];
  const valleys = [...c.valleys];
  const counts = [...c.counts];
  const n = counts.reduce((a, b) => a + b, 0);
  while (modes.length > 1 && counts[0] < Math.max(2, 0.2 * n)) {
    counts[1] += counts[0];
    modes.shift();
    valleys.shift();
    counts.shift();
  }
  for (let i = 1; i < modes.length - 1; i++) {
    if (counts[i] >= 2) continue;
    const intoLower = modes[i] - modes[i - 1] <= modes[i + 1] - modes[i];
    if (intoLower) {
      counts[i - 1] += counts[i];
      valleys.splice(i - 1, 1);
    } else {
      counts[i + 1] += counts[i];
      valleys.splice(i, 1);
    }
    modes.splice(i, 1);
    counts.splice(i, 1);
    i--;
  }
  return { modes, valleys, counts };
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
