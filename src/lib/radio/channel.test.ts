// The channel decoder (channel.ts): overs at silences, a new over where the
// other station of a QSO takes over at another speed, a detector's fades and
// static, the text cap, lines with their times, reset, the worker path, and
// flat cost on long runs. The scorecard is channel.score.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { ChannelDecoder, channelTuning, fitSpeed, type ChannelRead } from './channel';
import { keySend, renderBand, type Station } from './band';
import { channelsOf, feed, noiseChannel, type Mark } from './perturb';
import { SCENARIOS } from './scenarios';
import { scoreBand } from './score';
import { Decoder } from '../decoder/decoder';

const SAVED = { ...channelTuning };
afterEach(() => Object.assign(channelTuning, SAVED));

interface Part {
  text: string;
  wpm: number;
  overallWpm?: number;
  /** Silence before it, seconds (default 2; the first starts at 0.6). */
  pause?: number;
}

/** Transmissions keyed by machine, one after another. */
function keyed(parts: Part[]): Mark[] {
  const out: Mark[] = [];
  let t = 0.6;
  parts.forEach((p, k) => {
    const s: Station = { name: 'X', pitch: 700, wpm: p.wpm, overallWpm: p.overallWpm, sends: [] };
    if (out.length) t = out[out.length - 1].end + (p.pause ?? 2);
    for (const m of keySend(s, p.text, k)) out.push({ start: m.start + t, end: m.end + t });
  });
  return out;
}

const inPlace = () => new ChannelDecoder({ inPlace: true });

