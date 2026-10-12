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
  import { micError, stopMic } from '../lib/state/signal.svelte';
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
  const speed = (s: RadioSignal) => (s.wpm ? `${Math.round(s.wpm)} wpm` : 'measuring speed');
  const strength = (s: RadioSignal) => (s.snr <= 0 ? '' : s.snr >= 35 ? 'strong' : s.snr >= 20 ? 'fair' : 'weak');

  const tickTimer = setInterval(() => {
    now = performance.now();
    // iOS pauses all audio for a call, or for another app taking the sound: listening has stopped, so say so.
    if (listening && engine.ctx && engine.ctx.state !== 'running') {
      stop();
      error = `Listening stopped because the ${device} paused its audio, for example for a call. Press Start to listen again.`;
    }
  }, 1000);

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

  // A cable from the radio may come in on another device than the browser's choice. The browser
  // names its devices only once the microphone has been allowed, so unnamed ones are not offered.
  let devices = $state<{ value: string; label: string }[]>([]);
  /** While listening, the device list shows only after Change device. */
  let changing = $state(false);
  async function listDevices() {
    const all = await engine.inputDevices().catch(() => []);
    if (!gone) devices = all.filter((d) => d.label).map((d) => ({ value: d.deviceId, label: d.label }));
  }
  void listDevices();

  async function changeDevice(id: string) {
    settings.micDeviceId = id;
    changing = false;
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

  // Copy text acts on the followed signal's text: enabled once it has any.
  const hasAny = $derived(!!followed && !!(followed.text || followed.pending));

  const status = $derived(
    error || notice || (!listening && !starting && total > 0 ? 'BeepBeep has stopped listening. Press Start to listen again.' : ''),
  );
</script>

<svelte:window onkeydown={onKey} />

<section class="radio">
  <div class="top">
    <h1>Radio</h1>
    <Button kind="primary" onclick={() => (listening ? stop() : void start())} disabled={starting || (!listening && !secure)} hint={listening ? 'Esc' : 'Enter'}
      >{listening ? 'Stop' : 'Start'}</Button
    >
  </div>

  {#if !secure}
    <p class="warn">The microphone needs a secure (https) page. Open BeepBeep from its https address.</p>
  {/if}
  <p class="status" class:warn={!!error} role="status">{status}</p>

  {#if !followed}
    <!-- Until a signal is heard: what to do, in plain text. The reading box comes with the first signal. -->
    <div class="intro">
      {#if starting}
        <p>The microphone is starting. If the browser asks, allow it.</p>
      {:else if listening}
        <p>
          BeepBeep is listening but hasn't heard any Morse yet. Text shows here as soon as it decodes a signal. If nothing shows,
          turn the radio's volume up or bring the {device} closer to its speaker.
        </p>
      {:else}
        <p>
          Connect your radio's audio to the microphone, or put the {device} near its speaker, then press Start. BeepBeep writes down
          the Morse it hears.
        </p>
      {/if}
      <p class="muted">Each signal shows its pitch (how high its tone is, in Hz) and its speed in wpm (words per minute).</p>
      {#if devices.length > 1}
        {#if listening && !changing}
          <div><Button kind="quiet" onclick={() => (changing = true)}>Change device</Button></div>
        {:else}
          {@render chooser()}
        {/if}
      {:else if !listening}
        <p class="muted small">
          With a cable from the radio, press Start first. If there is more than one device to choose from, you can then pick the
          cable's with Change device.
        </p>
      {/if}
    </div>
  {:else}
    <div class="cols">
      <div class="main">
        <div class="following">
          <span class="led" class:on={followed.keying} aria-hidden="true"></span>
          <span class="label">Following</span>
          <span class="facts">{@render facts([`${Math.round(followed.pitch)} Hz`, speed(followed), strength(followed), quiet(followed) ? 'quiet' : ''])}</span>
        </div>

        <div class="frame">
          <!-- Scrolls on its own, newest at the bottom; it can take focus, so the keyboard scrolls it too. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div class="box" bind:this={box} onscroll={onScroll} tabindex="0" role="region" aria-label={`Text from the signal at ${Math.round(followed.pitch)} Hz`}>
            {#if !followed.text && !followed.pending}
              <p class="none">Nothing has been read from this signal yet.</p>
            {:else}
              {#each lines as line, i (i)}
                {#if i < lines.length - 1}
                  <p class="line">{@render text(line)}</p>
                {:else if line || followed.pending}
                  <!-- The over in progress goes on from the last line; its last word is still being read. -->
                  {@const cut = followed.pending.lastIndexOf(' ') + 1}
                  <p class="line">{@render text(line)}{@render text(followed.pending.slice(0, cut))}<span class="pending">{@render text(followed.pending.slice(cut))}</span></p>
                {/if}
              {/each}
            {/if}
          </div>
          {#if !stick}
            <button type="button" class="newest" onclick={toNewest}>Show newest</button>
          {/if}
        </div>

        <!-- A compact row under the text it acts on. -->
        <div class="tools">
          <Button kind="quiet" onclick={copy} disabled={!hasAny}>Copy text</Button>
          <Button kind="quiet" onclick={save} disabled={total === 0}>Save</Button>
          <Button kind="quiet" onclick={clear} disabled={total === 0}>Clear</Button>
          {#if devices.length > 1 && listening && !changing}
            <Button kind="quiet" onclick={() => (changing = true)}>Change device</Button>
          {/if}
        </div>
        {#if devices.length > 1 && (!listening || changing)}{@render chooser()}{/if}
      </div>

      <section class="side" aria-labelledby="others-heading">
        <h2 id="others-heading">Other signals</h2>
        <p class="small muted">
          {chosen === null ? 'BeepBeep follows the signal that is sending. Choose another to follow it instead.' : 'BeepBeep follows the signal you chose.'}
          Quiet means not heard for 30 seconds.
        </p>
        {#if chosen !== null}<div class="back-auto"><Button kind="quiet" onclick={() => (chosen = null)}>Follow automatically</Button></div>{/if}
        {#if others.length}
          <ul class="list" role="list">
            {#each others as s (s.id)}
              <li>
                <button
                  type="button"
                  class="row"
                  class:quiet={quiet(s)}
                  data-signal={s.id}
                  tabindex={s.id === tabStop ? 0 : -1}
                  onclick={() => follow(s.id)}
                  onfocus={() => (focusId = s.id)}
                  onkeydown={onListKey}
                >
                  <span class="row-top">
                    <span class="led" class:on={s.keying} aria-hidden="true"></span>
                    <span
                      ><span class="visually-hidden">Follow the signal at </span>{@render facts([`${Math.round(s.pitch)} Hz`, speed(s), quiet(s) ? 'quiet' : ''])}<span
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
    </div>
  {/if}

  <!-- New text of the followed signal, read out by screen readers. -->
  <p class="visually-hidden" aria-live="polite">{spoken}</p>
</section>

<!-- The device the microphone listens on. While listening it shows after Change device. -->
{#snippet chooser()}
  <div class="device">
    <Select label="Device" options={[{ value: '', label: 'Default' }, ...devices]} value={settings.micDeviceId} onchange={changeDevice} />
    {#if listening}<Button kind="quiet" onclick={() => (changing = false)}>Cancel</Button>{/if}
  </div>
{/snippet}

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

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
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

  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: var(--reading);
  }

  .small {
    font-size: var(--size-s);
  }

  .device {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-1);
    max-width: 420px;
  }

  .device :global(.select) {
    flex: 1 1 200px;
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
    align-items: center;
    gap: var(--s-1);
    min-height: var(--s-3);
  }

  .facts {
    font-variant-numeric: tabular-nums;
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

  /*
   * As tall as the window allows. Under it on a wide screen are the buttons; in one column,
   * Other signals too, whose first row stays in view; on a phone, also the tab bar and the home bar.
   */
  .box {
    height: max(240px, calc(100dvh - 300px));
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

  .none {
    font-family: var(--font-ui);
    font-size: var(--size-m);
    line-height: var(--leading);
    letter-spacing: 0;
    color: var(--muted);
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

  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--s-1);
    margin-left: calc(-1 * var(--s-1));
  }

  .tools :global(.btn) {
    min-height: var(--target-min);
  }

  .back-auto {
    margin-left: calc(-1 * var(--s-1));
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

  .row-top {
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

  /* One column: Other signals go under the text, and their first row stays in view. */
  @media (max-width: 860px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--s-2);
    }

    .side {
      border-left: 0;
      padding-left: 0;
    }

    .box {
      height: max(240px, calc(100dvh - 470px));
    }
  }

  /*
   * Phones held upright: smaller reading text, so a line holds a callsign and a word or two. The
   * box leaves room for the header, the line above it, the buttons under it, the first of Other
   * signals and the tab bar with the notch and the home bar: six lines on a 390 x 844 phone.
   */
  @media (max-width: 760px) and (min-height: 501px) {
    .box {
      height: max(160px, calc(100dvh - var(--safe-top) - var(--tabbar) - 445px));
      padding: var(--s-1) var(--s-2);
      font-size: var(--size-big);
    }
  }

  /* A phone on its side: little height, so the box takes what there is. */
  @media (orientation: landscape) and (max-height: 500px) {
    .box {
      height: max(120px, calc(100dvh - 190px));
      padding: var(--s-1) var(--s-2);
      font-size: var(--size-big);
    }
  }
</style>
