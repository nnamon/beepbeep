<script lang="ts">
  import { onMount } from 'svelte';
  import LineChart from '../ui/LineChart.svelte';
  import TokenText from '../ui/TokenText.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import RhythmView from '../ui/RhythmView.svelte';
  import { confusions, getItems, getKv, qsos, sessions, type QsoRecord, type SessionRecord } from '../lib/state/db';
  import { settings, strict } from '../lib/state/settings.svelte';
  import { href } from '../lib/state/router.svelte';
  import { currentLevel, playCw, playMarks, wait, type SlipCounts } from '../lib/train/session';
  import { windowStats, type ItemStat } from '../lib/train/srs';
  import { displayToken, isProsign } from '../lib/morse/code';
  import { FORMATS } from '../lib/qso/bot';

  let list = $state<SessionRecord[]>([]);
  let log = $state<QsoRecord[]>([]);
  let rx = $state<Map<string, ItemStat>>(new Map());
  let tx = $state<Map<string, ItemStat>>(new Map());
  let pairs = $state<{ want: string; got: string; count: number }[]>([]);
  let slips = $state<SlipCounts | null>(null);
  let sends = $state<{ at: number; text: string; marks: { start: number; end: number }[] }[]>([]);
  let heatOf = $state<'rx' | 'tx'>('rx');
  let days = $state<7 | 30>(30);
  let charTable = $state(false);
  let loaded = $state(false);

  onMount(async () => {
    try {
      [list, log, rx, tx] = await Promise.all([sessions(), qsos(), getItems('rx:'), getItems('tx:')]);
      pairs = (await confusions()).sort((a, b) => b.count - a.count).slice(0, 10);
      slips = await getKv<SlipCounts | null>('sendSlips', null);
      sends = await getKv('recentSends', []);
    } catch {
      /* storage unavailable */
    }
    loaded = true;
  });

  const week = $derived(list.filter((s) => s.at > Date.now() - 7 * 864e5));
  const minutes = $derived(Math.round(week.reduce((a, s) => a + s.seconds, 0) / 60));
  const sendShare = $derived.by(() => {
    const total = week.reduce((a, s) => a + s.seconds, 0);
    const send = week.filter((s) => s.sending).reduce((a, s) => a + s.seconds, 0);
    return total ? Math.round((send / total) * 100) : null;
  });

  const receive = $derived(list.filter((s) => !s.sending && s.mode !== 'familiarity' && s.wpm).map((s) => ({ t: s.at, y: s.wpm })));
  const sent = $derived(list.filter((s) => s.sentWpm).map((s) => ({ t: s.at, y: s.sentWpm! })));
  const ttr = $derived(list.filter((s) => s.ttrDelay).map((s) => ({ t: s.at, y: s.ttrDelay! })));
  const recovery = $derived(list.filter((s) => s.recovery !== undefined && s.recovery !== null).map((s) => ({ t: s.at, y: s.recovery! })));
  const lastFist = $derived([...list].reverse().find((s) => s.fist)?.fist ?? null);

  const level = $derived(currentLevel());
  const since = $derived(Date.now() - days * 864e5);
  const chars = $derived(
    level.known.map((t) => {
      const r = windowStats(rx.get(`rx:${t}`), since);
      const x = windowStats(tx.get(`tx:${t}`), since);
      const w = heatOf === 'rx' ? r : x;
      return { t, r, x, a: w?.accuracy ?? null, n: w?.n ?? 0 };
    }),
  );
  const charRows = $derived(chars.filter((c) => c.r || c.x));
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'no data' : `${Math.round(v * 100)}%`);
  const SLIPS: { kind: Exclude<keyof SlipCounts, 'pairs'>; label: string }[] = [
    { kind: 'merged-words', label: 'Words ran together' },
    { kind: 'merged-letters', label: 'Letters ran together' },
    { kind: 'split-letter', label: 'Letter split in two' },
    { kind: 'split-word', label: 'Word split in two' },
  ];
  const slipTotal = $derived(slips ? SLIPS.reduce((a, k) => a + slips![k.kind], 0) : 0);
  const slipPairs = $derived(slips ? Object.entries(slips.pairs).sort((a, b) => b[1] - a[1]).slice(0, 6) : []);
  const time = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const shade = (a: number | null) => (a === null ? 0 : 0.1 + a * 0.75);

  async function playPair(want: string, got: string) {
    await (await playCw(want, { plain: true })).done;
    await wait(300);
    await (await playCw(got, { plain: true })).done;
  }

  const fmtName = (f: string) => FORMATS.find((x) => x.id === f)?.name ?? f;
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

