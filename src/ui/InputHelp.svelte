<script lang="ts">
  // A one-line reminder of how to key, matching the chosen input.
  import { settings } from '../lib/state/settings.svelte';
  import { signal } from '../lib/state/signal.svelte';
  import { href } from '../lib/state/router.svelte';
  import { straightOnly } from '../lib/train/session';
</script>

<p class="help muted">
  {#if settings.input === 'mic'}
    {#if signal.error}
      {signal.error} <a href={href('setup')}>Open setup</a>, or
      <button type="button" class="switch" onclick={() => (settings.input = 'touch')}>use the touch key</button> instead.
    {:else if signal.info?.bluetooth}
      Bluetooth input drops the audio to call quality. Wired earphones or the built-in mic decode better.
    {:else}
      BeepBeep hears your key through the microphone. Use headphones so it doesn't hear the app's own sound. If you have
      no key, <button type="button" class="switch" onclick={() => (settings.input = 'touch')}>use the touch key</button>.
    {/if}
  {:else if settings.input === 'touch'}
    Touch key: hold the pad at the bottom of the screen. Space works too.
  {:else if settings.input === 'straight'}
    Straight key: hold Space.
  {:else if straightOnly()}
    In LICW strict mode, BC lessons use the straight key: hold Space. Turn strict mode off in Settings to use paddles.
  {:else}
    Paddles {settings.input === 'iambicA' ? 'A' : 'B'}: [ or Z for dit, ] or X for dah.
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
