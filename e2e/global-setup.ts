// Writes the CW fixtures the fake microphone plays: PARIS at 20 wpm, 650 Hz;
// and for the README images, a hand-keyed CQ at 600 Hz in a room with a fan
// and someone talking.
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderText } from '../src/lib/morse/render';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { writeWav } from '../src/lib/util/wav';

export default function setup() {
  const fs = 48000;
  const { samples } = renderText('PARIS PARIS PARIS PARIS', { sampleRate: fs, pitch: 650, amplitude: 0.5, charWpm: 20, noise: { snrDb: 25 } });
  mkdirSync(new URL('./.fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./.fixtures/paris.wav', import.meta.url), writeWav(samples, fs));

  const cq = renderText('VVV CQ CQ DE K1ABC K', { sampleRate: fs, pitch: 600, amplitude: 0.25, charWpm: 16, fist: { jitter: 0.08, charGapScale: 1.15, wordGapScale: 1.1, seed: 3 } }).samples;
  const room = new Float32Array(cq.length + Math.round(4 * fs));
  room.set(cq, Math.round(1.5 * fs));
  const fan = roomNoise('fan', room.length / fs, fs, 0.03, 4);
  const talk = roomNoise('speech', room.length / fs, fs, 0.03, 5);
  for (let i = 0; i < room.length; i++) room[i] += fan[i] + talk[i];
  writeFileSync(new URL('./.fixtures/room-cq.wav', import.meta.url), writeWav(room, fs));
}
