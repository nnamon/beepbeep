<script lang="ts">
  // Sound surfing: a continuous stream with no extra space between characters,
  // typed as it plays. No pauses, no replay, nothing marked until the end. The
  // score is how many characters in a row you missed each time you fell behind.
  // Stopping early scores only what had played.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Keyboard from '../../ui/Keyboard.svelte';
  import TokenText, { type Tok } from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { signal } from '../../lib/state/signal.svelte';
  import { currentLevel, maybeTaper, playCw, receiveSpeeds, saveSession } from '../../lib/train/session';
  import { route } from '../../lib/state/router.svelte';
  import { items } from '../../lib/train/generate';
  import { compareCopy, recoveryLength, type CopyResult } from '../../lib/train/scoring';
  import { align, textTokens } from '../../lib/util/text';
  import { scheduleDuration } from '../../lib/morse/schedule';
  import { mulberry32, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';
  import { forControl } from '../../lib/util/keys';
  import type { Playback } from '../../lib/audio/engine';

  const level = currentLevel();
  const rng = mulberry32(randomSeed());
  signal.receiving = true;

  // /practice/ifr/endurance starts with the 3-minute stream.
  let length = $state<'45' | '90' | '180'>(route.path[2] === 'endurance' ? '180' : '90');
  let tapered = $state<number | null>(null);
  let stage = $state<'ready' | 'playing' | 'done'>('ready');
  let typed = $state<string[]>([]);
  let text = '';
  let result = $state<CopyResult | null>(null);
  let startedAt = 0;
  let playback: Playback | null = null;
  /** Bumped on each start and on leaving, so an earlier stream can't finish this one. */
  let run = 0;

  function build(seconds: number): string {
    const known = new Set(level.known);
    const useKnown = known.size >= 26 ? null : known;
    const sp = receiveSpeeds();
    let out = '';
    while (scheduleDuration(out || 'E', { charWpm: sp.charWpm }) < seconds) {
      const kind = useKnown ? (rng() < 0.6 ? 'words' : 'groups') : rng() < 0.5 ? 'phrases' : 'words';
      const w = items(rng, kind, useKnown, 1)[0] ?? items(rng, 'groups', known, 1)[0];
      out = out ? `${out} ${w}` : w;
    }
    return out;
  }

  async function start() {
    if (stage === 'playing') return;
    const me = ++run;
    text = build(Number(length));
    typed = [];
    result = null;
    stage = 'playing';
    startedAt = Date.now();
    void keepAwake(true);
    const sp = receiveSpeeds();
    playback = null;
    const pb = await playCw(text, { charWpm: sp.charWpm, effectiveWpm: sp.charWpm });
    if (me !== run) return;
    playback = pb;
    await pb.done;
    if (me === run && stage === 'playing') setTimeout(() => me === run && finish(), 1500);
  }

  /** The part of the stream that has played so far: all of it once it has ended. */
  function heard(): string {
    const pb = playback;
    if (!pb?.schedule) return '';
    const t = engine.now - pb.startTime;
    if (t >= pb.duration) return text;
    return pb.schedule.chars
      .filter((c) => c.start <= t)
      .map((c) => c.token)
      .join('')
      .trim();
  }

  function onkey(k: string) {
    if (stage !== 'playing') return;
    if (k === 'DEL') typed.pop();
    else if (k === 'DONE') finish();
    else typed.push(k);
  }

  function finish() {
    if (stage !== 'playing') return;
    const played = heard();
    engine.stopAll();
    void keepAwake(false);
    // Stopped before anything much played: nothing to score.
    if (textTokens(played).filter((t) => t !== ' ').length < 5) {
      stage = 'ready';
      return;
    }
    text = played;
    stage = 'done';
    result = compareCopy(text, typed.join(''));
    void saveSession({
      mode: 'ifr',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: result.total,
      accuracy: result.accuracy,
      wpm: receiveSpeeds().charWpm,
      recovery: recoveryLength(result),
    });
    tapered = maybeTaper(result.accuracy);
  }

  onDestroy(() => {
    run++;
    signal.receiving = false;
    engine.stopAll();
    void keepAwake(false);
  });

  const marked = $derived.by((): Tok[] => {
    if (!result) return [];
    return align(textTokens(text), textTokens(typed.join('')))
      .filter((o) => o.op !== 'ins')
      .map((o) => ({ t: o.op === 'del' || o.op === 'sub' ? o.want : o.want, state: o.op === 'match' ? 'ok' : 'miss' }));
  });
  const rec = $derived(result ? recoveryLength(result) : null);
</script>

<DrillFrame title="Sound surfing" eyebrow="{level.name} · {receiveSpeeds().charWpm} wpm, no extra space between characters">
  {#if stage === 'ready'}
    <div class="intro">
      <Segmented
        label="Length"
        bind:value={length}
        options={[{ value: '45', label: '45 s' }, { value: '90', label: '90 s' }, { value: '180', label: '3 min' }]}
      />
      <p class="muted">Type what you hear as it plays. If you miss one, skip it and keep going. You see how you did at the end.</p>
    </div>
  {:else if stage === 'playing'}
    <p class="typed mono" aria-live="off">{typed.slice(-40).join('') || ' '}</p>
    <Keyboard {onkey} />
  {:else if result}
    <dl class="facts">
      <div><dt class="label">Copied</dt><dd class="num big">{Math.round(result.accuracy * 100)}%</dd></div>
      <div><dt class="label">Times you fell behind</dt><dd class="num big">{result.missRuns.length}</dd></div>
      <div><dt class="label">Missed in a row</dt><dd class="num big">{rec === null ? 'No misses' : `${rec.toFixed(1)} on average`}</dd></div>
    </dl>
    <p class="muted">
      Missed in a row: each time you fell behind, how many characters in a row you missed before you caught up again.
      1.0 means you lost only the one you missed. Lower is better.
    </p>
    {#if tapered}<p>Overall speed raised to {tapered} wpm: a little less space between characters.</p>{/if}
    <TokenText tokens={marked} size="m" label="Sent text, misses underlined" />
  {/if}

  {#snippet footer()}
    {#if stage === 'playing'}
      <Button kind="primary" onclick={finish} hint="Esc">Stop</Button>
    {:else}
      <Button kind="primary" onclick={start} hint="Enter">{stage === 'done' ? 'Again' : 'Start'}</Button>
    {/if}
  {/snippet}
</DrillFrame>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && stage === 'playing') {
      // Esc presses Stop, as in the other drills with a Stop button.
      e.preventDefault();
      finish();
    } else if (e.key === 'Enter' && stage !== 'playing' && !forControl(e)) {
      e.preventDefault();
      void start();
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

  .typed {
    font-size: var(--size-l);
    min-height: 1.4em;
    white-space: pre;
    overflow: hidden;
  }

  .facts {
    display: flex;
    gap: var(--s-5);
    flex-wrap: wrap;
    margin: 0;
  }

  .facts dd {
    margin: 0;
  }

  .big {
    font-size: var(--size-l);
  }
</style>
