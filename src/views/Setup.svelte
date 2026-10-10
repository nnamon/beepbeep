<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import TokenText from '../ui/TokenText.svelte';
  import { engine } from '../lib/audio/engine';
  import { LiveDecoder, type InputSource } from '../lib/audio/live';
  import { settings } from '../lib/state/settings.svelte';
  import { signal, startMic, stopMic } from '../lib/state/signal.svelte';
  import { textTokens } from '../lib/util/text';
  import { straightOnly } from '../lib/train/session';

  let devices = $state<MediaDeviceInfo[]>([]);
  let spec = $state<{ hz: number[]; db: number[] }>({ hz: [], db: [] });
  let cal = $state<'idle' | 'listening' | 'done'>('idle');
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

  async function calibrate() {
    if (settings.input === 'mic' && !signal.micOn) await micOn();
    calText = '';
    calNote = '';
    cal = 'listening';
    calLive?.stop();
    calLive = new LiveDecoder({
      source: settings.input,
      charWpm: settings.sendWpm,
      pitch: settings.pitch,
      onOutput: () => (calText = calLive?.text ?? ''),
    });
    await calLive.start();
    setTimeout(finishCal, 9000);
  }

  function finishCal() {
    if (!calLive || cal !== 'listening') return;
    calLive.flush();
    calLive.stop();
    calText = calLive.text;
    const vs = (calText.match(/V/g) ?? []).length;
    const marks = calLive.marks.length;
    const wpm = calLive.decoder.wpm;
    if (!marks) calNote = 'Nothing heard. Check the level meter and move the mic closer.';
    else if (vs >= 2 && marks <= vs * 4 + 2) {
      settings.sendWpm = Math.round(wpm);
      calNote = `Clean. ${Math.round(wpm)} wpm${signal.pitch ? ` at ${Math.round(signal.pitch)} Hz` : ''}, saved as your sending speed.`;
    } else if (marks > (vs || 3) * 4 + 2) {
      calNote = 'The tone is breaking up. Lower the sidetone volume, move the mic, or use a wired mic.';
    } else calNote = `Heard ${calText || 'nothing clear'}. Send V V V with clear gaps and try again.`;
    cal = 'done';
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

  function clickSpectrum(e: MouseEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const hz = lo + ((e.clientX - r.left) / r.width) * (hi - lo);
    if (hz >= 300 && hz <= 1200) pin(Math.round(hz));
  }

  function keySpectrum(e: KeyboardEvent) {
    const cur = Math.round(settings.pinnedHz ?? signal.pitch ?? 650);
    const step = e.shiftKey ? 50 : 10;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') pin(Math.min(1200, cur + step));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') pin(Math.max(300, cur - step));
    else if (e.key === 'Escape') pin(null);
    else return;
    e.preventDefault();
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
          <p class="warn">The browser kept voice processing on. Tones may break up; calibration below will show it.</p>
        {/if}
        {#if signal.info.bluetooth}
          <p class="warn">Bluetooth input: audio drops to call quality. Use wired earphones or the built-in mic.</p>
        {/if}
      {/if}
    </div>

    {#if signal.micOn}
      <div class="block">
        <div class="row between">
          <h2>Spectrum</h2>
          <span class="muted">
            {#if settings.pinnedHz}Pinned at <span class="num">{settings.pinnedHz} Hz</span>
              <Button kind="quiet" onclick={() => pin(null)}>Unpin</Button>
            {:else if signal.pitch}Locked at <span class="num">{Math.round(signal.pitch)} Hz</span>{:else}Searching 300–1200 Hz{/if}
          </span>
        </div>
        <div class="spec-wrap" bind:clientWidth={specWidth}>
        <svg
          class="spec"
          viewBox="0 0 {W} {H}"
          width={W}
          height={H}
          role="slider"
          tabindex="0"
          aria-label="Input spectrum. Click, or use arrow keys, to pin the tone."
          aria-valuemin={300}
          aria-valuemax={1200}
          aria-valuenow={Math.round(settings.pinnedHz ?? signal.pitch ?? 650)}
          aria-valuetext="{Math.round(settings.pinnedHz ?? signal.pitch ?? 650)} Hz"
          onclick={clickSpectrum}
          onkeydown={keySpectrum}
        >
          <rect x={xOf(300)} y="0" width={xOf(1200) - xOf(300)} height={H} class="band" />
          {#if path}<path d={path} class="line" />{/if}
          {#if signal.pitch}<line x1={xOf(signal.pitch)} x2={xOf(signal.pitch)} y1="0" y2={H} class="lock" />{/if}
          {#each [400, 600, 800, 1000, 1200] as t (t)}<text x={xOf(t)} y={H - 4} class="tick" text-anchor="middle">{t}</text>{/each}
        </svg>
        </div>
        <p class="muted small">Click the spectrum to pin a tone. Level {Math.round(signal.level)} dBFS, signal {Math.round(signal.snr)} dB over noise.</p>
      </div>
    {/if}
  {/if}

  <div class="block">
    <h2>Calibrate</h2>
    <p class="muted">Send <span class="mono">V V V</span>. Sets your sending speed and checks the tone.</p>
    {#if cal === 'listening'}
      <p class="muted">Listening for 9 s</p>
    {/if}
    {#if calText}<TokenText tokens={textTokens(calText).map((t) => ({ t }))} size="l" />{/if}
    {#if calNote}<p>{calNote}</p>{/if}
    <div><Button kind={cal === 'idle' ? 'primary' : 'secondary'} onclick={calibrate} disabled={cal === 'listening'}>Calibrate</Button></div>
  </div>

  <div class="block notes">
    <h2>Notes</h2>
    <ul>
      <li>Put the mic within a metre of the radio or oscillator speaker. Use headphones for the app's own audio.</li>
      <li>Audio stays on this device. Nothing is recorded or uploaded.</li>
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

  .spec {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 120px;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    cursor: crosshair;
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