<section class="progress">
  <h1>Progress</h1>

  <dl class="tiles">
    <div><dt class="label">Sessions, 7 days</dt><dd class="value">{week.length}</dd></div>
    <div><dt class="label">Minutes, 7 days</dt><dd class="value">{minutes}</dd></div>
    <div>
      <dt class="label">Sending share</dt>
      <dd class="value">{sendShare === null ? 'none yet' : `${sendShare}%`}</dd>
      <dd class="aim muted">aim 20% or more</dd>
    </div>
    <div><dt class="label">QSOs</dt><dd class="value">{log.length}</dd></div>
    <div><dt class="label">Lesson</dt><dd class="value small-value">{level.name}</dd></div>
    <div>
      <dt class="label">Comfort and stretch speeds</dt>
      <dd class="value small-value">{settings.comfortWpm} and {settings.stretchWpm} <span class="muted unit">wpm</span></dd>
      <dd class="aim muted">for the extra copy sessions</dd>
    </div>
  </dl>

  {#if loaded && !list.length}
    <p class="muted">No sessions recorded yet.</p>
  {/if}

  {#if list.length}
  <div class="charts">
    {#if strict()}
      <LineChart title="Time before the voice, Time to recognise (TTR)" unit="s" digits={2} points={ttr} lowerIsBetter />
      <LineChart title="Characters missed in a row, Sound surfing" unit="characters" digits={1} points={recovery} lowerIsBetter />
      <LineChart title="Speed you practised copying at" unit="wpm" points={receive} />
      <LineChart title="Your sending speed, as decoded" unit="wpm" points={sent} />
    {:else}
      <LineChart title="Speed you practised copying at" unit="wpm" points={receive} />
      <LineChart title="Your sending speed, as decoded" unit="wpm" points={sent} />
      <LineChart title="Time before the voice, Time to recognise (TTR)" unit="s" digits={2} points={ttr} lowerIsBetter />
      <LineChart title="Characters missed in a row, Sound surfing" unit="characters" digits={1} points={recovery} lowerIsBetter />
    {/if}
  </div>
  {/if}

  <div class="block">
    <div class="head">
      <h2>Accuracy by character</h2>
      <div class="controls">
        <Segmented label="Accuracy of" bind:value={heatOf} options={[{ value: 'rx', label: 'Copying' }, { value: 'tx', label: 'Sending' }]} />
        <Segmented label="Period" bind:value={days} options={[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }]} />
      </div>
    </div>
    <div class="note">
      <p class="muted small">
        {heatOf === 'rx' ? 'Characters you copied' : 'Characters you sent, as the decoder received them'}, last {days} days. Stronger colour
        means more accurate; blank cells have no answers yet.
      </p>
      {#if charRows.length}<button type="button" class="tbtn" onclick={() => (charTable = !charTable)}>{charTable ? 'Heatmap' : 'Table'}</button>{/if}
    </div>
    {#if charTable && charRows.length}
      <!-- A region that scrolls sideways must take keyboard focus (WCAG 2.1.1). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll" tabindex="0" role="region" aria-label="Accuracy by character, scrolls sideways">
        <table class="chars">
          <thead><tr><th>Character</th><th>Copied</th><th>Answer time</th><th>Sent</th><th>Timing error</th></tr></thead>
          <tbody>
            {#each charRows as c (c.t)}
              <tr>
                <td class="mono" class:prosign={isProsign(c.t)}>{displayToken(c.t)}</td>
                <td class="num">{pct(c.r?.accuracy)} <span class="muted">{c.r ? `of ${c.r.n}` : ''}</span></td>
                <td class="num">{c.r?.value ? `${(c.r.value / 1000).toFixed(1)} s` : 'no data'}</td>
                <td class="num">{pct(c.x?.accuracy)} <span class="muted">{c.x ? `of ${c.x.n}` : ''}</span></td>
                <td class="num">{c.x?.value ? `${Math.round(c.x.value / 10)}%` : 'no data'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted small">Answer time: from the end of the sound to your first key press. Timing error: how far your dits, dahs and the gaps inside the character were from standard length, on average.</p>
    {:else}
      <ul class="heat">
        {#each chars as c (c.t)}
          <li style:--a={shade(c.a)} class:strong={shade(c.a) > 0.45} title={c.a === null ? 'None yet' : `${Math.round(c.a * 100)}% of ${c.n}`}>
            <span class="mono ch" class:prosign={isProsign(c.t)}>{displayToken(c.t)}</span>
            <span class="pc num">{c.a === null ? '' : `${Math.round(c.a * 100)}`}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if pairs.length}
    <div class="block">
      <h2>Mixed up most</h2>
      <ul class="pairs">
        {#each pairs as p (p.want + p.got)}
          <li>
            <TokenText tokens={[{ t: p.want }]} size="m" /><span class="muted">heard as</span><TokenText tokens={[{ t: p.got }]} size="m" />
            <span class="num muted">×{p.count}</span>
            <button type="button" class="play" onclick={() => playPair(p.want, p.got)}>Play both</button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if slips && slipTotal}
    <div class="block">
      <h2>Spacing slips</h2>
      <dl class="fist">
        {#each SLIPS as k (k.kind)}
          <div><dt class="label">{k.label}</dt><dd class="num">{slips[k.kind]}</dd></div>
        {/each}
      </dl>
      {#if slipPairs.length}
        <ul class="slips">
          {#each slipPairs as [d, n] (d)}
            <li><span class="mono">{d}</span> <span class="num muted">×{n}</span></li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if lastFist}
    <div class="block">
      <h2>Your latest sending timing</h2>
      <dl class="fist">
        <div><dt class="label">Speed</dt><dd class="num">{lastFist.wpm.toFixed(0)} wpm</dd></div>
        <div><dt class="label">Dah length in dits</dt><dd class="num">{lastFist.dahRatio?.toFixed(1) ?? 'not measured'} <span class="muted">aim 3</span></dd></div>
        <div><dt class="label">Gap between letters</dt><dd class="num">{lastFist.charGap === null || lastFist.charGap === undefined ? 'none sent' : `${lastFist.charGap.toFixed(1)} units`} <span class="muted">aim 3</span></dd></div>
        <div><dt class="label">Gap between words</dt><dd class="num">{lastFist.wordGap === null || lastFist.wordGap === undefined ? 'none sent' : `${lastFist.wordGap.toFixed(1)} units`} <span class="muted">aim 7</span></dd></div>
        <div><dt class="label">Dit to gap inside letters</dt><dd class="num">{lastFist.weighting?.toFixed(2) ?? 'not measured'} <span class="muted">aim 1.0</span></dd></div>
      </dl>
      <p class="muted small">A unit is one dit long at your speed.</p>
    </div>
  {/if}

  {#if sends.length || settings.keepSends}
    <div class="block">
      <h2>Recent sends</h2>
      {#if sends.length}
        <ul class="sends">
          {#each sends as r (r.at)}
            <li>
              <div class="send-head">
                <span class="mono">{r.text || 'nothing decoded'}</span>
                <span class="muted small">{time(r.at)}</span>
                <button type="button" class="play" onclick={() => playMarks(r.marks)}>Replay</button>
              </div>
              {#if !strict()}<RhythmView rows={[{ label: '', marks: r.marks }]} labelWidth={0} />{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">None yet. What you send in the sending drills appears here.</p>
      {/if}
    </div>
  {:else}
    <p class="muted small">Turn on <a href={href('settings')}>Keep recent sends</a> to replay your last 8 sends here.</p>
  {/if}

  <div class="block">
    <h2>QSO log</h2>
    {#if log.length}
      <!-- A region that scrolls sideways must take keyboard focus (WCAG 2.1.1). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll" tabindex="0" role="region" aria-label="QSO log, scrolls sideways">
        <table>
          <thead><tr><th>Date</th><th>Format</th><th>Call</th><th>Name</th><th>QTH</th><th>RST sent</th><th>RST rcvd</th><th>Time</th><th>Copied</th><th>Received you</th></tr></thead>
          <tbody>
            {#each [...log].reverse() as q (q.id)}
              <tr>
                <td>{day(q.at)}</td><td>{fmtName(q.format)}</td><td class="mono">{q.call}</td><td class="mono">{q.name}</td>
                <td class="mono">{q.qth}{q.state && q.state !== q.qth ? ` ${q.state}` : ''}</td><td class="num">{q.format === 'sst' ? 'no report in SST' : q.rstSent || 'none'}</td><td class="num">{q.format === 'sst' ? 'no report in SST' : q.rstRcvd || 'none'}</td>
                <td class="num">{Math.floor(q.seconds / 60)}:{String(q.seconds % 60).padStart(2, '0')}</td>
                <td class="num">{Math.round(q.copyScore * 100)}%</td><td class="num">{Math.round(q.sendScore * 100)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="muted small">No QSOs yet.</p>
    {/if}
  </div>
</section>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--s-2) var(--s-4);
    margin: 0;
  }

  .tiles div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-top: var(--hairline) solid var(--line);
    padding-top: var(--s-1);
  }

  .tiles dd {
    margin: 0;
  }

  .value {
    font-size: var(--size-xl);
    font-weight: var(--weight-strong);
    line-height: 1.1;
  }

  .aim,
  .small {
    font-size: var(--size-s);
  }

  .small-value {
    font-size: var(--size-l);
  }

  .unit {
    font-size: var(--size-s);
    font-weight: normal;
  }

  .controls {
    display: flex;
    gap: var(--s-1);
    flex-wrap: wrap;
  }

  .note {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--s-2);
  }

  .tbtn {
    flex: none;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: var(--size-s);
    text-decoration: underline;
    padding: 0;
    min-height: 32px;
  }

  table.chars {
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }

  .slips {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-half) var(--s-3);
  }

  .sends {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .sends li {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    padding: var(--s-1) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  .send-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }

  .send-head .mono {
    overflow-wrap: anywhere;
    min-width: 0;
  }

  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--s-4) var(--s-5);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .heat {
    list-style: none;
    padding: 0;
    margin: var(--s-1) 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 2px;
  }

  .heat li {
    position: relative;
    min-height: 52px;
    border-radius: var(--radius);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    isolation: isolate;
  }

  .heat li::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--signal);
    opacity: var(--a);
    z-index: -1;
  }

  .heat li.strong {
    color: var(--signal-ink);
  }

  .ch {
    font-size: var(--size-m);
    font-weight: var(--weight-strong);
  }

  .pc {
    font-size: var(--size-s);
  }

  .pairs {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }

  .pairs li {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    border-bottom: var(--hairline) solid var(--line);
    min-height: var(--target);
  }

  .play {
    margin-left: auto;
    border: var(--hairline) solid var(--line);
    background: transparent;
    border-radius: var(--radius);
    min-height: 36px;
    padding: 0 var(--s-1);
    font-size: var(--size-s);
  }

  .fist {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-4);
    margin: 0;
  }

  .fist div {
    display: flex;
    flex-direction: column;
  }

  .fist dd {
    margin: 0;
  }

  .scroll {
    overflow-x: auto;
  }

  .scroll:focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
  }

  table {
    border-collapse: collapse;
    font-size: var(--size-s);
    min-width: 640px;
  }

  th,
  td {
    text-align: left;
    padding: var(--s-half) var(--s-2) var(--s-half) 0;
    border-bottom: var(--hairline) solid var(--line);
    white-space: nowrap;
  }

  th {
    color: var(--muted);
    font-weight: var(--weight-strong);
  }
</style>
