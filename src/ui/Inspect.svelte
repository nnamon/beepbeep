<script lang="ts">
  // An unrecognised character you sent: hear it again, and (outside strict
  // mode) see its rhythm drawn to scale.
  import RhythmView from './RhythmView.svelte';
  import Button from './Button.svelte';
  import { strict } from '../lib/state/settings.svelte';
  import { playMarks } from '../lib/train/session';

  let { marks, onclose }: { marks: { start: number; end: number }[]; onclose: () => void } = $props();
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }}
/>

<div class="inspect" role="group" aria-label="Unrecognised character">
  <span class="label">Unrecognised character</span>
  {#if !strict()}<RhythmView rows={[{ label: 'sent', marks }]} labelWidth={48} />{/if}
  <div class="row">
    <Button onclick={() => playMarks(marks)}>Play it</Button>
    <Button kind="quiet" onclick={onclose}>Close</Button>
  </div>
</div>

<style>
  .inspect {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-1) 0 var(--s-1) var(--s-2);
    border-left: 2px solid var(--line);
    max-width: 480px;
  }

  .row {
    display: flex;
    gap: var(--s-1);
  }
</style>
