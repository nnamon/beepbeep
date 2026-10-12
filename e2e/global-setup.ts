// Writes the CW fixtures the fake microphone plays: PARIS at 20 wpm, 650 Hz;
// three stations in turn at three pitches, as a radio would hear them; and
// for the README images, a hand-keyed CQ at 600 Hz in a room with a fan and
// someone talking.
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderText } from '../src/lib/morse/render';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { writeWav } from '../src/lib/util/wav';

export default function setup() {
  const fs = 48000;
  const { samples } = renderText('PARIS PARIS PARIS PARIS', { sampleRate: fs, pitch: 650, amplitude: 0.5, charWpm: 20, noise: { snrDb: 25 } });
  mkdirSync(new URL('./.fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./.fixtures/paris.wav', import.meta.url), writeWav(samples, fs));

  // Radio: three stations, one after another, each at its own pitch and speed.
  const stations = [
    { text: 'CQ CQ DE 9V1NE 9V1NE K', pitch: 600, charWpm: 20 },
    { text: '9V1NE DE G4ABC G4ABC UR 599 599 K', pitch: 780, charWpm: 24 },
    { text: 'CQ CQ CQ DE JA1XYZ JA1XYZ K', pitch: 500, charWpm: 18 },
  ].map((s) => renderText(s.text, { sampleRate: fs, pitch: s.pitch, amplitude: 0.4, charWpm: s.charWpm, noise: { snrDb: 30 }, seed: 5 }).samples);
  const gap = Math.round(2.5 * fs);
  const bandLength = stations.reduce((a, x) => a + x.length + gap, gap);
  const band = new Float32Array(bandLength);
  let at = gap;
  for (const x of stations) {
    band.set(x, at);
    at += x.length + gap;
  }
  writeFileSync(new URL('./.fixtures/radio-band.wav', import.meta.url), writeWav(band, fs));

  const cq = renderText('VVV CQ CQ DE K1ABC K', { sampleRate: fs, pitch: 600, amplitude: 0.25, charWpm: 16, fist: { jitter: 0.08, charGapScale: 1.15, wordGapScale: 1.1, seed: 3 } }).samples;
  const room = new Float32Array(cq.length + Math.round(4 * fs));
  room.set(cq, Math.round(1.5 * fs));
  const fan = roomNoise('fan', room.length / fs, fs, 0.03, 4);
  const talk = roomNoise('speech', room.length / fs, fs, 0.03, 5);
  for (let i = 0; i < room.length; i++) room[i] += fan[i] + talk[i];
  writeFileSync(new URL('./.fixtures/room-cq.wav', import.meta.url), writeWav(room, fs));
}
