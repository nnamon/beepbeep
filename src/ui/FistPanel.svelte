<script lang="ts">
  // One note first, then the measured numbers against their aims.
  import type { FistReport } from '../lib/train/fist';
  import { strict } from '../lib/state/settings.svelte';

  let { report, note = '' }: { report: FistReport | null; note?: string } = $props();

  const rows = $derived(
    report
      ? [
          { label: 'Word gap, aim 7', value: report.wordGap === null ? '–' : `${report.wordGap.toFixed(1)} u` },
          { label: 'Letter gap, aim 3', value: `${report.charGap.toFixed(1)} u` },
          { label: 'Dah to dit, aim 3', value: report.dahRatio.toFixed(1) },
          { label: 'Weighting, aim 1.0', value: report.weighting.toFixed(2) },
        ]
      : [],
  );
</script>

<div class="panel">
  <div>
    <h3>One note</h3>
    <p class="note">{note || 'Send a few words, then end the over.'}</p>
  </div>
  {#if report}
    <div>
      <h3>This over</h3>
      <dl>
        {#each rows as r (r.label)}
          <div class="row"><dt class="muted">{r.label}</dt><dd class="num">{r.value}</dd></div>
        {/each}
        <div class="row" class:context={strict()}>
          <dt class="muted">Speed</dt>
          <dd class="num">{report.wpm.toFixed(0)} wpm</dd>
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
