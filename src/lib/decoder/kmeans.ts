// One-dimensional k-means on log-durations: speed-independent clustering of
// marks (dit/dah) and gaps (element/character/word).

export function kmeans2(values: number[], c1: number, c2: number, iterations = 12) {
  let a = c1;
  let b = c2;
  let na = 0;
  let nb = 0;
  for (let it = 0; it < iterations; it++) {
    let sa = 0;
    let sb = 0;
    na = 0;
    nb = 0;
    const mid = (a + b) / 2;
    for (const v of values) {
      if (v < mid) {
        sa += v;
        na++;
      } else {
        sb += v;
        nb++;
      }
    }
    const na2 = na ? sa / na : a;
    const nb2 = nb ? sb / nb : b;
    if (Math.abs(na2 - a) < 1e-9 && Math.abs(nb2 - b) < 1e-9) break;
    a = na2;
    b = nb2;
  }
  return { low: a, high: b, nLow: na, nHigh: nb };
}
