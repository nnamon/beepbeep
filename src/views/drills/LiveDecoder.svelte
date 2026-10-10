<script lang="ts">
  // Free practice scope: key anything and watch your own sending decoded live,
  // with its rhythm drawn to scale. Shows text while you key in every mode.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import TokenText, { type Tok } from '../../ui/TokenText.svelte';
  import RhythmView from '../../ui/RhythmView.svelte';
  import FistPanel from '../../ui/FistPanel.svelte';
  import InputHelp from '../../ui/InputHelp.svelte';
  import Inspect from '../../ui/Inspect.svelte';
  import { LiveDecoder } from '../../lib/audio/live';
  import { settings } from '../../lib/state/settings.svelte';
  import { signal, startMic } from '../../lib/state/signal.svelte';
  import { analyseFist, type FistReport } from '../../lib/train/fist';
  import { oneNote } from '../../lib/train/scoring';
  import { keepAwake } from '../../lib/util/wakelock';
  import { keepSend, saveSession, sendInput } from '../../lib/train/session';

  let live: LiveDecoder | null = null;
  let running = $state(false);
  let tokens = $state<Tok[]>([]);
  let marks = $state<{ start: number; end: number }[]>([]);
  let report = $state<FistReport | null>(null);
  let note = $state('');
  let inspecting = $state<{ start: number; end: number }[] | null>(null);
  let startedAt = 0;

  async function start() {
    if (settings.input === 'mic' && !signal.micOn) {
      const ok = await startMic();
      if (!ok) return;
    }
    live = new LiveDecoder({
      source: sendInput(),
      charWpm: settings.sendWpm,
      pitch: settings.pitch,
      onOutput: (o) => {
        if (o.kind === 'space') tokens.push({ t: ' ' });
        else if (o.char.token) tokens.push({ t: o.char.token, state: 'ok' });
        else {
          const m = o.char.marks.map((x) => ({ start: x.start, end: x.end }));
          tokens.push({ t: '⁇', state: 'unknown', onclick: () => (inspecting = m) });
        }
        if (tokens.length > 400) tokens.splice(0, tokens.length - 400);
        signal.wpm = live?.decoder.wpm ?? 0;
      },
      onKey: (down) => {
        if (!down && live) {
          marks = live.marks.slice(-30);
          signal.wpm = live.decoder.wpm;
        }
      },
    });
    await live.start();
    running = true;
    startedAt = Date.now();
    void keepAwake(true);
  }

  function stop() {
    if (live) {
      endOver();
      live.stop();
      void saveSession({
        mode: 'live',
        seconds: Math.round((Date.now() - startedAt) / 1000),
        sending: true,
        items: live.chars.length,
        accuracy: null,
        wpm: settings.sendWpm,
        sentWpm: report?.wpm,
        fist: report,
      });
    }
    live = null;
    running = false;
    void keepAwake(false);
  }

  function endOver() {
    if (!live) return;
    live.flush();
    report = analyseFist(live.outputs);
    note = oneNote(report, [], settings.sendTolerance);
    void keepSend(live.text, live.marks);
  }

  function clear() {
    tokens = [];
    marks = [];
    report = null;
    note = '';
    inspecting = null;
    live?.resetOver();
  }

  onDestroy(() => {
    live?.stop();
    void keepAwake(false);
  });
</script>

<DrillFrame title="Live decoder" eyebrow="Your sending, decoded live">
  <div class="screen" aria-live="polite">
    {#if tokens.length}
      <TokenText {tokens} size="xl" label="Decoded sending" />
    {:else}
      <p class="muted placeholder">{running ? 'Decoded text shows here.' : 'Press Start and send.'}</p>
    {/if}
  </div>
  {#if inspecting}<Inspect marks={inspecting} onclose={() => (inspecting = null)} />{/if}
  {#if marks.length}
    <div class="rhythm">
      <span class="label">Rhythm, last {marks.length} marks</span>
      <RhythmView rows={[{ label: 'yours', marks }]} />
    </div>
  {/if}
  <InputHelp />

  {#snippet side()}
    <FistPanel {report} {note} />
  {/snippet}

  {#snippet footer()}
    {#if running}
      <Button kind="primary" onclick={stop} hint="Esc">Stop</Button>
      <Button onclick={endOver}>End over</Button>
    {:else}
      <Button kind="primary" onclick={start} disabled={signal.starting}>Start</Button>
    {/if}
    <Button kind="quiet" onclick={clear}>Clear</Button>
  {/snippet}
</DrillFrame>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && running) stop(); }} />

<style>
  .screen {
    min-height: 160px;
    padding: var(--s-2) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  .placeholder {
    font-size: var(--size-l);
  }

  .rhythm {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
</style>
