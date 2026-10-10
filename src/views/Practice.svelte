<script lang="ts">
  import { route, href } from '../lib/state/router.svelte';
  import { settings, strict } from '../lib/state/settings.svelte';
  import { TRACKS, type TrackId } from '../lib/train/courses';
  import { currentLevel, receiveSpeeds } from '../lib/train/session';
  import Segmented from '../ui/Segmented.svelte';
  import Button from '../ui/Button.svelte';
  import TokenText from '../ui/TokenText.svelte';
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
      { id: 'live', name: 'Live decoder', text: 'Key anything and watch your own sending decoded, with its rhythm.' },
      { id: 'send', name: 'Send drill', text: 'Send prompted text; see what a listener received, then one note.' },
    ] },
    { group: 'Both', items: [
      { id: 'hear-send', name: 'Hear it, send it', text: 'The app sends; you send it straight back, by ear.' },
      { id: 'qso', name: 'QSO simulator', text: 'Work a bot station: ragchew, SKCC, SST, POTA, contest, pileup.', href: href('qso') },
    ] },
    { group: 'Receive', items: [
      { id: 'copy', name: 'Copy drill', text: 'Type what you hear from your current lesson’s characters.' },
      { id: 'familiarity', name: 'Familiarity', text: 'A new sound plays unnamed among known ones; tap each time you hear it.' },
      { id: 'ttr', name: 'TTR drill', text: 'Recognise each character before its name is spoken; the delay tightens.' },
      { id: 'ifr', name: 'Sound surfing (IFR)', text: 'Copy a continuous stream with no pauses; stay in step after misses.' },
      { id: 'head-copy', name: 'Head copy', text: 'No typing while it plays; answer questions about meaning afterwards.' },
      { id: 'sprint', name: 'Callsign and word sprint', text: 'Copy at rising speed; see where copy stays steady.' },
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
          <h2 id="ask-h">Turn on LICW strict mode?</h2>
          <p class="muted">
            Strict mode applies the LICW Method Guide's guardrails: no rhythm visuals or character chart, your decoded
            sending shown only after each over, receive answers only at the end of a drill, and speed shown as context
            rather than the headline. You can change it any time in Settings.
          </p>
          <div class="ask-actions">
            <Button kind="primary" onclick={() => { settings.licwStrict = true; settings.licwAsked = true; }}>Turn on strict mode</Button>
            <Button onclick={() => { settings.licwStrict = false; settings.licwAsked = true; }}>Keep visuals</Button>
          </div>
        </div>
      {/if}

      <div class="level">
        <div class="level-name">
          <span class="label">{TRACKS[settings.track].name}</span>
          <div class="stepper">
            <Button kind="quiet" label="Previous lesson" disabled={idx <= 0} onclick={() => step(-1)}>&larr;</Button>
            <strong>{level.name}</strong>
            <Button kind="quiet" label="Next lesson" disabled={idx >= levels.length - 1} onclick={() => step(1)}>&rarr;</Button>
          </div>
        </div>
        <div class="level-chars">
          <span class="label">New in this lesson</span>
          <TokenText tokens={level.added.map((t) => ({ t }))} size="l" />
        </div>
        <div class="level-meta">
          <span class="label">Receive speed</span>
          <span class="num">{speeds.charWpm}/{speeds.effectiveWpm} wpm</span>
        </div>
        <div class="level-meta">
          <span class="label">Characters known</span>
          <span class="num">{level.known.length}</span>
        </div>
        {#if !strict()}<a class="ref" href={href('reference')}>Character reference</a>{/if}
      </div>
    </section>

    <section class="today" aria-labelledby="today-h">
      <h2 id="today-h">Today</h2>
      <p class="muted">
        A {settings.sessionMinutes}-minute session with one to three objectives works best, with at least a quarter of
        it sending. Comfort at <span class="num">{settings.comfortWpm}</span> wpm, stretch at
        <span class="num">{settings.stretchWpm}</span> wpm.
      </p>
    </section>

    {#each MODES as g (g.group)}
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
    gap: var(--s-half);
    margin-left: calc(-1 * var(--s-1));
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
    max-width: var(--reading);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
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
