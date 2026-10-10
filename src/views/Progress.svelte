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
  import { accuracy, type ItemStat } from '../lib/train/srs';
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
  const chars = $derived(level.known.map((t) => ({ t, s: (heatOf === 'rx' ? rx : tx).get(`${heatOf}:${t}`) })));
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
      <dd class="value">{sendShare === null ? '–' : `${sendShare}%`}</dd>
      <dd class="aim muted">aim 25% or more</dd>
    </div>
    <div><dt class="label">QSOs</dt><dd class="value">{log.length}</dd></div>
    <div><dt class="label">Lesson</dt><dd class="value small-value">{level.name}</dd></div>
    <div>
      <dt class="label">Comfort / stretch</dt>
      <dd class="value small-value">{settings.comfortWpm} / {settings.stretchWpm} <span class="muted unit">wpm</span></dd>
    </div>
  </dl>

  {#if loaded && !list.length}
    <p class="muted">No sessions recorded yet.</p>
  {/if}

  {#if list.length}
  <div class="charts">
    {#if strict()}
      <LineChart title="TTR voice delay" unit="s" digits={2} points={ttr} lowerIsBetter />
      <LineChart title="Recovery after misses" unit="chars" digits={1} points={recovery} lowerIsBetter />
      <LineChart title="Receive speed" unit="wpm" points={receive} />
      <LineChart title="Sending speed" unit="wpm" points={sent} />
    {:else}
      <LineChart title="Receive speed" unit="wpm" points={receive} />
      <LineChart title="Sending speed" unit="wpm" points={sent} />
      <LineChart title="TTR voice delay" unit="s" digits={2} points={ttr} lowerIsBetter />
      <LineChart title="Recovery after misses" unit="chars" digits={1} points={recovery} lowerIsBetter />
    {/if}
  </div>
  {/if}

  <div class="block">
    <div class="head">
      <h2>Accuracy by character</h2>
      <Segmented label="Accuracy of" bind:value={heatOf} options={[{ value: 'rx', label: 'Copying' }, { value: 'tx', label: 'Sending' }]} />
    </div>
    <p class="muted small">
      {heatOf === 'rx' ? 'Characters you copied.' : 'Characters you sent, as the decoder received them.'} Last 10 each. Stronger
      colour is more accurate. Blank cells have none yet.
    </p>
    <ul class="heat">
      {#each chars as c (c.t)}
        {@const a = c.s ? accuracy(c.s) : null}
        <li style:--a={shade(a)} class:strong={shade(a) > 0.45} title={a === null ? 'No answers yet' : `${Math.round(a * 100)}% of ${c.s!.recent.length}`}>
          <span class="mono ch" class:prosign={isProsign(c.t)}>{displayToken(c.t)}</span>
          <span class="pc num">{a === null ? '' : `${Math.round(a * 100)}`}</span>
        </li>
      {/each}
    </ul>
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
      <h2>Latest fist report</h2>
      <dl class="fist">
        <div><dt class="label">Speed</dt><dd class="num">{lastFist.wpm.toFixed(0)} wpm</dd></div>
        <div><dt class="label">Dah to dit</dt><dd class="num">{lastFist.dahRatio.toFixed(1)} <span class="muted">aim 3</span></dd></div>
        <div><dt class="label">Letter gap</dt><dd class="num">{lastFist.charGap.toFixed(1)} u <span class="muted">aim 3</span></dd></div>
        <div><dt class="label">Word gap</dt><dd class="num">{lastFist.wordGap?.toFixed(1) ?? '–'} u <span class="muted">aim 7</span></dd></div>
        <div><dt class="label">Weighting</dt><dd class="num">{lastFist.weighting.toFixed(2)} <span class="muted">aim 1.0</span></dd></div>
      </dl>
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
                <span class="mono">{r.text || '–'}</span>
                <span class="muted small">{time(r.at)}</span>
                <button type="button" class="play" onclick={() => playMarks(r.marks)}>Replay</button>
              </div>
              {#if !strict()}<RhythmView rows={[{ label: '', marks: r.marks }]} labelWidth={0} />{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">None yet. Sends from the send drills appear here.</p>
      {/if}
    </div>
  {:else}
    <p class="muted small">Turn on <a href={href('settings')}>Keep recent sends</a> to replay your last 8 sends here.</p>
  {/if}

  <div class="block">
    <h2>QSO log</h2>
    {#if log.length}
      <div class="scroll">
        <table>
          <thead><tr><th>Date</th><th>Format</th><th>Call</th><th>Name</th><th>QTH</th><th>RST rcvd</th><th>Copied</th><th>Received you</th></tr></thead>
          <tbody>
            {#each [...log].reverse() as q (q.id)}
              <tr>
                <td>{day(q.at)}</td><td>{fmtName(q.format)}</td><td class="mono">{q.call}</td><td class="mono">{q.name}</td>
                <td class="mono">{q.qth} {q.state}</td><td class="num">{q.rstRcvd}</td>
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
