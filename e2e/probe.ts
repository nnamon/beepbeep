// Test helpers that watch the page from inside: every sound it plays (decoded
// back to text), keyboard listeners, wake locks and microphone streams. Also
// keying on the Space bar, the touch key and paddles with exact timing.
import type { Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';

/** Settings saved before the app first loads (a reload keeps what the app saved since). */
export async function settings(page: Page, s: Record<string, unknown>) {
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('probe.settings')) {
      localStorage.setItem('beepbeep.settings.v1', JSON.stringify(s));
      sessionStorage.setItem('probe.settings', '1');
    }
  }, s);
}

/**
 * Instruments the page before the app loads:
 *  - every AudioBufferSourceNode.start() is logged with the route it happened on and
 *    the Morse it contains (decoded from the samples), or kind 'voice' for spoken clips;
 *  - window keydown/keyup listeners are tracked (to catch leaked keyers);
 *  - navigator.wakeLock is stubbed and its requests/releases logged;
 *  - getUserMedia can be made to fail or wait (window.__gum = { fail?: name, delayMs?: n }).
 */
export async function instrument(page: Page, opts: { gumFail?: string; gumDelayMs?: number } = {}) {
  const code: Record<string, string> = {};
  for (const t of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?/\'-()@:'.split('')) {
    const p = patternOf(t);
    if (p) code[p] = t;
  }
  for (const t of ['<AR>', '<SK>', '<BT>', '<KN>', '<BK>']) code[patternOf(t)!] = t;
  await page.addInitScript(
    ({ code, opts }) => {
      const w = window as unknown as Record<string, unknown> & { __audio: unknown[]; __wake: string[]; __keyListeners: Set<unknown> };
      w.__audio = [];
      w.__wake = [];
      w.__keyListeners = new Set();
      const clipLens = new Set<number>();
      const odec = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (this: AudioContext, ...a: unknown[]) {
        const p = (odec as (...x: unknown[]) => Promise<AudioBuffer>).apply(this, a);
        return p.then((b) => {
          clipLens.add(b.length);
          return b;
        });
      } as typeof odec;
      const decode = (x: Float32Array, sr: number): string => {
        const win = Math.round(sr * 0.003);
        const marks: [number, number][] = [];
        let last = -1e9;
        let on = false;
        let start = 0;
        for (let i = 0; i < x.length; i++) {
          if (Math.abs(x[i]) > 0.06) last = i;
          const now = i - last < win;
          if (now && !on) {
            on = true;
            start = i;
          } else if (!now && on) {
            on = false;
            marks.push([start / sr, (i - win) / sr]);
          }
        }
        if (on) marks.push([start / sr, x.length / sr]);
        if (!marks.length) return '';
        const lens = marks.map(([a, b]) => b - a);
        const mn = Math.min(...lens);
        const mx = Math.max(...lens);
        const dit0 = (w.__dit as number) ?? 0.06;
        const thr = mx / mn > 2 ? Math.sqrt(mn * mx) : dit0 * 2;
        const dits = lens.filter((l) => l < thr);
        const u = dits.length ? dits.reduce((a, b) => a + b, 0) / dits.length : lens.reduce((a, b) => a + b, 0) / lens.length / 3;
        let out = '';
        let pat = '';
        for (let k = 0; k < marks.length; k++) {
          if (k) {
            const gap = marks[k][0] - marks[k - 1][1];
            if (gap > 2 * u) {
              out += code[pat] ?? '#';
              pat = '';
              if (gap > 5.5 * u) out += ' ';
            }
          }
          pat += lens[k] < thr ? '.' : '-';
        }
        out += code[pat] ?? '#';
        return out;
      };
      const ostart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: unknown[]) {
        const b = this.buffer;
        let text = '';
        let kind = 'cw';
        if (b) {
          if (clipLens.has(b.length)) kind = 'voice';
          else {
            try {
              text = decode(b.getChannelData(0), b.sampleRate);
            } catch {
              text = '?';
            }
          }
        }
        w.__audio.push({ at: Math.round(performance.now()), hash: location.hash, dur: b ? +(b.duration.toFixed(2)) : 0, kind, text });
        this.addEventListener('ended', () => ((w.__ended as number[]) ??= []).push(Math.round(performance.now())));
        return (ostart as (...x: unknown[]) => void).apply(this, a);
      } as typeof ostart;
      w.__tone = [];
      const ostt = AudioParam.prototype.setTargetAtTime;
      AudioParam.prototype.setTargetAtTime = function (this: AudioParam, v: number, t: number, c: number) {
        if (v === 0.35) (w.__tone as unknown[]).push({ at: Math.round(performance.now()), hash: location.hash });
        return ostt.call(this, v, t, c);
      } as typeof ostt;
      const oadd = window.addEventListener;
      const orem = window.removeEventListener;
      window.addEventListener = function (this: Window, type: string, fn: unknown, o?: unknown) {
        if (type === 'keydown') w.__keyListeners.add(fn);
        return (oadd as (...x: unknown[]) => void).call(this, type, fn, o);
      } as typeof oadd;
      window.removeEventListener = function (this: Window, type: string, fn: unknown, o?: unknown) {
        if (type === 'keydown') w.__keyListeners.delete(fn);
        return (orem as (...x: unknown[]) => void).call(this, type, fn, o);
      } as typeof orem;
      try {
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: {
            request: async () => {
              w.__wake.push('request@' + location.hash);
              const et = new EventTarget() as EventTarget & { release: () => Promise<void>; released: boolean };
              et.released = false;
              et.release = async () => {
                w.__wake.push('release@' + location.hash);
                et.released = true;
                et.dispatchEvent(new Event('release'));
              };
              return et;
            },
          },
        });
      } catch {
        /* ignore */
      }
      w.__streams = [];
      {
        const md0 = navigator.mediaDevices;
        const g0 = md0?.getUserMedia?.bind(md0);
        if (md0 && g0) {
          md0.getUserMedia = async (c?: MediaStreamConstraints) => {
            const st = await g0(c);
            (w.__streams as MediaStream[]).push(st);
            return st;
          };
        }
      }
      if (opts.gumFail || opts.gumDelayMs) {
        const md = navigator.mediaDevices;
        const orig = md?.getUserMedia?.bind(md);
        if (md) {
          md.getUserMedia = async (c?: MediaStreamConstraints) => {
            w.__gumCalls = ((w.__gumCalls as number) ?? 0) + 1;
            if (opts.gumDelayMs) await new Promise((r) => setTimeout(r, opts.gumDelayMs));
            if (opts.gumFail) throw new DOMException('denied', opts.gumFail);
            return orig!(c);
          };
        }
      }
    },
    { code, opts },
  );
}

