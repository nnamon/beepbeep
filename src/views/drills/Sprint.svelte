<script lang="ts">
  // Callsign and word sprint: speed rises 2 wpm after each right answer and
  // falls 2 after a miss.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Keyboard from '../../ui/Keyboard.svelte';
  import TokenText from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { signal } from '../../lib/state/signal.svelte';
  import { strict } from '../../lib/state/settings.svelte';
  import { playCw, receiveSpeeds, saveSession } from '../../lib/train/session';
  import { items } from '../../lib/train/generate';
  import { textTokens } from '../../lib/util/text';
  import { mulberry32, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

  const ROUND = 20;
  const rng = mulberry32(randomSeed());
  signal.receiving = true;

  let material = $state<'callsigns' | 'words'>('callsigns');
  let stage = $state<'ready' | 'playing' | 'typing' | 'shown' | 'done'>('ready');
  let wpm = $state(receiveSpeeds().charWpm);
  let n = $state(0);
  let item = $state('');
  let typed = $state<string[]>([]);
  let log = $state<{ item: string; got: string; wpm: number; ok: boolean }[]>([]);
  let startedAt = 0;

  async function start() {
    wpm = receiveSpeeds().charWpm;
    n = 0;
    log = [];
    startedAt = Date.now();
    void keepAwake(true);
    await next();
  }

  async function next() {
    if (n >= ROUND) return finish();
    item = items(rng, material, null, 1)[0];
    typed = [];
    stage = 'playing';
    const pb = await playCw(item, { charWpm: wpm, effectiveWpm: wpm });
    stage = 'typing';
    await pb.done;
  }

  function onkey(k: string) {
    if (stage === 'shown' && k === 'DONE') return void next();
    if (stage !== 'typing' && stage !== 'playing') return;
    if (k === 'DEL') typed.pop();
    else if (k === 'DONE') submit();
    else if (k !== ' ' || material === 'words') typed.push(k);
  }

  function submit() {
    const got = typed.join('');
    const ok = textTokens(got).join('') === textTokens(item).join('');
    log.push({ item, got, wpm, ok });
    n++;
    wpm = Math.max(5, wpm + (ok ? 2 : -2));
    // Strict mode holds answers until the end of the round.
    if (strict()) void next();
    else stage = 'shown';
  }

  function finish() {
    stage = 'done';
    void keepAwake(false);
    void saveSession({
      mode: 'sprint',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: log.length,
      accuracy: log.filter((l) => l.ok).length / Math.max(1, log.length),
      wpm: top,
    });
  }

  onDestroy(() => {
    signal.receiving = false;
    engine.stopAll();
    void keepAwake(false);
  });

  const top = $derived(Math.max(0, ...log.filter((l) => l.ok).map((l) => l.wpm)));
  const last = $derived(log[log.length - 1]);
</script>

<DrillFrame title="Sprint" eyebrow="{material === 'callsigns' ? 'Callsigns' : 'Words'} · +2 wpm right, −2 wpm missed" count={stage !== 'ready' && stage !== 'done' ? `${Math.min(n + 1, ROUND)} / ${ROUND}` : ''}>
  {#if stage === 'ready'}
    <Segmented label="Material" bind:value={material} options={[{ value: 'callsigns', label: 'Callsigns' }, { value: 'words', label: 'Words' }]} />
    <p class="muted">{ROUND} to copy, starting at {receiveSpeeds().charWpm} wpm. Each one you get right makes the next 2 wpm faster; each miss makes it 2 wpm slower.</p>
  {:else if stage === 'done'}
    <dl class="facts">
      <div><dt class="label">Top speed copied</dt><dd class="num big">{top || '–'} wpm</dd></div>
      <div><dt class="label">Copied</dt><dd class="num big">{log.filter((l) => l.ok).length} of {log.length}</dd></div>
    </dl>
    <ul class="list">
      {#each log as l, k (k)}
        <li><span class="num muted">{l.wpm}</span><span class="mono">{l.item}</span><span class="muted mono">{l.ok ? '' : l.got || '–'}</span></li>
      {/each}
    </ul>
  {:else}
    <div class="row">
      <span class="num speed">{stage === 'shown' && last ? last.wpm : wpm} wpm</span>
      {#if stage === 'shown' && last}
        <TokenText tokens={textTokens(last.item).map((t) => ({ t, state: last.ok ? 'ok' : 'miss' }))} size="xl" />
        <span class="muted">{last.ok ? 'Copied' : `Typed ${last.got || 'nothing'}`}</span>
      {:else}
        <p class="typed mono">{typed.join('') || ' '}</p>
      {/if}
    </div>
    <Keyboard {onkey} showSpace={material === 'words'} />
  {/if}

  {#snippet footer()}
    {#if stage === 'ready' || stage === 'done'}
      <Button kind="primary" onclick={start}>{stage === 'done' ? 'Again' : 'Start'}</Button>
    {:else if stage === 'shown'}
      <Button kind="primary" onclick={next} hint="Enter">Next</Button>
    {/if}
  {/snippet}
</DrillFrame>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Enter' && (stage === 'ready' || stage === 'done') && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      void start();
    }
  }}
/>


<style>
  .row {
    min-height: 130px;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .speed {
    color: var(--muted);
  }

  .typed {
    font-size: var(--size-xl);
    min-height: 1.2em;
  }

  .facts {
    display: flex;
    gap: var(--s-5);
    margin: 0;
  }

  .facts dd {
    margin: 0;
  }

  .big {
    font-size: var(--size-l);
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--s-half) var(--s-3);
  }

  .list li {
    display: grid;
    grid-template-columns: 3ch 1fr auto;
    gap: var(--s-1);
    border-bottom: var(--hairline) solid var(--line);
    padding: var(--s-half) 0;
  }
</style>
