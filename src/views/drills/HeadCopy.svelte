<script lang="ts">
  // Head copy: an over plays with nothing on screen and no typing (optionally
  // three keywords of notes). Afterwards, questions about what was said.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import TokenText from '../../ui/TokenText.svelte';
  import { engine } from '../../lib/audio/engine';
  import { signal } from '../../lib/state/signal.svelte';
  import { maybeTaper, playCw, receiveSpeeds, saveSession } from '../../lib/train/session';
  import { makeIdentity, type BotIdentity } from '../../lib/qso/bot';
  import { editDistance, textTokens } from '../../lib/util/text';
  import { mulberry32, pick, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

  const rng = mulberry32(randomSeed());
  signal.receiving = true;

  type Field = 'name' | 'qth' | 'rig' | 'ant' | 'wx' | 'ask';
  const ASKS = [
    { text: 'HW CPY?', label: 'How you copy' },
    { text: 'WAT RIG HR?', label: 'Your rig' },
    { text: 'HW IS UR WX?', label: 'Your weather' },
  ];

  let notesAllowed = $state(false);
  let stage = $state<'ready' | 'playing' | 'questions' | 'done'>('ready');
  let id: BotIdentity | null = null;
  let ask = ASKS[0];
  let text = $state('');
  let notes = $state('');
  let answers = $state<Record<Field, string>>({ name: '', qth: '', rig: '', ant: '', wx: '', ask: '' });
  let marks = $state<Record<Field, boolean>>({ name: false, qth: false, rig: false, ant: false, wx: false, ask: false });
  let startedAt = 0;

  function compose(b: BotIdentity): string {
    ask = pick(rng, ASKS);
    return `GE OM TNX FER CALL = NAME HR IS ${b.name} ${b.name} = QTH IS ${b.qth} ${b.state} = RIG IS ${b.rig} ES ANT IS ${b.ant} = WX HR ${b.wx} = ${ask.text} K`;
  }

  async function start() {
    id = makeIdentity(rng);
    text = compose(id);
    notes = '';
    answers = { name: '', qth: '', rig: '', ant: '', wx: '', ask: '' };
    stage = 'playing';
    startedAt = Date.now();
    void keepAwake(true);
    const sp = receiveSpeeds();
    const pb = await playCw(text, { charWpm: sp.charWpm, effectiveWpm: Math.max(sp.effectiveWpm, sp.charWpm - 4) });
    await pb.done;
    if (stage === 'playing') stage = 'questions';
    void keepAwake(false);
  }

  const near = (a: string, b: string) => {
    const x = a.trim().toUpperCase();
    const y = b.toUpperCase();
    return !!x && (x === y || y.includes(x) || editDistance([...x], [...y]) <= 1);
  };

  function check() {
    const b = id!;
    marks = {
      name: near(answers.name, b.name),
      qth: near(answers.qth, b.qth) || near(answers.qth, `${b.qth} ${b.state}`),
      rig: near(answers.rig, b.rig),
      ant: near(answers.ant, b.ant),
      wx: near(answers.wx, b.wx),
      ask: answers.ask === ask.label,
    };
    stage = 'done';
    const got = Object.values(marks).filter(Boolean).length;
    void saveSession({
      mode: 'head-copy',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: 6,
      accuracy: got / 6,
      wpm: receiveSpeeds().charWpm,
    });
    maybeTaper(got / 6);
  }

  onDestroy(() => {
    signal.receiving = false;
    engine.stopAll();
    void keepAwake(false);
  });

  const fields: { key: Exclude<Field, 'ask'>; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'qth', label: 'QTH' },
    { key: 'rig', label: 'Rig' },
    { key: 'ant', label: 'Antenna' },
    { key: 'wx', label: 'Weather' },
  ];
  const score = $derived(Object.values(marks).filter(Boolean).length);
</script>

<DrillFrame title="Head copy" eyebrow="{receiveSpeeds().charWpm} wpm · no writing while it plays">
  {#if stage === 'ready'}
    <div class="intro">
      <p class="muted">A station sends one over. Nothing shows on screen and you can't type while it plays. Afterwards you answer questions about it, such as the operator's name and rig.</p>
      <Toggle bind:checked={notesAllowed} label="Allow notes" detail="Up to three words while it plays" />
    </div>
  {:else if stage === 'playing'}
    <p class="big muted">Listening</p>
    {#if notesAllowed}
      <label class="notes">
        <span class="label">Notes, three words</span>
        <input
          class="mono"
          bind:value={notes}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          oninput={() => (notes = notes.split(/\s+/).slice(0, 3).join(' '))}
        />
      </label>
    {/if}
  {:else}
    <form class="qs" onsubmit={(e) => { e.preventDefault(); check(); }}>
      {#if notes}<p class="muted">Your notes: <span class="mono">{notes}</span></p>{/if}
      {#each fields as f (f.key)}
        <label class="q">
          <span class="label">{f.label}</span>
          <input
            class="mono"
            bind:value={answers[f.key]}
            disabled={stage === 'done'}
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
          />
          {#if stage === 'done'}<span class="mark" class:ok={marks[f.key]}>{marks[f.key] ? 'Copied' : 'Missed'}</span>{/if}
        </label>
      {/each}
      <fieldset class="q">
        <legend class="label">They asked about</legend>
        <div class="choices">
          {#each ASKS as a (a.label)}
            <label><input type="radio" name="ask" value={a.label} bind:group={answers.ask} disabled={stage === 'done'} /> {a.label}</label>
          {/each}
        </div>
        {#if stage === 'done'}<span class="mark" class:ok={marks.ask}>{marks.ask ? 'Copied' : 'Missed'}</span>{/if}
      </fieldset>
      {#if stage === 'questions'}<Button kind="primary" type="submit">Check</Button>{/if}
    </form>
    {#if stage === 'done'}
      <p class="big">{score} of 6</p>
      <span class="label">The over</span>
      <TokenText tokens={textTokens(text).map((t) => ({ t }))} size="m" />
    {/if}
  {/if}

  {#snippet footer()}
    {#if stage === 'ready' || stage === 'done'}
      <Button kind="primary" onclick={start}>{stage === 'done' ? 'Another over' : 'Play'}</Button>
    {/if}
    {#if stage === 'done'}<Button onclick={() => playCw(text)}>Play it again</Button>{/if}
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
  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: 420px;
  }

  .big {
    font-size: var(--size-l);
    font-weight: var(--weight-strong);
  }

  .notes,
  .q {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }

  .qs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--s-2) var(--s-3);
    align-items: start;
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    grid-column: 1 / -1;
  }

  .choices {
    display: flex;
    gap: var(--s-3);
    flex-wrap: wrap;
  }

  .choices label {
    display: inline-flex;
    gap: var(--s-1);
    align-items: center;
    min-height: 40px;
  }

  input:not([type='radio']) {
    min-height: var(--target);
    padding: 0 var(--s-1);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--size-field);
    text-transform: uppercase;
  }

  input[type='radio'] {
    accent-color: var(--signal);
  }

  .mark {
    font-size: var(--size-s);
    color: var(--muted);
  }

  .mark.ok {
    color: var(--ink);
  }
</style>
