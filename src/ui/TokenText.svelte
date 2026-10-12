<script lang="ts" module>
  export interface Tok {
    t: string;
    state?: 'ok' | 'miss' | 'extra' | 'unknown' | 'pending';
    onclick?: () => void;
  }
</script>

<script lang="ts">
  // Decoded or prompted text: prosigns overlined, misses with a muted dotted
  // underline (never red, never a cross), unknown patterns as a neutral mark.
  import { isProsign, displayToken } from '../lib/morse/code';


  let { tokens, size = 'l', label = '' }: { tokens: Tok[]; size?: 's' | 'm' | 'l' | 'xl'; label?: string } = $props();
</script>

<p class="text {size} mono" aria-label={label || undefined}>
  {#each tokens as k, i (i)}
    {#if k.t === ' '}<span class="sp">{' '}</span>{:else if k.state === 'unknown' || k.t === '⁇'}<button
        type="button"
        class="unknown"
        onclick={k.onclick}
        aria-label="Unrecognised character; play it again">&#9675;</button
      >{:else}<span
        class:prosign={isProsign(k.t)}
        class:miss={k.state === 'miss'}
        class:extra={k.state === 'extra'}
        class:pending={k.state === 'pending'}>{displayToken(k.t)}</span
      >{/if}
  {/each}
</p>

<style>
  /* Lines break at the spaces between words. Only a word wider than the whole line breaks inside. */
  .text {
    margin: 0;
    overflow-wrap: anywhere;
    line-height: 1.4;
    letter-spacing: 0.02em;
  }

  .s {
    font-size: var(--size-s);
  }

  .m {
    font-size: var(--size-m);
  }

  .l {
    font-size: var(--size-l);
  }

  .xl {
    font-size: var(--size-xl);
  }

  /* Kept as typed, and a place to break the line; at a line end it hangs instead of starting the next line. */
  .sp {
    white-space: pre-wrap;
  }

  /*
   * The overline is drawn just above the capitals, not at the top of the line box where a
   * text-decoration overline sits: there it reads as an underline of the line above.
   * The span's box runs from the font's ascent (1 em above the baseline); capitals are 0.68 em tall.
   */
  .prosign {
    position: relative;
    white-space: nowrap;
    text-decoration: none;
  }

  .prosign::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0.02em;
    top: 0.17em;
    border-top: max(1.5px, 0.06em) solid currentcolor;
    pointer-events: none;
  }

  .miss {
    color: var(--muted);
    text-decoration: underline dotted;
    text-decoration-thickness: 2px;
    text-underline-offset: 0.2em;
  }

  .extra {
    color: var(--muted);
  }

  .pending {
    color: var(--muted);
  }

  .unknown {
    position: relative;
    font: inherit;
    color: var(--muted);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  /* A full-size tap target around the one character, without spacing the text out. */
  .unknown::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--target-min);
    height: var(--target-min);
    transform: translate(-50%, -50%);
  }
</style>
