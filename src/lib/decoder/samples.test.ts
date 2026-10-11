// Microphone samples recorded with the debug server's sample recorder
// (samples/<name>.wav with <name>.json), replayed through the detector and
// decoder as the browser runs them. Room-only takes should key nothing and
// keying takes decode what was keyed (samples/labels.json corrects the text
// given when recording). No take may get worse than samples/best.json; a new
// take's first result goes in as its best.
// The samples stay on the machine that recorded them; without them this skips.

import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Detector, type DetectorEvent } from '../dsp/detector';
import { Decoder, isGlitch } from './decoder';
import { applyEvents, outputsToText } from './pipeline';
import { readWav } from '../util/wav';
import { cer } from '../util/text';

const DIR = 'samples';

interface Meta {
  kind: 'noise' | 'keying' | 'keying-noise';
  keyed: string;
  notes: string;
  settings: { pitch: number; pinnedHz: number | null; sendWpm: number };
  decodedLive: string;
  decodedSettled: string;
}

// What was actually keyed, where it differs from the text given when recording.
const LABELS: Record<string, string | null> = existsSync(`${DIR}/labels.json`) ? JSON.parse(readFileSync(`${DIR}/labels.json`, 'utf8')) : {};
const ROWS: string[] = [];
// A ratchet: the best result so far per take (stray letters, or letter error).
// BEST=1 rewrites it from the current results.
const UPDATE = process.env.BEST === '1';
const BEST: Record<string, number> = existsSync(`${DIR}/best.json`) ? JSON.parse(readFileSync(`${DIR}/best.json`, 'utf8')) : {};
let added = false;

const names = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith('.json') && existsSync(`${DIR}/${f.slice(0, -5)}.wav`))
      .map((f) => f.slice(0, -5))
      .sort()
  : [];

/** Detector and decoder over a whole sample, in 128-sample blocks like the AudioWorklet. */
export function replay(samples: Float32Array, sampleRate: number, meta: Meta) {
  const wpm = meta.settings.sendWpm || 15;
  const detector = new Detector(sampleRate, { pinnedHz: meta.settings.pinnedHz, dit: 1.2 / wpm });
  const decoder = new Decoder({ initialWpm: wpm });
  const marks: { start: number; end: number }[] = [];
  let down: number | null = null;
  for (let i = 0; i < samples.length; i += 128) {
    const events: DetectorEvent[] = detector.process(samples.subarray(i, Math.min(samples.length, i + 128)));
    for (const e of events) {
      if (e.type !== 'key') continue;
      if (e.down) down = e.t;
      else if (down !== null) {
        if (!isGlitch(e.t - down, decoder.ditEstimate)) marks.push({ start: down, end: e.t });
        down = null;
      }
    }
    applyEvents(decoder, events);
    decoder.tick(detector.time);
    detector.setDit(decoder.ditEstimate);
  }
  decoder.flush(detector.time + 10);
  const text = marks.length ? outputsToText(Decoder.redecode(decoder.model(), marks)) : '';
  return { marks, text, pitch: detector.pitch };
}

describe('microphone samples', () => {
  if (!names.length) it.skip(`no samples in ${DIR}`, () => {});
  afterAll(() => {
    if (UPDATE || added) writeFileSync(`${DIR}/best.json`, JSON.stringify(BEST, null, 2));
    if (ROWS.length) console.log(`\nMicrophone samples: letter error now and in the browser when recorded\n${ROWS.join('\n')}\n`);
  });
  for (const n of names) {
    it(n, () => {
      const meta = JSON.parse(readFileSync(`${DIR}/${n}.json`, 'utf8')) as Meta;
      const { samples, sampleRate } = readWav(readFileSync(`${DIR}/${n}.wav`));
      const r = replay(samples, sampleRate, meta);
      const keyed = n in LABELS ? LABELS[n] : meta.keyed || null;
      // Word spaces are the sender's; a beginner's are uncertain, so letters are what count.
      const score = (text: string) => (keyed === null ? '' : `${(cer(keyed.replace(/ /g, ''), text.replace(/ /g, '')) * 100).toFixed(0)}%`.padStart(5));
      const what = meta.kind === 'noise' ? 'room only' : (keyed ?? '(not known)');
      ROWS.push(`${n.slice(9).padEnd(24)} ${(meta.notes || meta.kind).padEnd(16)} ${what.padEnd(24)} now ${score(r.text)} ${JSON.stringify(r.text).padEnd(26)} browser ${score(meta.decodedSettled)} ${JSON.stringify(meta.decodedSettled)}`);
      // Room takes count stray letters; keying takes, letter error against what was keyed.
      const value = meta.kind === 'noise' ? r.text.replace(/ /g, '').length : keyed ? cer(keyed.replace(/ /g, ''), r.text.replace(/ /g, '')) : null;
      if (value === null) return;
      if (UPDATE || !(n in BEST)) {
        added ||= !(n in BEST);
        BEST[n] = value;
      } else expect(value, 'worse than the best recorded in samples/best.json').toBeLessThanOrEqual((BEST[n] ?? 0) + 1e-9);
    });
  }
});
