<script lang="ts">
  // Free practice scope: key anything and watch your own sending decoded live,
  // with its rhythm drawn to scale above the standard and a timing note that
  // updates as you go. In LICW strict mode the text shows only when you pause
  // (or press Done sending), and there are no rhythm bars.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import TokenText, { type Tok } from '../../ui/TokenText.svelte';
  import RhythmView, { type RhythmRow } from '../../ui/RhythmView.svelte';
  import FistPanel from '../../ui/FistPanel.svelte';
  import InputHelp from '../../ui/InputHelp.svelte';
  import Inspect from '../../ui/Inspect.svelte';
  import { LiveDecoder } from '../../lib/audio/live';
  import type { DecoderOutput } from '../../lib/decoder/decoder';
  import { settings, strict } from '../../lib/state/settings.svelte';
  import { signal, touchKeyArea, startMic } from '../../lib/state/signal.svelte';
  import { analyseFist, type FistReport } from '../../lib/train/fist';
  import { oneNote } from '../../lib/train/scoring';
  import { keepAwake } from '../../lib/util/wakelock';
  import { forControl } from '../../lib/util/keys';
  import { followInput, keepSend, saveSession, sendInput } from '../../lib/train/session';

  // The touch key pad stays in place while this screen is open.
  $effect(() => touchKeyArea());
  // Switching input while sending (Use the touch key) moves the decoder over at once.
  $effect(() => {
    void settings.input;
    void followInput(live);
  });

  let live: LiveDecoder | null = null;
  let running = $state(false);
  let tokens = $state<Tok[]>([]);
  let rows = $state<RhythmRow[]>([]);
  // Strict mode: tokens before this index are revealed (the finished overs).
  let revealed = $state(0);
  let overTimer: ReturnType<typeof setTimeout> | null = null;
  let report = $state<FistReport | null>(null);
  let note = $state('');
  let inspecting = $state<{ start: number; end: number }[] | null>(null);
  let startedAt = 0;
  const shown = $derived(strict() ? tokens.slice(0, revealed) : tokens);

  let starting = false;

  async function start() {
    if (running || starting) return;
    starting = true;
    try {
      await begin();
    } finally {
      starting = false;
    }
  }

  /** Set on leaving: a start still waiting for the microphone gives up. */
  let gone = false;

  async function begin() {
    if (settings.input === 'mic' && !signal.micOn) {
      const ok = await startMic();
      if (!ok || gone) return;
    }
    live = new LiveDecoder({
      source: sendInput(),
      charWpm: settings.sendWpm,
      pitch: settings.pitch,
      // Shown re-decoded with what has been learned so far, so early letters settle as you key.
      onOutput: () => {
        const n = ++req;
        void live?.settled().then((o) => {
          if (n === req && live) tokens = render(o);
        });
        signal.wpm = live?.decoder.wpm ?? 0;
        // Timing feedback as you go, not only when you finish (not in strict mode).
        if (live && !strict()) {
          report = analyseFist(live.outputs);
          note = oneNote(report, [], settings.sendTolerance);
        }
      },
      onKey: (down) => {
        if (overTimer) clearTimeout(overTimer);
        overTimer = null;
        if (!down && live) {
          if (!strict()) rows = rhythmRows();
          signal.wpm = live.decoder.wpm;
          if (strict()) overTimer = setTimeout(endOver, settings.overTimeout * 1000);
        }
      },
    });
    await live.start();
    if (gone) {
      live.stop();
      return;
    }
    running = true;
    startedAt = Date.now();
    void keepAwake(true);
  }

  let req = 0;

  async function stop() {
    if (live) {
      const l = live;
      await endOver();
      if (live !== l) return;
      live.stop();
      // Nothing sent: nothing to record.
      if (live.chars.length) void saveSession({
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

  function rhythmRows(): RhythmRow[] {
    if (!live) return [];
    const r = live.recentRhythm(30);
    return r.standard.length
      ? [{ label: 'yours', marks: r.yours }, { label: 'standard', marks: r.standard, style: 'outline' }]
      : [{ label: 'yours', marks: r.yours }];
  }

  function render(outs: DecoderOutput[]): Tok[] {
    const toks: Tok[] = outs.map((o) => {
      if (o.kind === 'space') return { t: ' ' };
      if (o.char.token) return { t: o.char.token, state: 'ok' };
      const m = o.char.marks.map((x) => ({ start: x.start, end: x.end }));
      return { t: '⁇', state: 'unknown', onclick: () => (inspecting = m) };
    });
    const out = toks.slice(-400);
    revealed = Math.min(revealed, out.length);
    return out;
  }

  async function endOver() {
    if (overTimer) clearTimeout(overTimer);
    overTimer = null;
    if (!live) return;
    live.flush();
    req++;
    tokens = render(await live.settle());
    if (!live) return;
    report = analyseFist(live.outputs);
    note = oneNote(report, [], settings.sendTolerance);
    revealed = tokens.length;
    if (!strict()) rows = rhythmRows();
    void keepSend(live.text, live.marks);
  }

  function clear() {
    tokens = [];
    rows = [];
    revealed = 0;
    report = null;
    note = '';
    inspecting = null;
    live?.resetOver();
  }

  onDestroy(() => {
    gone = true;
    if (overTimer) clearTimeout(overTimer);
    live?.stop();
    void keepAwake(false);
  });
</script>

<DrillFrame title="Live decoder" eyebrow={strict() ? 'Your sending, shown when you pause' : 'Your sending, decoded live'}>
  <div class="screen" aria-live="polite">
    {#if shown.length}
      <TokenText tokens={shown} size="xl" label="Decoded sending" />
    {:else}
      <p class="muted placeholder">
        {running ? (strict() ? `Decoded text shows after ${settings.overTimeout} s of silence.` : 'Decoded text shows here.') : 'Press Start and send.'}
      </p>
    {/if}
  </div>
  {#if inspecting}<Inspect marks={inspecting} onclose={() => (inspecting = null)} />{/if}
  {#if rows.length && rows[0].marks.length && !strict()}
    <div class="rhythm">
      <span class="label">Rhythm of your last {rows[0].marks.length} dits and dahs</span>
      <RhythmView {rows} />
    </div>
  {/if}
  <InputHelp />

  {#snippet side()}
    <FistPanel {report} {note} />
  {/snippet}

  {#snippet footer()}
    {#if running}
      <Button kind="primary" onclick={stop} hint="Esc">Stop</Button>
      <Button onclick={endOver}>Done sending</Button>
    {:else}
      <Button kind="primary" onclick={start} disabled={signal.starting}>Start</Button>
    {/if}
    <Button kind="quiet" onclick={clear}>Clear</Button>
  {/snippet}
</DrillFrame>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && running) {
      e.preventDefault();
      stop();
    } else if (e.key === 'Enter' && !running && !forControl(e)) {
      e.preventDefault();
      void start();
    }
  }}
/>

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
