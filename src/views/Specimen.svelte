<script lang="ts">
  // Design specimen: every component and token on one page, for screenshot
  // review in both themes at phone and laptop widths. Not linked from the nav.
  import Button from '../ui/Button.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Slider from '../ui/Slider.svelte';
  import TokenText from '../ui/TokenText.svelte';
  import RhythmView from '../ui/RhythmView.svelte';
  import Keyboard from '../ui/Keyboard.svelte';
  import FistPanel from '../ui/FistPanel.svelte';
  import LineChart from '../ui/LineChart.svelte';
  import SignalBar from '../ui/SignalBar.svelte';
  import { buildSchedule } from '../lib/morse/schedule';

  let on = $state(true);
  let seg = $state<'a' | 'b' | 'c'>('a');
  let val = $state(18);
  let typed = $state('');
  const yours = buildSchedule('LE', { charWpm: 18, leadIn: 0, tail: 0, fist: { wordGapScale: 0.6, jitter: 0.06 } }).marks;
  const std = buildSchedule('L E', { charWpm: 18, leadIn: 0, tail: 0 }).marks;
  // Fixed dates so the page renders the same every time (screenshot baseline).
  const pts = Array.from({ length: 14 }, (_, i) => ({ t: Date.UTC(2026, 8, 20 + i, 12), y: 12 + Math.round(i * 0.6 + (i % 3)) }));
  const TOKENS = ['--bg', '--surface', '--surface-2', '--line', '--ink', '--muted', '--signal', '--fault'];
</script>

<section class="spec">
  <h1>Specimen</h1>

  <div class="block">
    <h2>Type</h2>
    <p style:font-size="var(--size-xl)">40 Atkinson Hyperlegible Next</p>
    <p style:font-size="var(--size-l)">20 Decoded text and headings</p>
    <p>15 Body, labels and controls</p>
    <p style:font-size="var(--size-s)">13 Secondary text</p>
    <p class="mono" style:font-size="var(--size-l)">K1ABC 0O 1Il 5NN 73</p>
  </div>

  <div class="block">
    <h2>Colour tokens</h2>
    <ul class="swatches">
      {#each TOKENS as t (t)}<li><span class="sw" style:background="var({t})"></span><span class="mono">{t}</span></li>{/each}
    </ul>
  </div>

  <div class="block">
    <h2>Controls</h2>
    <div class="row">
      <Button kind="primary" hint="Enter">Primary</Button>
      <Button hint="R">Secondary</Button>
      <Button kind="quiet">Quiet</Button>
      <Button disabled>Disabled</Button>
    </div>
    <Segmented label="Example" bind:value={seg} options={[{ value: 'a', label: 'Characters' }, { value: 'b', label: 'Words' }, { value: 'c', label: 'Callsigns' }]} />
    <div class="narrow">
      <Toggle bind:checked={on} label="Toggle" detail="With a detail line" />
      <Slider label="Slider" bind:value={val} min={5} max={40} unit="wpm" />
    </div>
    <SignalBar />
  </div>

  <div class="block">
    <h2>Text states</h2>
    <TokenText tokens={[{ t: 'T' }, { t: 'N' }, { t: 'X' }, { t: ' ' }, { t: 'C', state: 'miss' }, { t: 'A', state: 'miss' }, { t: ' ' }, { t: '<BK>' }, { t: ' ' }, { t: '⁇' }]} size="xl" />
  </div>

  <div class="block narrow">
    <h2>Rhythm</h2>
    <RhythmView rows={[{ label: 'yours', marks: yours }, { label: 'standard', marks: std, style: 'outline' }]} />
  </div>

  <div class="block two">
    <FistPanel note="Word gaps short: 4.8 units, aim 7." report={{ chars: 12, wpm: 17.6, unit: 0.068, dahRatio: 2.9, elemGap: 1, charGap: 3.1, wordGap: 4.8, weighting: 1.05, drift: 0.4, ditSpread: 0.08, clean: 0.92 }} />
    <LineChart title="Receive speed" unit="wpm" points={pts} />
  </div>

  <div class="block">
    <h2>Keyboard</h2>
    <p class="mono">{typed || ' '}</p>
    <Keyboard onkey={(k) => (typed = k === 'DEL' ? typed.slice(0, -1) : k === 'DONE' ? '' : (typed + k).slice(-30))} />
  </div>
</section>

<style>
  .spec {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    border-top: var(--hairline) solid var(--line);
    padding-top: var(--s-2);
  }

  .row {
    display: flex;
    gap: var(--s-1);
    flex-wrap: wrap;
  }

  .narrow {
    max-width: 420px;
  }

  .two {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    gap: var(--s-4);
  }

  .swatches {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  .swatches li {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--size-s);
  }

  .sw {
    width: 24px;
    height: 24px;
    border-radius: var(--radius);
    border: var(--hairline) solid var(--line);
  }

  @media (max-width: 700px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
