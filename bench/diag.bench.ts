// Diagnostic: one scene, the current detector's marks against the truth, and for
// each missed mark what the detector saw (room gate, steadiness, level).
import { it } from 'vitest';
import { Detector, type TraceStep } from '../src/lib/dsp/detector';
import { FISTS } from '../src/lib/decoder/fists';
import { FS, loadBed, mix, renderTone, segment, type Timbre } from './lib/scene';
import { read, scoreMarks, decodeMarks } from './lib/run';

it('diag', () => {
  const bed = loadBed(`data/demand/${process.env.BED ?? 'DLIVING'}.wav`);
  const snr = Number(process.env.SNR ?? 15);
  const timbre = (process.env.TIMBRE ?? 'sine') as Timbre;
  const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
  const keying = { text: 'CQ CQ DE K1ABC K', fist: fair, seed: 11 };
  const tone = renderTone(keying, { pitch: 600, timbre, amplitude: 0.05 });
  const x = mix(tone.samples, segment(bed, 0, tone.samples.length), 600, 0.05, snr);
  const steps: TraceStep[] = [];
  const got = read((fs, o) => new Detector(fs, { ...o, trace: (s) => steps.push(s) }), x, FS, 600, 15);
  const m = scoreMarks(got.marks, tone.marks);
  const rows = [`recall ${m.recall.toFixed(2)} precision ${m.precision.toFixed(2)} text ${JSON.stringify(got.text)} ref ${JSON.stringify(decodeMarks(tone.marks))}`];
  for (const t of tone.marks) {
    const hit = got.marks.some((g) => Math.min(g.end, t.end) - Math.max(g.start, t.start) > 0.5 * (t.end - t.start));
    const inside = steps.filter((s) => s.t >= t.start + 0.01 && s.t <= t.end - 0.01);
    const frac = (f: (s: TraceStep) => boolean) => (inside.filter(f).length / Math.max(1, inside.length)).toFixed(2);
    const rise = inside.map((s) => s.env - s.floor).sort((a, b) => a - b)[inside.length >> 1];
    rows.push(`${hit ? 'hit ' : 'MISS'} ${t.start.toFixed(2)}+${((t.end - t.start) * 1000).toFixed(0).padStart(3)} rise ${rise?.toFixed(0)} above-on ${frac((s) => s.env > s.onThr)} clear ${frac((s) => s.clear)} steady ${frac((s) => s.coherence >= 0.4 && Math.abs(s.offset) <= 20)} voiced ${frac((s) => s.voiced)} harmonic-on ${frac((s) => s.harmonic)} toneLike ${frac((s) => s.toneLike)} down ${frac((s) => s.keyDown)}`);
  }
  console.log('DIAG\n' + rows.join('\n'));
});
