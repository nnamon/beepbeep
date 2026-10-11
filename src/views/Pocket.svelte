<script lang="ts">
  import { onMount } from 'svelte';
  import { route, href } from '../lib/state/router.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { currentLevel, trackLevels } from '../lib/train/session';
  import { CHUNKS, COMMON_WORDS, QSO_WORDS, wordsFromKnown } from '../lib/train/words';
  import { getKv, setKv } from '../lib/state/db';
  import { ALL_TOKENS, displayToken, isProsign } from '../lib/morse/code';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import PocketRound from './PocketRound.svelte';

  const sub = $derived(route.path[1] ?? '');
  const stageId = $derived(route.path[2] ?? 'characters');
  const level = $derived(currentLevel());
  const known = $derived(new Set(level.known));
  const levels = $derived(trackLevels());
  const idx = $derived(levels.findIndex((l) => l.id === level.id));

  function step(d: number) {
    settings.level[settings.track] = levels[Math.max(0, Math.min(levels.length - 1, idx + d))].id;
  }

  let custom = $state<{ chars: string[]; words: string[] }>({ chars: [], words: [] });
  let wordsText = $state('');

  onMount(async () => {
    custom = await getKv('pocket.custom', { chars: [], words: [] }).catch(() => ({ chars: [], words: [] }));
    wordsText = custom.words.join(' ');
  });

  const STAGES = $derived([
    { id: 'characters', name: 'Characters', count: level.known.length, note: level.name },
    { id: 'chunks', name: 'Chunks', count: wordsFromKnown(CHUNKS, known).length, note: 'CQ, DE, TU, 5NN, -ING' },
    { id: 'words', name: 'Words', count: wordsFromKnown([...QSO_WORDS, ...COMMON_WORDS], known).length, note: 'Operating and common words' },
    { id: 'callsigns', name: 'Callsigns', count: null, note: 'Generated, with real prefixes' },
    { id: 'phrases', name: 'Phrases', count: null, note: 'Whole QSO lines' },
    { id: 'custom', name: 'Custom', count: custom.chars.length + custom.words.length, note: 'Your own set' },
  ]);

  function toggle(t: string) {
    custom.chars = custom.chars.includes(t) ? custom.chars.filter((c) => c !== t) : [...custom.chars, t];
    void save();
  }

  async function save() {
    custom.words = wordsText.toUpperCase().split(/[\s,]+/).filter(Boolean).slice(0, 200);
    await setKv('pocket.custom', $state.snapshot(custom)).catch(() => undefined);
  }
</script>

{#if sub === 'round'}
  {#key stageId}<PocketRound stage={stageId} customSet={custom} />{/key}
{:else if sub === 'custom'}
  <section class="custom">
    <div class="head">
      <h1>Custom set</h1>
      <Button kind="primary" href={href('pocket', 'round', 'custom')}>Start a round</Button>
    </div>
    <h3>Characters</h3>
    <div class="grid" role="group" aria-label="Characters in the set">
      {#each ALL_TOKENS.filter((t) => t !== '<HH>' && t !== '_' && t !== '!' && t !== '"' && t !== ';') as t (t)}
        <button
          type="button"
          class="chip mono"
          class:on={custom.chars.includes(t)}
          aria-pressed={custom.chars.includes(t)}
          onclick={() => toggle(t)}><span class:prosign={isProsign(t)}>{displayToken(t)}</span></button
        >
      {/each}
    </div>
    <label class="words">
      <h3>Words</h3>
      <textarea
        class="mono"
        rows="4"
        bind:value={wordsText}
        onchange={save}
        autocapitalize="characters"
        spellcheck="false"
        placeholder="CQ TNX FB 73"
      ></textarea>
    </label>
  </section>
{:else}
  <section class="home">
    <div class="head">
      <h1>Pocket</h1>
      <div class="lesson">
        <span class="muted">{settings.track === 'licw' ? 'LICW' : 'Koch'}</span>
        <Button kind="secondary" label="Previous lesson" disabled={idx <= 0} onclick={() => step(-1)}><Icon name="back" size={18} /></Button>
        <strong>{level.name}</strong>
        <Button kind="secondary" label="Next lesson" disabled={idx >= levels.length - 1} onclick={() => step(1)}><Icon name="forward" size={18} /></Button>
      </div>
    </div>
    <p class="muted lead">
      Learn and quiz by ear, no key needed. Each round plays 20, using only what your lesson has covered. Score
      {settings.track === 'licw' ? '80' : '90'}% or better in a Characters round to open the next lesson.
    </p>
    <ul class="stages">
      {#each STAGES as s (s.id)}
        <li>
          <a href={href('pocket', 'round', s.id)}>
            <span class="name">{s.name}</span>
            <span class="muted">{s.note}</span>
            {#if s.count !== null}<span class="num muted count">{s.count}</span>{/if}
          </a>
        </li>
      {/each}
    </ul>
    <a class="edit" href={href('pocket', 'custom')}>Edit custom set</a>
  </section>
{/if}

<style>
  .home,
  .custom {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: 720px;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }

  .lead {
    max-width: var(--reading);
  }

  .lesson {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }

  .lesson :global(.btn) {
    padding: 0 var(--s-1);
  }

  .lesson strong {
    min-width: 9ch;
    text-align: center;
  }

  .stages {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--hairline) solid var(--line);
  }

  .stages a {
    display: grid;
    grid-template-columns: 9rem 1fr auto;
    gap: var(--s-2);
    align-items: baseline;
    min-height: var(--target);
    padding: var(--s-2) 0;
    border-bottom: var(--hairline) solid var(--line);
    text-decoration: none;
  }

  .stages a:hover .name {
    text-decoration: underline;
    text-decoration-color: var(--signal);
    text-underline-offset: 3px;
  }

  .name {
    font-weight: var(--weight-strong);
  }

  .edit {
    color: var(--muted);
    font-size: var(--size-s);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
    gap: var(--s-half);
  }

  .chip {
    min-height: var(--target);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--size-m);
  }

  .chip.on {
    border-color: var(--signal);
    background: var(--signal-soft);
    font-weight: var(--weight-strong);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  textarea {
    width: 100%;
    padding: var(--s-1);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--size-m);
    text-transform: uppercase;
  }

  @media (max-width: 600px) {
    .stages a {
      grid-template-columns: 1fr auto;
    }

    .stages a .muted:not(.count) {
      grid-column: 1;
      grid-row: 2;
      font-size: var(--size-s);
    }
  }
</style>
