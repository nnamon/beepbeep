import { describe, expect, it } from 'vitest';
import { Decoder, type DecoderModel, type DecoderOutput } from './decoder';
import { outputsToText } from './pipeline';
import { FISTS, keyText } from './fists';
import { StableReading, WRITE_AFTER } from './stable';
import type { Kept } from './settle';
import { cer } from '../util/text';

const sync = new StableReading((m, mk, until, keep, full) => Promise.resolve(Decoder.redecode(m, mk, until, keep, full)));

/** Streams marks through a live decoder and the reading; returns every reading shown. */
async function stream(reading: StableReading, marks: { start: number; end: number }[], wpm: number): Promise<DecoderOutput[][]> {
  const d = new Decoder({ initialWpm: wpm });
  const shown: DecoderOutput[][] = [];
  const read = async (out: DecoderOutput[], t: number, n: number) => {
    if (out.length) shown.push(await reading.update(d.model(), marks.slice(0, n), t));
  };
  for (let i = 0; i < marks.length; i++) {
    await read(d.keyDown(marks[i].start), marks[i].start, i);
    await read(d.keyUp(marks[i].end), marks[i].end, i + 1);
    const next = marks[i + 1]?.start ?? marks[i].end + 5;
    for (let t = marks[i].end + 0.02; t < next; t += 0.02) await read(d.tick(t), t, i + 1);
  }
  d.flush(marks[marks.length - 1].end + 5);
  shown.push(await reading.finish(d.model(), marks));
  return shown;
}

describe('stable reading', () => {
  it('keeps words already written when the tempo changes later', async () => {
    // Slow and careful, then much faster: the fist the decoder learned early no longer fits.
    // Reading the whole over again on every letter (the old way) rewrote text more
    // than 8 letters back 33 times in 10 overs like these.
    const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
    const TEXT = 'CQ CQ DE K1ABC K1ABC DE W1AW';
    let stableErr = 0;
    let wholeErr = 0;
    for (let seed = 0; seed < 5; seed++) {
      const a = keyText('CQ CQ DE K1ABC', { ...fair, wpm: 10 }, 7 + seed * 2);
      const b = keyText('K1ABC DE W1AW', { ...fair, wpm: 22 }, 8 + seed * 2);
      const shift = a[a.length - 1].end + 7 * (1.2 / 10) - b[0].start;
      const marks = [...a, ...b.map((m) => ({ start: m.start + shift, end: m.end + shift }))];
      const shown = await stream(sync, marks, 15);
      // Once a word has WRITE_AFTER marks after it in what was shown, it never changes.
      let kept = '';
      for (const outs of shown) {
        const text = outputsToText(outs);
        expect(text.startsWith(kept), `seed ${seed}: "${kept}" rewritten as "${text}"`).toBe(true);
        let after = 0;
        for (let i = outs.length - 1; i >= 0; i--) {
          const o = outs[i];
          if (o.kind === 'char') after += o.char.marks.length;
          else if (i < outs.length - 1 && after >= WRITE_AFTER) {
            kept = outputsToText(outs.slice(0, i));
            break;
          }
        }
      }
      expect(kept.length).toBeGreaterThan(10);
      stableErr += cer(TEXT, outputsToText(shown[shown.length - 1]));
      const d = new Decoder({ initialWpm: 15 });
      for (const m of marks) {
        d.keyDown(m.start);
        d.keyUp(m.end);
      }
      wholeErr += cer(TEXT, outputsToText(Decoder.redecode(d.model(), marks)));
    }
    // A jump from 10 to 22 wpm is hard either way; holding words must not make it worse.
    expect(stableErr).toBeLessThanOrEqual(wholeErr + 0.05);
  });

  it('skips a reading a newer request replaces', async () => {
    const calls: number[] = [];
    const r = new StableReading((_m, marks) => {
      calls.push(marks.length);
      return Promise.resolve([]);
    });
    const model = new Decoder().model();
    const m = [{ start: 0, end: 0.1 }];
    const first = r.update(model, m, 1);
    const second = r.update(model, [...m, { start: 0.2, end: 0.3 }], 1);
    await Promise.all([first, second]);
    expect(calls).toEqual([2]);
  });

  it('does not carry words into the next over when reset mid-reading', async () => {
    const model: DecoderModel = new Decoder({ initialWpm: 20 }).model();
    const marks = keyText('CQ CQ DE K1ABC K1ABC K', FISTS[FISTS.length - 1], 3);
    const keeps: Kept[][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const r = new StableReading(async (m, mk, until, keep, full) => {
      keeps.push(keep);
      if (keeps.length === 1) await gate;
      return Decoder.redecode(m, mk, until, keep, full);
    });
    const pending = r.update(model, marks, marks[marks.length - 1].end + 1);
    r.reset();
    release();
    await pending;
    await r.update(model, marks.slice(0, 4), marks[3].end + 1);
    expect(keeps[keeps.length - 1]).toEqual([]);
  });
});
