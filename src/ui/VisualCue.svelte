<script lang="ts">
  // Optional light that pulses with the app's own tone, for noisy rooms and
  // hard-of-hearing operators. Off by default; unavailable in LICW strict mode.
  import { onMount } from 'svelte';
  import { engine } from '../lib/audio/engine';
  import { strict } from '../lib/state/settings.svelte';

  let on = $state(false);

  onMount(() => {
    let raf = 0;
    const loop = () => {
      const c = engine.cue;
      const now = engine.now;
      let lit = false;
      if (c && !strict()) {
        for (const m of c.marks) {
          if (now >= c.start + m.start && now <= c.start + m.end) {
            lit = true;
            break;
          }
        }
      }
      on = lit;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="cue" class:on aria-hidden="true"></div>

<style>
  .cue {
    position: fixed;
    top: max(var(--s-2), env(safe-area-inset-top));
    right: var(--s-2);
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--muted);
    z-index: 20;
    pointer-events: none;
  }

  .on {
    background: var(--signal);
    border-color: var(--signal);
  }
</style>
