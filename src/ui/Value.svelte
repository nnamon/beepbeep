<script lang="ts">
  // A measured value: tabular figures, with its unit small and muted beside it.
  let { value, unit = '', size = 'm' }: { value: string | number; unit?: string; size?: 's' | 'm' | 'l' | 'xl' } = $props();
</script>

<span class="v {size}"><span class="num">{value}</span>{#if unit}<span class="unit">{unit}</span>{/if}</span>

<style>
  .v {
    white-space: nowrap;
  }

  .s {
    font-size: var(--size-s);
  }

  .m {
    font-size: var(--size-m);
  }

  .l {
    font-size: var(--size-l);
  }

  .xl {
    font-size: var(--size-xl);
    font-weight: var(--weight-strong);
    line-height: 1.1;
  }

  .unit {
    font-family: var(--font-ui);
    font-size: var(--size-s);
    font-weight: var(--weight-regular);
    color: var(--muted);
    margin-left: 0.3em;
  }
</style>
