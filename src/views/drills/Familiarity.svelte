<script lang="ts">
  // LICW BC1 familiarity: a new character plays unnamed among others; tap each
  // time it plays. Its name is revealed once the taps land reliably.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import TokenText from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { say } from '../../lib/audio/speech';
  import { signal } from '../../lib/state/signal.svelte';
  import { currentLevel, playCw, receiveSpeeds, saveSession } from '../../lib/train/session';
  import { mulberry32, pick, randomSeed, shuffle } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

  const level = currentLevel();
  const targets = level.added;
  const rng = mulberry32(randomSeed());
  const startedAt = Date.now();
  signal.receiving = true;

  let idx = $state(0);
  let stage = $state<'ready' | 'playing' | 'scored' | 'revealed' | 'done'>('ready');
  let hits = $state(0);
  let occurrences = $state(0);
  let extra = $state(0);
  let taps: number[] = [];
  let startTime = 0;
  let rounds = 0;
  const target = $derived(targets[idx]);

  function stream(t: string): string[] {
    const others = [...new Set([...level.known.filter((k) => k !== t)])];
    const pool = others.length ? others : ['E', 'T', 'M', 'I'];
    const seq: string[] = [];
    const n = 20;
    const want = Math.max(6, Math.round(n * 0.35));
    const slots = shuffle(rng, Array.from({ length: n }, (_, k) => k)).slice(0, want);
    for (let k = 0; k < n; k++) seq.push(slots.includes(k) ? t : pick(rng, pool));
    return seq;
  }

  async function play() {
    const seq = stream(target);
    taps = [];
    stage = 'playing';
    void keepAwake(true);
    const sp = receiveSpeeds();
    const pb = await playCw(seq.join(' '), { charWpm: sp.charWpm, effectiveWpm: sp.effectiveWpm, plain: true });
    startTime = pb.startTime;
    await pb.done;
    score(pb.schedule!.chars.filter((c) => c.token !== ' '));
  }

  function tap() {
    if (stage === 'playing') taps.push(engine.now - startTime);
  }

  function score(chars: { token: string; start: number; end: number }[]) {
    rounds++;
    const windows = chars.filter((c) => c.token === target).map((c) => ({ a: c.start, b: c.end + 1.2, hit: false }));
    let falseTaps = 0;
    for (const t of taps) {
      const w = windows.find((x) => !x.hit && t >= x.a && t <= x.b);
      if (w) w.hit = true;
      else falseTaps++;
    }
    occurrences = windows.length;
    hits = windows.filter((w) => w.hit).length;
    extra = falseTaps;
    if (hits / occurrences >= 0.8 && falseTaps <= 2) {
      stage = 'revealed';
      void say(target);
    } else stage = 'scored';
  }

  function nextTarget() {
    if (idx < targets.length - 1) {
      idx++;
      stage = 'ready';
    } else finish();
  }

  function finish() {
    stage = 'done';
    void keepAwake(false);
    void saveSession({
      mode: 'familiarity',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: rounds,
      accuracy: occurrences ? hits / occurrences : null,
      wpm: receiveSpeeds().charWpm,
      effectiveWpm: receiveSpeeds().effectiveWpm,
    });
  }

  onDestroy(() => {
    signal.receiving = false;
    engine.stopAll();
    void keepAwake(false);
  });

  function onKey(e: KeyboardEvent) {
    if (e.code === 'Space') {
      e.preventDefault();
      tap();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (stage === 'ready' || stage === 'scored') void play();
      else if (stage === 'revealed') nextTarget();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<DrillFrame title="Familiarity" eyebrow="{level.name} · new character {idx + 1} of {targets.length}">
  {#if stage === 'ready'}
    <p class="muted lead">A new character plays unnamed, mixed with others. Tap each time it plays.</p>
  {:else if stage === 'playing'}
    <button type="button" class="tap" onpointerdown={tap}>Tap<span class="muted">Space</span></button>
  {:else if stage === 'scored'}
    <p class="big">{hits} of {occurrences} caught{extra ? `, ${extra} extra taps` : ''}</p>
    <p class="muted">Catch 80% with no more than 2 extra taps to hear its name.</p>
  {:else if stage === 'revealed'}
    <span class="label">It was</span>
    <TokenText tokens={[{ t: target }]} size="xl" />
    <p class="muted">{hits} of {occurrences} caught.</p>
  {:else}
    <p class="big">All {targets.length} new characters named.</p>
    <p class="muted">Next: Copy drill or TTR drill with this lesson.</p>
  {/if}

  {#snippet footer()}
    {#if stage === 'ready'}
      <Button kind="primary" onclick={play} hint="Enter">Play</Button>
    {:else if stage === 'scored'}
      <Button kind="primary" onclick={play} hint="Enter">Again</Button>
    {:else if stage === 'revealed'}
      <Button kind="primary" onclick={nextTarget} hint="Enter">{idx < targets.length - 1 ? 'Next character' : 'Finish'}</Button>
      <Button onclick={() => say(target)}>Say it again</Button>
    {:else if stage === 'done'}
      <Button kind="primary" href="#/practice/copy">Copy drill</Button>
      <Button href="#/practice/ttr">TTR drill</Button>
    {/if}
  {/snippet}
</DrillFrame>

<style>
  .lead {
    max-width: var(--reading);
  }

  .tap {
    width: 100%;
    max-width: 420px;
    min-height: 200px;
    border: 1.5px solid var(--signal);
    background: var(--signal-soft);
    border-radius: var(--radius);
    font-size: var(--size-xl);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    touch-action: manipulation;
  }

  .tap span {
    font-size: var(--size-s);
  }

  .tap:active {
    background: var(--surface-2);
  }

  .big {
    font-size: var(--size-l);
    font-weight: var(--weight-strong);
  }
</style>
