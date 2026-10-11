<script lang="ts">
  // Debug server only: records what the detector hears, with what it made of
  // it, and saves both into samples/ on the machine serving the app.
  import { onDestroy, onMount } from 'svelte';
  import Button from './Button.svelte';
  import Segmented from './Segmented.svelte';
  import { engine } from '../lib/audio/engine';
  import { LiveDecoder } from '../lib/audio/live';
  import { settings } from '../lib/state/settings.svelte';
  import { signal } from '../lib/state/signal.svelte';
  import { saved, upload, wav } from '../lib/debug/samples';
  import type { DetectorEvent } from '../lib/dsp/detector';

  type Kind = 'noise' | 'keying' | 'keying-noise' | 'playback';
  type Hand = 'steady' | 'hand';
  type PitchChoice = 'mine' | 'random';

  // Playback: the app keys a known text through the speaker while recording,
  // so the take carries its exact keying. Any place, no keying needed.
  let playText = $state('CQ CQ DE K1ABC K PARIS VVV');
  let playWpm = $state(15);
  let playHand = $state<Hand>('hand');
  // Random: 400–1000 Hz, so the takes cover other people's sidetones, not just this one.
  let playPitch = $state<PitchChoice>('mine');
  /** The detector was pinned to the take's pitch; the user's pin goes back at stop. */
  let repinned = false;
  let playback: { text: string; wpm: number; hand: Hand; pitch: number; seed: number; startCtx: number; recStartCtx: number; marks: { start: number; end: number }[] } | null = null;

  let kind = $state<Kind>('noise');
  let keyed = $state('');
  let notes = $state('');
  let recording = $state(false);
  let seconds = $state(0);
  let decoded = $state('');
  let status = $state('');
  let files = $state<string[]>([]);

  // The recordings that help most, in order. The text is short; the room is what is being recorded.
  const TAKES: { id: string; title: string; how: string; kind: Kind; keyed: string; notes: string }[] = [
    { id: 't1', title: 'Quiet keying', how: 'Quiet room, your normal speed.', kind: 'keying', keyed: 'CQ CQ DE', notes: 'quiet room' },
    { id: 't2', title: 'Keying while talking', how: 'Talk out loud, or play a video with speech, while you key.', kind: 'keying-noise', keyed: 'CQ CQ DE', notes: 'talking' },
    { id: 't3', title: 'Keying while typing', how: 'Type on the laptop keyboard while you key.', kind: 'keying-noise', keyed: 'CQ CQ DE', notes: 'typing' },
    { id: 't4', title: 'Talking only', how: 'No keying. About 20 s of talking near the laptop.', kind: 'noise', keyed: '', notes: 'talking' },
    { id: 't5', title: 'Weak tone', how: 'Sidetone turned down, or the key further from the laptop.', kind: 'keying', keyed: 'CQ CQ DE', notes: 'quieter sidetone' },
    { id: 't6', title: 'Pause and resume', how: 'VVV, wait about 5 s, then VVV again.', kind: 'keying', keyed: 'VVV VVV', notes: '5 s pause' },
    { id: 'p1', title: 'Playback, anywhere', how: 'Keys a known text through the speaker. Record somewhere noisy, such as near a radio or people talking. No keying.', kind: 'playback', keyed: '', notes: '' },
  ];
  let take = $state<string | null>(null);

  function choose(t: (typeof TAKES)[number]) {
    take = t.id;
    kind = t.kind;
    keyed = t.keyed;
    notes = t.notes;
  }

  let live: LiveDecoder | null = null;
  let unsub: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let events: DetectorEvent[] = [];
  let started = 0;

  onMount(() => void refresh());
  onDestroy(() => {
    if (recording) void stop();
  });

  async function refresh() {
    files = (await saved().catch(() => [])).filter((f) => f.endsWith('.wav'));
  }

  async function start() {
    if (!signal.micOn) return;
    events = [];
    decoded = '';
    status = '';
    unsub = engine.onEvents((evs) => events.push(...evs));
    live = new LiveDecoder({ source: 'mic', charWpm: settings.sendWpm, pitch: settings.pitch, onOutput: () => (decoded = live?.text ?? '') });
    await live.start();
    const recStartCtx = engine.now;
    engine.startRecording();
    recording = true;
    started = performance.now();
    seconds = 0;
    timer = setInterval(() => {
      seconds = Math.floor((performance.now() - started) / 1000);
      if (seconds >= 90) void stop();
    }, 250);
    playback = null;
    if (kind === 'playback') {
      // A second of the room first, then the text, then a second more.
      await new Promise((r) => setTimeout(r, 1000));
      if (!recording) return;
      const pitch = playPitch === 'mine' ? (settings.pinnedHz ?? settings.pitch) : 400 + 10 * Math.floor(Math.random() * 61);
      if (playPitch === 'random') {
        engine.command({ type: 'pin', hz: pitch });
        repinned = true;
      }
      // The app mutes the mic while it plays; this take is meant to hear itself.
      engine.muteWhilePlaying = false;
      const seed = Math.floor(Math.random() * 1e6);
      const fist = playHand === 'hand' ? { jitter: 0.15, charGapScale: 1.25, wordGapScale: 1.2, seed } : { jitter: 0.03, seed };
      const pb = await engine.playText(playText.trim().toUpperCase(), { charWpm: playWpm, pitch, fist, seed, leadIn: 0 });
      playback = { text: playText.trim().toUpperCase(), wpm: playWpm, hand: playHand, pitch, seed, startCtx: pb.startTime, recStartCtx, marks: pb.schedule?.marks ?? [] };
      await pb.done;
      await new Promise((r) => setTimeout(r, 1000));
      await stop();
    }
  }

  async function stop() {
    if (!recording) return;
    recording = false;
    if (timer) clearInterval(timer);
    timer = null;
    const rec = await engine.stopRecording();
    if (repinned) {
      engine.command({ type: 'pin', hz: settings.pinnedHz });
      repinned = false;
    }
    engine.muteWhilePlaying = !settings.headphones;
    unsub?.();
    unsub = null;
    live?.flush();
    const text = live?.text ?? '';
    const settled = live ? (await live.settle()).length : 0;
    const settledText = live?.text ?? '';
    live?.stop();
    live = null;
    decoded = settledText;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${kind}${take ? `-${take}` : ''}`;
    const meta = {
      kind,
      take,
      keyed: kind === 'playback' ? (playback?.text ?? '') : keyed.trim().toUpperCase(),
      // Playback: the exact keying, its start on the audio clock, and the audio-clock time recording began
      // (the recording's own clock starts at t0; speaker and microphone latency are found by alignment).
      playback,
      notes: notes.trim(),
      at: d.toISOString(),
      sampleRate: rec.sampleRate,
      seconds: rec.pcm.length / rec.sampleRate,
      t0: rec.t0,
      mic: signal.info,
      settings: { pitch: settings.pitch, pinnedHz: settings.pinnedHz, sendWpm: settings.sendWpm },
      lockedHz: signal.pitch,
      decodedLive: text,
      decodedSettled: settledText,
      settledOutputs: settled,
      events: events.filter((e) => e.type !== 'status' || e.t >= rec.t0),
      userAgent: navigator.userAgent,
    };
    status = 'Uploading';
    try {
      await upload(`${name}.wav`, wav(rec.pcm, rec.sampleRate));
      await upload(`${name}.json`, JSON.stringify(meta));
      status = `Saved samples/${name}.wav, ${meta.seconds.toFixed(1)} s${playback ? `, ${playback.pitch} Hz` : ''}`;
    } catch (e) {
      status = `Upload failed: ${(e as Error).message}`;
    }
    await refresh();
  }
</script>

<div class="rec">
  <h2>Record a sample <span class="tag">debug</span></h2>
  <p class="muted small">Raw microphone input, as the detector hears it, saved on the machine serving this page. Pick a take, then Record.</p>
  <ol class="takes">
    {#each TAKES as t (t.id)}
      <li class:on={take === t.id}>
        <div>
          <strong>{t.title}</strong>
          {#if files.some((f) => f.endsWith(`-${t.id}.wav`))}<span class="done">saved</span>{/if}
          <p class="muted small">{t.how}</p>
        </div>
        <Button kind={take === t.id ? 'primary' : 'secondary'} onclick={() => choose(t)} disabled={recording}>{take === t.id ? 'Selected' : 'Select'}</Button>
      </li>
    {/each}
  </ol>
  <Segmented
    label="Sample"
    bind:value={kind}
    options={[
      { value: 'noise' as Kind, label: 'Room only' },
      { value: 'keying' as Kind, label: 'Keying' },
      { value: 'keying-noise' as Kind, label: 'Keying with noise' },
      { value: 'playback' as Kind, label: 'Playback' },
    ]}
  />
  {#if kind === 'playback'}
    <div class="fields">
      <label><span class="label">Text it keys</span><input class="mono" bind:value={playText} autocapitalize="characters" autocomplete="off" spellcheck="false" disabled={recording} /></label>
      <label><span class="label">Speed, wpm</span><input class="num" type="number" min="5" max="40" bind:value={playWpm} disabled={recording} /></label>
    </div>
    <Segmented label="Keying" bind:value={playHand} options={[{ value: 'hand' as Hand, label: 'Like a hand' }, { value: 'steady' as Hand, label: 'Steady' }]} />
    <Segmented
      label="Pitch"
      bind:value={playPitch}
      options={[
        { value: 'mine' as PitchChoice, label: `Yours, ${settings.pinnedHz ?? settings.pitch} Hz` },
        { value: 'random' as PitchChoice, label: 'Random, 400–1000 Hz' },
      ]}
    />
    <p class="muted small">Plays through the device speaker. The take stops by itself.</p>
  {/if}
  <div class="fields">
    <label><span class="label">What you key</span><input class="mono" bind:value={keyed} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="VVV CQ DE 9V1XX" disabled={kind === 'noise' || kind === 'playback' || recording} /></label>
    <label><span class="label">Notes</span><input bind:value={notes} autocomplete="off" placeholder="Fan on, typing, key 30 cm away" disabled={recording} /></label>
  </div>
  <div class="row">
    {#if recording}
      <Button kind="primary" onclick={stop}>Stop and save</Button>
      <span class="num">{seconds} s</span>
    {:else}
      <Button kind="primary" onclick={start} disabled={!signal.micOn}>Record</Button>
      {#if !signal.micOn}<span class="muted small">Start the mic first.</span>{/if}
    {/if}
  </div>
  {#if decoded}<p class="mono decoded">{decoded}</p>{/if}
  {#if status}<p class="small">{status}</p>{/if}
  {#if files.length}
    <p class="muted small">In samples/: {files.length} {files.length === 1 ? 'recording' : 'recordings'}. Latest {files[files.length - 1]}.</p>
  {/if}
</div>

<style>
  .rec {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2);
    border: var(--hairline) dashed var(--line);
    border-radius: var(--radius);
  }

  h2 {
    display: flex;
    gap: var(--s-1);
    align-items: baseline;
  }

  .tag {
    font-size: var(--size-s);
    font-weight: var(--weight-regular);
    color: var(--signal);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--s-2);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }

  .takes {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: 0;
    padding-left: var(--s-3);
  }

  .takes li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--s-2);
  }

  .takes p {
    margin: 0;
  }

  .done {
    margin-left: var(--s-1);
    font-size: var(--size-s);
    color: var(--signal);
  }

  .row {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }

  .decoded {
    overflow-wrap: anywhere;
  }
</style>
