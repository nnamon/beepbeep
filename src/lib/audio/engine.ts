// The one AudioContext: CW playback, sidetone for the keyboard keyer, and the
// microphone feeding the detector worklet. Browsers only allow audio after a
// tap, so everything starts from `ensure()` inside a user gesture.
//
// The microphone feeds one detector at a time: the one for your own key
// (detector.worklet.ts), or while Radio listens, the Radio's detector of
// every signal (radio.worklet.ts).

import workletUrl from './detector.worklet.ts?worker&url';
import radioWorkletUrl from '../radio/radio.worklet.ts?worker&url';
import type { WorkletCommand, WorkletMessage } from './detector.worklet';
import type { RadioBatch, RadioCommand, RadioMessage } from '../radio/batch';
import type { DetectorEvent } from '../dsp/detector';
import { renderSchedule, type Conditions } from '../morse/render';
import { buildSchedule, type FistOptions, type Schedule } from '../morse/schedule';
import { reloadIfUpdated } from '../state/update';
import { writeWav } from '../util/wav';

export interface MicInfo {
  label: string;
  bluetooth: boolean;
  /** What the browser actually applied, which may ignore our request. */
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  sampleRate: number;
}

export interface Playback {
  /** Audio-clock time the first sample plays. */
  startTime: number;
  duration: number;
  schedule?: Schedule;
  done: Promise<void>;
  stop(): void;
}

export interface PlayTextOptions extends Conditions {
  charWpm: number;
  effectiveWpm?: number;
  pitch: number;
  fist?: FistOptions;
  volume?: number;
  seed?: number;
  /** Extra silence before the first mark, seconds. */
  leadIn?: number;
}

type Listener = (events: DetectorEvent[], time: number) => void;
type RadioListener = (batch: RadioBatch) => void;

const BLUETOOTH = /bluetooth|airpods|hands-?free|headset|\bbt\b|hfp|buds/i;

/** iPhone, iPod, or an iPad (which reports itself as a Mac with touch). */
export const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * iOS 17+ Audio Session API. 'playback' is not muted by the silent switch;
 * the mic needs 'play-and-record', which is not muted either.
 */
function setAudioSession(type: 'playback' | 'play-and-record'): boolean {
  const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!s) return false;
  try {
    s.type = type;
    return true;
  } catch {
    return false;
  }
}

