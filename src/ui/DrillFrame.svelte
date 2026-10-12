<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { go, href } from '../lib/state/router.svelte';

  let {
    title,
    eyebrow = '',
    count = '',
    back = 'practice',
    side,
    children,
    footer,
  }: {
    title: string;
    eyebrow?: string;
    count?: string;
    back?: string;
    side?: Snippet;
    children: Snippet;
    footer?: Snippet;
  } = $props();
</script>

<!-- Esc leaves the drill (which ends it), unless the drill used Esc itself, e.g. to stop and show results. -->
<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    setTimeout(() => {
      if (!e.defaultPrevented) go(...back.split('/'));
    }, 0);
  }}
/>

<section class="drill">
  <div class="top">
    <a class="back" href={href(back)} aria-label="Back"><Icon name="back" size={18} /></a>
    <div class="titles">
      <h1>{title}</h1>
      {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
    </div>
    {#if count}<span class="count num">{count}</span>{/if}
  </div>
  <div class="body" class:has-side={!!side}>
    <div class="main">{@render children()}</div>
    {#if side}<aside class="side">{@render side()}</aside>{/if}
  </div>
  {#if footer}<div class="footer">{@render footer()}</div>{/if}
</section>

<style>
  .drill {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .back {
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--target);
    min-height: var(--target);
    margin-left: calc(-1 * var(--s-2));
  }

  .back:hover {
    color: var(--ink);
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  .eyebrow {
    font-size: var(--size-s);
    color: var(--muted);
  }

  .count {
    font-size: var(--size-s);
    color: var(--muted);
  }

  .body {
    display: grid;
    gap: var(--s-4);
  }

  .body.has-side {
    grid-template-columns: minmax(0, 1fr) 260px;
  }

  .side {
    border-left: var(--hairline) solid var(--line);
    padding-left: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    align-items: center;
  }

  @media (max-width: 860px) {
    .body.has-side {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      border-left: 0;
      padding-left: 0;
      border-top: var(--hairline) solid var(--line);
      padding-top: var(--s-2);
    }
  }

  @media (max-width: 600px) {
    .footer :global(.btn) {
      flex: 1 1 auto;
    }
  }

  /*
   * A phone on its side: too short for the answer keys under the drill, so they go beside it.
   * The title, the drill and its buttons fill the left column; the keys fill the right.
   */
  @media (orientation: landscape) and (max-height: 500px) {
    .drill {
      gap: var(--s-2);
    }

    /* Rows sized by the left column; the last row takes whatever height the keys need beyond it. */
    .drill:has(.main > :global(.kb)) {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: repeat(6, auto) 1fr;
      gap: 0 var(--s-4);
      align-items: start;
    }

    .drill:has(.main > :global(.kb)) :is(.body, .main) {
      display: contents;
    }

    /* Spaced with margins, so rows the drill does not use add no height. */
    .drill:has(.main > :global(.kb)) > *,
    .drill:has(.main > :global(.kb)) .main > :global(*) {
      grid-column: 1;
      margin-bottom: var(--s-2);
    }

    .drill:has(.main > :global(.kb)) .main > :global(.kb) {
      grid-column: 2;
      grid-row: 1 / -1;
      margin: 0;
    }
  }
</style>
