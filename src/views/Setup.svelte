<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import TokenText from '../ui/TokenText.svelte';
  import SampleRecorder from '../ui/SampleRecorder.svelte';
  import Icon from '../ui/Icon.svelte';
  import { engine } from '../lib/audio/engine';
  import { LiveDecoder, type InputSource } from '../lib/audio/live';
  import { settings } from '../lib/state/settings.svelte';
  import { signal, touchKeyArea, startMic, stopMic } from '../lib/state/signal.svelte';
  import { textTokens } from '../lib/util/text';
  import { sendInput, straightOnly } from '../lib/train/session';
  import { outputsToText } from '../lib/decoder/pipeline';

  // The touch key pad stays in place while this screen is open.
  $effect(() => touchKeyArea());

  let devices = $state<MediaDeviceInfo[]>([]);
  let spec = $state<{ hz: number[]; db: number[] }>({ hz: [], db: [] });
  let cal = $state<'idle' | 'listening' | 'settling' | 'done'>('idle');
  let calText = $state('');
  let calNote = $state('');
  let poll: ReturnType<typeof setInterval> | null = null;
  let calLive: LiveDecoder | null = null;

  onMount(() => {
    void refreshDevices();
    poll = setInterval(async () => {
      if (signal.micOn) spec = await engine.spectrum();
    }, 250);
  });

  onDestroy(() => {
    if (poll) clearInterval(poll);
    calLive?.stop();
    calUnsub?.();
    stopCalTimer();
  });

  async function refreshDevices() {
    devices = await engine.inputDevices().catch(() => []);
  }

  async function micOn() {
    await startMic();
    await refreshDevices();
  }

  async function changeDevice(id: string) {
    settings.micDeviceId = id;
    if (signal.micOn) await startMic();
  }

  function pin(hz: number | null) {
    settings.pinnedHz = hz;
    engine.command({ type: 'pin', hz });
  }

  /** Levels heard while calibrating: the tone over the room (while keyed) and the room. */
  let calLevels: { rise: number[]; floor: number[] } = { rise: [], floor: [] };
  let calUnsub: (() => void) | null = null;
  let calPin = $state<number | null>(null);
  let calLevelNote = $state('');
  const CAL_SECONDS = 9;
  let calLeft = $state(CAL_SECONDS);
  let calTimer: ReturnType<typeof setInterval> | null = null;
  /** Each start, or start over, of a calibration; an older one still starting gives way. */
  let calRun = 0;

  function stopCalTimer() {
    if (calTimer) clearInterval(calTimer);
    calTimer = null;
  }

  async function calibrate() {
    const run = ++calRun;
    stopCalTimer();
    if (settings.input === 'mic' && !signal.micOn) await micOn();
    if (run !== calRun) return;
    calReq++;
    calText = '';
    calNote = '';
    calLevelNote = '';
    calPin = null;
    calLeft = CAL_SECONDS;
    cal = 'listening';
    if (settings.input === 'mic') {
      // Measure from scratch: an old squelch must not hide a quieter tone.
      engine.command({ type: 'squelch', db: null });
      calLevels = { rise: [], floor: [] };
      calUnsub?.();
      calUnsub = engine.onEvents((events) => {
        for (const e of events) {
          if (e.type !== 'status') continue;
          if (e.keyDown) calLevels.rise.push(e.snr);
          else calLevels.floor.push(e.floor);
        }
      });
    }
    calLive?.stop();
    const live = (calLive = new LiveDecoder({
      source: sendInput(),
      charWpm: settings.sendWpm,
      pitch: settings.pitch,
      onOutput: () => {
        const n = ++calReq;
        void calLive?.settled().then((o) => {
          if (n === calReq && cal === 'listening') calText = outputsToText(o);
        });
      },
    }));
    await live.start();
    if (run !== calRun) {
      // Started over while this one was starting: it was stopped before it attached.
      live.stop();
      return;
    }
    calTimer = setInterval(() => {
      if (--calLeft <= 0) void finishCal();
    }, 1000);
  }

  let calReq = 0;

  async function finishCal() {
    if (!calLive || cal !== 'listening') return;
    stopCalTimer();
    cal = 'settling';
    calLive.flush();
    // The second pass: decoded again with the whole calibration's timing.
    await calLive.settle();
    calLive.stop();
    calUnsub?.();
    calUnsub = null;
    calText = calLive.text;
    const mic = settings.input === 'mic';
    const vs = (calText.match(/V/g) ?? []).length;
    const marks = calLive.marks.length;
    const model = calLive.decoder.model();
    const wpm = calLive.decoder.wpm;
    // Inside a letter the gap is one dit by the book; hand keying often runs longer.
    const inner = model.gapModel ? model.elemGap / model.dit : null;
    if (!marks) {
      calNote = mic ? 'Nothing heard. Check the level meter and move the mic closer.' : 'Nothing keyed. Hold the key for each element.';
    } else if (vs >= 2 && (!mic || marks <= vs * 4 + 2)) {
      settings.sendWpm = Math.round(wpm);
      const where = mic && signal.pitch ? ` at ${Math.round(signal.pitch)} Hz` : '';
      const gaps = inner !== null && inner >= 1.8 ? ` The gaps inside your letters are ${inner.toFixed(1)} dits long; the standard is 1.` : '';
      calNote = `Heard ${vs} V's at ${Math.round(wpm)} wpm${where}. Saved as your sending speed.${gaps}`;
    } else if (mic && marks > (vs || 3) * 4 + 2) {
      calNote = 'Tone breaking up. Lower the sidetone volume, move the mic or use a wired mic.';
    } else {
      calNote = `Heard ${calText || 'nothing clear'}. V is di-di-di-dah. Gaps inside a V should be shorter than gaps between V's.`;
    }
    if (mic) checkLevels(vs >= 2 && marks <= vs * 4 + 2);
    cal = 'done';
  }

  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

  /**
   * How far the tone stood above the room while keyed. A good calibration sets
   * the squelch at half that rise (9 to 20 dB): room sounds quieter than that
   * never key. The locked tone is offered for pinning.
   */
  function checkLevels(good: boolean) {
    if (calLevels.rise.length < 3) {
      engine.command({ type: 'squelch', db: settings.squelchDb });
      return;
    }
    const rise = Math.round(median(calLevels.rise));
    const room = calLevels.floor.length ? Math.round(median(calLevels.floor)) : null;
    const where = room === null ? '' : ` (room ${room} dBFS, tone ${room + rise} dBFS)`;
    if (good) {
      settings.squelchDb = Math.max(9, Math.min(20, Math.round(rise / 2)));
      calLevelNote = `Tone ${rise} dB over the room${where}. Squelch set to ${settings.squelchDb} dB, so quieter sounds are ignored.`;
    } else {
      calLevelNote = `Tone ${rise} dB over the room${where}. Squelch left at ${settings.squelchDb ? `${settings.squelchDb} dB` : 'the default'}.`;
    }
    if (rise < 15) calLevelNote += ' Weak. Turn the sidetone up or move the mic closer.';
    engine.command({ type: 'squelch', db: settings.squelchDb });
    if (good && signal.pitch && (!settings.pinnedHz || Math.abs(settings.pinnedHz - signal.pitch) > 10)) calPin = Math.round(signal.pitch);
  }

  function clearSquelch() {
    settings.squelchDb = null;
    engine.command({ type: 'squelch', db: null });
  }

  // Drawn at the container's pixel width so the axis text stays 13 px.
  let specWidth = $state(0);
  const W = $derived(Math.max(240, specWidth || 600));
  const H = 120;
  const path = $derived.by(() => {
    if (!spec.hz.length) return '';
    const lo = spec.hz[0];
    const hi = spec.hz[spec.hz.length - 1];
    const max = Math.max(...spec.db);
    const min = max - 60;
    return spec.hz
      .map((hz, i) => {
        const x = ((hz - lo) / (hi - lo)) * W;
        const y = H - Math.max(0, Math.min(1, (spec.db[i] - min) / 60)) * H;
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join('');
  });
  const lo = $derived(spec.hz[0] ?? 200);
  const hi = $derived(spec.hz[spec.hz.length - 1] ?? 1500);
  const xOf = (hz: number) => ((hz - lo) / (hi - lo)) * W;

  /** Moves the pinned pitch, within the band the detector searches. */
  function setPitch(hz: number) {
    if (Number.isFinite(hz)) pin(Math.max(300, Math.min(1200, Math.round(hz))));
  }

  const ON = (v: boolean | null) => (v === null ? 'not reported' : v ? 'on' : 'off');
</script>

<section class="setup">
  <h1>Input setup</h1>

  <div class="row">
    <Segmented
      label="Input"
      bind:value={settings.input}
      options={[
        { value: 'mic' as InputSource, label: 'Microphone' },
        { value: 'touch' as InputSource, label: 'Touch key' },
        { value: 'straight' as InputSource, label: 'Keyboard straight key' },
        ...(straightOnly()
          ? []
          : [
              { value: 'iambicA' as InputSource, label: 'Paddles A' },
              { value: 'iambicB' as InputSource, label: 'Paddles B' },
            ]),
      ]}
    />
  </div>
  {#if straightOnly()}
    <p class="muted">LICW strict mode, BC lessons: straight key only. Turn strict mode off in Settings to use paddles.</p>
  {/if}

  {#if settings.input === 'mic'}
    <div class="block">
      <div class="row">
        {#if signal.micOn}
          <Button onclick={stopMic}>Stop mic</Button>
        {:else}
          <Button kind="primary" onclick={micOn} disabled={signal.starting || !engine.micSupported}>Start mic</Button>
        {/if}
        {#if devices.length > 1}
          <label class="select">
            <span class="label">Device</span>
            <select value={settings.micDeviceId} onchange={(e) => changeDevice((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">Default</option>
              {#each devices as d (d.deviceId)}<option value={d.deviceId}>{d.label || 'Microphone'}</option>{/each}
            </select>
          </label>
        {/if}
      </div>
      {#if !engine.micSupported}
        <p class="warn">The microphone needs a secure (https) page. Open BeepBeep from its https address.</p>
      {/if}
      {#if signal.error}<p class="warn">{signal.error}</p>{/if}
      {#if signal.info}
        <dl class="facts">
          <div><dt class="label">Device</dt><dd>{signal.info.label}</dd></div>
          <div><dt class="label">Echo cancellation</dt><dd>{ON(signal.info.echoCancellation)}</dd></div>
          <div><dt class="label">Noise suppression</dt><dd>{ON(signal.info.noiseSuppression)}</dd></div>
          <div><dt class="label">Auto gain</dt><dd>{ON(signal.info.autoGainControl)}</dd></div>
          <div><dt class="label">Sample rate</dt><dd class="num">{signal.info.sampleRate} Hz</dd></div>
        </dl>
        {#if signal.info.echoCancellation || signal.info.noiseSuppression || signal.info.autoGainControl}
          <p class="warn">The browser kept voice processing on. Tones may break up.</p>
        {/if}
        {#if signal.info.bluetooth}
          <p class="warn">Bluetooth input: audio drops to call quality. Use wired earphones or the built-in mic.</p>
        {/if}
      {/if}
    </div>

    {#if signal.micOn}
      <div class="block">
        <h2>Your tone</h2>
        <div class="tone">
          {#if settings.pinnedHz}
            <div class="stepper">
              <Button kind="secondary" label="5 Hz lower" onclick={() => setPitch((settings.pinnedHz ?? 600) - 5)}><Icon name="minus" size={18} /></Button>
              <label class="hz">
                <span class="sr">Pinned pitch</span>
                <input
                  class="num"
                  type="number"
                  inputmode="numeric"
                  min="300"
                  max="1200"
                  step="1"
                  value={settings.pinnedHz}
                  onchange={(e) => setPitch(Number((e.currentTarget as HTMLInputElement).value))}
                />
                <span class="muted">Hz</span>
              </label>
              <Button kind="secondary" label="5 Hz higher" onclick={() => setPitch((settings.pinnedHz ?? 600) + 5)}><Icon name="plus" size={18} /></Button>
            </div>
            <Button kind="quiet" onclick={() => pin(null)}>Unpin</Button>
          {:else}
            <span class="muted">{#if signal.pitch}Heard at <span class="num">{Math.round(signal.pitch)} Hz</span>{:else}Searching 300–1200 Hz{/if}</span>
            <Button kind={signal.pitch ? 'primary' : 'secondary'} onclick={() => setPitch(signal.pitch ?? 600)}>Pin {Math.round(signal.pitch ?? 600)} Hz</Button>
          {/if}
        </div>
        <p class="muted small">When a pitch is pinned, the decoder listens only at that pitch and ignores other sounds. Key a few V's and pin the pitch it hears, or enter your sidetone's pitch.</p>
        <div class="spec-wrap" bind:clientWidth={specWidth}>
        <svg class="spec" viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label="Input spectrum, 200 to 1500 Hz">
          <rect x={xOf(300)} y="0" width={xOf(1200) - xOf(300)} height={H} class="band" />
          {#if path}<path d={path} class="line" />{/if}
          {#if signal.pitch}<line x1={xOf(signal.pitch)} x2={xOf(signal.pitch)} y1="0" y2={H} class="lock" />{/if}
          {#each [400, 600, 800, 1000, 1200] as t (t)}<text x={xOf(t)} y={H - 4} class="tick" text-anchor="middle">{t}</text>{/each}
        </svg>
        </div>
        <div class="row between">
          <p class="muted small">
            Level {Math.round(signal.level)} dBFS, signal {Math.round(signal.snr)} dB over noise.{#if settings.squelchDb}
              Squelch {settings.squelchDb} dB, from calibration.{/if}
          </p>
          {#if settings.squelchDb}<Button kind="quiet" onclick={clearSquelch}>Clear squelch</Button>{/if}
        </div>
      </div>
    {/if}
    {#if __DEBUG__}<SampleRecorder />{/if}
  {/if}

  <div class="block">
    <h2>Calibrate</h2>
    <p class="muted">Send <span class="mono">V V V</span>. Sets your sending speed and checks the tone.</p>
    {#if cal === 'listening'}
      <p class="muted">Listening, {calLeft} s left</p>
    {/if}
    {#if calText}<TokenText tokens={textTokens(calText).map((t) => ({ t }))} size="l" />{/if}
    {#if calNote}<p>{calNote}</p>{/if}
    {#if calLevelNote}<p>{calLevelNote}</p>{/if}
    {#if calPin}
      <div class="row">
        <Button kind="primary" onclick={() => { pin(calPin); calPin = null; }}>Pin {calPin} Hz</Button>
        <span class="muted small">Listen only at this pitch from now on.</span>
      </div>
    {/if}
    <div class="row">
      {#if cal === 'listening'}
        <Button kind="primary" onclick={finishCal}>Done</Button>
        <Button kind="secondary" onclick={calibrate}>Start over</Button>
      {:else}
        <Button kind={cal === 'idle' ? 'primary' : 'secondary'} onclick={calibrate} disabled={cal === 'settling'}>Calibrate</Button>
      {/if}
    </div>
  </div>

  <div class="block notes">
    <h2>Notes</h2>
    <ul>
      <li>Put the mic within a metre of the radio or oscillator speaker. Use headphones for the app's own audio.</li>
      {#if __DEBUG__}
        <li>Debug server: samples you record are saved on the machine serving this page.</li>
      {:else}
        <li>Audio stays on this device. Nothing is recorded or uploaded.</li>
      {/if}
      <li>LICW classes are private: LICW counts automated transcription as recording. Don't run the decoder during a class.</li>
      <li>On iPhone, keep BeepBeep in the foreground while it listens.</li>
    </ul>
  </div>
</section>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 760px;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .row {
    display: flex;
    gap: var(--s-2);
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .between {
    justify-content: space-between;
    align-items: baseline;
  }

  .select {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  select {
    min-height: var(--target);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 0 var(--s-1);
    max-width: 320px;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-4);
    margin: var(--s-1) 0 0;
  }

  .facts div {
    display: flex;
    flex-direction: column;
  }

  .facts dd {
    margin: 0;
  }

  .warn {
    border-left: 2px solid var(--signal);
    padding-left: var(--s-1);
  }

  .tone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }

  .stepper :global(.btn) {
    padding: 0 var(--s-1);
  }

  .hz {
    display: flex;
    align-items: baseline;
    gap: var(--s-half);
  }

  .hz input {
    width: 6ch;
    text-align: center;
    font-size: var(--size-l);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .spec {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 120px;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
  }

  .band {
    fill: var(--surface);
  }

  .line {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.25;
  }

  .lock {
    stroke: var(--signal);
    stroke-width: 2;
  }

  .tick {
    font-size: var(--size-s);
    fill: var(--muted);
    font-family: var(--font-mono);
  }

  .small {
    font-size: var(--size-s);
  }

  .notes ul {
    margin: 0;
    padding-left: 1.2em;
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    max-width: var(--reading);
  }
</style>
