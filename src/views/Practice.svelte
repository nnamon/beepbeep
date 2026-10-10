<script lang="ts">
  import { route, href } from '../lib/state/router.svelte';
  import { settings, strict } from '../lib/state/settings.svelte';
  import { TRACKS, type TrackId } from '../lib/train/courses';
  import { currentLevel, receiveSpeeds } from '../lib/train/session';
  import Segmented from '../ui/Segmented.svelte';
  import Button from '../ui/Button.svelte';
  import TokenText from '../ui/TokenText.svelte';
  import Value from '../ui/Value.svelte';
  import Icon from '../ui/Icon.svelte';
  import LiveDecoder from './drills/LiveDecoder.svelte';
  import SendDrill from './drills/SendDrill.svelte';
  import HearSend from './drills/HearSend.svelte';
  import CopyDrill from './drills/CopyDrill.svelte';
  import Familiarity from './drills/Familiarity.svelte';
  import TtrDrill from './drills/TtrDrill.svelte';
  import IfrDrill from './drills/IfrDrill.svelte';
  import HeadCopy from './drills/HeadCopy.svelte';
  import Sprint from './drills/Sprint.svelte';

  const mode = $derived(route.path[1] ?? '');
  const level = $derived(currentLevel());
  const levels = $derived(TRACKS[settings.track].levels);
  const idx = $derived(levels.findIndex((l) => l.id === level.id));
  const speeds = $derived(receiveSpeeds());

  function setTrack(t: TrackId) {
    settings.track = t;
  }

  function step(d: number) {
    const next = levels[Math.max(0, Math.min(levels.length - 1, idx + d))];
    settings.level[settings.track] = next.id;
  }

  const MODES = [
    { group: 'Send', items: [
      { id: 'live', name: 'Live decoder', text: 'Decodes your sending as you key.' },
      { id: 'send', name: 'Send drill', text: 'Send the text shown. Shows what was received.' },
    ] },
    { group: 'Both', items: [
      { id: 'hear-send', name: 'Hear it, send it', text: 'Copy a character or word, then send it.' },
      { id: 'qso', name: 'QSO simulator', text: 'Ragchew, SKCC, SST, POTA, contest or pileup with a simulated station.', href: href('qso') },
    ] },
    { group: 'Receive', items: [
      { id: 'copy', name: 'Copy drill', text: 'Type groups or words from your lesson.' },
      { id: 'familiarity', name: 'Familiarity', text: 'Tap each time the new character plays.' },
      { id: 'ttr', name: 'TTR drill', text: 'Name each character before the voice does.' },
      { id: 'ifr', name: 'Sound surfing (IFR)', text: 'Copy a continuous stream without stopping.' },
      { id: 'head-copy', name: 'Head copy', text: 'Listen without writing, then answer questions.' },
      { id: 'sprint', name: 'Callsign and word sprint', text: 'Callsigns or words at rising speed.' },
    ] },
  ];
</script>

