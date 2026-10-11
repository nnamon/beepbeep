<script lang="ts">
  // Hear it, send it: the app sends a character or word, you send it straight
  // back. No restarts; sets alternate your comfortable speed and +4 WPM.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import TokenText, { type Tok } from '../../ui/TokenText.svelte';
  import RhythmView, { type RhythmRow } from '../../ui/RhythmView.svelte';
  import InputHelp from '../../ui/InputHelp.svelte';
  import { LiveDecoder } from '../../lib/audio/live';
  import type { DecodedChar } from '../../lib/decoder/decoder';
  import { engine } from '../../lib/audio/engine';
  import { settings, strict } from '../../lib/state/settings.svelte';
  import { signal, touchKeyArea, startMic } from '../../lib/state/signal.svelte';
  import { currentLevel, followInput, playMarks, recordSend, saveSession, sendInput, wait } from '../../lib/train/session';
  import { items } from '../../lib/train/generate';
  import { buildSchedule } from '../../lib/morse/schedule';
  import { textTokens } from '../../lib/util/text';
  import { compareCopy } from '../../lib/train/scoring';
  import { mulberry32, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

  // The touch key pad stays in place while this screen is open.
  $effect(() => touchKeyArea());
  // The decoder listening now (one per item); switching input moves it over at once.
  let listening: LiveDecoder | null = null;
  $effect(() => {
    void settings.input;
    void followInput(listening);
  });

  const SET = 10;
  let material = $state<'characters' | 'words'>('characters');
  let running = $state(false);
  let phase = $state<'listen' | 'send' | 'shown'>('listen');
  let i = $state(0);
  let current = $state('');
  let lastResult: { want: string; got: string; ok: boolean; rows: RhythmRow[] } | null = $state(null);
  let results = $state<{ want: string; got: string; ok: boolean; wpm: number; marks: { start: number; end: number }[] }[]>([]);
  let stopFlag = false;
  const rng = mulberry32(randomSeed());
  const startedAt = Date.now();

  const speedFor = (n: number) => settings.comfortWpm + (Math.floor(n / SET) % 2 === 1 ? 4 : 0);
  const total = SET * 2;

  async function run() {
    if (settings.input === 'mic' && !signal.micOn) {
      if (!(await startMic())) return;
    }
    running = true;
    stopFlag = false;
    results = [];
    void keepAwake(true);
    const known = new Set(currentLevel().known);
    for (i = 0; i < total && !stopFlag; i++) {
      const wpm = speedFor(i);
      current = material === 'characters'
        ? items(rng, 'characters', known, 1)[0]
        : (items(rng, 'words', known.size >= 26 ? null : known, 1)[0] ?? items(rng, 'groups', known, 1)[0]);
      phase = 'listen';
      const pb = await engine.playText(current, { charWpm: wpm, pitch: settings.pitch });
      await pb.done;
      if (stopFlag) break;
      phase = 'send';
      const got = await listen(wpm);
      if (stopFlag) break;
      const r = compareCopy(current, got.text);
      const ok = r.accuracy === 1 && textTokens(got.text).length === textTokens(current).length;
      results.push({ want: current, got: got.text, ok, wpm, marks: got.marks });
      void recordSend(current, got.text, [], got.chars);
      const std = buildSchedule(current, { charWpm: wpm, leadIn: 0, tail: 0 });
      lastResult = {
        want: current,
        got: got.text,
        ok,
        rows: [
          { label: 'yours', marks: got.marks },
          { label: 'standard', marks: std.marks, style: 'outline' },
        ],
      };
      phase = 'shown';
      await wait(ok ? 700 : 1600);
    }
    finish();
  }

  /** Listens until a pause after your sending, or up to 8 seconds. */
  async function listen(wpm: number): Promise<{ text: string; marks: { start: number; end: number }[]; chars: DecodedChar[] }> {
    let last = 0;
    const began = performance.now();
    const live = new LiveDecoder({
      source: sendInput(),
      charWpm: wpm,
      pitch: settings.pitch,
      onKey: () => (last = performance.now()),
    });
    await live.start();
    listening = live;
    await waitUntil(
      () => stopFlag || (last > 0 && performance.now() - last > gapMs(wpm)) || performance.now() - began > 8000,
    );
    live.flush();
    await live.settle();
    live.stop();
    listening = null;
    return { text: live.text, marks: live.marks, chars: live.chars };
  }

  const gapMs = (wpm: number) => Math.max(1100, (1.2 / wpm) * 10 * 1000);

  function waitUntil(cond: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (cond()) {
          clearInterval(t);
          resolve();
        }
      }, 50);
    });
  }

  function finish() {
    running = false;
    void keepAwake(false);
    if (results.length) {
      void saveSession({
        mode: 'hear-send',
        seconds: Math.round((Date.now() - startedAt) / 1000),
        sending: true,
        items: results.length,
        accuracy: results.filter((r) => r.ok).length / results.length,
        wpm: settings.comfortWpm,
      });
    }
  }

  function stop() {
    stopFlag = true;
    engine.stopAll();
  }

  onDestroy(() => {
    stopFlag = true;
    void keepAwake(false);
  });

  const toks = (s: string): Tok[] => textTokens(s).map((t) => ({ t }));
  const done = $derived(!running && results.length > 0);
