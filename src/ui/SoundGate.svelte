<script lang="ts">
  // iPhone and iPad: audio starts only from a tap, and the ringer switch mutes
  // web audio unless the page asks for playback. One tap here does both and
  // plays a short dit. Shows again if iOS suspends audio (a call, another app).
  import { engine, IS_IOS } from '../lib/audio/engine';
  import { settings } from '../lib/state/settings.svelte';

  let running = $state(false);

  $effect(() => {
    if (!IS_IOS) return;
    const check = () => (running = engine.ctx?.state === 'running');
    check();
    const t = setInterval(check, 700);
    return () => clearInterval(t);
  });

  async function enable() {
    await engine.ensure();
    running = engine.ctx?.state === 'running';
    void engine.playText('E', { charWpm: 20, pitch: settings.pitch });
  }
</script>

{#if IS_IOS && !running}
  <div class="gate" role="status">
    <span>Sound is off until you tap. It plays with the silent switch on.</span>
    <button type="button" onclick={enable}>Turn sound on</button>
  </div>
{/if}

<style>
  .gate {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-2);
    padding: var(--s-1) calc(var(--s-2) + var(--safe-right)) var(--s-1) calc(var(--s-2) + var(--safe-left));
    border-bottom: var(--hairline) solid var(--line);
    font-size: var(--size-s);
    color: var(--muted);
  }

  button {
    min-height: var(--target-min);
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--signal);
    border-radius: var(--radius);
    background: var(--signal-soft);
    color: var(--ink);
    font-size: var(--size-s);
    font-weight: var(--weight-strong);
  }
</style>
