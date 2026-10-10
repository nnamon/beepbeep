<script lang="ts" generics="T extends string">
  let {
    options,
    value = $bindable(),
    label,
    onchange,
  }: {
    options: { value: T; label: string }[];
    value: T;
    label: string;
    onchange?: (v: T) => void;
  } = $props();
</script>

<div class="seg" role="radiogroup" aria-label={label}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === o.value}
      class:on={value === o.value}
      onclick={() => {
        value = o.value;
        onchange?.(o.value);
      }}
    >
      {o.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    padding: 2px;
    gap: 2px;
  }

  button {
    min-height: 40px;
    padding: 0 var(--s-2);
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--muted);
    font-size: var(--size-s);
  }

  button:hover {
    color: var(--ink);
  }

  .on {
    background: var(--surface-2);
    color: var(--ink);
    font-weight: var(--weight-strong);
    box-shadow: inset 0 -2px 0 var(--signal);
  }
</style>
