<script lang="ts" generics="T extends string | number">
  // A labelled native select.
  let {
    label,
    options,
    value = $bindable(),
    onchange,
  }: {
    label: string;
    options: { value: T; label: string }[];
    value: T;
    onchange?: (v: T) => void;
  } = $props();
  const id = `s-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="select">
  <label class="label" for={id}>{label}</label>
  <select
    {id}
    value={String(value)}
    onchange={(e) => {
      const raw = (e.currentTarget as HTMLSelectElement).value;
      const v = (typeof value === 'number' ? Number(raw) : raw) as T;
      value = v;
      onchange?.(v);
    }}
  >
    {#each options as o (o.value)}<option value={String(o.value)}>{o.label}</option>{/each}
  </select>
</div>

<style>
  .select {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  select {
    min-height: var(--target);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    padding: 0 var(--s-1);
    max-width: 320px;
    font: inherit;
  }
</style>
