// The Radio screen's transcript: text as it arrives, with times, for Save.

import { describe, expect, it } from 'vitest';
import { Transcript, added, ending, fileName, parts, readable } from './transcript';
import type { RadioSignal } from './source';

const sig = (id: number, text: string, pending = '', pitch = 652, wpm: number | null = 20): RadioSignal => ({
  id,
  pitch,
  wpm,
  snr: 30,
  keying: false,
  lastHeard: 0,
  text,
  pending,
});

/** Local time on 13 October 2026. */
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 13, h, m, s).getTime();

describe('added', () => {
  it('finds text added at the end', () => {
    expect(added('', 'CQ CQ\n')).toBe('CQ CQ\n');
    expect(added('CQ CQ\n', 'CQ CQ\nDE 9V1NE\n')).toBe('DE 9V1NE\n');
    expect(added('CQ CQ\n', 'CQ CQ\n')).toBe('');
  });

  it('allows for the oldest text dropped from the front', () => {
    const prev = 'CQ CQ DE 9V1NE K\nQRZ DE 9V1NE K\n';
    const next = 'DE 9V1NE K\nQRZ DE 9V1NE K\nG4ABC DE 9V1NE\n';
    expect(added(prev, next)).toBe('G4ABC DE 9V1NE\n');
  });

  it('says when the text started again', () => {
    expect(added('CQ CQ DE 9V1NE K\n', '')).toBeNull();
    expect(added('CQ CQ DE 9V1NE K\n', 'TEST\n')).toBeNull();
    // A last letter that happens to match is no continuation.
    expect(added('CQ CQ DE 9V1NE K', 'K1ABC')).toBeNull();
  });
});

describe('Transcript', () => {
  it('stamps each over with the time it began to show', () => {
    const t = new Transcript();
    t.update([sig(1, '', 'CQ')], at(14, 1));
    t.update([sig(1, '', 'CQ CQ DE 9V1NE K')], at(14, 1, 20));
    const got = t.update([sig(1, 'CQ CQ DE 9V1NE K\n')], at(14, 2, 5));
    expect(got.get(1)).toBe('CQ CQ DE 9V1NE K\n');
    t.update([sig(1, 'CQ CQ DE 9V1NE K\n', 'QRZ')], at(14, 3));
    expect(t.file(new Date(at(14, 5)))).toBe(
      [
        'BeepBeep Radio',
        "Saved on 13 October 2026 at 14:05. Times are this device's local time.",
        '',
        'Signal at 652 Hz, 20 wpm, first heard at 14:01',
        '14:01  CQ CQ DE 9V1NE K',
        '14:03  QRZ',
        '',
      ].join('\n'),
    );
  });

  it('keeps every signal, oldest first, with what a beginner can read', () => {
    const t = new Transcript();
    t.update([sig(1, 'CQ CQ DE 9V1NE K\n')], at(9, 0));
    t.update([sig(2, '9V1NE DE JA1ABC <KN>\n', '', 701, null), sig(1, 'CQ CQ DE 9V1NE K\n')], at(9, 1));
    t.update([sig(2, '9V1NE DE JA1ABC <KN>\nR R ⁇ 73\n', '', 701, null), sig(1, 'CQ CQ DE 9V1NE K\n')], at(9, 2));
    expect(t.signals).toBe(2);
    const file = t.file(new Date(at(9, 3)));
    expect(file).toContain('Signal at 652 Hz, 20 wpm, first heard at 09:00\n09:00  CQ CQ DE 9V1NE K\n');
    expect(file).toContain('Signal at 701 Hz, speed not measured, first heard at 09:01\n09:01  9V1NE DE JA1ABC <KN>\n09:02  R R ○ 73\n');
    expect(file.indexOf('652 Hz')).toBeLessThan(file.indexOf('701 Hz'));
  });

  it('keeps a long over on one line when it is written in parts', () => {
    const t = new Transcript();
    t.update([sig(1, '', 'PARIS PARIS')], at(10, 0));
    t.update([sig(1, 'PARIS PARIS ', 'PARIS')], at(10, 1));
    t.update([sig(1, 'PARIS PARIS PARIS\n')], at(10, 2));
    expect(t.file(new Date(at(10, 3)))).toContain('\n10:00  PARIS PARIS PARIS\n');
  });

  it('goes on after the source drops its oldest text', () => {
    const t = new Transcript();
    t.update([sig(1, 'AAA BBB\n')], at(10, 0));
    t.update([sig(1, 'BBB\nCCC\n')], at(10, 1));
    const file = t.file(new Date(at(10, 2)));
    expect(file).toContain('10:00  AAA BBB\n10:01  CCC\n');
    expect(t.size).toBe('AAA BBB\nCCC\n'.length);
  });

  it('forgets everything on Clear', () => {
    const t = new Transcript();
    t.update([sig(1, 'CQ\n', 'DE')], at(10, 0));
    expect(t.size).toBe(5);
    t.clear();
    expect(t.size).toBe(0);
    expect(t.signals).toBe(0);
    expect(t.file(new Date(at(10, 1)))).toContain('No signals were heard.');
  });

  it('stops showing text still being read once the source lets a signal go', () => {
    const t = new Transcript();
    t.update([sig(1, 'CQ\n', 'DE')], at(10, 0));
    t.update([], at(10, 1));
    expect(t.size).toBe(3);
    expect(t.file(new Date(at(10, 2)))).not.toContain('DE');
  });
});

describe('showing text', () => {
  it('marks prosigns and unreadable sounds', () => {
    expect(parts('R R <AR> ⁇ 73')).toEqual([
      { kind: 'text', text: 'R R ' },
      { kind: 'prosign', text: 'AR' },
      { kind: 'text', text: ' ' },
      { kind: 'unreadable', text: '○' },
      { kind: 'text', text: ' 73' },
    ]);
    expect(readable('R ⁇ <SK>')).toBe('R ○ <SK>');
  });

  it('shows the end of a signal on one line, from a word', () => {
    expect(ending({ text: 'CQ CQ\nDE 9V1NE\n', pending: 'K' })).toBe('CQ CQ DE 9V1NE K');
    expect(ending({ text: 'CQ CQ CQ DE 9V1NE 9V1NE K\n', pending: '' }, 12)).toBe('9V1NE K');
  });

  it('names the file by when it was saved', () => {
    expect(fileName(new Date(2026, 9, 3, 9, 5))).toBe('beepbeep-radio-2026-10-03-0905.txt');
  });
});
