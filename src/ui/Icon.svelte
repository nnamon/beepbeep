<script lang="ts">
  // One 1.5 px line icon set, drawn for BeepBeep. Used only where a symbol is
  // clearer than a word: transport controls, the mic, settings, close.
  type Name = 'play' | 'stop' | 'replay' | 'mic' | 'mic-off' | 'settings' | 'close' | 'back' | 'forward' | 'key' | 'check';
  let { name, size = 20, label = '' }: { name: Name; size?: number; label?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
>
  {#if name === 'play'}
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />
  {:else if name === 'stop'}
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
  {:else if name === 'replay'}
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.7h3.7" />
  {:else if name === 'mic'}
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  {:else if name === 'mic-off'}
    <path d="M15 9.5V6.5a3 3 0 0 0-5.8-1.1M9 9v2.5a3 3 0 0 0 4.6 2.5" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 10.7 5M18.5 11.5c0 .8-.1 1.5-.4 2.2M12 18v2.5M4 4l16 16" />
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="2.75" />
    <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === 'back'}
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  {:else if name === 'forward'}
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  {:else if name === 'key'}
    <path d="M4 17.5h16M7 17.5v-3h10v3M12 14.5V8.5M9.5 8.5h5" />
  {:else if name === 'check'}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {/if}
</svg>
