<script module lang="ts">
  import { createRadioSource } from '../lib/radio/create';
  import { Transcript } from '../lib/radio/transcript';
  import type { RadioSignal } from '../lib/radio/source';
  import { holdReload } from '../lib/state/update';

  // One source for the page: what was heard stays while you visit other
  // screens, until the page reloads. Leaving the screen stops the listening.
  const source = createRadioSource();
  const transcript = new Transcript();
  let latest: RadioSignal[] = [];
  const watchers = new Set<(list: RadioSignal[], added: Map<number, string>) => void>();
  source.subscribe((list) => {
    latest = list;
    const added = transcript.update(list, Date.now());
    // The text lives only in this page's memory: an app update must not reload it away.
    holdReload('radio', transcript.size > 0);
    for (const w of watchers) w(list, added);
  });

  /** The signal you chose to follow (null: the one sending), and the one followed for you. Kept while you are elsewhere. */
  let keptChoice: number | null = null;
  let keptAuto: number | null = null;
</script>

<script lang="ts">
  // Leave the app listening to a radio: every signal it decodes, one followed
  // in large text, the others listed by pitch. Nothing here keys or plays.
  import { onDestroy, tick } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import { engine } from '../lib/audio/engine';
  import { settings } from '../lib/state/settings.svelte';
  import { micError, signal, stopMic } from '../lib/state/signal.svelte';
  import { ending, fileName, parts, readable } from '../lib/radio/transcript';
  import { keepAwake } from '../lib/util/wakelock';
  import { forControl, inField } from '../lib/util/keys';

  /** Not heard for this long: shown as quiet, ms. */
  const QUIET_MS = 30_000;
  /** The signal followed for you stays followed this long after its last sound, ms (an over ends after 3 seconds of silence). */
  const STAY_MS = 5_000;
  /** Clear asks first when there is at least this much text. */
  const ASK_CHARS = 200;

  let signals = $state.raw<RadioSignal[]>(latest);
  let total = $state(transcript.size);
  let chosen = $state<number | null>(keptChoice);
  let auto = $state<number | null>(keptAuto);
  let listening = $state(false);
  let starting = $state(false);
  let error = $state('');
  let notice = $state('');
  /** The newest text of the followed signal, read out by screen readers. */
  let spoken = $state('');
  let now = $state(performance.now());

  // On a phone the advice is to move the phone; on a computer, the computer.
  const device = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'computer';
  const secure = engine.micSupported;

  /** The followed signal stays while it sends and a few seconds after; then the one heard last. */
  function pickAuto(list: RadioSignal[], t: number) {
    const cur = list.find((s) => s.id === auto);
    if (cur && (cur.keying || t - cur.lastHeard < STAY_MS)) return;
    auto = (list.find((s) => s.keying) ?? list[0])?.id ?? null;
  }

  function onSignals(list: RadioSignal[], added: Map<number, string>) {
    const t = performance.now();
    now = t;
    signals = list;
    total = transcript.size;
    if (chosen !== null && !list.some((s) => s.id === chosen)) chosen = null;
    pickAuto(list, t);
    const id = chosen ?? auto;
    const more = id === null ? '' : (added.get(id) ?? '').trim();
    const f = list.find((s) => s.id === id);
    if (more && f) spoken = `${Math.round(f.pitch)} Hz: ${readable(more)}`;
  }
  watchers.add(onSignals);
  pickAuto(latest, performance.now());

  const followed = $derived(signals.find((s) => s.id === (chosen ?? auto)) ?? null);
  // Listed by pitch, low to high, so rows stay put as signals come and go.
  const others = $derived(signals.filter((s) => s.id !== followed?.id).sort((a, b) => a.pitch - b.pitch));
  const lines = $derived(followed ? followed.text.split('\n') : []);

  const quiet = (s: RadioSignal) => !s.keying && now - s.lastHeard >= QUIET_MS;
  const speed = (s: RadioSignal) => (s.wpm ? `${Math.round(s.wpm)} wpm` : 'speed not measured yet');
  const strength = (s: RadioSignal) => (s.snr <= 0 ? '' : s.snr >= 35 ? 'strong' : s.snr >= 20 ? 'fair' : 'weak');

  const tickTimer = setInterval(() => (now = performance.now()), 1000);

  /** Set on leaving: a start still waiting for the microphone gives up. */
  let gone = false;

  async function start() {
    if (listening || starting) return;
    starting = true;
    error = '';
    notice = '';
    try {
      await source.start();
      if (gone) {
        source.stop();
        return;
      }
      listening = true;
      void keepAwake(true);
      void listDevices();
    } catch (err) {
      error = micError(err);
    } finally {
      starting = false;
    }
  }

  // A cable from the radio may come in on another input than the browser's choice.
  let devices = $state<{ value: string; label: string }[]>([]);
  async function listDevices() {
    const all = await engine.inputDevices().catch(() => []);
    if (!gone) devices = all.map((d) => ({ value: d.deviceId, label: d.label || 'Microphone' }));
  }
  if (signal.micOn) void listDevices();

  async function changeDevice(id: string) {
    settings.micDeviceId = id;
    if (!listening) return;
    stop();
    await start();
  }

  function stop() {
    if (!listening) return;
    source.stop();
    // The radio may have been on for hours: the microphone is let go at once.
    stopMic();
    listening = false;
    void keepAwake(false);
  }

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function tell(text: string) {
    notice = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 6000);
  }

  async function copy() {
    if (!followed) return;
    const pitch = Math.round(followed.pitch);
    try {
      await navigator.clipboard.writeText(readable(`${followed.text}${followed.pending}`.trim()));
      tell(`Copied the text of the signal at ${pitch} Hz.`);
    } catch {
      tell("The text couldn't be copied. Select it and copy it yourself, or use Save.");
    }
  }

  function save() {
    const when = new Date();
    const name = fileName(when);
    const url = URL.createObjectURL(new Blob([transcript.file(when)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    tell(`Saved the text of every signal, with times, as ${name} in your downloads.`);
  }

  function clear() {
    const n = transcript.signals;
    if (total >= ASK_CHARS) {
      const what = n === 1 ? 'the signal' : `all ${n} signals`;
      if (!confirm(`Clear the text of ${what}? ${total.toLocaleString('en-GB')} characters will be gone. To keep them, press Cancel and then Save.`)) return;
    }
    source.clear();
    transcript.clear();
    total = 0;
    chosen = null;
    auto = null;
    spoken = '';
    tell('The text of every signal is cleared.');
  }

  /** Follows a signal you chose; the text box takes focus, since the row you pressed moves up into it. */
  function follow(id: number) {
    chosen = id;
    void tick().then(() => box?.focus());
  }

  // The text box: newest at the bottom, kept in view unless you scroll up to read.
  let box = $state<HTMLElement | null>(null);
  let stick = $state(true);
  let lastTop = 0;
  function onScroll() {
    if (!box) return;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    if (atEnd) stick = true;
    else if (box.scrollTop < lastTop) stick = false;
    lastTop = box.scrollTop;
  }
  let shownId: number | null = null;
  $effect(() => {
    const id = followed?.id ?? null;
    if (id !== shownId) {
      shownId = id;
      stick = true;
    }
  });
  $effect(() => {
    void followed?.text;
    void followed?.pending;
    if (stick && box) box.scrollTop = box.scrollHeight;
  });
  function toNewest() {
    stick = true;
    box?.focus();
  }

  // The box fills the screen down to the tab bar (or near the bottom of a wide window), so the
  // newest line is in view without scrolling the page. Measured again whenever anything above it
  // changes size, and when the window does.
  let section = $state<HTMLElement | null>(null);
  let fitted = $state<number | null>(null);
  function fit() {
    if (!box) return;
    const top = box.getBoundingClientRect().top + window.scrollY;
    const bar = document.querySelector('.tabbar');
    const below = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().height + 16 : 32;
    const h = Math.max(160, Math.floor(window.innerHeight - top - below));
    if (h !== fitted) fitted = h;
  }
  $effect(() => {
    if (!section) return;
    // In the next frame: a height set inside the observer's callback would resize what it watches in the same frame.
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const watch = new ResizeObserver(refit);
    watch.observe(section);
    window.addEventListener('resize', refit);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      window.removeEventListener('resize', refit);
    };
  });

  // Arrow keys move through the list; Enter or Space on a row follows it.
  let focusId = $state<number | null>(null);
  const tabStop = $derived(others.some((s) => s.id === focusId) ? focusId : (others[0]?.id ?? null));
  function onListKey(e: KeyboardEvent) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key) || !others.length) return;
    e.preventDefault();
    const at = Math.max(0, others.findIndex((s) => s.id === tabStop));
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? others.length - 1 : Math.min(others.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
    focusId = others[to].id;
    void tick().then(() => (document.querySelector(`[data-signal="${focusId}"]`) as HTMLElement | null)?.focus());
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && listening && !inField(e)) {
      e.preventDefault();
      stop();
    } else if (e.key === 'Enter' && !listening && !forControl(e) && secure) {
      e.preventDefault();
      void start();
    }
  }

  onDestroy(() => {
    gone = true;
    watchers.delete(onSignals);
    clearInterval(tickTimer);
    if (noticeTimer) clearTimeout(noticeTimer);
    keptChoice = chosen;
    keptAuto = auto;
    // Left by a link: listening stops. The app lets the microphone go about 10 seconds later.
    if (listening) source.stop();
    void keepAwake(false);
  });

  const status = $derived(
    error || notice || (!listening && !starting && total > 0 ? 'BeepBeep has stopped listening. Press Start to listen again.' : ''),
  );
