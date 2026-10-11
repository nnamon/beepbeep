<script lang="ts">
  // The BeepBeep roadrunner, in the text colour (amber stays reserved for live signal).
  let { size = 22 }: { size?: number } = $props();
</script>

<svg viewBox="2 1 62 45" width={(size * 62) / 45} height={size} aria-hidden="true" focusable="false">
  <g fill="currentColor">
    <path d="M27.5 28.2 L3.2 14.4 L2.8 17.4 L25.6 33 Z" />
    <path d="M22 30.6 C24.6 25 33 22.6 41.2 23 C46 23.3 48.2 26 46.4 29.4 C44 33.6 35.6 36.2 28.4 35.6 C24.2 35.2 21 33.2 22 30.6 Z" />
    <path d="M40.2 25.2 C43.8 21.4 46.8 17.6 49.2 13.6 L53.8 15.4 C51.4 19.6 48.8 24.4 46.8 28.8 Z" />
    <circle cx="52" cy="13.4" r="4" />
    <path d="M49.4 11.2 L40.2 5.4 L50.4 13.4 Z" />
    <path d="M51.2 10 L44.6 2.4 L53 10.6 Z" />
    <path d="M53.4 9.8 L50.8 1.4 L55.2 10.4 Z" />
    <path d="M55.4 12 L63.6 14.6 L55.6 16 Z" />
  </g>
  <circle cx="53.2" cy="12.8" r="1.05" class="eye" />
  <g stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M31 34.6 L25.8 42.4 L19 44.6" />
    <path d="M36.8 34.2 L43 41.4 L49.8 42.2" />
  </g>
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }

  .eye {
    fill: var(--bg);
  }
</style>
