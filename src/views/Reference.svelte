<script lang="ts">
  // Character reference: each character's rhythm drawn to scale, with audio.
  // Hidden in LICW strict mode.
  import RhythmView from '../ui/RhythmView.svelte';
  import { buildSchedule } from '../lib/morse/schedule';
  import { LETTER_TOKENS, DIGIT_TOKENS, displayToken, isProsign } from '../lib/morse/code';
  import { strict } from '../lib/state/settings.svelte';
  import { href } from '../lib/state/router.svelte';
  import { playCw } from '../lib/train/session';

  const GROUPS = [
    { name: 'Letters', tokens: LETTER_TOKENS },
    { name: 'Numbers', tokens: DIGIT_TOKENS },
    { name: 'Punctuation', tokens: ['.', ',', '?', '/', "'", '-', '(', ')', ':', '@'] },
    { name: 'Prosigns', tokens: ['<AR>', '<SK>', '<BT>', '<KN>', '<BK>', '<AS>'] },
  ];
  // One shared scale: the longest character (a 5-dah number) sets the width.
  const marksOf = (t: string) => buildSchedule(t, { charWpm: 20, leadIn: 0, tail: 0 }).marks;
  const zero = buildSchedule('0', { charWpm: 20, leadIn: 0, tail: 0 }).marks;
  const span = zero[zero.length - 1].end - zero[0].start;
</script>

<section class="ref">
  <h1>Character reference</h1>
  {#if strict()}
    <p class="muted">The character reference is hidden in LICW strict mode. You can turn strict mode off in <a href={href('settings')}>Settings</a>.</p>
  {:else}
    <p class="muted small">Rhythm drawn to scale at 20 wpm. Select a character to hear it.</p>
    {#each GROUPS as g (g.name)}
      <h2>{g.name}</h2>
      <ul class="grid">
        {#each g.tokens as t (t)}
          <li>
            <button type="button" onclick={() => playCw(t, { charWpm: 20, plain: true })} aria-label="Play {displayToken(t)}">
              <span class="mono tok" class:prosign={isProsign(t)}>{displayToken(t)}</span>
              <span class="bars">
                <RhythmView rows={[{ label: '', marks: marksOf(t) }]} labelWidth={0} height={10} fixedSpan={span} />
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</section>

<style>
  .ref {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .small {
    font-size: var(--size-s);
  }

  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0 var(--s-3);
  }

  button {
    width: 100%;
    display: grid;
    grid-template-columns: 3ch 1fr;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--target);
    border: 0;
    border-bottom: var(--hairline) solid var(--line);
    background: transparent;
    text-align: left;
    padding: 0;
  }

  button:hover .tok {
    color: var(--signal);
  }

  .tok {
    font-size: var(--size-l);
  }

  .bars {
    display: block;
  }
</style>