class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sidetoneOsc: OscillatorNode | null = null;
  private sidetoneGain: GainNode | null = null;
  private mic: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  /** Worklet modules loaded or loading, by URL. */
  private modules = new Map<string, Promise<void>>();
  private listeners = new Set<Listener>();
  /** The Radio's detector, while Radio listens. */
  private radio: AudioWorkletNode | null = null;
  private radioListeners = new Set<RadioListener>();
  private radioSpectrumWaiters: ((s: { hz: number[]; db: number[] }) => void)[] = [];
  private spectrumWaiters: ((s: { hz: number[]; db: number[] }) => void)[] = [];
  private active = new Set<AudioBufferSourceNode>();
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;
  volume = 0.7;
  /** Mute the mic while the app plays, so it cannot decode itself. Off with headphones, for break-in. */
  muteWhilePlaying = true;
  /** What is playing now, for the optional visual cue. */
  cue: { start: number; marks: { start: number; end: number }[] } | null = null;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'AudioContext' in window;
  }

  get micSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get micActive(): boolean {
    return !!this.mic;
  }

  /** Creates or resumes the audio context. Call from a tap or key press. */
  async ensure(): Promise<AudioContext> {
    if (typeof navigator !== 'undefined') {
      if (!setAudioSession(this.mic ? 'play-and-record' : 'playback')) this.unlockOlderIos();
    }
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  private silentEl: HTMLAudioElement | null = null;

  /**
   * iOS before 17 has no Audio Session API. A media element playing silence
   * moves the page into the playback category, which the silent switch does
   * not mute; Web Audio then plays too. Started from the same tap as ensure().
   */
  private unlockOlderIos() {
    if (!IS_IOS || this.silentEl) return;
    const wav = writeWav(new Float32Array(4800), 48000);
    const el = new Audio(URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' })));
    el.loop = true;
    el.setAttribute('playsinline', '');
    void el.play().catch(() => undefined);
    this.silentEl = el;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) el.pause();
      else void el.play().catch(() => undefined);
    });
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  /** Plays samples; the mic is muted while they play (unless on headphones) so the app cannot hear itself. */
  async play(samples: Float32Array, opts: { schedule?: Schedule; delay?: number } = {}): Promise<Playback> {
    const ctx = await this.ensure();
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master!);
    const startTime = ctx.currentTime + (opts.delay ?? 0.05);
    const duration = samples.length / ctx.sampleRate;
    if (this.muteWhilePlaying) this.muteInput(true);
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    src.onended = () => {
      this.active.delete(src);
      if (!this.active.size) this.muteInput(false);
      resolve();
    };
    this.active.add(src);
    src.start(startTime);
    if (opts.schedule) this.cue = { start: startTime, marks: opts.schedule.marks };
    return {
      startTime,
      duration,
      schedule: opts.schedule,
      done,
      stop: () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      },
    };
  }

  /** Decodes a compressed clip (mp3) at the context's sample rate. */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = await this.ensure();
    return ctx.decodeAudioData(data);
  }

  /** Renders text to CW at the context's sample rate and plays it. */
  async playText(text: string, o: PlayTextOptions): Promise<Playback> {
    const ctx = await this.ensure();
    const schedule = buildSchedule(text, {
      charWpm: o.charWpm,
      effectiveWpm: o.effectiveWpm,
      fist: o.fist,
      leadIn: o.leadIn ?? 0.15,
      tail: 0.2,
    });
    const samples = renderSchedule(schedule, {
      ...o,
      sampleRate: ctx.sampleRate,
      pitch: o.pitch,
      amplitude: 0.45 * (o.volume ?? 1),
      seed: o.seed,
    });
    return this.play(samples, { schedule });
  }

  private stopHooks: (() => void)[] = [];

  /** Runs `fn` on every stopAll(), e.g. so speech stops with the code. */
  onStopAll(fn: () => void) {
    this.stopHooks.push(fn);
  }

  stopAll() {
    for (const fn of this.stopHooks) fn();
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
    this.muteInput(false);
  }

  private sidetoneNodes(ctx: AudioContext) {
    if (!this.sidetoneOsc) {
      this.sidetoneOsc = ctx.createOscillator();
      this.sidetoneGain = ctx.createGain();
      this.sidetoneGain.gain.value = 0;
      this.sidetoneOsc.connect(this.sidetoneGain).connect(this.master!);
      this.sidetoneOsc.start();
    }
    return { osc: this.sidetoneOsc, gain: this.sidetoneGain!.gain };
  }

  /** Sidetone for the straight key: a click-free gate on a running oscillator, now. */
  async sidetone(on: boolean, pitch: number) {
    const ctx = await this.ensure();
    const { osc, gain } = this.sidetoneNodes(ctx);
    osc.frequency.setValueAtTime(pitch, ctx.currentTime);
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setTargetAtTime(on ? 0.35 : 0, ctx.currentTime, 0.0015);
  }

  /** Schedules a sidetone element at exact audio-clock times (iambic keyer). */
  sidetoneElement(start: number, end: number, pitch: number) {
    if (!this.ctx) return;
    const { osc, gain } = this.sidetoneNodes(this.ctx);
    const s = Math.max(start, this.ctx.currentTime);
    osc.frequency.setValueAtTime(pitch, s);
    gain.setTargetAtTime(0.35, s, 0.0015);
    gain.setTargetAtTime(0, Math.max(end, s + 0.005), 0.0015);
  }

  private muteInput(muted: boolean) {
    if (this.unmuteTimer) {
      clearTimeout(this.unmuteTimer);
      this.unmuteTimer = null;
    }
    if (muted) this.command({ type: 'mute', muted: true });
    // Keep listening off a little longer so room echo of our own tone dies away.
    else this.unmuteTimer = setTimeout(() => this.command({ type: 'mute', muted: false }), 200);
  }

  /** A microphone start still waiting, often on the browser's permission prompt. */
  private micStarting: Promise<MicInfo> | null = null;

  /**
   * Opens the microphone (again, after stopping it: e.g. another device). A
   * call while a start is still waiting shares it: a second stream opened
   * then would replace the first, which would never be stopped.
   */
  startMic(deviceId?: string): Promise<MicInfo> {
    this.micStarting ??= this.openMic(deviceId).finally(() => (this.micStarting = null));
    return this.micStarting;
  }

  private async openMic(deviceId?: string): Promise<MicInfo> {
    if (!this.micSupported) throw new Error('This browser only allows the microphone on a secure (https) page.');
    const ctx = await this.ensure();
    this.stopMic();
    setAudioSession('play-and-record');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.mic = stream;
    await this.loadWorklet(ctx, workletUrl);
    this.worklet = new AudioWorkletNode(ctx, 'beepbeep-detector', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.worklet.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      const m = e.data;
      if (m.type === 'events') for (const l of this.listeners) l(m.events, m.time);
      else if (m.type === 'spectrum') {
        const waiters = this.spectrumWaiters;
        this.spectrumWaiters = [];
        for (const w of waiters) w({ hz: m.hz, db: m.db });
      } else if (m.type === 'pcm' && this.recording) {
        this.recording.chunks.push(m.data);
        this.recording.t0 ??= m.t0;
        if (m.last) this.recording.done?.();
      }
    };
    this.micNode = ctx.createMediaStreamSource(stream);
    this.micNode.connect(this.worklet);
    const track = stream.getAudioTracks()[0];
    const s = track.getSettings() as MediaTrackSettings & { autoGainControl?: boolean; noiseSuppression?: boolean };
    return {
      label: track.label || 'Microphone',
      bluetooth: BLUETOOTH.test(track.label),
      echoCancellation: typeof s.echoCancellation === 'boolean' ? s.echoCancellation : null,
      noiseSuppression: typeof s.noiseSuppression === 'boolean' ? s.noiseSuppression : null,
      autoGainControl: typeof s.autoGainControl === 'boolean' ? s.autoGainControl : null,
      sampleRate: ctx.sampleRate,
    };
  }

  /**
   * Loads a worklet's module once. A failure is not kept, so the next start
   * tries again. After an update the old build's worklet files are gone from
   * the server: the page reloads into the new build, and this never resolves.
   */
  private async loadWorklet(ctx: AudioContext, url: string): Promise<void> {
    let ready = this.modules.get(url);
    if (!ready) {
      ready = ctx.audioWorklet.addModule(url);
      this.modules.set(url, ready);
    }
    try {
      await ready;
    } catch (e) {
      this.modules.delete(url);
      if (reloadIfUpdated(true)) return new Promise<never>(() => {});
      throw e;
    }
  }

  stopMic() {
    this.stopRadio();
    this.micNode?.disconnect();
    this.worklet?.disconnect();
    this.worklet?.port.close();
    const hadMic = !!this.mic;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.micNode = null;
    this.worklet = null;
    if (hadMic) setAudioSession('playback');
  }

  async inputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  onEvents(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  command(c: WorkletCommand) {
    this.worklet?.port.postMessage(c);
  }

  private recording: { chunks: Float32Array[]; t0: number | null; done?: () => void } | null = null;

  /** Debug builds: records the raw microphone input the detector hears. */
  startRecording() {
    this.recording = { chunks: [], t0: null };
    this.command({ type: 'record', on: true });
  }

  /** The recording, and the detector time of its first sample. */
  stopRecording(): Promise<{ pcm: Float32Array; t0: number; sampleRate: number }> {
    const rec = this.recording;
    if (!rec || !this.worklet) {
      this.recording = null;
      return Promise.resolve({ pcm: new Float32Array(0), t0: 0, sampleRate: this.sampleRate });
    }
    return new Promise((resolve) => {
      rec.done = () => {
        this.recording = null;
        const n = rec.chunks.reduce((a, c) => a + c.length, 0);
        const pcm = new Float32Array(n);
        let at = 0;
        for (const c of rec.chunks) {
          pcm.set(c, at);
          at += c.length;
        }
        resolve({ pcm, t0: rec.t0 ?? 0, sampleRate: this.sampleRate });
      };
      this.command({ type: 'record', on: false });
    });
  }

  spectrum(): Promise<{ hz: number[]; db: number[] }> {
    return new Promise((resolve) => {
      if (!this.worklet) return resolve({ hz: [], db: [] });
      this.spectrumWaiters.push(resolve);
      this.command({ type: 'spectrum' });
    });
  }

  /** Loads the Radio's worklet, so `startRadio` can begin at once. Call from a tap. */
  async prepareRadio(): Promise<void> {
    const ctx = await this.ensure();
    await this.loadWorklet(ctx, radioWorkletUrl);
  }

  /**
   * The Radio's detector listens to the microphone, which must be on
   * (`startMic`); the detector for your own key hears nothing meanwhile. Its
   * batches go to `onRadio` listeners. Starting again begins a new detector.
   */
  async startRadio(): Promise<void> {
    const ctx = await this.ensure();
    await this.loadWorklet(ctx, radioWorkletUrl);
    if (!this.micNode) throw new Error('The microphone is off.');
    this.stopRadio();
    const node = new AudioWorkletNode(ctx, 'beepbeep-radio', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    node.port.onmessage = (e: MessageEvent<RadioMessage>) => {
      const m = e.data;
      if (m.type === 'events') for (const l of this.radioListeners) l(m);
      else if (m.type === 'spectrum') this.answerSpectrum({ hz: m.hz, db: m.db });
    };
    try {
      if (this.worklet) this.micNode.disconnect(this.worklet);
    } catch {
      /* not connected */
    }
    this.micNode.connect(node);
    this.radio = node;
  }

  /** The Radio's detector stops; the detector for your own key hears the microphone again. */
  stopRadio() {
    const node = this.radio;
    if (!node) return;
    this.radio = null;
    try {
      this.micNode?.disconnect(node);
    } catch {
      /* not connected */
    }
    node.port.close();
    if (this.micNode && this.worklet) this.micNode.connect(this.worklet);
    this.answerSpectrum({ hz: [], db: [] });
  }

  onRadio(l: RadioListener): () => void {
    this.radioListeners.add(l);
    return () => this.radioListeners.delete(l);
  }

  radioCommand(c: RadioCommand) {
    this.radio?.port.postMessage(c);
  }

  /** The Radio detector's spectrum (dB) over the band it searches; empty while it is not listening. */
  radioSpectrum(): Promise<{ hz: number[]; db: number[] }> {
    return new Promise((resolve) => {
      if (!this.radio) return resolve({ hz: [], db: [] });
      this.radioSpectrumWaiters.push(resolve);
      this.radioCommand({ type: 'spectrum' });
    });
  }

  private answerSpectrum(s: { hz: number[]; db: number[] }) {
    const waiters = this.radioSpectrumWaiters;
    this.radioSpectrumWaiters = [];
    for (const w of waiters) w(s);
  }
}

export const engine = new AudioEngine();
