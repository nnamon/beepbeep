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
  .text {
    margin: 0;
    overflow-wrap: anywhere;
    line-height: 1.25;
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

  .sp {
    white-space: pre;
  }

  .prosign {
    text-decoration: overline;
    text-decoration-thickness: 1.5px;
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
    font: inherit;
    color: var(--muted);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
</style>
