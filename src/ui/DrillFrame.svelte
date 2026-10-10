<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { href } from '../lib/state/router.svelte';

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
    min-width: 40px;
    min-height: 40px;
    margin-left: calc(-1 * var(--s-1));
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
</style>
