<script lang="ts" module>
  export interface RhythmRow {
    label: string;
    marks: { start: number; end: number }[];
    style?: 'filled' | 'outline';
    note?: string;
  }
</script>

<script lang="ts">
  // Morse drawn to scale: each mark is a bar as long as it lasted. Rows share
  // one time scale so "yours" and "standard" line up. Labels are real text, so
  // they stay legible at any width; only the bars stretch.
  let {
    rows,
    height = 12,
    labelWidth = 72,
    fixedSpan,
  }: { rows: RhythmRow[]; height?: number; labelWidth?: number; fixedSpan?: number } = $props();

  const span = $derived(
    fixedSpan ??
      Math.max(0.05, ...rows.map((r) => (r.marks.length ? r.marks[r.marks.length - 1].end - r.marks[0].start : 0))),
  );
  const W = 1000;
  const x = (r: RhythmRow, t: number) => ((t - (r.marks[0]?.start ?? 0)) / span) * W;
  const desc = $derived(rows.map((r) => `${r.label || 'rhythm'}: ${r.marks.length} dits and dahs${r.note ? `, ${r.note}` : ''}`).join('; '));
  const hasNotes = $derived(rows.some((r) => r.note));
</script>

<div class="rhythm" role="img" aria-label="Rhythm drawn to scale. {desc}" style:--lw="{labelWidth}px">
  {#each rows as r, i (i)}
    <div class="row" class:notes={hasNotes} class:bare={labelWidth === 0}>
      {#if labelWidth > 0}<span class="label">{r.label}</span>{/if}
      <svg viewBox="0 0 {W} {height}" preserveAspectRatio="none" style:height="{height}px" aria-hidden="true">
        {#each r.marks as m, j (j)}
          <rect
            x={x(r, m.start)}
            y={r.style === 'outline' ? 0.5 : 0}
            width={Math.max(2, x(r, m.end) - x(r, m.start))}
            height={r.style === 'outline' ? height - 1 : height}
            class={r.style === 'outline' ? 'outline' : 'filled'}
            vector-effect="non-scaling-stroke"
          />
        {/each}
      </svg>
      {#if hasNotes}<span class="note">{r.note ?? ''}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .rhythm {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    width: 100%;
  }

  .row {
    display: grid;
    grid-template-columns: var(--lw) minmax(0, 1fr);
    align-items: center;
    gap: var(--s-1);
  }

  .row.notes {
    grid-template-columns: var(--lw) minmax(0, 1fr) auto;
  }

  .row.bare {
    grid-template-columns: minmax(0, 1fr);
  }

  .row.bare.notes {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .label,
  .note {
    font-size: var(--size-s);
    color: var(--muted);
    white-space: nowrap;
  }

  svg {
    width: 100%;
    display: block;
    overflow: visible;
  }

  .filled {
    fill: var(--ink);
  }

  .outline {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1;
  }
</style>
