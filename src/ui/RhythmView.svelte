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
  // one time scale so "yours" and "standard" line up.

  let { rows, height = 12, labelWidth = 72 }: { rows: RhythmRow[]; height?: number; labelWidth?: number } = $props();

  const span = $derived(
    Math.max(
      0.05,
      ...rows.map((r) => (r.marks.length ? r.marks[r.marks.length - 1].end - r.marks[0].start : 0)),
    ),
  );
  const W = 600;
  const noteWidth = $derived(rows.some((r) => r.note) ? 130 : 0);
  const plot = $derived(W - labelWidth - noteWidth);
  const rowH = $derived(height + 12);
  const x = (r: RhythmRow, t: number) => labelWidth + ((t - (r.marks[0]?.start ?? 0)) / span) * plot;
  const desc = $derived(rows.map((r) => `${r.label}: ${r.marks.length} marks${r.note ? `, ${r.note}` : ''}`).join('; '));
</script>

<svg viewBox="0 0 {W} {rows.length * rowH}" role="img" aria-label="Rhythm drawn to scale. {desc}" class="rhythm">
  {#each rows as r, i (i)}
    <g transform="translate(0 {i * rowH})">
      <text x="0" y={height - 1} class="label">{r.label}</text>
      {#each r.marks as m, j (j)}
        <rect
          x={x(r, m.start)}
          y="1"
          width={Math.max(1.5, x(r, m.end) - x(r, m.start))}
          {height}
          rx="1"
          class={r.style === 'outline' ? 'outline' : 'filled'}
        />
      {/each}
      {#if r.note}<text x={W} y={height - 1} class="note" text-anchor="end">{r.note}</text>{/if}
    </g>
  {/each}
</svg>

<style>
  .rhythm {
    width: 100%;
    height: auto;
    display: block;
  }

  .label,
  .note {
    font-size: 12px;
    fill: var(--muted);
    font-family: var(--font-ui);
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
