// Spoken answers: your own recorded clips when you have made them, otherwise
// the device's built-in voice (works offline on phones and desktops).

import { isProsign, displayToken } from '../morse/code';
import { voiceClip } from '../state/db';
import { settings } from '../state/settings.svelte';

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

let current: HTMLAudioElement | null = null;

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
}
