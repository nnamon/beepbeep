<script lang="ts">
  // Copy drill: hear a group or word made from your lesson's characters and
  // type it. Hot characters come up more often. Answers show after each item,
  // or only at the end in LICW strict mode.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Keyboard from '../../ui/Keyboard.svelte';
  import TokenText, { type Tok } from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { settings, strict } from '../../lib/state/settings.svelte';
  import { signal } from '../../lib/state/signal.svelte';
  import { advanceThreshold, answer, currentLevel, lessonOpenedBy, maybeTaper, playCw, receiveSpeeds, saveSession, stats } from '../../lib/train/session';
  import { route } from '../../lib/state/router.svelte';
  import { pickNext, type ItemStat } from '../../lib/train/srs';
  import { compareCopy } from '../../lib/train/scoring';
  import { wordsFromKnown, QSO_WORDS, COMMON_WORDS } from '../../lib/train/words';
  import { textTokens, align } from '../../lib/util/text';
  import { mulberry32, pick, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

  const ROUND = 20;
  type Material = 'chars' | 'groups' | 'words' | 'context';
  // Presets from links: /practice/copy/<material> or /practice/copy/comfort|stretch.
  const preset = route.path[2] ?? '';
  const session: 'comfort' | 'stretch' | null = preset === 'comfort' || preset === 'stretch' ? preset : null;
  let material = $state<Material>((['chars', 'groups', 'words', 'context'] as const).find((m) => m === preset) ?? 'groups');
  let tapered = $state<number | null>(null);
  let promoted = $state(false);
  let stage = $state<'ready' | 'playing' | 'typing' | 'shown' | 'done'>('ready');
  let i = $state(0);
  let item = $state('');
  let typed = $state<string[]>([]);
  let log: { want: string; got: string }[] = $state([]);
  let replays = 0;
  let endPerf = 0;
  let firstKeyMs = 0;
  let map = new Map<string, ItemStat>();
  const rng = mulberry32(randomSeed());
  const startedAt = Date.now();
  signal.receiving = true;

  const level = currentLevel();
  const known = level.known;

  function makeItem(): string {
    const pool = wordsFromKnown([...QSO_WORDS, ...COMMON_WORDS], new Set(known));
    if (material === 'words' && pool.length >= 5) return pick(rng, pool);
    // Context: two or three known words together, so characters land in meaning.
    if (material === 'context' && pool.length >= 5) {
      const n = 2 + Math.floor(rng() * 2);
      return Array.from({ length: n }, () => pick(rng, pool)).join(' ');
    }
    const n = material === 'chars' ? 1 : known.length < 4 ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 4);
    const recent: string[] = [];
    let g = '';
    for (let k = 0; k < n; k++) {
      const c = pickNext(rng, known, new Map([...map].map(([key, v]) => [key.slice(3), v])), recent);
      recent.push(c);
      g += c;
    }
    return g;
  }

  async function start() {
    map = await stats('rx:');
    log = [];
    i = 0;
    void keepAwake(true);
    await next();
  }

  async function next() {
    if (i >= ROUND) return finish();
    item = makeItem();
    typed = [];
    replays = 0;
    firstKeyMs = 0;
    await play();
  }

  async function play() {
    stage = 'playing';
    const pb = await playCw(item, speedOverride ?? {});
    endPerf = performance.now() + (pb.startTime - engine.now + pb.duration - 0.2) * 1000;
    stage = 'typing';
    await pb.done;
  }

  async function replay() {
    replays++;
    await play();
  }

  function onkey(k: string) {
    if (stage !== 'typing' && stage !== 'playing') {
      if (k === 'DONE' && stage === 'shown') void advance();
      return;
    }
    if (k === 'DEL') typed.pop();
    else if (k === 'DONE') submit();
    else if (k !== ' ') {
      if (!firstKeyMs) firstKeyMs = Math.max(0, performance.now() - endPerf);
      typed.push(k);
      if (textTokens(item).length === 1 && typed.length === 1) submit();
    }
  }

  async function submit() {
    const got = typed.join('');
    log.push({ want: item, got });
    // Per-character stats from the alignment.
    const ops = align(textTokens(item), textTokens(got));
    for (const o of ops) {
      if (o.op === 'match') await answer(map, `rx:${o.want}`, true, firstKeyMs || 1500, 1500);
      else if (o.op === 'sub') await answer(map, `rx:${o.want}`, false, firstKeyMs || 1500, 1500, { want: o.want, got: o.got });
      else if (o.op === 'del') await answer(map, `rx:${o.want}`, false, 3000, 1500);
    }
    i++;
    if (strict()) await advance();
    else stage = 'shown';
  }

  async function advance() {
    await next();
  }

  function finish() {
    stage = 'done';
    void keepAwake(false);
    const r = summary();
    void saveSession({
      mode: 'copy',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: log.length,
      accuracy: r.accuracy,
      wpm: speeds.charWpm,
      effectiveWpm: speeds.effectiveWpm,
      stretch: session === 'stretch',
    });
    if (!session) tapered = maybeTaper(r.accuracy);
  }

  /** The stretch speed has become comfortable: promote it and set a new stretch. */
  function promote() {
    settings.comfortWpm = settings.stretchWpm;
    settings.stretchWpm = settings.stretchWpm + 4;
    promoted = true;
  }

  function summary() {
    const all = compareCopy(log.map((l) => l.want).join(' '), log.map((l) => l.got).join(' '));
    return all;
  }

  const threshold = advanceThreshold();

  function levelUp() {
    if (nextLevel) settings.level[settings.track] = nextLevel.id;
    stage = 'ready';
  }

  onDestroy(() => {
    signal.receiving = false;
    engine.stopAll();
    void keepAwake(false);
  });

  const toks = (s: string, state?: Tok['state']): Tok[] => textTokens(s).map((t) => ({ t, state }));
  function marked(want: string, got: string): Tok[] {
    return align(textTokens(want), textTokens(got))
      .filter((o) => o.op !== 'ins')
      .map((o) => ({ t: o.op === 'del' ? o.want : o.want, state: o.op === 'match' ? 'ok' : 'miss' }));
  }
  const result = $derived(stage === 'done' ? summary() : null);
  const nextLevel = $derived(result ? lessonOpenedBy(result.accuracy) : null);
  const speedOverride = session ? { charWpm: settings[`${session}Wpm`], effectiveWpm: settings[`${session}Wpm`] } : null;
  const speeds = speedOverride ?? receiveSpeeds();
