<script lang="ts">
  // The in-app keyboard: every key always shown, ABC and 123 layers, keys as
  // tall as the phone's own. Physical keyboards work too.
  import { onMount } from 'svelte';
  import { displayToken } from '../lib/morse/code';

  let {
    onkey,
    showDone = true,
    showSpace = true,
    disabled = false,
  }: {
    onkey: (k: string) => void;
    showDone?: boolean;
    showSpace?: boolean;
    disabled?: boolean;
  } = $props();

  let layer: 'abc' | '123' = $state('abc');

  const ABC = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ];
  const NUM = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['.', ',', '?', '/', "'", '-', '(', ')', ':', '@'],
    ['<AR>', '<SK>', '<BT>', '<KN>', '<BK>'],
  ];
  const ALIAS: Record<string, string> = { '<AR>': '+', '<BT>': '=' };
  const rows = $derived(layer === 'abc' ? ABC : NUM);

  function press(k: string) {
    if (disabled) return;
    onkey(k);
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toUpperCase();
      if (k === 'BACKSPACE') {
        e.preventDefault();
        press('DEL');
      } else if (k === 'ENTER') {
        if (showDone) {
          e.preventDefault();
          press('DONE');
        }
      } else if (k === ' ') {
        if (showSpace) {
          e.preventDefault();
          press(' ');
        }
      } else if (/^[A-Z0-9.,?/'\-():@]$/.test(k)) {
        e.preventDefault();
        press(k);
      } else if (k === '+') press('<AR>');
      else if (k === '=') press('<BT>');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="kb" class:disabled role="group" aria-label="Answer keyboard">
  {#each rows as row, ri (ri)}
    <div class="row" class:offset={layer === 'abc' && ri === 1}>
      {#if ri === 2}
        <button type="button" class="key fn" onclick={() => (layer = layer === 'abc' ? '123' : 'abc')}>
          {layer === 'abc' ? '123' : 'ABC'}
        </button>
      {/if}
      {#each row as k (k)}
        <button type="button" class="key" onclick={() => press(k)} aria-label={k.startsWith('<') ? `prosign ${displayToken(k)}` : k}>
          <span class="mono" class:prosign={k.startsWith('<')}>{displayToken(k)}</span>
          {#if ALIAS[k]}<span class="alias">{ALIAS[k]}</span>{/if}
        </button>
      {/each}
      {#if ri === 2}
        <button type="button" class="key fn" onclick={() => press('DEL')} aria-label="Delete">Del</button>
      {/if}
    </div>
  {/each}
  {#if showSpace || showDone}
    <div class="row">
      {#if showSpace}<button type="button" class="key space" onclick={() => press(' ')}>space</button>{/if}
      {#if showDone}<button type="button" class="key done" onclick={() => press('DONE')}>Done</button>{/if}
    </div>
  {/if}
</div>

<style>
  .kb {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    user-select: none;
    touch-action: manipulation;
  }

  .disabled {
    opacity: 0.5;
  }

  .row {
    display: flex;
    gap: 5px;
    justify-content: center;
  }

  .offset {
    padding: 0 4.5%;
  }

  .key {
    flex: 1 1 0;
    min-width: 0;
    height: var(--target);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--size-m);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }

  .key:active {
    background: var(--surface-2);
    border-color: var(--muted);
  }

  .fn {
    flex: 1.5 1 0;
    font-size: var(--size-s);
  }

  .alias {
    font-size: 11px;
    color: var(--muted);
  }

  .space {
    flex: 3 1 0;
    color: var(--muted);
    font-size: var(--size-s);
  }

  .done {
    flex: 1.5 1 0;
    border-color: var(--signal);
    background: var(--signal-soft);
    font-weight: var(--weight-strong);
    font-size: var(--size-s);
  }

  .prosign {
    text-decoration: overline;
  }
</style>
