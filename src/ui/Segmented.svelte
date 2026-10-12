<script lang="ts" generics="T extends string | number">
  // A row of choices that works like a set of radio buttons: one tab stop (the
  // chosen option), arrow keys move the choice, Home and End jump to the ends.
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

  let group: HTMLDivElement;

  // The option in the tab order: the chosen one, or the first if none is chosen.
  const stop = $derived(options.some((o) => o.value === value) ? value : options[0]?.value);

  function choose(v: T) {
    value = v;
    onchange?.(v);
  }

  function onkeydown(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === stop);
    const n = options.length;
    let to: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    else return;
    // Alt+arrows change the receive speed everywhere; leave them alone.
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (options[to].value !== value) choose(options[to].value);
    group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  }
</script>

<div class="seg" role="radiogroup" aria-label={label} bind:this={group}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === o.value}
      tabindex={o.value === stop ? 0 : -1}
      class:on={value === o.value}
      onclick={() => choose(o.value)}
      {onkeydown}
    >
      {o.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    align-self: flex-start;
    max-width: 100%;
    flex-wrap: wrap;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    padding: 2px;
    gap: 2px;
  }

  button {
    min-height: var(--target-min);
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