</script>

<DrillFrame
  title="Hear it, send it"
  eyebrow="{currentLevel().name} · {settings.comfortWpm} and {settings.comfortWpm + 4} wpm, alternating sets"
  count={running ? `${Math.min(i + 1, total)} / ${total}` : ''}
>
  {#if !running && !done}
    <div class="intro">
      <Segmented label="Material" bind:value={material} options={[{ value: 'characters', label: 'Characters' }, { value: 'words', label: 'Words' }]} />
      <p class="muted">A character or word plays. Copy it, then send it back on your key. Use headphones so the microphone hears only your key, not the app.</p>
      <InputHelp />
    </div>
  {:else if running}
    <div class="stage" aria-live="polite">
      {#if phase === 'listen'}
        <p class="big muted">Listen</p>
      {:else if phase === 'send'}
        <p class="big">Send</p>
      {:else if lastResult}
        {#if strict()}
          <p class="big muted">Next</p>
        {:else}
          <span class="label">Received</span>
          {#if lastResult.got}<TokenText tokens={toks(lastResult.got)} size="xl" />{:else}<p class="muted">Nothing decoded</p>{/if}
          {#if !lastResult.ok}
            <span class="label">It was</span>
            <TokenText tokens={toks(lastResult.want)} size="l" />
            <RhythmView rows={lastResult.rows} />
          {/if}
        {/if}
      {/if}
    </div>
  {:else}
    <div class="summary">
      <p class="big">{results.filter((r) => r.ok).length} of {results.length} matched</p>
      <ul class="list">
        {#each results as r, k (k)}
          <li>
            <span class="num muted">{r.wpm}</span>
            <TokenText tokens={toks(r.want)} size="m" />
            <span class="muted">{r.ok ? 'matched' : `received ${r.got || 'nothing'}`}</span>
            <span class="replays">
              {#if r.marks.length}<button type="button" onclick={() => playMarks(r.marks)}>Mine</button>{/if}
              <button type="button" onclick={() => engine.playText(r.want, { charWpm: r.wpm, pitch: settings.pitch })}>Standard</button>
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#snippet footer()}
    {#if running}
      <Button kind="primary" onclick={stop} hint="Esc">Stop</Button>
    {:else}
      <Button kind="primary" onclick={run} hint="Enter">{done ? 'Another set' : 'Start'}</Button>
    {/if}
  {/snippet}
</DrillFrame>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && running) {
      e.preventDefault();
      stop();
    } else if (e.key === 'Enter' && !running) {
      e.preventDefault();
      void run();
    }
  }}
/>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    align-items: flex-start;
    max-width: var(--reading);
  }

  .stage {
    min-height: 220px;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .big {
    font-size: var(--size-xl);
    line-height: 1.1;
  }

  .summary .big {
    font-size: var(--size-l);
  }

  .list {
    list-style: none;
    padding: 0;
    margin: var(--s-2) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }

  .replays {
    display: flex;
    gap: var(--s-half);
  }

  .replays button {
    min-height: 36px;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    padding: 0 var(--s-1);
    font-size: var(--size-s);
  }

  .list li {
    display: grid;
    grid-template-columns: 3ch 8ch 1fr auto;
    gap: var(--s-2);
    align-items: baseline;
    border-bottom: var(--hairline) solid var(--line);
    padding: var(--s-half) 0;
  }
</style>
