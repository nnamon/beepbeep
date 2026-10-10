<script lang="ts">
  let {
    checked = $bindable(false),
    label,
    detail = '',
    disabled = false,
    onchange,
  }: { checked?: boolean; label: string; detail?: string; disabled?: boolean; onchange?: (v: boolean) => void } = $props();
  const id = `t-${Math.random().toString(36).slice(2, 8)}`;
</script>

<label class="row" for={id} class:disabled>
  <span class="text">
    <span>{label}</span>
    {#if detail}<span class="detail">{detail}</span>{/if}
  </span>
  <input
    {id}
    type="checkbox"
    role="switch"
    bind:checked
    {disabled}
    onchange={() => onchange?.(checked)}
  />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</label>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    min-height: var(--target);
    cursor: pointer;
    position: relative;
  }

  .disabled {
    opacity: 0.5;
    cursor: default;
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  .detail {
    font-size: var(--size-s);
    color: var(--muted);
  }

  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }

  .track {
    flex: none;
    width: 44px;
    height: 24px;
    border-radius: 12px;
    border: 1.5px solid var(--muted);
    position: relative;
    transition: border-color var(--transition), background-color var(--transition);
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform var(--transition), background-color var(--transition);
  }

  input:checked + .track {
    border-color: var(--signal);
    background: var(--signal-soft);
  }

  input:checked + .track .knob {
    transform: translateX(20px);
    background: var(--signal);
  }

  input:focus-visible + .track {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
  }
</style>
