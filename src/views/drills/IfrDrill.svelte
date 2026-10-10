<script lang="ts">
  // Sound surfing: a continuous stream at natural spacing, typed as it plays.
  // No pauses, no replay, nothing marked until the end. The score is how many
  // characters it took to get back in step after each miss.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Keyboard from '../../ui/Keyboard.svelte';
  import TokenText, { type Tok } from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { signal } from '../../lib/state/signal.svelte';
  import { currentLevel, playCw, receiveSpeeds, saveSession } from '../../lib/train/session';
  import { items } from '../../lib/train/generate';
  import { compareCopy, recoveryLength, type CopyResult } from '../../lib/train/scoring';
  import { align, textTokens } from '../../lib/util/text';
  import { scheduleDuration } from '../../lib/morse/schedule';
  import { mulberry32, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

  const level = currentLevel();
  const rng = mulberry32(randomSeed());
  signal.receiving = true;

  let length = $state<'45' | '90' | '180'>('90');
  let stage = $state<'ready' | 'playing' | 'done'>('ready');
  let typed = $state<string[]>([]);
  let text = '';
  let result = $state<CopyResult | null>(null);
  let startedAt = 0;

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
    text = build(Number(length));
    typed = [];
    result = null;
    stage = 'playing';
    startedAt = Date.now();
    void keepAwake(true);
    const sp = receiveSpeeds();
    const pb = await playCw(text, { charWpm: sp.charWpm, effectiveWpm: sp.charWpm });
    await pb.done;
    if (stage === 'playing') setTimeout(finish, 1500);
  }

  function onkey(k: string) {
    if (stage !== 'playing') return;
    if (k === 'DEL') typed.pop();
    else if (k === 'DONE') finish();
    else typed.push(k);
  }

  function finish() {
    if (stage !== 'playing') return;
    engine.stopAll();
    stage = 'done';
    void keepAwake(false);
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
  }

  onDestroy(() => {
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

<DrillFrame title="Sound surfing" eyebrow="{level.name} · {receiveSpeeds().charWpm} wpm, natural spacing">
  {#if stage === 'ready'}
    <div class="intro">
      <Segmented
        label="Length"
        bind:value={length}
        options={[{ value: '45', label: '45 s' }, { value: '90', label: '90 s' }, { value: '180', label: '3 min' }]}
      />
      <p class="muted">Type as it plays. Skip what you miss and keep going. Nothing is marked until the end.</p>
    </div>
  {:else if stage === 'playing'}
    <p class="typed mono" aria-live="off">{typed.slice(-40).join('') || ' '}</p>
    <Keyboard {onkey} />
  {:else if result}
    <dl class="facts">
      <div><dt class="label">Recovery</dt><dd class="num big">{rec === null ? 'No misses' : `${rec.toFixed(1)} chars`}</dd></div>
      <div><dt class="label">Copied</dt><dd class="num big">{Math.round(result.accuracy * 100)}%</dd></div>
      <div><dt class="label">Miss runs</dt><dd class="num big">{result.missRuns.length}</dd></div>
    </dl>
    <p class="muted">Recovery is the average run of characters missed after the first miss. Lower is better.</p>
    <TokenText tokens={marked} size="m" label="Sent text, misses underlined" />
  {/if}

  {#snippet footer()}
    {#if stage === 'playing'}
      <Button kind="primary" onclick={finish}>Stop</Button>
    {:else}
      <Button kind="primary" onclick={start} hint="Enter">{stage === 'done' ? 'Again' : 'Start'}</Button>
    {/if}
  {/snippet}
</DrillFrame>

<svelte:window onkeydown={(e) => { if (e.key === 'Enter' && stage !== 'playing') { e.preventDefault(); void start(); } }} />

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
