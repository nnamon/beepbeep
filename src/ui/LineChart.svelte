<script lang="ts">
  // One series over time: 2px line, end label, hairline grid, crosshair with a
  // tooltip on hover or arrow keys, and a table view of every value. Points sit
  // at their dates, so a busy week takes no more room than a quiet one. Drawn at
  // the container's pixel width so text stays at its real size.
  let {
    points,
    title,
    unit,
    digits = 0,
    lowerIsBetter = false,
  }: {
    points: { t: number; y: number }[];
    title: string;
    unit: string;
    digits?: number;
    lowerIsBetter?: boolean;
  } = $props();

  let width = $state(0);
  const W = $derived(Math.max(240, width || 600));
  const H = 180;
  const L = 48;
  const R = 56;
  const T = 12;
  const B = 26;
  let active = $state<number | null>(null);
  let table = $state(false);

  const ys = $derived(points.map((p) => p.y));
  const ext = $derived.by(() => {
    if (!ys.length) return { lo: 0, hi: 1, step: 1 };
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (lo === hi) {
      const pad = lo ? Math.abs(lo) * 0.2 : 1;
      lo -= pad;
      hi += pad;
    }
    // Times, speeds and counts are never below zero, so neither is the axis.
    if (Math.min(...ys) >= 0) lo = Math.max(0, lo);
    const raw = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  });
  const ticks = $derived.by(() => {
    const out: number[] = [];
    for (let v = ext.lo; v <= ext.hi + ext.step / 2; v += ext.step) out.push(+v.toFixed(6));
    return out;
  });
  const span = $derived(points.length > 1 ? points[points.length - 1].t - points[0].t : 0);
  const x = (i: number) => {
    if (points.length <= 1) return L + (W - L - R) / 2;
    const f = span > 0 ? (points[i].t - points[0].t) / span : i / (points.length - 1);
    return L + f * (W - L - R);
  };
  const y = (v: number) => T + (1 - (v - ext.lo) / (ext.hi - ext.lo)) * (H - T - B);
  const d = $derived(points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(''));
  const fmt = (v: number) => v.toFixed(digits);
  // Tick labels need enough decimals for the step (0.05 s steps need two).
  const tickDigits = $derived(Math.max(0, -Math.floor(Math.log10(ext.step) + 1e-9)));
  const fmtTick = (v: number) => v.toFixed(tickDigits);
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function move(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    let dist = Infinity;
    points.forEach((_, i) => {
      const dd = Math.abs(x(i) - px);
      if (dd < dist) {
        dist = dd;
        best = i;
      }
    });
    active = points.length ? best : null;
  }

  function key(e: KeyboardEvent) {
    if (!points.length) return;
    if (e.key === 'ArrowRight') active = Math.min(points.length - 1, (active ?? -1) + 1);
    else if (e.key === 'ArrowLeft') active = Math.max(0, (active ?? points.length) - 1);
    else return;
    e.preventDefault();
  }

  const last = $derived(points[points.length - 1]);
</script>

<figure class="chart">
  <figcaption>
    <span class="title">{title}</span>
    <span class="muted unit">{unit}{lowerIsBetter ? ', lower is better' : ''}</span>
    {#if points.length}<button type="button" class="tbtn" onclick={() => (table = !table)}>{table ? 'Chart' : 'Table'}</button>{/if}
  </figcaption>
  {#if !points.length}
    <p class="muted empty">No data yet.</p>
  {:else if table}
    <table>
      <thead><tr><th>Date</th><th>{unit}</th></tr></thead>
      <tbody>{#each points as p, i (i)}<tr><td>{date(p.t)}</td><td class="num">{fmt(p.y)}</td></tr>{/each}</tbody>
    </table>
  {:else}
    <div class="plot" bind:clientWidth={width}>
    <svg
      viewBox="0 0 {W} {H}"
      width={W}
      height={H}
      role="slider"
      aria-label="{title}: {points.length} sessions. Arrow keys step through them."
      aria-valuemin={0}
      aria-valuemax={points.length - 1}
      aria-valuenow={active ?? points.length - 1}
      aria-valuetext="{fmt(points[active ?? points.length - 1].y)} {unit}, {date(points[active ?? points.length - 1].t)}"
      tabindex="0"
      onpointermove={move}
      onpointerleave={() => (active = null)}
      onkeydown={key}
      onblur={() => (active = null)}
    >
      {#each ticks as v (v)}
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class="grid" />
        <text x={L - 6} y={y(v) + 4} text-anchor="end" class="tick">{fmtTick(v)}</text>
      {/each}
      <text x={L} y={H - 6} class="tick">{date(points[0].t)}</text>
      {#if points.length > 1}<text x={W - R} y={H - 6} text-anchor="end" class="tick">{date(last.t)}</text>{/if}
      <path {d} class="line" />
      <circle cx={x(points.length - 1)} cy={y(last.y)} r="4" class="dot" />
      <text x={x(points.length - 1) + 8} y={y(last.y) + 4} class="end">{fmt(last.y)}</text>
      {#if active !== null}
        {@const p = points[active]}
        <line x1={x(active)} x2={x(active)} y1={T} y2={H - B} class="cross" />
        <circle cx={x(active)} cy={y(p.y)} r="4" class="dot" />
        <g transform="translate({Math.min(W - R - 120, Math.max(L, x(active) - 60))} {T})">
          <rect width="120" height="44" rx="4" class="tip" />
          <text x="10" y="18" class="tipv">{fmt(p.y)} {unit}</text>
          <text x="10" y="36" class="tipl">{date(p.t)}</text>
        </g>
      {/if}
    </svg>
    </div>
  {/if}
</figure>

<style>
  .chart {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  figcaption {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--s-1);
  }

  .title {
    font-weight: var(--weight-strong);
  }

  .unit {
    font-size: var(--size-s);
  }

  .tbtn {
    margin-left: auto;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: var(--size-s);
    text-decoration: underline;
    min-height: 32px;
  }

  .plot {
    width: 100%;
    min-width: 0;
  }

  svg {
    display: block;
    max-width: 100%;
    touch-action: pan-y;
  }

  svg:focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
  }

  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }

  .tick {
    font-size: var(--size-s);
    fill: var(--muted);
    font-family: var(--font-mono);
  }

  .line {
    fill: none;
    stroke: var(--signal);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .dot {
    fill: var(--signal);
    stroke: var(--bg);
    stroke-width: 2;
  }

  .end {
    font-size: var(--size-s);
    fill: var(--ink);
    font-family: var(--font-ui);
    font-weight: 600;
  }

  .cross {
    stroke: var(--muted);
    stroke-width: 1;
  }

  .tip {
    fill: var(--surface-2);
    stroke: var(--line);
  }

  .tipv {
    font-size: var(--size-s);
    font-weight: 600;
    fill: var(--ink);
    font-family: var(--font-ui);
  }

  .tipl {
    font-size: var(--size-s);
    fill: var(--muted);
    font-family: var(--font-ui);
  }

  .empty {
    font-size: var(--size-s);
  }

  table {
    border-collapse: collapse;
    font-size: var(--size-s);
  }

  th,
  td {
    text-align: left;
    padding: 2px var(--s-3) 2px 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  th {
    color: var(--muted);
  }
</style>
