// What the Radio screen keeps of each signal for Save: its text as it came
// in, with the time each piece arrived, so the saved file has times. Built
// only from what a RadioSource sends, so it works the same behind any source.

import type { RadioSignal } from './source';

/** Characters kept per signal for Save. */
export const TRANSCRIPT_KEEP = 100_000;

/** How a sound that is no character is written, on screen and in copied or saved text. */
export const UNREADABLE = '○';

/**
 * The text added at the end of `prev` to make `next`. A source drops the
 * oldest text from the front once it has kept enough, so `next` may begin
 * part way into `prev`. Null when `next` does not go on from `prev` (Clear).
 */
export function added(prev: string, next: string): string | null {
  if (next.startsWith(prev)) return next.slice(prev.length);
  // At most half of what was there is dropped at once; a smaller overlap is new text that only looks like it.
  for (let cut = Math.max(1, prev.length - next.length); cut <= prev.length / 2; cut++) {
    if (headOf(prev, cut, next)) return next.slice(prev.length - cut);
  }
  return null;
}

/** True when `prev` from `cut` on is the start of `next`. */
function headOf(prev: string, cut: number, next: string): boolean {
  const n = prev.length - cut;
  if (n > next.length) return false;
  for (let i = 0; i < n; i++) if (prev.charCodeAt(cut + i) !== next.charCodeAt(i)) return false;
  return true;
}

/** Text as people read it: unreadable sounds as a circle. Prosigns keep their brackets (<AR>). */
export function readable(text: string): string {
  return text.replaceAll('⁇', UNREADABLE);
}

/** Pieces of a line of decoded text, for showing it: prosigns are overlined, unreadable sounds marked. */
export type Part = { kind: 'text' | 'prosign' | 'unreadable'; text: string };

export function parts(line: string): Part[] {
  const out: Part[] = [];
  for (const bit of line.split(/(<[A-Z0-9]{2,}>|⁇)/)) {
    if (!bit) continue;
    if (bit === '⁇') out.push({ kind: 'unreadable', text: UNREADABLE });
    else if (bit.startsWith('<')) out.push({ kind: 'prosign', text: bit.slice(1, -1) });
    else out.push({ kind: 'text', text: bit });
  }
  return out;
}

/** The end of a signal's text on one line, about `max` characters, starting at a word. */
export function ending(s: Pick<RadioSignal, 'text' | 'pending'>, max = 60): string {
  const all = `${s.text} ${s.pending}`.replace(/\s+/g, ' ').trim();
  if (all.length <= max) return all;
  const cut = all.slice(-max);
  const at = cut.indexOf(' ');
  return at >= 0 && at < cut.length - 1 ? cut.slice(at + 1) : cut;
}

/** HH:MM on this device's clock. */
export function clockTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Piece {
  at: number;
  text: string;
}

interface Entry {
  pitch: number;
  wpm: number | null;
  first: number;
  pieces: Piece[];
  size: number;
  /** The source's text when last seen. */
  prev: string;
  pending: string;
  /** When the text still being read first showed. */
  startedAt: number | null;
}

export class Transcript {
  private entries = new Map<number, Entry>();

  /**
   * The signals as the source sent them, at `at` (Date.now()). Returns the
   * text each signal added since the last update, by id.
   */
  update(list: RadioSignal[], at: number): Map<number, string> {
    const out = new Map<number, string>();
    const seen = new Set<number>();
    for (const s of list) {
      seen.add(s.id);
      let e = this.entries.get(s.id);
      if (!e) {
        e = { pitch: s.pitch, wpm: s.wpm, first: at, pieces: [], size: 0, prev: '', pending: '', startedAt: null };
        this.entries.set(s.id, e);
      }
      e.pitch = s.pitch;
      e.wpm = s.wpm ?? e.wpm;
      if (s.pending && e.startedAt === null) e.startedAt = at;
      const more = added(e.prev, s.text);
      if (more === null) {
        // The source started this signal's text again.
        e.pieces = s.text ? [{ at, text: s.text }] : [];
        e.size = s.text.length;
      } else if (more) {
        e.pieces.push({ at: e.startedAt ?? at, text: more });
        e.size += more.length;
        e.startedAt = s.pending ? at : null;
        out.set(s.id, more);
        while (e.size > TRANSCRIPT_KEEP && e.pieces.length > 1) e.size -= e.pieces.shift()!.text.length;
      }
      e.prev = s.text;
      e.pending = s.pending;
    }
    // A signal the source no longer tracks: its text is kept, but nothing more is being read.
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      e.pending = '';
      e.startedAt = null;
    }
    return out;
  }

  clear() {
    this.entries.clear();
  }

  /** Characters kept, every signal, the text still being read included. */
  get size(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.size + e.pending.length;
    return n;
  }

  /** Signals with any text. */
  get signals(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.size || e.pending) n++;
    return n;
  }

  /** The text of every signal, oldest first, each line with the time it started. */
  file(saved: Date): string {
    const day = saved.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const out = ['BeepBeep Radio', `Saved on ${day} at ${clockTime(saved)}. Times are this device's local time.`];
    const entries = [...this.entries.values()].filter((e) => e.size || e.pending).sort((a, b) => a.first - b.first);
    if (!entries.length) out.push('', 'No signals were heard.');
    for (const e of entries) {
      const speed = e.wpm ? `${Math.round(e.wpm)} wpm` : 'speed not measured';
      out.push('', `Signal at ${Math.round(e.pitch)} Hz, ${speed}, first heard at ${clockTime(new Date(e.first))}`);
      const pieces = e.pending ? [...e.pieces, { at: e.startedAt ?? saved.getTime(), text: e.pending }] : e.pieces;
      let line = '';
      let lineAt = 0;
      const end = () => {
        if (line.trim()) out.push(`${clockTime(new Date(lineAt))}  ${readable(line.trim())}`);
        line = '';
      };
      for (const p of pieces) {
        for (const ch of p.text) {
          if (ch === '\n') {
            end();
            continue;
          }
          if (!line) lineAt = p.at;
          line += ch;
        }
      }
      end();
    }
    return `${out.join('\n')}\n`;
  }
}

/** The saved file's name, from the time it is saved: beepbeep-radio-2026-10-13-1405.txt. */
export function fileName(saved: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `beepbeep-radio-${saved.getFullYear()}-${two(saved.getMonth() + 1)}-${two(saved.getDate())}-${two(saved.getHours())}${two(saved.getMinutes())}.txt`;
}
