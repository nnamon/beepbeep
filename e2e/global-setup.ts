// Writes the CW fixture the fake microphone plays: PARIS at 20 wpm, 650 Hz.
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderText } from '../src/lib/morse/render';
import { writeWav } from '../src/lib/util/wav';

export default function setup() {
  const fs = 48000;
  const { samples } = renderText('PARIS PARIS PARIS PARIS', { sampleRate: fs, pitch: 650, amplitude: 0.5, charWpm: 20, noise: { snrDb: 25 } });
  mkdirSync(new URL('./.fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./.fixtures/paris.wav', import.meta.url), writeWav(samples, fs));
}
