// Writes the CW fixtures the fake microphone plays: PARIS at 20 wpm, 650 Hz;
// for Radio, three stations sending at the same time at three pitches, and two
// stations 150 Hz apart sending at the same time, as a radio would hear them;
// and for the README images, a hand-keyed CQ at 600 Hz in a room with a fan
// and someone talking.
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderText } from '../src/lib/morse/render';
import { REF_AMP, renderBand } from '../src/lib/radio/band';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { writeWav } from '../src/lib/util/wav';

/** What the Radio fixtures send, for the tests: pitch, speed and text. */
export const RADIO_BAND = [
  { pitch: 600, wpm: 20, text: 'CQ CQ DE 9V1NE 9V1NE K', at: 1 },
  { pitch: 780, wpm: 24, text: 'VK2BHF DE G4ABC UR 599 599 K', at: 1.8 },
  { pitch: 500, wpm: 18, text: 'CQ CQ CQ DE JA1XYZ JA1XYZ K', at: 2.6 },
];
export const RADIO_PAIR = [
  { pitch: 650, wpm: 20, text: 'CQ CQ DE ZL1RTE ZL1RTE K', at: 1 },
  { pitch: 800, wpm: 16, text: 'JA7KUD DE PY2WQS UR 579 K', at: 1.2 },
];

/**
 * Stations sending at the same time through a receiver's audio filter, with 3
 * seconds of quiet before the file plays again; each station peaks at 0.25 of
 * full scale, so together they never clip.
 */
function radio(stations: typeof RADIO_BAND, seed: number): Float32Array {
  const band = { stations: stations.map((s, i) => ({ name: `S${i}`, pitch: s.pitch, wpm: s.wpm, sends: [{ text: s.text, at: s.at }] })), noise: { snrDb: 30 }, passband: [300, 2700] as [number, number], seed };
  const { truth } = renderBand(band, 8000);
  const end = Math.max(...truth.map((t) => t.marks[t.marks.length - 1].end));
  const { samples } = renderBand({ ...band, seconds: end + 3 }, 48000);
  const gain = 0.25 / REF_AMP;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

export default function setup() {
  const fs = 48000;
  const { samples } = renderText('PARIS PARIS PARIS PARIS', { sampleRate: fs, pitch: 650, amplitude: 0.5, charWpm: 20, noise: { snrDb: 25 } });
  mkdirSync(new URL('./.fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./.fixtures/paris.wav', import.meta.url), writeWav(samples, fs));

  // Radio: three stations at once, each at its own pitch and speed; and two 150 Hz apart.
  writeFileSync(new URL('./.fixtures/radio-band.wav', import.meta.url), writeWav(radio(RADIO_BAND, 5), fs));
  writeFileSync(new URL('./.fixtures/radio-pair.wav', import.meta.url), writeWav(radio(RADIO_PAIR, 6), fs));

  const cq = renderText('VVV CQ CQ DE K1ABC K', { sampleRate: fs, pitch: 600, amplitude: 0.25, charWpm: 16, fist: { jitter: 0.08, charGapScale: 1.15, wordGapScale: 1.1, seed: 3 } }).samples;
  const room = new Float32Array(cq.length + Math.round(4 * fs));
  room.set(cq, Math.round(1.5 * fs));
  const fan = roomNoise('fan', room.length / fs, fs, 0.03, 4);
  const talk = roomNoise('speech', room.length / fs, fs, 0.03, 5);
  for (let i = 0; i < room.length; i++) room[i] += fan[i] + talk[i];
  writeFileSync(new URL('./.fixtures/room-cq.wav', import.meta.url), writeWav(room, fs));
}
