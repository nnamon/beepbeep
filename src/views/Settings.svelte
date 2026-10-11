<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Slider from '../ui/Slider.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import VoiceRecorder from '../ui/VoiceRecorder.svelte';
  import { effectiveMix, settings, resetSettings } from '../lib/state/settings.svelte';
  import { areaOf } from '../lib/train/world';
  import { href } from '../lib/state/router.svelte';
  import { engine } from '../lib/audio/engine';
  import { voices } from '../lib/audio/speech';
  import { clearAll, exportAll, importAll } from '../lib/state/db';
  import type { TrackId } from '../lib/train/courses';

  let voiceList = $state<SpeechSynthesisVoice[]>([]);
  let showRecorder = $state(false);
  let dataNote = $state('');

  onMount(() => {
    voiceList = voices();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => (voiceList = voices());
  });

  async function exportData() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify({ ...data, settings: $state.snapshot(settings) }, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beepbeep-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    dataNote = 'Exported.';
  }

  async function importData(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await importAll(data);
      if (data.settings) Object.assign(settings, data.settings);
      dataNote = `Imported ${data.sessions?.length ?? 0} sessions and ${data.qsos?.length ?? 0} QSOs.`;
    } catch (err) {
      dataNote = (err as Error).message;
    }
  }

  async function clearProgress() {
    if (!confirm('Delete all progress, QSO log and recorded voice clips on this device?')) return;
    await clearAll();
    dataNote = 'Progress deleted.';
  }

  // Desktop Chrome has navigator.vibrate but no motor; offer it on touch devices only.
  const MIX_NAME = { asia: 'Asia-Pacific', europe: 'Europe', americas: 'the Americas', world: 'everywhere' } as const;
  const mixNote = $derived(
    settings.stationMix === 'auto'
      ? `Auto: mostly ${MIX_NAME[effectiveMix()]}${areaOf(settings.you) ? ', from your callsign or region' : '; set your callsign to focus it'}.`
      : `Mostly ${MIX_NAME[settings.stationMix]}, some from elsewhere.`,
  );
  const canVibrate =
    typeof navigator !== 'undefined' && 'vibrate' in navigator && window.matchMedia('(pointer: coarse)').matches;
  const tone = () => void engine.playText('VVV', { charWpm: 20, pitch: settings.pitch });
</script>

