// E0's tables, from result rows: by pitch (over beds), by keying, by bed. Shared
// by E0 itself and by e0merge, which joins runs split over several processes.

export interface E0Row {
  bed: string;
  detector: string;
  pitch: number;
  timbre: string;
  keying: string;
  snr: number;
  letterError: number;
  recall: number;
  precision: number;
  strayPerMin: number;
}

export function e0Report(rows: E0Row[], snrs: number[]): string {
  const detectors = [...new Set(rows.map((r) => r.detector))];
  const table = (title: string, key: (r: E0Row) => string) => {
    const keys = [...new Set(rows.map(key))];
    const out = [title];
    for (const k of keys) {
      for (const d of detectors) {
        const rs = rows.filter((r) => r.detector === d && key(r) === k);
        if (!rs.length) continue;
        const col = (f: (r: E0Row) => number) =>
          snrs
            .map((s) => {
              const v = rs.filter((r) => r.snr === s);
              return ((v.reduce((a, r) => a + f(r), 0) / Math.max(1, v.length)) * 100).toFixed(0).padStart(4);
            })
            .join('');
        // One stray count per bed and pitch, not per scene.
        const strays = new Map(rs.map((r) => [`${r.bed}|${r.pitch}`, r.strayPerMin]));
        const stray = [...strays.values()].reduce((a, x) => a + x, 0) / Math.max(1, strays.size);
        out.push(`${k.padEnd(24)} ${d.padEnd(9)} err ${col((r) => r.letterError)} | recall ${col((r) => r.recall)} | precision ${col((r) => r.precision)} | stray/min ${stray.toFixed(1)}`);
      }
    }
    return out.join('\n');
  };
  const beds = new Set(rows.map((r) => r.bed)).size;
  return [
    `Columns: band SNR ${snrs.join(' ')} dB`,
    table(`By pitch (over ${beds} beds)`, (r) => String(r.pitch)),
    table('By timbre', (r) => r.timbre),
    table('By keying', (r) => r.keying),
    table('By bed', (r) => r.bed),
  ].join('\n\n');
}
