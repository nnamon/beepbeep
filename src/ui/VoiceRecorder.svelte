<script lang="ts">
  // Record your own voice for spoken answers: one short clip per character.
  import { onMount } from 'svelte';
  import { deleteVoiceClip, saveVoiceClip, voiceClip, voiceTokens } from '../lib/state/db';
  import { LETTER_TOKENS, DIGIT_TOKENS, displayToken, isProsign } from '../lib/morse/code';
  import { spoken } from '../lib/audio/speech';

  const TOKENS = [...LETTER_TOKENS, ...DIGIT_TOKENS, '.', ',', '?', '/', '<AR>', '<SK>', '<BT>', '<KN>', '<BK>'];
  let have = $state<Set<string>>(new Set());
  let busy = $state('');
  let error = $state('');

  onMount(async () => {
    have = new Set(await voiceTokens().catch(() => []));
  });

  async function record(t: string) {
    error = '';
    busy = t;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start();
      await new Promise((r) => setTimeout(r, 1400));
      rec.stop();
      await done;
      stream.getTracks().forEach((x) => x.stop());
      await saveVoiceClip(t, new Blob(chunks, { type: rec.mimeType }));
      have = new Set([...have, t]);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      error =
        name === 'NotAllowedError'
          ? "The microphone is blocked, so nothing was recorded. Allow it in the browser's site settings, then try again."
          : name === 'NotFoundError'
            ? 'No microphone was found, so nothing was recorded.'
            : "The clip wasn't recorded. Try again.";
    } finally {
      busy = '';
    }
  }

  async function play(t: string) {
    const b = await voiceClip(t).catch(() => null);
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    void a.play();
  }

  async function remove(t: string) {
    await deleteVoiceClip(t);
    const s = new Set(have);
    s.delete(t);
    have = s;
  }
</script>

<div class="rec">
  <p class="muted small">Each clip records for 1.4 seconds from when you press Record. Say the name only: "{spoken('K')}", "{spoken('<AR>')}".</p>
  {#if error}<p class="small">{error}</p>{/if}
  <ul>
    {#each TOKENS as t (t)}
      <li>
        <span class="mono tok" class:prosign={isProsign(t)}>{displayToken(t)}</span>
        <button type="button" onclick={() => record(t)} disabled={!!busy}>{busy === t ? 'Recording' : 'Record'}</button>
        {#if have.has(t)}
          <button type="button" onclick={() => play(t)}>Play</button>
          <button type="button" class="quiet" onclick={() => remove(t)}>Delete</button>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .small {
    font-size: var(--size-s);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: var(--s-1) 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: var(--s-half) var(--s-3);
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    border-bottom: var(--hairline) solid var(--line);
    min-height: 44px;
  }

  .tok {
    width: 3ch;
    font-size: var(--size-m);
  }

  button {
    min-height: 36px;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    padding: 0 var(--s-1);
    font-size: var(--size-s);
  }

  .quiet {
    border-color: transparent;
    color: var(--muted);
  }
</style>
