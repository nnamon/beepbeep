<script lang="ts">
  // Spot the new character: one of the lesson's new characters plays alone
  // three times, unnamed, then mixed in with others; tap each time it plays.
  // Its name is revealed once the taps land reliably.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import TokenText from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { say } from '../../lib/audio/speech';
  import { signal } from '../../lib/state/signal.svelte';
  import { currentLevel, playCw, receiveSpeeds, saveSession, wait } from '../../lib/train/session';
  import { mulberry32, pick, randomSeed, shuffle } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';
  import { forControl } from '../../lib/util/keys';

  const level = currentLevel();
  const targets = level.added;
  const rng = mulberry32(randomSeed());
  const startedAt = Date.now();
  signal.receiving = true;

  let idx = $state(0);
  let stage = $state<'ready' | 'intro' | 'playing' | 'scored' | 'revealed' | 'done'>('ready');
  let hits = $state(0);
  let occurrences = $state(0);
  let extra = $state(0);
  let taps: number[] = [];
  let startTime = 0;
  let rounds = 0;
  /** Bumped on each play and on leaving, so a stream still to come doesn't start. */
  let run = 0;
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
    if (stage === 'intro' || stage === 'playing') return;
    const me = ++run;
    const seq = stream(target);
    taps = [];
    void keepAwake(true);
    const sp = receiveSpeeds();
    // The one to catch, on its own first.
    stage = 'intro';
    const intro = await playCw(`${target} ${target} ${target}`, { charWpm: sp.charWpm, effectiveWpm: sp.effectiveWpm, plain: true });
    await intro.done;
    await wait(1500);
    if (me !== run) return;
    stage = 'playing';
    const pb = await playCw(seq.join(' '), { charWpm: sp.charWpm, effectiveWpm: sp.effectiveWpm, plain: true });
    startTime = pb.startTime;
    await pb.done;
    if (me !== run) return;
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
    run++;
    signal.receiving = false;
    engine.stopAll();
    void keepAwake(false);
  });

  function onKey(e: KeyboardEvent) {
    // Space on the Tap button itself is a tap too.
    if (forControl(e) && !(e.target as HTMLElement).classList.contains('tap')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      tap();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!targets.length) return;
      if (stage === 'ready' || stage === 'scored') void play();
      else if (stage === 'revealed') nextTarget();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<DrillFrame title="Spot the new character" eyebrow={targets.length ? `${level.name} · new character ${idx + 1} of ${targets.length}` : level.name}>
  {#if !targets.length}
    <p class="lead">{level.name} adds no new characters, so there is nothing to spot here. This drill is for lessons that add characters.</p>
  {:else if stage === 'ready'}
    <p class="lead">One of this lesson's new characters plays three times on its own, without its name. That is the one to catch.</p>
    <p class="muted lead">Then it plays mixed in with other characters. Tap each time you hear it. Its name comes once you catch most of them.</p>
  {:else if stage === 'intro'}
    <p class="big">Listen: this is the one to catch.</p>
    <p class="muted">It plays three times.</p>
  {:else if stage === 'playing'}
    <p class="muted">Tap each time you hear it.</p>
    <button type="button" class="tap" onpointerdown={tap}>Tap<span class="muted">Space</span></button>
  {:else if stage === 'scored'}
    <p class="big">You caught {hits} of {occurrences}{extra ? `, with ${extra} ${extra === 1 ? 'tap' : 'taps'} on other characters` : ''}.</p>
    <p class="muted">Catch 8 in 10, with no more than 2 taps on other characters, to hear its name. Press Again to hear it on its own first, then try again.</p>
  {:else if stage === 'revealed'}
    <span class="label">It was</span>
    <TokenText tokens={[{ t: target }]} size="xl" />
    <p class="muted">You caught {hits} of {occurrences}.</p>
  {:else}
    <p class="big">You found and heard the names of all {targets.length} new characters.</p>
    <p class="muted">Next, try the Copy drill or the Time to recognise (TTR) drill with this lesson.</p>
  {/if}

  {#snippet footer()}
    {#if !targets.length}
      <Button kind="primary" href="#/practice">Back to Practice</Button>
    {:else if stage === 'ready'}
      <Button kind="primary" onclick={play} hint="Enter">Play</Button>
    {:else if stage === 'scored'}
      <Button kind="primary" onclick={play} hint="Enter">Again</Button>
    {:else if stage === 'revealed'}
      <Button kind="primary" onclick={nextTarget} hint="Enter">{idx < targets.length - 1 ? 'Next character' : 'Finish'}</Button>
      <Button onclick={() => say(target)}>Say it again</Button>
    {:else if stage === 'done'}
      <Button kind="primary" href="#/practice/copy">Copy drill</Button>
      <Button href="#/practice/ttr">Time to recognise (TTR)</Button>
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