describe('channel decoder', () => {
  it('ends an over at a long silence and starts a new line there', () => {
    const dec = inPlace();
    const text = feed(dec, keyed([{ text: 'CQ TEST OH6BVK OH6BVK TEST', wpm: 30 }, { text: 'JA7KUD 5NN 15', wpm: 30, pause: 1.5 }, { text: 'TU OH6BVK TEST', wpm: 30, pause: 2.5 }]));
    expect(text).toBe('CQ TEST OH6BVK OH6BVK TEST\nJA7KUD 5NN 15\nTU OH6BVK TEST');
    expect(dec.pending).toBe('');
  });

  it('keeps word gaps, a short pause and Farnsworth spacing inside one over', () => {
    // A pause of 0.7 seconds at 20 wpm (word gaps 0.42 s) at the same speed changes nothing.
    const a = feed(inPlace(), keyed([{ text: 'UR RST 599 5NN', wpm: 20 }, { text: 'NAME KLAUS QTH MUNICH', wpm: 20, pause: 0.7 }]));
    expect(a).toBe('UR RST 599 5NN NAME KLAUS QTH MUNICH');
    // 18 wpm characters, 10 overall: letter gaps 0.62 s, word gaps 1.45 s.
    const b = feed(inPlace(), keyed([{ text: 'QST DE G4PRC THE NIGHT TRAIN LEAVES AT NINE', wpm: 18, overallWpm: 10 }]));
    expect(b).toBe('QST DE G4PRC THE NIGHT TRAIN LEAVES AT NINE');
  });

  it('starts a new over where a QSO turns to the other station at another speed', () => {
    // The turnover pause (0.5 s) is about a word gap at 18 wpm (0.47 s): only the speed tells.
    const marks = keyed([{ text: 'UR RST 579 579 NAME KENJI', wpm: 18 }, { text: 'R TNX KENJI UR 599 NAME WEI', wpm: 26, pause: 0.5 }]);
    const dec = inPlace();
    const first = keyed([{ text: 'UR RST 579 579 NAME KENJI', wpm: 18 }]).length;
    let ditAfter = 0;
    // The speed ten marks after the turnover.
    const text = feed(dec, marks, { onMark: (n) => n === first + 10 && (ditAfter = dec.dit) });
    expect(text).toBe('UR RST 579 579 NAME KENJI\nR TNX KENJI UR 599 NAME WEI');
    expect(ditAfter / (1.2 / 26)).toBeGreaterThan(0.9);
    expect(ditAfter / (1.2 / 26)).toBeLessThan(1.1);
    expect(dec.wpm).toBeCloseTo(26, -0.5);
  });

  it('reads a turnover with a short pause both ways round, slow after fast too', () => {
    const marks = keyed([{ text: 'R TNX KENJI UR 599 NAME WEI', wpm: 26 }, { text: 'UR RST 579 579 NAME KENJI', wpm: 18, pause: 0.55 }]);
    expect(feed(inPlace(), marks)).toBe('R TNX KENJI UR 599 NAME WEI\nUR RST 579 579 NAME KENJI');
  });

  it('reads a station over three times as fast as the one before it', () => {
    // At 40 wpm a dit is a third of one at 12: it must not be taken for a click.
    const marks = keyed([{ text: 'CQ CQ DE JA1QRT JA1QRT K', wpm: 12 }, { text: 'JA1QRT DE BV2KD BV2KD UR 599 TU', wpm: 40, pause: 2 }]);
    expect(feed(inPlace(), marks)).toBe('CQ CQ DE JA1QRT JA1QRT K\nJA1QRT DE BV2KD BV2KD UR 599 TU');
  });

  it('starts a new line after a word that hands over', () => {
    const text = feed(inPlace(), keyed([{ text: 'CQ CQ DE JA1QRT K', wpm: 20 }, { text: 'JA1QRT DE BV2KD K', wpm: 20, pause: 0.6 }]));
    expect(text).toBe('CQ CQ DE JA1QRT K\nJA1QRT DE BV2KD K');
  });

  it('gives each line the time of its first mark', () => {
    const marks = keyed([{ text: 'CQ TEST OH6BVK', wpm: 25 }, { text: 'K4SWZ 5NN 15', wpm: 25, pause: 3 }]);
    const dec = inPlace();
    feed(dec, marks);
    const second = keyed([{ text: 'CQ TEST OH6BVK', wpm: 25 }]).length;
    expect(dec.lines.map((l) => l.text)).toEqual(['CQ TEST OH6BVK', 'K4SWZ 5NN 15']);
    expect(dec.lines[0].t).toBeCloseTo(marks[0].start, 6);
    expect(dec.lines[1].t).toBeCloseTo(marks[second].start, 6);
  });

  it('keeps only the last characters of the text, and the lines that hold them', () => {
    channelTuning.textCap = 60;
    const dec = inPlace();
    const parts: Part[] = ['CQ TEST OH6BVK OH6BVK TEST', 'JA7KUD 5NN 15', 'TU OH6BVK TEST', 'EA4GHT 5NN 15', 'TU OH6BVK', 'CQ TEST OH6BVK OH6BVK'].map((text) => ({ text, wpm: 30, pause: 2 }));
    feed(dec, keyed(parts));
    const all = parts.map((p) => p.text).join('\n');
    expect(dec.text.length).toBeLessThanOrEqual(60);
    expect(dec.text.length).toBeGreaterThan(40);
    expect(all.endsWith(dec.text)).toBe(true);
    expect(dec.lines.map((l) => l.text).join('\n')).toBe(dec.text);
    expect(dec.footprint.chars).toBe(dec.text.length);
  });

  it('forgets the text on reset and keeps listening at the speed it learned', () => {
    const dec = inPlace();
    const marks = keyed([{ text: 'CQ CQ DE 9M2SKA 9M2SKA K', wpm: 22 }, { text: 'YB1QRX DE 9M2SKA GM', wpm: 22, pause: 3 }]);
    const cut = keyed([{ text: 'CQ CQ DE 9M2SKA 9M2SKA K', wpm: 22 }]).length;
    feed(dec, marks.slice(0, cut), { tail: 4 });
    expect(dec.text).toBe('CQ CQ DE 9M2SKA 9M2SKA K');
    dec.reset();
    expect(dec.text).toBe('');
    expect(dec.pending).toBe('');
    expect(dec.lines).toEqual([]);
    expect(dec.wpm).toBeCloseTo(22, -0.5);
    expect(feed(dec, marks.slice(cut))).toBe('YB1QRX DE 9M2SKA GM');
  });

  it('shows the words still being read as pending, after the text', () => {
    const sent = 'G3VTQ DE DL4MKX R R GE PETER UR RST 599 5NN';
    const dec = inPlace();
    let both = 0;
    let longest = 0;
    feed(dec, keyed([{ text: sent, wpm: 20 }]), {
      onTick: () => {
        // Written words are the start of what was sent; the words being read follow after a space.
        expect(sent.startsWith(dec.text)).toBe(true);
        if (dec.text && dec.pending) {
          both++;
          expect(dec.pending.startsWith(' ')).toBe(true);
        }
        longest = Math.max(longest, (dec.text + dec.pending).length);
      },
    });
    expect(both).toBeGreaterThan(10);
    expect(longest).toBe(sent.length);
  });

  it('runs the search through a queue when it answers later, with the same text', async () => {
    const marks = keyed([{ text: 'CQ CQ DE EI7HDK EI7HDK K', wpm: 20 }, { text: 'CT1EHK DE EI7HDK GM UR RST 569', wpm: 20, pause: 2 }]);
    const later: ChannelRead = (model, mk, until, keep, full, prefer) => new Promise((resolve) => setTimeout(() => resolve(Decoder.redecode(model, mk, until, keep, full, prefer)), 1));
    // Two channels share the queue, as on a busy band.
    const a = new ChannelDecoder({ read: later });
    const b = new ChannelDecoder({ read: later });
    feed(a, marks);
    feed(b, marks);
    for (let i = 0; i < 2000 && !(a.idle && b.idle); i++) await new Promise((r) => setTimeout(r, 5));
    const sync = feed(inPlace(), marks);
    expect(a.text).toBe(sync);
    expect(b.text).toBe(sync);
  });

  it('joins a mark a fade cut in two, once the speed is known', () => {
    const marks = keyed([{ text: 'TNX FER QSO 73 ES GL OM', wpm: 20 }]);
    const dit = 1.2 / 20;
    // Every third dah after the first 8 marks loses a third of a dit in its
    // middle. (Over the first 8 marks of an over, a silence that short might
    // be a gap inside a letter at a faster speed: only a fifth of a dit is
    // joined there, and a cut like this one reads as two marks.)
    let dahs = 0;
    const cut = marks.flatMap((m, i) => {
      if (i < 8 || m.end - m.start < 2 * dit || ++dahs % 3) return [m];
      const mid = (m.start + m.end) / 2;
      return [
        { start: m.start, end: mid - dit / 6 },
        { start: mid + dit / 6, end: m.end },
      ];
    });
    expect(cut.length).toBeGreaterThan(marks.length + 4);
    expect(feed(inPlace(), cut)).toBe('TNX FER QSO 73 ES GL OM');
  });

  it('writes nothing for clicks of static alone', () => {
    const dec = inPlace();
    let shown = '';
    feed(dec, noiseChannel(40, 0.5, 3), { onTick: () => (shown += dec.pending) });
    expect(dec.text).toBe('');
    expect(shown).toBe('');
  });

  it('reads clean machine-sent band scenarios without errors, a QSO on one channel too', () => {
    // The full scorecard (channel.score.test.ts) runs on request; these three guard the common case.
    for (const name of ['strong 30 wpm', 'QSO 12 Hz apart', 'broadcast 18/10']) {
      const sc = SCENARIOS.find((s) => s.name === name)!;
      const truth = renderBand(sc.band, 8000).truth;
      const out = channelsOf(truth, { merge: true }).map((c) => ({ pitch: c.pitch, text: feed(inPlace(), c.marks) }));
      const s = scoreBand(truth, out);
      expect(s.cer, name).toBe(0);
      expect(s.falseChars, name).toBe(0);
    }
  }, 300_000);

  it('fits dits and dahs from a few marks', () => {
    const marks = keyed([{ text: 'TNX', wpm: 24 }]);
    const f = fitSpeed(marks)!;
    expect(f.dit).toBeCloseTo(0.05, 3);
    expect(f.dah).toBeCloseTo(0.15, 3);
    expect(fitSpeed(keyed([{ text: 'EEE', wpm: 24 }]))).toBeNull();
  });

  it('keeps the search window and every list small over a long run', () => {
    // About 3 minutes of contest and QSO text at 28 wpm with pauses, and two long overs without a pause.
    const texts = [
      'CQ TEST OH6BVK OH6BVK TEST',
      'JA7KUD 5NN 15',
      'TU OH6BVK TEST',
      'SM5RYC DE ZS6WBK = R R FB ANNA SOLID CPY = UR SIG 599 IN PRETORIA BUT QSB AT TIMES = RIG IS A HOMEBREW 50W ES 3 EL YAGI = WX CLEAR ES COOL 9C = TNX FER NICE QSO ES HPE CU AGN ON 20M = 73 SM5RYC DE ZS6WBK <SK> TU',
    ];
    const parts: Part[] = [];
    for (let i = 0; i < 8; i++) parts.push({ text: texts[i % texts.length], wpm: 28, pause: 1.5 });
    const marks = keyed(parts);
    const sizes: number[] = [];
    const read: ChannelRead = (model, mk, until, keep, full, prefer) => {
      sizes.push(mk.length);
      return Decoder.redecode(model, mk, until, keep, full, prefer);
    };
    const dec = new ChannelDecoder({ read, inPlace: true });
    let most = 0;
    feed(dec, marks, { onMark: () => (most = Math.max(most, dec.footprint.marks)) });
    const T = channelTuning;
    // The window: written context, its slack, and the words not written yet.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(T.context + T.trimAfter + 60);
    expect(most).toBeLessThanOrEqual(T.context + T.trimAfter + 60);
    expect(dec.footprint.history).toBeLessThanOrEqual(64);
    // Searches per mark stay about the same from the first quarter to the last.
    expect(sizes.length / marks.length).toBeLessThan(0.5);
    expect((dec.text.match(/\n/g) ?? []).length + 1).toBe(dec.lines.length);
    expect(dec.text.endsWith('73 SM5RYC DE ZS6WBK <SK>\nTU')).toBe(true);
  }, 300_000);
});
