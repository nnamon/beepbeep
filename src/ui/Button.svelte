<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    kind = 'secondary',
    type = 'button',
    disabled = false,
    wide = false,
    hint = '',
    href = '',
    label = '',
    onclick,
    children,
  }: {
    kind?: 'primary' | 'secondary' | 'quiet';
    type?: 'button' | 'submit';
    disabled?: boolean;
    wide?: boolean;
    /** Keyboard shortcut shown beside the label on wide screens. */
    hint?: string;
    href?: string;
    label?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

{#if href}
  <a class="btn {kind}" class:wide {href} aria-label={label || undefined}>
    {@render children()}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </a>
{:else}
  <button class="btn {kind}" class:wide {type} {disabled} {onclick} aria-label={label || undefined}>
    {@render children()}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    min-height: var(--target);
    padding: 0 var(--s-2);
    border-radius: var(--radius);
    border: var(--hairline) solid var(--muted);
    background: transparent;
    color: var(--ink);
    font-size: var(--size-m);
    font-weight: var(--weight-regular);
    text-decoration: none;
    white-space: nowrap;
    transition: background-color var(--transition), border-color var(--transition);
    user-select: none;
  }

  .btn:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .primary {
    border: 1.5px solid var(--signal);
    background: var(--signal-soft);
    font-weight: var(--weight-strong);
  }

  .primary:hover:not(:disabled) {
    background: var(--signal-soft);
    border-color: var(--ink);
  }

  .quiet {
    border-color: transparent;
    color: var(--muted);
    padding: 0 var(--s-1);
  }

  .quiet:hover:not(:disabled) {
    color: var(--ink);
    background: transparent;
  }

  .wide {
    width: 100%;
  }

  .hint {
    font-size: var(--size-s);
    color: var(--muted);
    font-weight: var(--weight-regular);
  }

  @media (pointer: coarse), (max-width: 600px) {
    .hint {
      display: none;
    }
  }
</style>
