<script lang="ts">
  // Always visible: input level, tone lock, key light and speed. In LICW
  // strict mode the key light and meter hide during receive drills.
  import { signal } from '../lib/state/signal.svelte';
  import { settings, strict } from '../lib/state/settings.svelte';
  import { href } from '../lib/state/router.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const bars = [-50, -40, -32, -25, -18];
  const keyboard = $derived(settings.input !== 'mic');
  const hide = $derived(strict() && signal.receiving);
  // Locked, but nothing keyed for 15 s and the signal is down near the noise.
  const toneLost = $derived(
    signal.micOn && !!signal.pitch && signal.snr < 8 && performance.now() - signal.lastKeyDown > 15000 && signal.level > -200,
  );
</script>

<a class="bar" class:compact href={href('setup')} aria-label="Signal: open input setup">
  {#if keyboard}
    <span class="cell muted">Keyboard {settings.input === 'straight' ? 'straight key' : settings.input === 'iambicA' ? 'iambic A' : 'iambic B'}</span>
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
  {#if signal.notice}<span class="cell">{signal.notice}</span>
  {:else if signal.wpm > 0 && !hide}<span class="cell num">{signal.wpm.toFixed(0)} wpm</span>{/if}
</a>

<style>
  .bar {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 36px;
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
