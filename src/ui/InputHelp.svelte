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
      A Bluetooth headset is the input; it may reduce the mic to call quality. Wired earphones or the built-in mic work
      better.
    {:else}
      Listening through the microphone. Keep your sidetone near the mic and use headphones for the app's own audio.
    {/if}
  {:else if settings.input === 'straight'}
    Keyboard straight key: hold Space.
  {:else}
    Keyboard paddles: [ or Z for dit, ] or X for dah ({settings.input === 'iambicA' ? 'iambic A' : 'iambic B'}).
  {/if}
</p>

<style>
  .help {
    font-size: var(--size-s);
    max-width: var(--reading);
  }
</style>