</script>

<svelte:window onkeydown={onKey} />

<section class="radio" bind:this={section}>
  <div class="head">
    <h1>Radio</h1>
    <p class="lead muted">Each signal shows its pitch (how high its tone is, in Hz) and its speed in wpm (words per minute).</p>
  </div>

  <div class="actions">
    <Button kind="primary" onclick={() => (listening ? stop() : void start())} disabled={starting || (!listening && !secure)} hint={listening ? 'Esc' : 'Enter'}
      >{listening ? 'Stop' : 'Start'}</Button
    >
    <Button onclick={copy} disabled={!followed || !(followed.text || followed.pending)}>Copy text</Button>
    <Button onclick={save} disabled={total === 0}>Save</Button>
    <Button kind="quiet" onclick={clear} disabled={total === 0}>Clear</Button>
  </div>
  {#if devices.length > 1}
    <div class="device">
      <Select label="Device" options={[{ value: '', label: 'Default' }, ...devices]} value={settings.micDeviceId} onchange={changeDevice} />
    </div>
  {/if}

  {#if !secure}
    <p class="warn">The microphone needs a secure (https) page. Open BeepBeep from its https address.</p>
  {/if}
  <p class="status" class:warn={!!error} role="status">{status}</p>

  <div class="cols">
    <div class="main">
      {#if followed}
        <div class="following">
          <span class="led" class:on={followed.keying} aria-hidden="true"></span>
          <span class="label">Following</span>
          <span class="facts">{@render facts([`${Math.round(followed.pitch)} Hz`, speed(followed), strength(followed), quiet(followed) ? 'quiet' : ''])}</span>
          {#if chosen !== null}<span class="auto"><Button kind="quiet" onclick={() => (chosen = null)}>Follow automatically</Button></span>{/if}
        </div>
      {/if}

      <div class="frame">
        <!-- Scrolls on its own, newest at the bottom; it can take focus, so the keyboard scrolls it too. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="box"
          bind:this={box}
          style:height={fitted ? `${fitted}px` : undefined}
          onscroll={onScroll}
          tabindex="0"
          role="region"
          aria-label={followed ? `Text from the signal at ${Math.round(followed.pitch)} Hz` : 'Decoded text'}
        >
          {#if followed}
            {#each lines as line, i (i)}
              {#if i < lines.length - 1}
                <p class="line">{@render text(line)}</p>
              {:else if line || followed.pending}
                <!-- The over in progress goes on from the last line; its last word is still being read. -->
                {@const cut = followed.pending.lastIndexOf(' ') + 1}
                <p class="line">{@render text(line)}{@render text(followed.pending.slice(0, cut))}<span class="pending">{@render text(followed.pending.slice(cut))}</span></p>
              {/if}
            {/each}
          {:else if starting}
            <p class="empty">The microphone is starting. If the browser asks, allow it.</p>
          {:else if listening}
            <p class="empty">
              BeepBeep is listening but hasn't heard any Morse yet. Text shows here as soon as it decodes a signal. If nothing
              shows, turn the radio's volume up or bring the {device} closer to its speaker.
            </p>
          {:else}
            <p class="empty">
              Connect your radio's audio to the microphone, or put the {device} near its speaker, then press Start. BeepBeep writes
              down the Morse it hears.
            </p>
            <p class="empty small">
              If the radio's audio comes in through a cable, press Start and then pick that input under Device. Device appears
              when there is more than one input to choose from.
            </p>
          {/if}
        </div>
        {#if followed && !stick}
          <button type="button" class="newest" onclick={toNewest}>Show newest</button>
        {/if}
      </div>
    </div>

    {#if listening || signals.length}
      <section class="side" aria-labelledby="others-heading">
        <h2 id="others-heading">Other signals</h2>
        <p class="small muted">
          {chosen === null
            ? 'BeepBeep follows the signal that is sending. Choose another signal here to follow it instead.'
            : 'BeepBeep follows the signal you chose. Follow automatically goes back to the signal that is sending.'}
          A signal not heard for 30 seconds is marked quiet.
        </p>
        {#if others.length}
          <ul class="list" role="list">
            {#each others as s (s.id)}
              <li>
                <button type="button" class="row" class:quiet={quiet(s)} data-signal={s.id} tabindex={s.id === tabStop ? 0 : -1} onclick={() => follow(s.id)} onfocus={() => (focusId = s.id)} onkeydown={onListKey}>
                  <span class="top">
                    <span class="led" class:on={s.keying} aria-hidden="true"></span>
                    <span><span class="visually-hidden">Follow the signal at </span>{@render facts([`${Math.round(s.pitch)} Hz`, speed(s), quiet(s) ? 'quiet' : ''])}<span
                        class="visually-hidden">: </span
                      ></span
                    >
                  </span>
                  <span class="tail mono">{@render text(ending(s, 28))}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No other signals have been heard yet.</p>
        {/if}
      </section>
    {/if}
  </div>

  <!-- New text of the followed signal, read out by screen readers. -->
  <p class="visually-hidden" aria-live="polite">{spoken}</p>
</section>

<!-- Facts about a signal on one line, a dot between them; a screen reader hears commas. -->
{#snippet facts(items: string[])}{#each items.filter(Boolean) as f, k (k)}{#if k}<span class="sep" aria-hidden="true">·</span><span class="visually-hidden">, </span>{/if}<span
      >{f}</span
    >{/each}{/snippet}

{#snippet text(s: string)}{#each parts(s) as p, k (k)}{#if p.kind === 'prosign'}<span class="prosign">{p.text}</span>{:else if p.kind === 'unreadable'}<span
        class="unreadable"
        role="img"
        aria-label="unreadable character">{p.text}</span
      >{:else}{p.text}{/if}{/each}{/snippet}

<style>
  .radio {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .lead {
    max-width: var(--reading);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }

  .device {
    max-width: 320px;
  }

  /* Empty, it takes no room but stays in place, so a screen reader hears what appears in it. */
  .status:empty {
    margin-top: calc(-1 * var(--s-2));
  }

  .warn {
    max-width: var(--reading);
    border-left: 2px solid var(--signal);
    padding-left: var(--s-1);
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: var(--s-3) var(--s-4);
    align-items: start;
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }

  .following {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--s-1);
    min-height: var(--target-min);
  }

  .facts {
    font-variant-numeric: tabular-nums;
  }

  .auto {
    margin-left: auto;
  }

  .sep {
    margin: 0 0.4em;
    color: var(--muted);
  }

  .led {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--muted);
  }

  .led.on {
    background: var(--signal);
    border-color: var(--signal);
  }

  .frame {
    position: relative;
  }

  .box {
    height: max(260px, 100dvh - 400px);
    overflow-y: auto;
    padding: var(--s-2);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-feature-settings: 'zero' 1;
    font-size: var(--size-xl);
    line-height: 1.35;
    letter-spacing: 0.02em;
    overflow-wrap: anywhere;
  }

  .line {
    margin: 0 0 var(--s-1);
  }

  .line:last-child {
    margin-bottom: 0;
  }

  .pending,
  .unreadable {
    color: var(--muted);
  }

  /* The overline sits just above the capitals, as in the rest of the app (TokenText). */
  .prosign {
    position: relative;
    white-space: nowrap;
  }

  .prosign::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0.02em;
    top: 0.17em;
    border-top: max(1.5px, 0.06em) solid currentcolor;
    pointer-events: none;
  }

  .empty {
    font-family: var(--font-ui);
    font-size: var(--size-l);
    line-height: var(--leading);
    letter-spacing: 0;
    color: var(--muted);
    max-width: var(--reading);
  }

  .empty + .empty {
    margin-top: var(--s-2);
  }

  .empty.small,
  .small {
    font-size: var(--size-s);
  }


  .newest {
    position: absolute;
    right: var(--s-2);
    bottom: var(--s-2);
    min-height: var(--target);
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font-size: var(--size-m);
  }

  .newest:hover {
    background: var(--surface-2);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
    border-left: var(--hairline) solid var(--line);
    padding-left: var(--s-3);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--hairline) solid var(--line);
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-height: var(--target);
    padding: var(--s-1);
    border: 0;
    border-bottom: var(--hairline) solid var(--line);
    background: none;
    color: var(--ink);
    text-align: left;
    font-size: var(--size-m);
  }

  .row:hover {
    background: var(--surface-2);
  }

  .row:focus-visible {
    outline-offset: -2px;
  }

  .row.quiet {
    color: var(--muted);
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }

  .tail {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  @media (max-width: 860px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      border-left: 0;
      padding-left: 0;
    }
  }

  /* Phones: smaller reading text, so a line holds a callsign and a word or two. */
  @media (max-width: 600px) {
    .box {
      height: max(220px, 100dvh - 430px);
      font-size: var(--size-big);
    }

    .actions :global(.btn) {
      flex: 1 1 auto;
    }
  }

  /* A phone on its side: little height, so the box takes what there is. */
  @media (orientation: landscape) and (max-height: 500px) {
    .box {
      height: max(160px, 100dvh - 200px);
      font-size: var(--size-big);
    }
  }
</style>
