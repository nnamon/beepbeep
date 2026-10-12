<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Slider from '../ui/Slider.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import VoiceRecorder from '../ui/VoiceRecorder.svelte';
  import { applySettings, effectiveMix, settings, resetSettings } from '../lib/state/settings.svelte';
  import { areaOf } from '../lib/train/world';
  import { href } from '../lib/state/router.svelte';
  import { engine } from '../lib/audio/engine';
  import { voices } from '../lib/audio/speech';
  import { clearAll, exportAll, importAll, readExport } from '../lib/state/db';
  import type { TrackId } from '../lib/train/courses';
  import { courseSpeedsInUse } from '../lib/train/session';
  import { reloadFresh } from '../lib/state/update';

  let voiceList = $state<SpeechSynthesisVoice[]>([]);
  let showRecorder = $state(false);
  let dataNote = $state('');

  onMount(() => {
    voiceList = voices();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => (voiceList = voices());
  });

  async function exportData() {
    let data;
    try {
      data = await exportAll();
    } catch {
      dataNote = "Nothing was exported: the browser's storage isn't available.";
      return;
    }
    const blob = new Blob([JSON.stringify({ ...data, settings: $state.snapshot(settings) }, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = `beepbeep-${new Date().toISOString().slice(0, 10)}.json`;
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    dataNote = `Saved ${name} to your downloads.`;
  }

  async function importData(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      dataNote = 'That file is not a BeepBeep export. Nothing was changed.';
      return;
    }
    try {
      const v = readExport(data);
      const what = `${v.sessions.length} ${v.sessions.length === 1 ? 'session' : 'sessions'} and ${v.qsos.length} ${v.qsos.length === 1 ? 'QSO' : 'QSOs'}`;
      if (!confirm(`Replace the progress on this device with the file's ${what}? What is here now will be gone.`)) {
        dataNote = 'Nothing was changed.';
        return;
      }
      await importAll(data);
      const s = (data as { settings?: unknown }).settings;
      if (s) applySettings(s);
      dataNote = `Imported ${what}.`;
    } catch (err) {
      // The file's own problems come with a plain message; anything else is the browser's storage.
      const msg = (err as Error).message ?? '';
      dataNote = msg.endsWith('Nothing was changed.') ? msg : "The import didn't happen: the browser's storage isn't available. Nothing was changed.";
    }
  }

  async function clearProgress() {
    if (
      !confirm(
        'Delete your progress on this device? This deletes your scores, sessions, QSO log, Learn QSOs results, recent sends and recorded voice clips. Your saved texts and Pocket custom set are kept.',
      )
    )
      return;
    try {
      await clearAll();
      dataNote = 'Your progress was deleted.';
    } catch {
      dataNote = "Nothing was deleted: the browser's storage isn't available.";
    }
  }

  let versionNote = $state('');
  async function freshReload() {
    versionNote = 'Loading the latest version.';
    if ((await reloadFresh()) === 'offline') versionNote = "You're offline. Connect to the internet first: without its saved copy the app couldn't load.";
  }

  function resetAll() {
    if (!confirm('Put every setting back to its default? Your progress, QSO log and texts are kept.')) return;
    resetSettings();
    dataNote = 'Every setting is back to its default.';
  }

  // Desktop Chrome has navigator.vibrate but no motor; offer it on touch devices only.
  const MIX_NAME = { asia: 'Asia-Pacific', europe: 'Europe', americas: 'the Americas', world: 'all over the world' } as const;
  const mixNote = $derived(
    settings.stationMix === 'auto'
      ? areaOf(settings.you)
        ? `Auto: most often from ${MIX_NAME[effectiveMix()]}, worked out from your callsign or region.`
        : 'Auto: stations from all over the world. Set your callsign to hear more from your area.'
      : settings.stationMix === 'world'
        ? 'Stations from all over the world.'
        : `Mostly from ${MIX_NAME[settings.stationMix]}, with some from elsewhere.`,
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
      <label><span class="label">Callsign</span><input id="you-call" class="mono" bind:value={settings.you.call} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="G4ABC" /></label>
      <label><span class="label">Name</span><input id="you-name" class="mono" bind:value={settings.you.name} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ANN" /></label>
      <label><span class="label">QTH</span><input id="you-qth" class="mono" bind:value={settings.you.qth} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="LEEDS" /></label>
      <label><span class="label">Region (optional)</span><input id="you-region" class="mono" bind:value={settings.you.state} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="TX, ON, JAPAN" /></label>
      <label><span class="label">SKCC member number (optional)</span><input id="you-skcc" class="mono" bind:value={settings.you.skcc} autocapitalize="characters" autocomplete="off" spellcheck="false" /></label>
    </div>
    <p class="muted small">
      These are used in QSOs and in the Send drill's My station practice. QTH is where you are, as you would send it. Your
      region is your state, province or country. It is sent after your QTH, and in SKCC, SST, POTA and SOTA exchanges.
      Leave it blank if it would repeat your QTH, as in Singapore. SKCC is the Straight Key Century Club.
    </p>
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
    <p class="muted small">This sets where QSO stations and practice callsigns come from. {mixNote}</p>
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
      detail="This works on the LICW track only. It shows no rhythm bars or character reference, shows your sending only when you finish, shows receive drill answers at the end, and keeps BC lessons to the straight key."
    />
    <Toggle
      bind:checked={settings.licwEnrolled}
      label="In an LICW class"
      detail="On the LICW track, this lets the carousel start at the lesson you joined at."
    />
    <Toggle
      bind:checked={settings.useCourseSpeeds}
      label="Use lesson speeds"
      detail="On the LICW track, receive drills use the lesson's speed instead of the speeds below: 12 wpm characters with 8 wpm overall in BC1 and 10 in BC2, then each stage's speed up to ADV. TTR+ and OverLearn use the speeds below."
    />
    <p class="muted small">
      Classic Koch order: K M R S U A P T L O W I . N J E F 0 Y , V G 5 / Q 9 Z H 3 8 B ? 4 2 7 C 1 D 6 X, then the
      prosigns BT AR SK KN BK. Most Koch trainers use this order; LICW's Method Guide traces it to Otto Lipmann (1919).
    </p>
  </div>

  <div class="group">
    <h2>Speed</h2>
    <div class="two">
      <Slider label="Receive: character speed" bind:value={settings.charWpm} min={5} max={45} unit="wpm" />
      <Slider label="Receive: overall speed" bind:value={settings.effectiveWpm} min={3} max={settings.charWpm} unit="wpm" />
      <Slider label="Your sending" bind:value={settings.sendWpm} min={5} max={45} unit="wpm" />
      <Slider label="Session length" bind:value={settings.sessionMinutes} min={5} max={45} step={5} unit="min" />
      <Slider label="Comfort speed" bind:value={settings.comfortWpm} min={5} max={45} unit="wpm" />
      <Slider label="Stretch speed" bind:value={settings.stretchWpm} min={5} max={50} unit="wpm" />
    </div>
    <p class="muted small">
      Character speed is how fast each character is sent; overall speed adds space between characters. Comfort and stretch
      are for the extra copy sessions on Practice: a speed you copy easily and one that pushes you.
    </p>
    {#if courseSpeedsInUse()}
      <p class="muted small">On the LICW track with Use lesson speeds on, receive drills use the lesson's speed, not the two receive speeds here.</p>
    {/if}
    <Toggle
      bind:checked={settings.autoTaper}
      label="Raise the overall speed automatically"
      detail="After a Copy drill, Sound surfing or Head copy session at 85% or better, the overall speed goes up 1 wpm, up to the character speed. LICW strict mode does this too. It doesn't apply while lesson speeds are in use."
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
      detail="A light pulses with the app's tone. It helps in noisy rooms and for hard-of-hearing operators. It is off in LICW strict mode."
    />
  </div>

  <div class="group">
    <h2>Band conditions</h2>
    <p class="muted small">
      Band conditions are used in the Copy drill, Time to recognise, Sound surfing, Head copy, the sprint, Pocket rounds and the QSO simulator.
      LICW exercises, Spot the new character, Hear it, send it and Learn QSOs play clean.
    </p>
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
          { value: 'straight', label: 'Straight key' },
          { value: 'iambicA', label: 'Paddles A' },
          { value: 'iambicB', label: 'Paddles B' },
        ]}
      />
    </div>
    <p class="muted small">
      The touch key is a pad at the bottom of the screen, shown while a drill or QSO listens. The straight key and paddles
      use your keyboard: Space, and [ and ] (or Z and X). <a href={href('setup')}>Setup</a> has the microphone, calibration
      and spectrum.
    </p>
    <Toggle
      bind:checked={settings.headphones}
      label="Headphones"
      detail="Turn on when the app's sound goes to headphones. The microphone then keeps listening while the app sends, so your keying can interrupt a QSO station. Leave it off when the app plays through a speaker."
    />
    <Slider label="Your turn ends after" bind:value={settings.overTimeout} min={1.5} max={6} step={0.5} unit="s of silence" />
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
    <p class="muted small">How far your timing can drift from standard before a note about it appears.</p>
    <Toggle
      bind:checked={settings.keepSends}
      label="Keep recent sends"
      detail="Keeps the timing of your last 8 sends so you can replay them in Progress. Timing only, no audio."
    />
  </div>

  <div class="group">
    <h2>Data</h2>
    <p class="muted small">Progress is stored in this browser only. Export it to a file to move it to another device, then import it there.</p>
    <div class="row">
      <Button onclick={exportData}>Export</Button>
      <label class="file">
        <span>Import</span>
        <input type="file" accept="application/json,.json" onchange={importData} />
      </label>
      <Button kind="quiet" onclick={resetAll}>Reset settings</Button>
      <Button kind="quiet" onclick={clearProgress}>Delete progress</Button>
    </div>
    {#if dataNote}<p class="small">{dataNote}</p>{/if}
  </div>

  <div class="group">
    <h2>Version</h2>
    <p class="small">
      This is BeepBeep {__APP_VERSION__} ({__APP_BUILD__}). <a href={href('changes')}>Version history</a> lists what changed in each version; the version number at the top of every screen opens it too.
    </p>
    <div><Button onclick={freshReload}>Reload the latest version</Button></div>
    <p class="muted small">
      If the app seems out of date, this loads the latest version from the internet instead of the copy saved on this
      device. It works when the app is on your home screen, where you can't force a refresh. Your progress and settings
      are kept.
    </p>
    {#if versionNote}<p class="small" role="status">{versionNote}</p>{/if}
  </div>
  <p class="muted small">LICW is a trademark of the Long Island CW Club; BeepBeep is not affiliated with it.</p>
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
    font-size: var(--size-field);
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
