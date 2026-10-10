// The one AudioContext: CW playback, sidetone for the keyboard keyer, and the
// microphone feeding the detector worklet. Browsers only allow audio after a
// tap, so everything starts from `ensure()` inside a user gesture.

import workletUrl from './detector.worklet.ts?worker&url';
import type { WorkletCommand, WorkletMessage } from './detector.worklet';
import type { DetectorEvent } from '../dsp/detector';
import { renderSchedule, type Conditions } from '../morse/render';
import { buildSchedule, type FistOptions, type Schedule } from '../morse/schedule';

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

const BLUETOOTH = /bluetooth|airpods|hands-?free|headset|\bbt\b|hfp|buds/i;

class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sidetoneOsc: OscillatorNode | null = null;
  private sidetoneGain: GainNode | null = null;
  private mic: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private workletReady: Promise<void> | null = null;
  private listeners = new Set<Listener>();
  private spectrumWaiters: ((s: { hz: number[]; db: number[] }) => void)[] = [];
  private active = new Set<AudioBufferSourceNode>();
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;
  volume = 0.7;
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
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  /** Plays samples; the mic is muted while they play so the app cannot hear itself. */
  async play(samples: Float32Array, opts: { schedule?: Schedule; delay?: number } = {}): Promise<Playback> {
    const ctx = await this.ensure();
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master!);
    const startTime = ctx.currentTime + (opts.delay ?? 0.05);
    const duration = samples.length / ctx.sampleRate;
    this.muteInput(true);
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

  stopAll() {
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

  async startMic(deviceId?: string): Promise<MicInfo> {
    if (!this.micSupported) throw new Error('This browser only allows the microphone on a secure (https) page.');
    const ctx = await this.ensure();
    this.stopMic();
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
    if (!this.workletReady) this.workletReady = ctx.audioWorklet.addModule(workletUrl);
    await this.workletReady;
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

  stopMic() {
    this.micNode?.disconnect();
    this.worklet?.disconnect();
    this.worklet?.port.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.micNode = null;
    this.worklet = null;
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

  spectrum(): Promise<{ hz: number[]; db: number[] }> {
    return new Promise((resolve) => {
      if (!this.worklet) return resolve({ hz: [], db: [] });
      this.spectrumWaiters.push(resolve);
      this.command({ type: 'spectrum' });
    });
  }
}

export const engine = new AudioEngine();