{#if mode === 'live'}
  <LiveDecoder />
{:else if mode === 'send'}
  <SendDrill />
{:else if mode === 'hear-send'}
  <HearSend />
{:else if mode === 'copy'}
  <CopyDrill />
{:else if mode === 'familiarity'}
  <Familiarity />
{:else if mode === 'ttr'}
  <TtrDrill />
{:else if mode === 'ifr'}
  <IfrDrill />
{:else if mode === 'head-copy'}
  <HeadCopy />
{:else if mode === 'sprint'}
  <Sprint />
{:else}
  <div class="home">
    <section class="course" aria-labelledby="course-h">
      <div class="row-head">
        <h1 id="course-h">Practice</h1>
        <Segmented
          label="Course"
          value={settings.track}
          onchange={setTrack}
          options={[
            { value: 'koch', label: 'Koch' },
            { value: 'licw', label: 'LICW' },
          ]}
        />
      </div>

      {#if settings.track === 'licw' && !settings.licwAsked}
        <div class="ask" role="group" aria-labelledby="ask-h">
          <h2 id="ask-h">LICW strict mode</h2>
          <p class="muted">
            Hides rhythm bars and the character reference. Decoded sending shows after each over; receive answers show
            at the end of a drill. Change it later in Settings.
          </p>
          <div class="ask-actions">
            <Button kind="primary" onclick={() => { settings.licwStrict = true; settings.licwAsked = true; }}>Turn on</Button>
            <Button onclick={() => { settings.licwStrict = false; settings.licwAsked = true; }}>Not now</Button>
          </div>
        </div>
      {/if}

      <div class="level">
        <div class="level-name">
          <span class="label">{TRACKS[settings.track].name}</span>
          <div class="stepper">
            <Button kind="secondary" label="Previous lesson" disabled={idx <= 0} onclick={() => step(-1)}><Icon name="back" size={18} /></Button>
            <strong>{level.name}</strong>
            <Button kind="secondary" label="Next lesson" disabled={idx >= levels.length - 1} onclick={() => step(1)}><Icon name="forward" size={18} /></Button>
          </div>
        </div>
        <div class="level-chars">
          <span class="label">New in this lesson</span>
          <TokenText tokens={level.added.flatMap((t, i) => (i ? [{ t: ' ' }, { t }] : [{ t }]))} size="l" />
        </div>
        <div class="level-meta">
          <span class="label">Receive speed</span>
          <Value value="{speeds.charWpm}/{speeds.effectiveWpm}" unit="wpm" size="l" />
        </div>
        <div class="level-meta">
          <span class="label">Characters known</span>
          <Value value={level.known.length} size="l" />
        </div>
        {#if !strict()}<a class="ref" href={href('reference')}>Character reference</a>{/if}
      </div>
    </section>

    <section class="today" aria-labelledby="today-h">
      <h2 id="today-h">Plan</h2>
      <dl class="facts">
        <div><dt class="label">Session</dt><dd><Value value={settings.sessionMinutes} unit="min" /></dd></div>
        <div><dt class="label">Sending</dt><dd><Value value="25%" unit="or more" /></dd></div>
        <div><dt class="label">Comfort</dt><dd><Value value={settings.comfortWpm} unit="wpm" /></dd></div>
        <div><dt class="label">Stretch</dt><dd><Value value={settings.stretchWpm} unit="wpm" /></dd></div>
      </dl>
    </section>

    {#each [MODES.slice(0, 2), MODES.slice(2)] as col, ci (ci)}
      <div class="col">
    {#each col as g (g.group)}
      <section class="modes" aria-labelledby="g-{g.group}">
        <h3 id="g-{g.group}">{g.group}</h3>
        <ul>
          {#each g.items as m (m.id)}
            {#if m.id !== 'familiarity' || settings.track === 'licw'}
              <li>
                <a href={m.href ?? href('practice', m.id)}>
                  <span class="name">{m.name}</span>
                  <span class="text muted">{m.text}</span>
                </a>
              </li>
            {/if}
          {/each}
        </ul>
      </section>
    {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .home {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-4) var(--s-6);
    align-items: start;
  }

  .course {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }

  .ask {
    border-left: 2px solid var(--signal);
    padding: var(--s-1) 0 var(--s-1) var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    max-width: var(--reading);
  }

  .ask-actions {
    display: flex;
    gap: var(--s-1);
    flex-wrap: wrap;
    margin-top: var(--s-1);
  }

  .level {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3) var(--s-5);
    align-items: flex-end;
    padding: var(--s-2) 0;
    border-top: var(--hairline) solid var(--line);
    border-bottom: var(--hairline) solid var(--line);
  }

  .level > div {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }

  .stepper :global(.btn) {
    padding: 0 var(--s-1);
  }

  .stepper strong {
    min-width: 9ch;
    text-align: center;
  }

  .ref {
    margin-left: auto;
    color: var(--muted);
    font-size: var(--size-s);
  }

  .today {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-5);
    margin: 0;
  }

  .facts div {
    display: flex;
    flex-direction: column;
  }

  .facts dd {
    margin: 0;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .modes ul {
    list-style: none;
    margin: var(--s-1) 0 0;
    padding: 0;
    border-top: var(--hairline) solid var(--line);
  }

  .modes li a {
    display: flex;
    flex-direction: column;
    padding: var(--s-2) 0;
    border-bottom: var(--hairline) solid var(--line);
    text-decoration: none;
  }

  .modes li a:hover .name {
    text-decoration: underline;
    text-decoration-color: var(--signal);
    text-underline-offset: 3px;
  }

  .name {
    font-weight: var(--weight-strong);
  }

  .text {
    font-size: var(--size-s);
  }

  @media (max-width: 860px) {
    .home {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
