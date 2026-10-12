<script lang="ts">
  // What's new: CHANGELOG.md from the repo, shown as a page. Only the few
  // shapes the changelog uses: version headings, section headings, bullets,
  // paragraphs and links. Links to repo files go to GitHub.
  import changelog from '../../CHANGELOG.md?raw';
  import { href } from '../lib/state/router.svelte';

  type Part = { text: string; url?: string };
  type Block = { kind: 'h2' | 'h3' | 'p'; parts: Part[] } | { kind: 'ul'; items: Part[][] };

  const REPO = 'https://github.com/nnamon/beepbeep/blob/main/';

  function inline(s: string): Part[] {
    const out: Part[] = [];
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let at = 0;
    for (const m of s.matchAll(re)) {
      if (m.index! > at) out.push({ text: s.slice(at, m.index) });
      const url = /^https?:/.test(m[2]) ? m[2] : REPO + m[2];
      out.push({ text: m[1], url });
      at = m.index! + m[0].length;
    }
    if (at < s.length) out.push({ text: s.slice(at) });
    return out;
  }

  function parse(md: string): Block[] {
    const blocks: Block[] = [];
    let list: Part[][] | null = null;
    for (const raw of md.split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('- ')) list = null;
      if (!line || line.startsWith('# ')) continue;
      if (line.startsWith('### ')) blocks.push({ kind: 'h3', parts: inline(line.slice(4)) });
      else if (line.startsWith('## ')) blocks.push({ kind: 'h2', parts: inline(line.slice(3)) });
      else if (line.startsWith('- ')) {
        if (!list) {
          list = [];
          blocks.push({ kind: 'ul', items: list });
        }
        list.push(inline(line.slice(2)));
      } else blocks.push({ kind: 'p', parts: inline(line) });
    }
    return blocks;
  }

  const blocks = parse(changelog);
</script>

{#snippet text(parts: Part[])}{#each parts as p, i (i)}{#if p.url}<a href={p.url} target="_blank" rel="noopener">{p.text}</a>{:else}{p.text}{/if}{/each}{/snippet}

<section class="changes">
  <div class="title">
    <h1>What's new</h1>
    <a class="back" href={href('settings')}>Back to Settings</a>
  </div>
  <p class="muted">You are using version {__APP_VERSION__} ({__APP_BUILD__}).</p>
  {#each blocks as b, i (i)}
    {#if b.kind === 'h2'}
      <h2>{@render text(b.parts)}</h2>
    {:else if b.kind === 'h3'}
      <h3>{@render text(b.parts)}</h3>
    {:else if b.kind === 'ul'}
      <ul>
        {#each b.items as item, j (j)}<li>{@render text(item)}</li>{/each}
      </ul>
    {:else}
      <p>{@render text(b.parts)}</p>
    {/if}
  {/each}
</section>

<style>
  .changes {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    max-width: var(--reading);
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-1) var(--s-3);
  }

  .back {
    font-size: var(--size-s);
    min-height: var(--target-min);
    display: inline-flex;
    align-items: center;
  }

  h2 {
    margin-top: var(--s-4);
    padding-top: var(--s-2);
    border-top: var(--hairline) solid var(--line);
  }

  h3 {
    margin-top: var(--s-2);
    font-size: var(--size-m);
  }

  ul {
    margin: 0;
    padding-left: 1.2em;
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }
</style>
