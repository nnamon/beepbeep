<script lang="ts">
  // Always visible: input level, tone lock, key light and speed. In LICW
  // strict mode the key light and meter hide during receive drills.
  import { signal } from '../lib/state/signal.svelte';
  import { strict } from '../lib/state/settings.svelte';
  import { href, route } from '../lib/state/router.svelte';
  import { sendInput } from '../lib/train/session';

  let { compact = false }: { compact?: boolean } = $props();

  const bars = [-50, -40, -32, -25, -18];
  // The input in use: on a BC lesson in strict mode, saved paddles key as the straight key.
  const input = $derived(sendInput());
  // Radio always listens through the microphone, and the speed there is the station's, not yours.
  const radio = $derived(route.path[0] === 'radio');
  const keyboard = $derived(input !== 'mic' && !radio);
  const NAMES: Record<string, string> = { touch: 'Touch key', straight: 'Straight key', iambicA: 'Paddles A', iambicB: 'Paddles B' };
  const hide = $derived(strict() && signal.receiving);
  // Locked, but nothing keyed for 15 s and the signal is down near the noise.
  const toneLost = $derived(
    signal.micOn && !!signal.pitch && signal.snr < 8 && performance.now() - signal.lastKeyDown > 15000 && signal.level > -200,
  );
  // The same words as on screen, as one sentence for a screen reader.
  const shown = $derived(
    keyboard
      ? (NAMES[input] ?? input)
      : !signal.micOn
        ? 'Mic off'
        : toneLost
          ? 'No tone'
          : signal.pitch
            ? `${Math.round(signal.pitch)} Hz`
            : 'Listening',
  );
  const showWpm = $derived(signal.wpm > 0 && !hide && !radio);
  const extra = $derived(signal.notice || (showWpm ? `${signal.wpm.toFixed(0)} wpm` : ''));
  const name = $derived(`${shown}${extra ? `, ${extra}` : ''}. Open input setup.`);
</script>

<!-- Named by what it shows ("Mic off", "Touch key", a notice), then where it goes. -->
<a class="bar" class:compact href={href('setup')} aria-label={name}>
  {#if keyboard}
    <span class="cell muted">{NAMES[input] ?? input}</span>
    {#if !hide}<span class="led" class:on={signal.keyDown} aria-hidden="true"></span>{/if}
  {:else if !signal.micOn}
    <span class="cell muted">Mic off</span>
  {:else}
    {#if !hide}
      <span class="meter" aria-hidden="true">
        {#each bars as b, i (b)}
          <span class="seg" class:lit={signal.level > b} style:height="{4 + i * 2.5}px"></span>
        {/each}
      </span>
    {/if}
    <span class="cell num">{toneLost ? 'No tone' : signal.pitch ? `${Math.round(signal.pitch)} Hz` : 'Listening'}</span>
    {#if !hide}<span class="led" class:on={signal.keyDown} aria-hidden="true"></span>{/if}
  {/if}
  {#if signal.notice}<span class="cell notice">{signal.notice}</span>
  {:else if showWpm}<span class="cell num">{signal.wpm.toFixed(0)} wpm</span>{/if}
</a>

<style>
  .bar {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--target-min);
    max-width: 100%;
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    text-decoration: none;
    color: var(--ink);
    font-size: var(--size-s);
  }

  .bar:hover {
    border-color: var(--muted);
  }

  .compact {
    width: 100%;
    justify-content: flex-start;
  }

  .cell {
    white-space: nowrap;
  }

  /* Last resort on the narrowest windows: the input name is cut short rather than the page scrolling sideways. */
  .cell.muted {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A long notice wraps inside the bar instead of pushing the header wider than the screen. */
  .notice {
    white-space: normal;
    min-width: 0;
    line-height: 1.25;
  }

  .meter {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
  }

  .seg {
    width: 3px;
    background: var(--line);
    border-radius: 1px;
  }

  .seg.lit {
    background: var(--signal);
  }

  .led {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--muted);
  }

  .led.on {
    background: var(--signal);
    border-color: var(--signal);
  }
</style>
