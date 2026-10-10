// Writes the CW fixture the fake microphone plays: PARIS at 20 wpm, 650 Hz.
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderText } from '../src/lib/morse/render';

export default function setup() {
  const fs = 48000;
  const { samples } = renderText('PARIS PARIS PARIS PARIS', { sampleRate: fs, pitch: 650, amplitude: 0.5, charWpm: 20, noise: { snrDb: 25 } });
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(fs, 24);
  h.writeUInt32LE(fs * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  mkdirSync(new URL('./.fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./.fixtures/paris.wav', import.meta.url), Buffer.concat([h, data]));
}
