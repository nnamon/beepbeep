// Spoken answers. Built-in clips (public/voice/, made by scripts/voice_clips.py)
// cover every character and prosign and play through the audio engine, so they
// work offline and mute the decoder input like any other app sound. Words and
// anything without a clip use the device voice. Recorded clips override both.

import { isProsign, displayToken } from '../morse/code';
import { voiceClip } from '../state/db';
import { settings } from '../state/settings.svelte';
import { engine, type Playback } from './engine';

const NAMES: Record<string, string> = {
  '.': 'period', ',': 'comma', '?': 'question mark', "'": 'apostrophe', '!': 'exclamation',
  '/': 'slash', ')': 'close bracket', ':': 'colon', ';': 'semicolon', '-': 'dash', '_': 'underscore',
  '"': 'quote', '@': 'at', '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
};

/** How a token is said aloud: letters spelled, prosigns as their letters. */
export function spoken(token: string): string {
  if (isProsign(token)) return displayToken(token).split('').join(' ');
  if (NAMES[token]) return NAMES[token];
  return token.length === 1 ? token : token.toLowerCase();
}

/** File name (without .mp3) of the built-in clip for a token, or null for words. */
export function clipName(token: string): string | null {
  if (isProsign(token)) return `prosign-${displayToken(token)}`;
  if (/^[A-Z0-9]$/.test(token)) return token;
  return NAMES[token]?.replaceAll(' ', '-') ?? null;
}

let current: HTMLAudioElement | null = null;
let currentClip: Playback | null = null;
const clips = new Map<string, Promise<AudioBuffer | null>>();

function builtin(name: string): Promise<AudioBuffer | null> {
  let p = clips.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}voice/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => engine.decode(b))
      .catch(() => {
        clips.delete(name);
        return null;
      });
    clips.set(name, p);
  }
  return p;
}

async function playClip(buf: AudioBuffer): Promise<void> {
  currentClip?.stop();
  const pb = await engine.play(buf.getChannelData(0), { delay: 0.01 });
  currentClip = pb;
  await pb.done;
}

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function voices(): SpeechSynthesisVoice[] {
  if (!speechAvailable()) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
}

/** Says a single token or a word. Resolves when done (or immediately if voice is off). */
export async function say(tokenOrWord: string): Promise<void> {
  if (settings.voice === 'off') return;
  if (settings.voice === 'recorded') {
    const blob = await voiceClip(tokenOrWord).catch(() => null);
    if (blob) return playBlob(blob);
  }
  const name = settings.voice === 'system' ? null : clipName(tokenOrWord);
  if (name) {
    const buf = await builtin(name);
    if (buf) return playClip(buf);
  }
  if (!speechAvailable()) return;
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(spoken(tokenOrWord));
    const v = voices().find((x) => x.voiceURI === settings.voiceURI);
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
    // Some browsers never fire onend; don't hang the drill.
    setTimeout(resolve, 2500);
  });
}

function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    current?.pause();
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    current = a;
    a.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    a.onerror = () => resolve();
    void a.play().catch(() => resolve());
  });
}

export function stopSpeech() {
  if (speechAvailable()) speechSynthesis.cancel();
  current?.pause();
  currentClip?.stop();
}
