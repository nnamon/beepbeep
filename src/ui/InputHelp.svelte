<script lang="ts">
  // A one-line reminder of how to key, matching the chosen input.
  import { settings } from '../lib/state/settings.svelte';
  import { signal } from '../lib/state/signal.svelte';
  import { href } from '../lib/state/router.svelte';
</script>

<p class="help muted">
  {#if settings.input === 'mic'}
    {#if signal.error}
      {signal.error} <a href={href('setup')}>Open setup</a>
    {:else if signal.info?.bluetooth}
      Bluetooth input: audio drops to call quality. Wired earphones or the built-in mic decode better.
    {:else}
      Input: microphone. Use headphones so the mic doesn't pick up the app.
      No key: <button type="button" class="switch" onclick={() => (settings.input = 'touch')}>Use the touch key</button>
    {/if}
  {:else if settings.input === 'touch'}
    Touch key: hold the pad at the bottom of the screen. Space works too.
  {:else if settings.input === 'straight'}
    Straight key: hold Space.
  {:else}
    Paddles: [ or Z dit, ] or X dah. {settings.input === 'iambicA' ? 'Iambic A' : 'Iambic B'}.
  {/if}
</p>

<style>
  .help {
    font-size: var(--size-s);
    max-width: var(--reading);
  }

  .switch {
    position: relative;
    border: 0;
    background: none;
    padding: 0;
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: var(--signal);
    text-underline-offset: 3px;
    font-size: inherit;
  }

  /* A full-height tap target in a line of small text, without spacing the lines apart. */
  .switch::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: var(--target);
    transform: translateY(-50%);
  }
</style>
