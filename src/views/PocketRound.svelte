<script lang="ts">
  // A pocket round: learn new items, then 20 quiz items answered on the full
  // keyboard. A miss plays the right answer and your pick back to back.
  import { onDestroy } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import Keyboard from '../ui/Keyboard.svelte';
  import TokenText from '../ui/TokenText.svelte';
  import RhythmView, { type RhythmRow } from '../ui/RhythmView.svelte';
  import { engine } from '../lib/audio/engine';
  import { say } from '../lib/audio/speech';
  import { settings, strict } from '../lib/state/settings.svelte';
  import { signal } from '../lib/state/signal.svelte';
  import { go, href } from '../lib/state/router.svelte';
  import { answer, currentLevel, playCw, receiveSpeeds, saveSession, stats, wait } from '../lib/train/session';
  import { pickNext, type ItemStat } from '../lib/train/srs';
  import { items, type Material } from '../lib/train/generate';
  import { CHUNKS, COMMON_WORDS, QSO_WORDS, wordsFromKnown } from '../lib/train/words';
  import { buildSchedule } from '../lib/morse/schedule';
  import { textTokens } from '../lib/util/text';
  import { mulberry32, randomSeed } from '../lib/util/random';
  import { keepAwake } from '../lib/util/wakelock';
  import { getKv } from '../lib/state/db';

  let { stage, customSet: initialSet }: { stage: string; customSet: { chars: string[]; words: string[] } } = $props();
  // A round is keyed by stage in the parent, so capturing initial props is intended.
  // svelte-ignore state_referenced_locally
  let customSet = $state(initialSet);

  const ROUND = 20;
  const rng = mulberry32(randomSeed());
  const level = currentLevel();
  const known = new Set(level.known);
  const single = $derived(stage === 'characters' || (stage === 'custom' && !customSet.words.length));
  signal.receiving = true;

  let phase = $state<'ready' | 'loading' | 'learn' | 'quiz' | 'reveal' | 'wrap' | 'empty'>('ready');
  let n = $state(0);
  let item = $state('');
  let typed = $state<string[]>([]);
  let learnItem = $state('');
  let last = $state<{ item: string; got: string; ok: boolean; rows: RhythmRow[] } | null>(null);
  let log = $state<{ item: string; got: string; ok: boolean; ms: number; replays: number }[]>([]);
  let replays = 0;
  let holding = $state(false);
  // LICW learn: tap each time the new character plays.
  let learnTaps = $state(0);
  let learnPlays = $state(0);
  let tapOpen = false;
  let tapped = false;
  let pool: string[] = [];
  let map = new Map<string, ItemStat>();
  let recent: string[] = [];
  let endPerf = 0;
  let firstKey = 0;
  const startedAt = Date.now();
  // svelte-ignore state_referenced_locally
  const prefix = stage === 'characters' ? 'rx:' : `pk:${stage}:`;

  function buildPool(): string[] {
    switch (stage) {
      case 'characters':
        return level.known;
      case 'chunks':
        return wordsFromKnown(CHUNKS, known);
      case 'words':
        return wordsFromKnown([...QSO_WORDS, ...COMMON_WORDS], known);
      case 'custom':
        return [...customSet.chars, ...customSet.words];
      default:
        return [];
    }
  }


  async function begin() {
    n = 0;
    log = [];
    last = null;
    phase = 'loading';
    map = await stats(prefix);
    if (stage === 'custom' && !customSet.chars.length && !customSet.words.length) {
      customSet = await getKv('pocket.custom', { chars: [], words: [] }).catch(() => customSet);
    }
    pool = buildPool();
    const generated = stage === 'callsigns' || stage === 'phrases';
    if (!generated && pool.length < 2) {
      phase = 'empty';
      return;
    }
    void keepAwake(true);
    const fresh = stage === 'characters' ? level.added.filter((c) => !(map.get(`rx:${c}`)?.seen)) : [];
    if (fresh.length) await learn(fresh);
    await next();
  }

  async function learn(fresh: string[]) {
    phase = 'learn';
    learnTaps = 0;
    learnPlays = 0;
    const licw = settings.track === 'licw';
    for (const c of fresh) {
      learnItem = licw ? '' : c;
      if (!licw) await say(c);
      for (let k = 0; k < (licw ? 5 : 3); k++) {
        tapOpen = true;
        tapped = false;
        const pb = await playCw(c, { plain: true });
        await pb.done;
        // Uneven gaps in LICW learn, so the tap follows the sound, not a beat.
        await wait(licw ? 600 + rng() * 1400 : 450);
        tapOpen = false;
        if (licw) learnPlays++;
      }
      learnItem = c;
      if (settings.track === 'licw') await say(c);
      await wait(700);
    }
  }

  function pickItem(): string {
    if (stage === 'callsigns' || stage === 'phrases') return items(rng, stage as Material, null, 1)[0];
    const keys = pool;
    const m = new Map([...map].map(([k, v]) => [k.slice(prefix.length), v]));
    const it = pickNext(rng, keys, m, recent);
    recent = [...recent, it].slice(-3);
    return it;
  }

  function learnTap() {
    if (!tapOpen || tapped) return;
    tapped = true;
    learnTaps++;
  }

  async function next() {
    if (n >= ROUND) return wrap();
    item = pickItem();
    typed = [];
    firstKey = 0;
    replays = 0;
    phase = 'quiz';
    await play();
  }

  async function replay() {
    replays++;
    await play();
  }

  async function play() {
    const pb = await playCw(item);
    endPerf = performance.now() + (pb.startTime - engine.now + pb.duration - 0.2) * 1000;
    await pb.done;
  }

  function onkey(k: string) {
    if (phase === 'reveal') {
      if (k === 'DONE') void next();
      return;
    }
    if (phase !== 'quiz') return;
    if (k === 'DEL') return void typed.pop();
    if (k === 'DONE') return void submit();
    if (k === ' ' && single) return;
    if (!firstKey) firstKey = Math.max(0, performance.now() - endPerf);
    typed.push(k);
    if (single) void submit();
  }

  async function submit() {
    const got = typed.join('');
    const ok = textTokens(got).join('') === textTokens(item).join('');
    const slow = single ? 1500 : 2500 + 300 * item.length;
    // Replays are counted, not penalised: timing runs from the end of the last play.
    const ms = firstKey || 2000;
    if (stage !== 'callsigns' && stage !== 'phrases') {
      await answer(map, `${prefix}${item}`, ok, ms, slow, !ok && single ? { want: item, got } : undefined);
    }
    log.push({ item, got, ok, ms: firstKey || 2000, replays });
    n++;
    const rows: RhythmRow[] = [];
    if (!ok && single && got) {
      const a = buildSchedule(item, { charWpm: receiveSpeeds().charWpm, leadIn: 0, tail: 0 });
      const b = buildSchedule(got, { charWpm: receiveSpeeds().charWpm, leadIn: 0, tail: 0 });
      rows.push({ label: 'It was', marks: a.marks }, { label: 'Your pick', marks: b.marks, style: 'outline' });
    }
    last = { item, got, ok, rows };
    // Strict mode: the answer is spoken before it is shown.
    holding = strict();
    phase = 'reveal';
    if (strict()) await say(item);
    holding = false;
    if (!ok) {
      await (await playCw(item, { plain: true })).done;
      if (single && got && textTokens(got).length === 1) {
        await wait(250);
        await (await playCw(got, { plain: true })).done;
      }
    } else {
      if (!strict()) void say(item);
      await wait(800);
      if (phase === 'reveal' && last?.item === item) await next();
    }
  }

  function wrap() {
    phase = 'wrap';
    void keepAwake(false);
    void saveSession({
      mode: `pocket-${stage}`,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: log.length,
      accuracy: log.filter((l) => l.ok).length / Math.max(1, log.length),
      wpm: receiveSpeeds().charWpm,
    });
  }

  onDestroy(() => {
    signal.receiving = false;
    engine.stopAll();
    void keepAwake(false);
  });

  const pairs = $derived.by(() => {
    const c = new Map<string, number>();
    for (const l of log) if (!l.ok && l.got) c.set(`${l.item}>${l.got}`, (c.get(`${l.item}>${l.got}`) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  });
  const right = $derived(log.filter((l) => l.ok).length);
  const avgMs = $derived(log.length ? log.reduce((a, l) => a + l.ms, 0) / log.length : 0);
  const replayed = $derived(log.filter((l) => l.replays > 0));
  const title = $derived(stage.charAt(0).toUpperCase() + stage.slice(1));
</script>

<svelte:window
  onkeydown={(e) => {
    if (phase === 'learn' && e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      learnTap();
    } else if (e.key === 'Escape') {
      go('pocket');
    } else if (e.key === 'Enter' && (phase === 'ready' || phase === 'wrap') && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      void begin();
    }
  }}
/>

<section class="round">
  <div class="top">
    <a class="back" href={href('pocket')} aria-label="Back to Pocket"><Icon name="back" size={18} /></a>
    <span class="muted">{stage === 'characters' ? level.name : title}</span>
    <span class="num muted">{Math.min(n + (phase === 'quiz' ? 1 : 0), ROUND)} / {ROUND}</span>
  </div>
  <div class="bar" aria-hidden="true"><span style:width="{(n / ROUND) * 100}%"></span></div>

  {#if phase === 'ready'}
    <div class="center">
      <p class="muted">{ROUND} items{stage === 'characters' ? ` from ${level.known.length} characters` : ''}.</p>
      <button type="button" class="play" onclick={begin} aria-label="Start the round"><Icon name="play" size={40} /></button>
      <span class="muted">Start</span>
    </div>
  {:else if phase === 'empty'}
    <p class="muted">Not enough items for this stage at {level.name}. Pick another stage or add to the custom set.</p>
  {:else if phase === 'learn'}
    <div class="center">
      <span class="label">New</span>
      {#if learnItem}<TokenText tokens={[{ t: learnItem }]} size="xl" />{:else if settings.track === 'licw'}
        <button type="button" class="play" onclick={learnTap} aria-label="Tap when it plays"><Icon name="key" size={40} /></button>
        <span class="muted">Tap when it plays</span>
        <span class="num muted">{learnTaps} of {learnPlays}</span>
      {:else}<p class="big muted">Listen</p>{/if}
    </div>
  {:else if phase === 'wrap'}
    <dl class="facts">
      <div><dt class="label">Right</dt><dd class="num big">{right} of {log.length}</dd></div>
      <div><dt class="label">Average answer</dt><dd class="num big">{(avgMs / 1000).toFixed(1)} s</dd></div>
      <div><dt class="label">Replayed</dt><dd class="num big">{replayed.length}</dd></div>
    </dl>
    {#if replayed.length}
      <p class="muted">Replayed: <span class="mono">{[...new Set(replayed.map((l) => l.item))].join(' ')}</span></p>
    {/if}
    {#if pairs.length}
      <h3>Mixed up</h3>
      <ul class="pairs">
        {#each pairs as [p, count] (p)}
          <li class="mono">{p.split('>')[0]} as {p.split('>')[1]} <span class="muted num">×{count}</span></li>
        {/each}
      </ul>
    {/if}
    <div class="actions">
      <Button kind="primary" onclick={begin}>Another round</Button>
      <Button href={href('pocket')}>Stages</Button>
    </div>
  {:else}
    <div class="center">
      <button type="button" class="play" onclick={replay} aria-label="Play again" disabled={phase !== 'quiz'}>
        <Icon name="play" size={40} />
      </button>
      {#if phase === 'reveal' && holding}
        <span class="muted">Listen</span>
      {:else if phase === 'reveal' && last}
        <span class="label">It was</span>
        <TokenText tokens={textTokens(last.item).map((t) => ({ t }))} size="xl" />
        {#if !last.ok}<span class="muted">You typed {last.got || 'nothing'}</span>{/if}
        {#if last.rows.length && !strict()}<div class="rhythm"><RhythmView rows={last.rows} labelWidth={90} /></div>{/if}
      {:else}
        <span class="muted">Tap to replay</span>
        <p class="typed mono">{typed.join('') || ' '}</p>
      {/if}
    </div>
    <div class="kb">
      {#if phase === 'reveal' && last && !last.ok}
        <Button kind="primary" wide onclick={next} hint="Enter">Next</Button>
      {/if}
      <Keyboard {onkey} showSpace={!single} showDone={!single} disabled={phase !== 'quiz'} />
    </div>
  {/if}
</section>

<style>
  .round {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: 560px;
    margin: 0 auto;
    min-height: calc(100dvh - 200px);
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    justify-content: space-between;
  }

  .back {
    color: var(--muted);
    min-width: 40px;
    min-height: 40px;
    display: inline-flex;
    align-items: center;
  }

  .bar {
    height: 2px;
    background: var(--line);
  }

  .bar span {
    display: block;
    height: 2px;
    background: var(--signal);
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-2) 0;
    text-align: center;
    flex: 1;
  }

  .play {
    width: 112px;
    height: 112px;
    border-radius: 50%;
    border: 2px solid var(--signal);
    background: var(--signal-soft);
    color: var(--signal);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--s-1);
  }

  .play:disabled {
    opacity: 0.6;
  }

  .typed {
    font-size: var(--size-xl);
    line-height: 1.2;
    min-height: 1.2em;
  }

  .big {
    font-size: var(--size-l);
  }

  .rhythm {
    width: 100%;
    max-width: 360px;
  }

  .kb {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin-top: auto;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-4);
    margin: var(--s-2) 0 0;
  }

  .facts dd {
    margin: 0;
  }

  .pairs {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .actions {
    display: flex;
    gap: var(--s-1);
    flex-wrap: wrap;
  }
</style>
