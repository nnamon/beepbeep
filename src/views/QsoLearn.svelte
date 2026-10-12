<script lang="ts">
  // Learn QSOs: guided lessons that take a standard contact apart. Each step
  // explains one part, plays what the other station sends or shows what you
  // send, and checks it, so you can get it wrong and try again. Every run
  // meets a new station.
  import { onDestroy, untrack } from 'svelte';
  import DrillFrame from '../ui/DrillFrame.svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import TokenText, { type Tok } from '../ui/TokenText.svelte';
  import InputHelp from '../ui/InputHelp.svelte';
  import { LiveDecoder } from '../lib/audio/live';
  import { engine } from '../lib/audio/engine';
  import { href, route } from '../lib/state/router.svelte';
  import { effectiveMix, settings, strict } from '../lib/state/settings.svelte';
  import { signal, startMic, touchKeyArea } from '../lib/state/signal.svelte';
  import { getKv, setKv } from '../lib/state/db';
  import { LESSONS, newStation, type Me, type Step } from '../lib/qso/lessons';
  import type { BotIdentity } from '../lib/qso/bot';
  import { checkField, checkSend, type FieldCheck, type Verdict } from '../lib/qso/check';
  import { words } from '../lib/qso/parse';
  import { followInput, playCw, receiveSpeeds, saveSession, sendInput } from '../lib/train/session';
  import { textTokens } from '../lib/util/text';
  import { mulberry32, randomSeed } from '../lib/util/random';
  import { keepAwake } from '../lib/util/wakelock';

  const lessonId = $derived(route.path[2] ?? '');
  const lesson = $derived(LESSONS.find((l) => l.id === lessonId) ?? null);

  // Your station: what you send in the lessons.
  const me = $derived<Me>({ call: settings.you.call, name: settings.you.name, qth: settings.you.qth, state: settings.you.state });
  const ready = $derived(!!(me.call.trim() && me.name.trim() && me.qth.trim()));

  let done = $state<Record<string, number>>({});
  void getKv<Record<string, number>>('qsoLessons', {}).then((d) => (done = d));

  // ---- A run of one lesson ----
  let them = $state.raw<BotIdentity | null>(null);
  let steps = $state.raw<Step[]>([]);
  let idx = $state(0);
  let firstTry = $state(0);
  let retried = false;
  let startedAt = 0;
  let finished = $state(false);
  const step = $derived(steps[idx] ?? null);

  // Listen steps: what you copied, and the verdict on each field.
  let copied = $state<Record<string, string>>({});
  let fieldResults = $state<Record<string, FieldCheck> | null>(null);
  let revealed = $state(false);
  let played = $state(false);

  // Send steps: typed or keyed text, and the verdict.
  let typed = $state('');
  let keyed = $state<Tok[]>([]);
  let verdict = $state<Verdict | null>(null);
  let showModel = $state(false);
  let sentText = $state('');

  // A run in progress survives going to Setup and back (or a reload): same
  // station, same step.
  const RUN = 'beepbeep.qsoLearn.run';
  interface Saved {
    lesson: string;
    them: BotIdentity;
    idx: number;
    firstTry: number;
    at: number;
  }

  function saveRun() {
    if (!lesson || !them) return;
    try {
      sessionStorage.setItem(RUN, JSON.stringify({ lesson: lesson.id, them, idx, firstTry, at: Date.now() } satisfies Saved));
    } catch {
      /* private mode: the run just isn't kept */
    }
  }

  function clearRun() {
    try {
      sessionStorage.removeItem(RUN);
    } catch {
      /* nothing kept */
    }
  }

  function savedRun(id: string): Saved | null {
    try {
      const s = JSON.parse(sessionStorage.getItem(RUN) ?? 'null') as Saved | null;
      return s && s.lesson === id && Date.now() - s.at < 2 * 3600_000 ? s : null;
    } catch {
      return null;
    }
  }

  // Opening a lesson: pick up a run in progress, or wait for Start.
  $effect(() => {
    const id = lessonId;
    untrack(() => {
      const l = LESSONS.find((x) => x.id === id);
      const s = l ? savedRun(id) : null;
      them = s?.them ?? null;
      steps = s && l ? l.steps({ me, them: s.them }) : [];
      idx = s?.idx ?? 0;
      firstTry = s?.firstTry ?? 0;
      finished = false;
      startedAt = Date.now();
      if (steps.length) enter();
      else stopListening();
    });
  });

  function begin() {
    if (!lesson) return;
    them = newStation(mulberry32(randomSeed()), effectiveMix());
    steps = lesson.steps({ me, them });
    idx = 0;
    firstTry = 0;
    finished = false;
    startedAt = Date.now();
    void keepAwake(true);
    saveRun();
    enter();
  }

  function enter() {
    copied = {};
    fieldResults = null;
    revealed = false;
    played = false;
    typed = '';
    keyed = [];
    verdict = null;
    showModel = false;
    sentText = '';
    retried = false;
    if (step?.kind === 'send' && settings.qsoInput === 'key') void listen();
    else stopListening();
  }

  function next() {
    if (!retried) firstTry++;
    if (idx < steps.length - 1) {
      idx++;
      saveRun();
      enter();
    } else void finish();
  }

  async function finish() {
    finished = true;
    clearRun();
    stopListening();
    void keepAwake(false);
    if (lesson) {
      done = { ...done, [lesson.id]: (done[lesson.id] ?? 0) + 1 };
      void setKv('qsoLessons', { ...done });
    }
    void saveSession({
      mode: 'qso-learn',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: true,
      items: steps.length,
      accuracy: steps.length ? firstTry / steps.length : null,
      wpm: receiveSpeeds().charWpm,
    });
  }

  // ---- Hearing the other station ----
  async function play(text: string, slow = false) {
    const sp = receiveSpeeds();
    const pb = await playCw(text, { charWpm: sp.charWpm, effectiveWpm: slow ? Math.max(5, sp.effectiveWpm - 3) : sp.effectiveWpm, plain: true });
    played = true;
    await pb.done;
  }

  function checkCopy() {
    if (step?.kind !== 'listen') return;
    const r: Record<string, FieldCheck> = {};
    for (const f of step.fields) r[f.key] = checkField(copied[f.key] ?? '', f.answer, f.kind);
    fieldResults = r;
    if (Object.values(r).some((x) => x.result === 'wrong')) retried = true;
  }
  const copyOk = $derived(!!fieldResults && Object.values(fieldResults).every((x) => x.result !== 'wrong'));

  // ---- Your sending: typed, or keyed and decoded ----
  let live: LiveDecoder | null = null;
  let lastKey = 0;
  let watch: ReturnType<typeof setInterval> | null = null;
  let req = 0;

  // The touch key stays available for the whole lesson, whatever input you start on.
  $effect(() => {
    if (steps.length && !finished) return touchKeyArea();
  });
  // Switching input mid-step (Use the touch key, Key with) moves the decoder
  // over at once, or starts one if the microphone never did; typing stops it.
  $effect(() => {
    void settings.input;
    void settings.qsoInput;
    untrack(() => {
      const keying = step?.kind === 'send' && settings.qsoInput === 'key' && !verdict;
      if (!keying) return stopListening();
      if (live) void followInput(live);
      else void listen();
    });
  });

  async function listen() {
    if (settings.input === 'mic' && !signal.micOn && !(await startMic())) return;
    await engine.ensure();
    if (!live) {
      live = new LiveDecoder({
        source: sendInput(),
        charWpm: settings.sendWpm,
        pitch: settings.pitch,
        onOutput: () => {
          const n = ++req;
          void live?.settled().then((outs) => {
            if (n !== req || verdict) return;
            keyed = outs.map((x) => (x.kind === 'space' ? { t: ' ' } : { t: x.char.token ?? '⁇', state: x.char.token ? 'ok' : 'unknown' }));
          });
        },
        onKey: () => (lastKey = performance.now()),
      });
      await live.start();
      watch = setInterval(() => {
        if (step?.kind === 'send' && !verdict && keyed.length && lastKey && performance.now() - lastKey > settings.overTimeout * 1000) void doneKeying();
      }, 200);
    }
    live.resetOver();
  }

  function stopListening() {
    if (watch) clearInterval(watch);
    watch = null;
    live?.stop();
    live = null;
  }

  async function doneKeying() {
    if (!live || verdict) return;
    live.flush();
    req++;
    keyed = (await live.settle()).map((x) => (x.kind === 'space' ? { t: ' ' } : { t: x.char.token ?? '⁇', state: x.char.token ? 'ok' : 'unknown' }));
    judge(keyed.map((t) => t.t).join('').trim());
  }

  function judge(text: string) {
    if (step?.kind !== 'send' || !text) return;
    sentText = text;
    verdict = checkSend(text, step.slots);
    if (verdict.result !== 'pass') retried = true;
  }

  function again() {
    verdict = null;
    typed = '';
    keyed = [];
    sentText = '';
    lastKey = 0;
    live?.resetOver();
  }

  // Words you sent that the model doesn't have (BT and R are always fine).
  const extras = $derived.by(() => {
    if (!verdict || step?.kind !== 'send') return [];
    const model = new Set([...words(step.model), 'BT', 'R', 'RR']);
    return verdict.extras.filter((w) => !model.has(w));
  });

  onDestroy(() => {
    stopListening();
    void keepAwake(false);
  });

  function onkey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (e.key !== 'Enter' || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A'))) return;
    if (lesson && ready && (!steps.length || finished)) {
      e.preventDefault();
      begin();
    }
  }

  const KEY_WITH = $derived([
    { value: 'mic' as const, label: 'Microphone' },
    { value: 'touch' as const, label: 'Touch key' },
    { value: settings.input === 'iambicA' || settings.input === 'iambicB' ? settings.input : ('straight' as const), label: 'Keyboard' },
  ]);

  const headline = (v: Verdict) => (v.result === 'pass' ? 'Right.' : v.result === 'almost' ? 'Almost.' : 'Not yet.');