export interface Played {
  at: number;
  hash: string;
  dur: number;
  kind: string;
  text: string;
}

export const played = (page: Page) => page.evaluate(() => (window as unknown as { __audio: Played[] }).__audio);
export const keyListeners = (page: Page) => page.evaluate(() => (window as unknown as { __keyListeners: Set<unknown> }).__keyListeners.size);
export const tones = (page: Page) => page.evaluate(() => (window as unknown as { __tone: { at: number; hash: string }[] }).__tone);
export const liveTracks = (page: Page) => page.evaluate(() => ((window as unknown as { __streams: MediaStream[] }).__streams ?? []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
export const wake = (page: Page) => page.evaluate(() => (window as unknown as { __wake: string[] }).__wake);

export async function sessions(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase | null = await new Promise((res, rej) => {
      const r = indexedDB.open('beepbeep', 1);
      // Read only: before the app has made its database, don't make an empty one in its place.
      r.onupgradeneeded = () => r.transaction!.abort();
      r.onsuccess = () => res(r.result);
      r.onerror = () => (r.error?.name === 'AbortError' ? res(null) : rej(r.error));
    });
    if (!db) return [];
    if (!db.objectStoreNames.contains('sessions')) {
      db.close();
      return [];
    }
    const all: Record<string, unknown>[] = await new Promise((res) => {
      const q = db.transaction('sessions').objectStore('sessions').getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return all;
  });
}

function schedule(text: string, wpm: number, wordGapDits = 7): [number, boolean][] {
  const dit = 1200 / wpm;
  const events: [number, boolean][] = [];
  let t = 150;
  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      t += dit * (wordGapDits - 3);
      continue;
    }
    for (const el of patternOf(tok)!) {
      events.push([t, true]);
      t += el === '.' ? dit : dit * 3;
      events.push([t, false]);
      t += dit;
    }
    t += dit * 2;
  }
  return events;
}

/** Keys text on the Space-bar straight key, timed inside the page. */
export async function keySpace(page: Page, text: string, wpm = 15) {
  return page.evaluate(async (evs) => {
    const t0 = performance.now();
    let late = 0;
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      late = Math.max(late, performance.now() - (t0 + at));
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    }
    return Math.round(late);
  }, schedule(text, wpm));
}

/** Keys text on the on-screen touch key pad with pointer events, timed inside the page. */
export async function keyTouch(page: Page, text: string, wpm = 15) {
  return page.evaluate(async (evs) => {
    const el = document.querySelector('.pad')!;
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true });
    const t0 = performance.now();
    let late = 0;
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      late = Math.max(late, performance.now() - (t0 + at));
      el.dispatchEvent(ev(down ? 'pointerdown' : 'pointerup'));
    }
    return Math.round(late);
  }, schedule(text, wpm));
}

/** Iambic paddle keying: holds dit/dah keys per element (keyer times them). */
export async function keyPaddle(page: Page, text: string, wpm = 15) {
  const dit = 1200 / wpm;
  const evs: [number, string, boolean][] = [];
  let t = 150;
  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      t += dit * 4;
      continue;
    }
    for (const el of patternOf(tok)!) {
      const code = el === '.' ? 'BracketLeft' : 'BracketRight';
      evs.push([t, code, true]);
      // release half way through the element so the keyer sends exactly one
      evs.push([t + dit * 0.5, code, false]);
      t += (el === '.' ? dit : dit * 3) + dit;
    }
    t += dit * 2;
  }
  await page.evaluate(async (evs) => {
    const t0 = performance.now();
    for (const [at, code, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'BracketLeft' ? '[' : ']', bubbles: true, cancelable: true }));
    }
  }, evs);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  return errors;
}

export const BASE = { voice: 'off', guideSeen: true, licwAsked: true, charWpm: 20, effectiveWpm: 20, humanFist: false };