</script>

<DrillFrame
  title={session === 'stretch' ? 'Stretch session' : session === 'comfort' ? 'Comfort session' : 'Copy drill'}
  eyebrow="{level.name} · {speeds.charWpm}/{speeds.effectiveWpm} wpm"
  count={stage !== 'ready' && stage !== 'done' ? `${Math.min(i + 1, ROUND)} / ${ROUND}` : ''}
>
  {#if stage === 'ready'}
    <div class="intro">
      <Segmented
        label="Material"
        bind:value={material}
        options={[
          { value: 'chars', label: 'Characters' },
          { value: 'groups', label: 'Groups' },
          { value: 'words', label: 'Words' },
          { value: 'context', label: 'Context' },
        ]}
      />
      <p class="muted">
        {ROUND} to copy, using the {known.length} characters you know. Type what you hear. Replay as often as you like; it
        doesn't affect your score. {strict() ? 'You see the answers at the end.' : 'You see the answer after each one.'}
      </p>
    </div>
  {:else if stage === 'done' && result}
    <div class="done">
      <p class="big">{Math.round(result.accuracy * 100)}% of characters</p>
      {#if result.confusions.length}
        <p class="muted">Mixed up: {result.confusions.slice(0, 6).map((c) => `${c.want} heard as ${c.got}`).join(', ')}</p>
      {/if}
      <ul class="list">
        {#each log as l, k (k)}
          <li><TokenText tokens={marked(l.want, l.got)} size="m" /><span class="muted mono">{l.got || '–'}</span></li>
        {/each}
      </ul>
      {#if nextLevel && !session}
        <p>You scored over {Math.round(threshold * 100)}%, so {nextLevel.name} is open.</p>
      {/if}
      {#if tapered}<p>Effective speed raised to {tapered} wpm.</p>{/if}
      {#if session === 'stretch' && result.accuracy >= 0.9 && !promoted}
        <p>You copied {Math.round(result.accuracy * 100)}% at {settings.stretchWpm} wpm, your stretch speed.</p>
        <div><Button onclick={promote}>Make {settings.stretchWpm} wpm the comfort speed</Button></div>
      {:else if promoted}
        <p>Comfort is now {settings.comfortWpm} wpm; stretch is {settings.stretchWpm} wpm.</p>
      {/if}
    </div>
  {:else}
    <div class="answer" aria-live="polite">
      {#if stage === 'shown'}
        <span class="label">Sent</span>
        <TokenText tokens={marked(item, typed.join(''))} size="xl" />
        <span class="label">Typed</span>
        <TokenText tokens={toks(typed.join('') || '–')} size="l" />
      {:else}
        <span class="label">{stage === 'playing' ? 'Listen' : 'Type'}</span>
        <p class="typed mono">{typed.join('') || ' '}</p>
      {/if}
    </div>
    <Keyboard {onkey} showSpace={false} />
  {/if}

  {#snippet footer()}
    {#if stage === 'ready'}
      <Button kind="primary" onclick={start} hint="Enter">Start</Button>
    {:else if stage === 'done'}
      <Button kind="primary" onclick={start}>Another round</Button>
      {#if nextLevel && !session}<Button onclick={levelUp}>Next lesson</Button>{/if}
    {:else if stage === 'shown'}
      <Button kind="primary" onclick={advance} hint="Enter">Next</Button>
      <Button onclick={replay}>Replay</Button>
    {:else}
      <Button onclick={replay} disabled={stage === 'playing'}>Replay</Button>
    {/if}
  {/snippet}
</DrillFrame>

<svelte:window onkeydown={(e) => { if (e.key === 'Enter' && stage === 'ready') { e.preventDefault(); void start(); } }} />

<style>
  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    align-items: flex-start;
    max-width: var(--reading);
  }

  .answer {
    min-height: 150px;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .typed {
    font-size: var(--size-xl);
    line-height: 1.2;
    min-height: 1.2em;
  }

  .big {
    font-size: var(--size-l);
    font-weight: var(--weight-strong);
  }

  .done {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--s-1) var(--s-3);
  }

  .list li {
    display: flex;
    justify-content: space-between;
    gap: var(--s-1);
    border-bottom: var(--hairline) solid var(--line);
    padding: var(--s-half) 0;
  }
</style>
