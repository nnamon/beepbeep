<script lang="ts">
  // Time To Recognize: a character plays, then its name is spoken after a
  // delay. Type it before the voice. The delay tightens or relaxes to keep you
  // recognising about two-thirds, down to 0.3 s.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Keyboard from '../../ui/Keyboard.svelte';
  import TokenText from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { say } from '../../lib/audio/speech';
  import { settings } from '../../lib/state/settings.svelte';
  import { signal } from '../../lib/state/signal.svelte';
  import { answer, currentLevel, playCw, receiveSpeeds, saveSession, stats, wait } from '../../lib/train/session';
  import { pickNext, type ItemStat } from '../../lib/train/srs';
  import { mulberry32, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

  const MAX = 40;
  const level = currentLevel();
  const rng = mulberry32(randomSeed());
  const startedAt = Date.now();
  signal.receiving = true;

  let running = $state(false);
  let n = $state(0);
  let delay = $state(Math.min(3, Math.max(0.3, settings.ttrDelay)));
  let shown = $state('');
  let outcome = $state<'' | 'before' | 'late' | 'wrong'>('');
  let recent: number[] = [];
  let got = 0;
  let stopFlag = false;
  let pending: ((k: string) => void) | null = null;
  let map = new Map<string, ItemStat>();
  let last: string[] = [];

  async function run() {
    map = await stats('rx:');
    running = true;
    stopFlag = false;
    void keepAwake(true);
    for (n = 0; n < MAX && !stopFlag; n++) {
      const ch = pickNext(rng, level.known, new Map([...map].map(([k, v]) => [k.slice(3), v])), last);
      last = [...last, ch].slice(-3);
      shown = '';
      outcome = '';
      const sp = receiveSpeeds();
      const pb = await playCw(ch, { charWpm: sp.charWpm, plain: false });
      const endPerf = performance.now() + (pb.startTime - engine.now + pb.duration - 0.2) * 1000;
      const key = await Promise.race([
        new Promise<string>((r) => (pending = r)),
        (async () => {
          await pb.done;
          const left = endPerf + delay * 1000 - performance.now();
          if (left > 0) await wait(left);
          return '';
        })(),
      ]);
      pending = null;
      const ms = key ? Math.max(0, performance.now() - endPerf) : delay * 1000;
      const right = key === ch;
      outcome = !key ? 'late' : right ? 'before' : 'wrong';
      shown = ch;
      if (right) got++;
      await answer(map, `rx:${ch}`, right, ms, delay * 1000, key && !right ? { want: ch, got: key } : undefined);
      recent = [...recent, right ? 1 : 0].slice(-12);
      adapt();
      await say(ch);
      await wait(350);
    }
    finish();
  }

  function adapt() {
    if (recent.length < 8) return;
    const rate = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (rate > 0.8) delay = Math.max(0.3, +(delay - 0.05).toFixed(2));
    else if (rate < 0.55) delay = Math.min(3, +(delay + 0.1).toFixed(2));
  }

  function finish() {
    running = false;
    void keepAwake(false);
    settings.ttrDelay = delay;
    void saveSession({
      mode: 'ttr',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: n,
      accuracy: n ? got / n : null,
      wpm: receiveSpeeds().charWpm,
      ttrDelay: delay,
    });
  }

  function onkey(k: string) {
    if (pending && k.length && k !== 'DEL' && k !== 'DONE') pending(k);
  }

  function stop() {
    stopFlag = true;
    pending?.('');
    engine.stopAll();
  }

  onDestroy(() => {
    stopFlag = true;
    signal.receiving = false;
    void keepAwake(false);
  });
</script>

<DrillFrame
  title="TTR drill"
  eyebrow="{level.name} · {receiveSpeeds().charWpm} wpm characters"
  count={running ? `${n + 1} / ${MAX}` : ''}
>
  <div class="row">
    <div>
      <span class="label">Voice delay</span>
      <p class="delay num">{delay.toFixed(2)} s</p>
    </div>
    <div class="answer" aria-live="polite">
      {#if shown}
        <TokenText tokens={[{ t: shown }]} size="xl" />
        <span class="muted">{outcome === 'before' ? 'Before the voice' : outcome === 'late' ? 'After the voice' : 'Different key'}</span>
      {:else if running}
        <span class="muted big">Listen</span>
      {:else}
        <p class="muted">A character plays, then a voice names it. Type it before the voice does. Aim to beat the voice about two times in three; as you get faster, the voice comes sooner.</p>
      {/if}
    </div>
  </div>
  {#if running}<Keyboard {onkey} showDone={false} showSpace={false} />{/if}

  {#snippet footer()}
    {#if running}
      <Button kind="primary" onclick={stop} hint="Esc">Stop</Button>
    {:else}
      <Button kind="primary" onclick={run} hint="Enter">{n ? 'Again' : 'Start'}</Button>
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
  .row {
    display: flex;
    gap: var(--s-6);
    align-items: flex-start;
    flex-wrap: wrap;
    min-height: 140px;
  }

  .delay {
    font-size: var(--size-xl);
    line-height: 1.1;
  }

  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    max-width: var(--reading);
  }

  .big {
    font-size: var(--size-l);
  }
</style>