<section class="settings">
  <h1>Settings</h1>

  <div class="group">
    <h2>Appearance</h2>
    <Segmented
      label="Theme"
      bind:value={settings.theme}
      options={[
        { value: 'system', label: 'System' },
        { value: 'dark', label: 'Shack (dark)' },
        { value: 'light', label: 'Light' },
        { value: 'paper', label: 'Paper' },
      ]}
    />
    <p class="muted small">System uses Shack when the device is dark and Light when it is light. Paper is cream, for daylight.</p>
  </div>

  <div class="group">
    <h2>Your station</h2>
    <div class="station">
      <label><span class="label">Callsign</span><input id="you-call" class="mono" bind:value={settings.you.call} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="K1ABC" /></label>
      <label><span class="label">Name</span><input id="you-name" class="mono" bind:value={settings.you.name} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="TOM" /></label>
      <label><span class="label">QTH</span><input id="you-qth" class="mono" bind:value={settings.you.qth} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="BOSTON" /></label>
      <label><span class="label">State, province or country</span><input id="you-region" class="mono" bind:value={settings.you.state} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="MA, ON, JAPAN" /></label>
      <label><span class="label">SKCC number</span><input id="you-skcc" class="mono" bind:value={settings.you.skcc} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Optional" /></label>
    </div>
    <p class="muted small">Used in QSOs and in the send drill's My station material. Send your region as you would on the air.</p>
    <div class="field">
      <span class="label">Stations you hear</span>
      <Segmented
        label="Stations you hear"
        bind:value={settings.stationMix}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'asia', label: 'Asia-Pacific' },
          { value: 'europe', label: 'Europe' },
          { value: 'americas', label: 'Americas' },
          { value: 'world', label: 'Worldwide' },
        ]}
      />
    </div>
    <p class="muted small">QSO stations and practice callsigns. {mixNote}</p>
  </div>

  <div class="group">
    <h2>Course</h2>
    <Segmented
      label="Course"
      bind:value={settings.track}
      onchange={(v: TrackId) => (settings.track = v)}
      options={[
        { value: 'koch', label: 'Classic Koch order' },
        { value: 'licw', label: 'LICW Beginners Carousel' },
      ]}
    />
    <Toggle
      bind:checked={settings.licwStrict}
      onchange={() => (settings.licwAsked = true)}
      label="LICW strict mode"
      detail="LICW track only. Hides rhythm bars and the character reference; answers show at the end of a drill."
    />
    <Toggle
      bind:checked={settings.useCourseSpeeds}
      label="Use lesson speeds"
      detail="LICW track: 12/8 in BC1, 12/10 in BC2."
    />
    <p class="muted small">
      Classic Koch order: K M R S U A P T L O W I . N J E F 0 Y , V G 5 / Q 9 Z H 3 8 B ? 4 2 7 C 1 D 6 X, the sequence
      most Koch trainers use. LICW's Method Guide traces it to Otto Lipmann (1919).
    </p>
  </div>

  <div class="group">
    <h2>Speed</h2>
    <div class="two">
      <Slider label="Receive, character" bind:value={settings.charWpm} min={5} max={45} unit="wpm" />
      <Slider label="Receive, effective" bind:value={settings.effectiveWpm} min={3} max={settings.charWpm} unit="wpm" />
      <Slider label="Your sending" bind:value={settings.sendWpm} min={5} max={45} unit="wpm" />
      <Slider label="Session" bind:value={settings.sessionMinutes} min={5} max={45} step={5} unit="min" />
      <Slider label="Comfort" bind:value={settings.comfortWpm} min={5} max={45} unit="wpm" />
      <Slider label="Stretch" bind:value={settings.stretchWpm} min={5} max={50} unit="wpm" />
    </div>
    {#if settings.effectiveWpm < settings.charWpm}
      <p class="muted small">Farnsworth spacing is on. LICW treats extra spacing as temporary; raise effective speed toward character speed over time.</p>
    {/if}
    <Toggle
      bind:checked={settings.autoTaper}
      label="Raise effective speed automatically"
      detail="+1 wpm after a receive drill at 85% or better, up to character speed. Always on in LICW strict mode."
    />
  </div>

  <div class="group">
    <h2>Sound</h2>
    <div class="two">
      <Slider label="Pitch" bind:value={settings.pitch} min={400} max={1000} step={10} unit="Hz" />
      <Slider label="Volume" bind:value={settings.volume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => engine.setVolume(v)} />
    </div>
    <div><Button onclick={tone}>Play a test tone</Button></div>
    <div class="field">
      <span class="label">Spoken answers</span>
      <Segmented
        label="Spoken answers"
        bind:value={settings.voice}
        options={[
          { value: 'builtin', label: 'Built-in' },
          { value: 'system', label: 'Device voice' },
          { value: 'recorded', label: 'My recordings' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </div>
    {#if settings.voice === 'builtin'}
      <p class="muted small">Characters and prosigns use built-in clips. Words use the device voice.</p>
    {:else if settings.voice === 'recorded'}
      <p class="muted small">Characters you have not recorded use the built-in clips.</p>
    {/if}
    {#if settings.voice === 'system' && voiceList.length}
      <label class="select">
        <span class="label">Voice</span>
        <select bind:value={settings.voiceURI}>
          <option value="">Default</option>
          {#each voiceList as v (v.voiceURI)}<option value={v.voiceURI}>{v.name}</option>{/each}
        </select>
      </label>
    {/if}
    {#if settings.voice === 'recorded'}
      <Button onclick={() => (showRecorder = !showRecorder)}>{showRecorder ? 'Hide recorder' : 'Record clips'}</Button>
      {#if showRecorder}<VoiceRecorder />{/if}
    {/if}
    {#if canVibrate}
      <Toggle bind:checked={settings.vibrate} label="Vibrate" detail="The phone vibrates the rhythm while the app sends." />
    {/if}
    <Toggle
      bind:checked={settings.visualCue}
      label="Visual cue"
      detail="A light pulses with the app's tone. For noisy rooms or hard-of-hearing operators. Off in LICW strict mode."
    />
  </div>

  <div class="group">
    <h2>Band conditions</h2>
    <p class="muted small">Applied to receive drills and QSOs.</p>
    <Segmented label="Noise" bind:value={settings.noise} options={[{ value: 0, label: 'No noise' }, { value: 1, label: 'Light' }, { value: 2, label: 'Moderate' }, { value: 3, label: 'Heavy' }]} />
    <div class="two">
      <Slider label="Fading (QSB)" bind:value={settings.qsb} min={0} max={3} format={(v) => ['Off', 'Light', 'Moderate', 'Deep'][v]} />
      <Slider label="Interference (QRM)" bind:value={settings.qrm} min={0} max={2} format={(v) => ['Off', 'Weak', 'Strong'][v]} />
      <Slider label="Static (QRN)" bind:value={settings.qrn} min={0} max={3} format={(v) => ['Off', 'Light', 'Moderate', 'Heavy'][v]} />
    </div>
    <Toggle bind:checked={settings.humanFist} label="Human fists" detail="Generated code has timing variation like hand sending." />
    <Toggle bind:checked={settings.chirp} label="Chirp and drift" detail="Pitch shifts at the start of each element and wanders slowly." />
  </div>

  <div class="group">
    <h2>Input</h2>
    <div class="field">
      <span class="label">Key with</span>
      <Segmented
        label="Key with"
        bind:value={settings.input}
        options={[
          { value: 'mic', label: 'Microphone' },
          { value: 'touch', label: 'Touch key' },
          { value: 'straight', label: 'Keyboard straight key' },
          { value: 'iambicA', label: 'Paddles A' },
          { value: 'iambicB', label: 'Paddles B' },
        ]}
      />
    </div>
    <p class="muted small">Touch key: a pad at the bottom of the screen while a drill or QSO listens. <a href={href('setup')}>Setup</a> has the mic, calibration and spectrum.</p>
    <Toggle
      bind:checked={settings.headphones}
      label="Headphones"
      detail="App audio goes to headphones. The mic stays open while the app sends, so keying stops a QSO station (break-in). Leave off when the app plays through a speaker."
    />
    <Slider label="End your over after" bind:value={settings.overTimeout} min={1.5} max={6} step={0.5} unit="s of silence" />
    <div class="field">
      <span class="label">Timing notes</span>
      <Segmented
        label="Timing notes"
        bind:value={settings.sendTolerance}
        options={[
          { value: 'tight', label: 'Tight' },
          { value: 'normal', label: 'Normal' },
          { value: 'loose', label: 'Loose' },
        ]}
      />
    </div>
    <p class="muted small">How far your dah ratio and gaps can drift from standard before a note appears.</p>
    <Toggle
      bind:checked={settings.keepSends}
      label="Keep recent sends"
      detail="Stores key timing of your last 8 sends for replay in Progress. Timing only, no audio."
    />
  </div>

  <div class="group">
    <h2>Data</h2>
    <p class="muted small">Progress is stored in this browser only. Export it to move between devices.</p>
    <div class="row">
      <Button onclick={exportData}>Export</Button>
      <label class="file">
        <span>Import</span>
        <input type="file" accept="application/json,.json" onchange={importData} />
      </label>
      <Button kind="quiet" onclick={resetSettings}>Reset settings</Button>
      <Button kind="quiet" onclick={clearProgress}>Delete progress</Button>
    </div>
    {#if dataNote}<p class="small">{dataNote}</p>{/if}
  </div>

  <p class="muted small">BeepBeep {__APP_VERSION__} ({__APP_BUILD__}). LICW is a trademark of the Long Island CW Club; BeepBeep is not affiliated with it.</p>
</section>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 760px;
  }

  .station {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--s-2);
  }

  .station label {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    min-width: 0;
  }

  .station input {
    min-height: var(--target);
    padding: 0 var(--s-1);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--size-m);
    text-transform: uppercase;
    width: 100%;
  }

  .station input::placeholder {
    text-transform: none;
    color: var(--muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-top: var(--s-2);
    border-top: var(--hairline) solid var(--line);
  }

  .two {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--s-2) var(--s-4);
  }

  .row {
    display: flex;
    gap: var(--s-1);
    flex-wrap: wrap;
    align-items: center;
  }

  .small {
    font-size: var(--size-s);
  }

  .select {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 320px;
  }

  select {
    min-height: var(--target);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 0 var(--s-1);
  }

  .file {
    display: inline-flex;
    align-items: center;
    min-height: var(--target);
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    cursor: pointer;
    position: relative;
  }

  .file input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .file:focus-within {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
  }
</style>
