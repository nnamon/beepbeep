<script lang="ts">
  let {
    value = $bindable(0),
    min,
    max,
    step = 1,
    label,
    unit = '',
    format,
    onchange,
  }: {
    value?: number;
    min: number;
    max: number;
    step?: number;
    label: string;
    unit?: string;
    format?: (v: number) => string;
    onchange?: (v: number) => void;
  } = $props();
  const id = `s-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="slider">
  <div class="top">
    <label for={id}>{label}</label>
    <span class="num">{format ? format(value) : value}{#if unit}<span class="unit"> {unit}</span>{/if}</span>
  </div>
  <input {id} type="range" {min} {max} {step} bind:value oninput={() => onchange?.(value)} />
</div>

<style>
  .slider {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .unit {
    color: var(--muted);
    font-size: var(--size-s);
  }

  input {
    width: 100%;
    accent-color: var(--signal);
    min-height: 32px;
  }
</style>
