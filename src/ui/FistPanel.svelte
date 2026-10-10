<script lang="ts">
  // One note first, then the measured numbers against their aims.
  import type { FistReport } from '../lib/train/fist';
  import { strict } from '../lib/state/settings.svelte';
  import Value from './Value.svelte';

  let { report, note = '' }: { report: FistReport | null; note?: string } = $props();

  const rows = $derived(
    report
      ? [
          { label: 'Word gap, aim 7', value: report.wordGap === null ? '–' : report.wordGap.toFixed(1), unit: report.wordGap === null ? '' : 'units' },
          { label: 'Letter gap, aim 3', value: report.charGap.toFixed(1), unit: 'units' },
          { label: 'Dah to dit, aim 3', value: report.dahRatio.toFixed(1), unit: '' },
          { label: 'Weighting, aim 1.0', value: report.weighting.toFixed(2), unit: '' },
          { label: 'Clean characters', value: `${Math.round(report.clean * 100)}%`, unit: '' },
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
      <h3>This over</h3>
      <dl>
        {#each rows as r (r.label)}
          <div class="row"><dt class="muted">{r.label}</dt><dd><Value value={r.value} unit={r.unit} /></dd></div>
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

  .context {
    opacity: 0.8;
  }
</style>