</script>

<svelte:window onkeydown={onkey} />

{#if !lesson}
  <section class="list">
    <div class="head">
      <h1>Learn QSOs</h1>
      <a href={href('qso')}>On the air: the QSO simulator</a>
    </div>
    <p class="lead">
      A standard contact, one part at a time. Each part is explained; you hear what the other station sends and copy it, or
      send your part and BeepBeep checks it. Get it wrong as often as you like. Each run meets a new station.
    </p>

    <div class="you">
      <h2>Your station</h2>
      <div class="fields">
        <label><span class="label">Call</span><input bind:value={settings.you.call} autocapitalize="characters" autocomplete="off" spellcheck="false" /></label>
        <label><span class="label">Name</span><input bind:value={settings.you.name} autocapitalize="characters" autocomplete="off" spellcheck="false" /></label>
        <label><span class="label">QTH, where you are</span><input bind:value={settings.you.qth} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="SALEM, LONDON, SINGAPORE" /></label>
        <label><span class="label">State, province or country (optional)</span><input bind:value={settings.you.state} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="MA, ON, JAPAN" /></label>
      </div>
      <p class="muted small">
        Used in what you send. If you aren't licensed yet, use any practice call, such as N0CALL. The state, province or
        country goes in contest and POTA exchanges; leave it blank if it would repeat your QTH.
      </p>
    </div>

    <div class="options">
      <div>
        <span class="label">What to send</span>
        <Segmented label="What to send" bind:value={settings.qsoHelp} options={[{ value: 'text', label: 'Show the text' }, { value: 'outline', label: 'Show an outline' }, { value: 'none', label: 'Nothing' }]} />
      </div>
      <div>
        <span class="label">Your part</span>
        <Segmented label="Your part" bind:value={settings.qsoInput} options={[{ value: 'key', label: 'Key it' }, { value: 'type', label: 'Type it' }]} />
      </div>
    </div>
    <p class="muted small">Typing lets you learn the order first; keying is the real thing. Start with the text shown, then try an outline, then nothing.</p>

    <ol class="lessons">
      {#each LESSONS as l, i (l.id)}
        <li>
          <a href={href('qso', 'learn', l.id)} aria-disabled={!ready}>
            <span class="name"><span class="n num">{i + 1}</span>{l.name}</span>
            <span class="text muted">{l.summary}</span>
          </a>
          {#if done[l.id]}<span class="done muted small">Done {done[l.id] === 1 ? 'once' : `${done[l.id]} times`}</span>{/if}
        </li>
      {/each}
    </ol>
    {#if !ready}<p class="warn">Fill in your call, name and QTH first: the lessons put them in what you send.</p>{/if}
  </section>
{:else}
  <DrillFrame
    title={lesson.name}
    eyebrow={steps.length && !finished ? `Step ${idx + 1} of ${steps.length}${step ? ` · ${step.title}` : ''}` : 'Learn QSOs'}
    back="qso/learn"
  >
    {#if !ready}
      <p class="warn">Fill in your station first. <a href={href('qso', 'learn')}>Back to the lessons</a></p>
    {:else if !steps.length}
      <p class="lead">{lesson.summary}</p>
      <p class="muted">You will meet a new station. Take your time; you can repeat any step.</p>
    {:else if finished}
      <p class="big">Lesson done.</p>
      <p>{firstTry} of {steps.length} steps right the first time.</p>
      <p class="muted">Run it again: you will meet a different station.</p>
    {:else if step}
      <div class="explain">
        {#each step.explain as p (p)}<p>{p}</p>{/each}
      </div>

      {#if step.kind === 'note'}
        {#if step.play}<div><Button onclick={() => play(step.play!)}>{played ? 'Play again' : 'Play'}</Button></div>{/if}
      {:else if step.kind === 'listen'}
        <div class="row">
          <Button kind={played ? 'secondary' : 'primary'} onclick={() => play(step.play)}>{played ? 'Play again' : 'Play'}</Button>
          {#if played}<Button onclick={() => play(step.play, true)}>Slower</Button>{/if}
        </div>
        <div class="fields">
          {#each step.fields as f (f.key)}
            <label>
              <span class="label">{f.label}</span>
              <input
                bind:value={copied[f.key]}
                autocapitalize="characters"
                autocomplete="off"
                spellcheck="false"
                class="mono"
                onkeydown={(e) => e.key === 'Enter' && checkCopy()}
              />
              {#if fieldResults?.[f.key]}
                {@const r = fieldResults[f.key]}
                <span class="verdict {r.result}">{r.result === 'right' ? 'Right' : r.result === 'close' ? `Close: it was ${r.answer}` : revealed ? `It was ${r.answer}` : 'Not quite. Listen again.'}</span>
              {/if}
            </label>
          {/each}
        </div>
        {#if revealed}
          <div class="sent"><span class="label">What they sent</span><TokenText tokens={textTokens(step.play).map((t) => ({ t }))} size="m" /></div>
        {/if}
      {:else if step.kind === 'send'}
        {#if settings.qsoHelp === 'text' || showModel}
          <div class="model"><span class="label">Send this</span><TokenText tokens={textTokens(step.model).map((t) => ({ t }))} size="l" /></div>
        {:else if settings.qsoHelp === 'outline'}
          <div class="model"><span class="label">Outline</span><p class="outline">{step.outline}</p></div>
        {/if}
        <div class="row">
          <Button onclick={() => playCw(step.model, { charWpm: settings.sendWpm, effectiveWpm: settings.sendWpm, plain: true })}>Hear it</Button>
          {#if settings.qsoHelp !== 'text' && !showModel}<Button kind="quiet" onclick={() => (showModel = true)}>Show me</Button>{/if}
        </div>

        {#if settings.qsoInput === 'type'}
          <label class="field">
            <span class="label">Type what you would send</span>
            <input
              bind:value={typed}
              class="mono"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              disabled={!!verdict}
              onkeydown={(e) => e.key === 'Enter' && judge(typed)}
            />
          </label>
        {:else}
          <div class="keyed" aria-live="polite">
            <span class="label">{verdict ? 'You sent' : 'Decoded'}</span>
            {#if verdict || !strict()}
              {#if keyed.length}<TokenText tokens={keyed} size="l" />{:else}<p class="muted">Send when you are ready. It is checked {settings.overTimeout} s after you stop, or press Done.</p>{/if}
            {:else}
              <p class="muted">Send when you are ready. It shows after you stop.</p>
            {/if}
          </div>
          {#if !verdict}
            <div class="keywith">
              <span class="label">Key with</span>
              <Segmented label="Key with" bind:value={settings.input} options={KEY_WITH} />
            </div>
            {#if settings.input === 'mic'}
              <p class="muted small">
                The microphone listens for your key's tone. If nothing shows when you send, key with the touch key instead, or
                calibrate in <a href={href('setup')}>Setup</a>; you come back to this step.
              </p>
            {:else}
              <InputHelp />
            {/if}
          {/if}
        {/if}

        {#if verdict}
          <div class="result {verdict.result}">
            <p class="big">{headline(verdict)}</p>
            {#if verdict.notes.length}<ul>{#each verdict.notes as n, i (i)}<li>{n}</li>{/each}</ul>{/if}
            {#if extras.length}<p class="muted">Not needed here: {extras.join(' ')}.</p>{/if}
            {#if verdict.result !== 'pass' && settings.qsoHelp !== 'text' && !showModel}<p class="muted">Show me puts the text on screen.</p>{/if}
          </div>
        {/if}
      {/if}
    {/if}

    {#snippet footer()}
      {#if !ready}
        <Button href={href('qso', 'learn')}>Back</Button>
      {:else if !steps.length || finished}
        <Button kind="primary" onclick={begin} hint="Enter">{finished ? 'Again, new station' : 'Start'}</Button>
        {#if finished}
          {@const at = LESSONS.findIndex((l) => l.id === lesson.id)}
          {#if LESSONS[at + 1]}<Button href={href('qso', 'learn', LESSONS[at + 1].id)}>Next lesson</Button>{/if}
          <Button kind="quiet" href={href('qso', 'learn')}>All lessons</Button>
        {/if}
      {:else if step?.kind === 'note'}
        <Button kind="primary" onclick={next}>Next</Button>
      {:else if step?.kind === 'listen'}
        {#if copyOk}
          <Button kind="primary" onclick={next}>Next</Button>
        {:else}
          <Button kind="primary" onclick={checkCopy} disabled={!played}>Check</Button>
          {#if fieldResults && !revealed}<Button onclick={() => { revealed = true; retried = true; }}>Show what they sent</Button>{/if}
          {#if revealed}<Button onclick={next}>Next</Button>{/if}
        {/if}
      {:else if step?.kind === 'send'}
        {#if verdict}
          {#if verdict.result !== 'try'}<Button kind="primary" onclick={next}>Next</Button>{/if}
          <Button kind={verdict.result === 'try' ? 'primary' : 'secondary'} onclick={again}>Try again</Button>
          {#if verdict.result === 'try'}<Button kind="quiet" onclick={() => { retried = true; next(); }}>Skip</Button>{/if}
        {:else if settings.qsoInput === 'type'}
          <Button kind="primary" onclick={() => judge(typed)} disabled={!typed.trim()}>Check</Button>
        {:else}
          <Button kind="primary" onclick={doneKeying} disabled={!keyed.length}>Done</Button>
          <Button kind="quiet" onclick={again}>Clear</Button>
        {/if}
      {/if}
    {/snippet}
  </DrillFrame>
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    max-width: 760px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-1) var(--s-3);
  }

  .lead,
  .explain p {
    max-width: var(--reading);
  }

  .explain {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  .fields label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  input {
    min-height: var(--target);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    padding: 0 var(--s-1);
    font: inherit;
    font-size: var(--size-field);
    text-transform: uppercase;
    max-width: 100%;
  }

  .field input {
    width: min(560px, 100%);
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-4);
  }

  .options > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .lessons {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--hairline) solid var(--line);
  }

  .lessons li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    border-bottom: var(--hairline) solid var(--line);
  }

  .lessons a {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--s-2) 0;
    text-decoration: none;
  }

  .lessons a[aria-disabled='true'] {
    pointer-events: none;
    opacity: 0.55;
  }

  .lessons a:hover .name {
    text-decoration: underline;
    text-decoration-color: var(--signal);
    text-underline-offset: 3px;
  }

  .name {
    font-weight: var(--weight-strong);
  }

  .n {
    color: var(--muted);
    font-weight: normal;
    margin-right: var(--s-1);
  }

  .small {
    font-size: var(--size-s);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }

  .model,
  .keyed,
  .sent {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .outline {
    font-size: var(--size-m);
  }

  .verdict {
    font-size: var(--size-s);
  }

  .verdict.right {
    color: var(--ink);
  }

  .verdict.close,
  .verdict.wrong {
    color: var(--fault);
  }

  .result {
    border-left: 2px solid var(--line);
    padding-left: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .result.pass {
    border-left-color: var(--signal);
  }

  .result.try,
  .result.almost {
    border-left-color: var(--fault);
  }

  .result ul {
    margin: 0;
    padding-left: 1.2em;
  }

  .big {
    font-size: var(--size-l);
    font-weight: var(--weight-strong);
  }

  .keywith {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .warn {
    border-left: 2px solid var(--signal);
    padding-left: var(--s-1);
  }
</style>
