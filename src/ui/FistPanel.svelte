<script lang="ts">
  // One note first, then the measured numbers against their aims.
  import type { FistReport } from '../lib/train/fist';
  import { strict } from '../lib/state/settings.svelte';
  import Value from './Value.svelte';

  let { report, note = '' }: { report: FistReport | null; note?: string } = $props();

  const rows = $derived(
    report
      ? [
          { label: 'Gap between words', aim: 'aim 7 units', value: report.wordGap === null ? 'none sent' : report.wordGap.toFixed(1), unit: report.wordGap === null ? '' : 'units' },
          { label: 'Gap between letters', aim: 'aim 3 units', value: report.charGap === null ? 'none sent' : report.charGap.toFixed(1), unit: report.charGap === null ? '' : 'units' },
          { label: 'Dah length in dits', aim: 'aim 3', value: report.dahRatio === null ? 'not measured' : report.dahRatio.toFixed(1), unit: '' },
          { label: 'Dit to gap inside letters', aim: 'aim 1.0', value: report.weighting === null ? 'not measured' : report.weighting.toFixed(2), unit: '' },
          { label: 'Characters read cleanly', aim: '', value: `${Math.round(report.clean * 100)}%`, unit: '' },
        ]
      : [],
  );
</script>

<div class="panel">
  <div>
    <h3>One note</h3>
    <p class="note">{note || 'No sending measured yet.'}</p>
  </div>
  {#if report}
    <div>
      <h3>Measured</h3>
      <dl>
        {#each rows as r (r.label)}
          <div class="row">
            <dt class="muted">{r.label}{#if r.aim}<span class="aim"><span class="visually-hidden">, </span>{r.aim}</span>{/if}</dt>
            <dd><Value value={r.value} unit={r.unit} /></dd>
          </div>
        {/each}
        <div class="row" class:context={strict()}>
          <dt class="muted">Speed</dt>
          <dd><Value value={report.wpm.toFixed(0)} unit="wpm" /></dd>
        </div>
      </dl>
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .note {
    margin-top: var(--s-1);
    font-size: var(--size-m);
  }

  dl {
    margin: var(--s-1) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
  }

  dt,
  dd {
    margin: 0;
  }

  /* The aim on a line of its own under the name, so it never breaks in two. */
  .aim {
    display: block;
    font-size: var(--size-s);
  }

  .context {
    opacity: 0.8;
  }
</style>
