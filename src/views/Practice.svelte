<script lang="ts">
  import { route, href } from '../lib/state/router.svelte';
  import { settings, strict } from '../lib/state/settings.svelte';
  import { CAROUSEL_GROUPS, TRACK_NAMES, type TrackId } from '../lib/train/courses';
  import { CLASSES, EXERCISE_GROUPS, classById, groupOf, type ClassId } from '../lib/train/classes';
  import Select from '../ui/Select.svelte';
  import Exercise from './drills/Exercise.svelte';
  import { currentLevel, farnsworthDays, receiveSpeeds, trackLevels } from '../lib/train/session';
  import { getItems, sessions } from '../lib/state/db';
  import { accuracy, windowStats } from '../lib/train/srs';
  import { displayToken } from '../lib/morse/code';
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
  const levels = $derived(trackLevels());
  const idx = $derived(levels.findIndex((l) => l.id === level.id));
  const speeds = $derived(receiveSpeeds());

  // One to three objectives for today's session, from your own numbers.
  let objectives = $state<{ text: string; to: string[] }[]>([]);
  $effect(() => {
    const lvl = level;
    const track = settings.track;
    const minutes = settings.sessionMinutes;
    const stretchWpm = settings.stretchWpm;
    void (async () => {
      try {
        const [rx, list] = await Promise.all([getItems('rx:'), sessions()]);
        const out: { text: string; to: string[] }[] = [];
        const fresh = lvl.added.filter((c) => {
          const st = rx.get(`rx:${c}`);
          return !st || st.seen < 10 || (accuracy(st) ?? 0) < 0.9;
        });
        if (fresh.length) out.push({ text: `Learn ${fresh.map(displayToken).join(' ')}`, to: track === 'licw' ? ['familiarity'] : ['copy', 'chars'] });
        const since = Date.now() - 30 * 864e5;
        const weak = lvl.known
          .filter((c) => !lvl.added.includes(c))
          .map((c) => ({ c, w: windowStats(rx.get(`rx:${c}`), since) }))
          .filter((x) => x.w && x.w.n >= 5 && x.w.accuracy < 0.8)
          .sort((a, b) => a.w!.accuracy - b.w!.accuracy)
          .slice(0, 3);
        if (weak.length) out.push({ text: `Copy ${weak.map((x) => displayToken(x.c)).join(' ')}, under 80% this month`, to: ['copy', 'chars'] });
        const week = list.filter((x) => x.at > Date.now() - 7 * 864e5);
        const total = week.reduce((a, x) => a + x.seconds, 0);
        const sent = week.filter((x) => x.sending).reduce((a, x) => a + x.seconds, 0);
        if (!total || sent / total < 0.25) out.push({ text: `Send for ${Math.max(3, Math.round(minutes / 4))} min`, to: ['send'] });
        if (out.length < 3) out.push({ text: `Stretch session at ${stretchWpm} wpm`, to: ['copy', 'stretch'] });
        objectives = out.slice(0, 3);
      } catch {
        objectives = [];
      }
    })();
  });

  // Flag extra spacing left on for more than two weeks.
  let wideDays = $state<number | null>(null);
  $effect(() => {
    void settings.effectiveWpm;
    void settings.charWpm;
    void settings.track;
    void settings.useCourseSpeeds;
    void farnsworthDays().then((d) => (wideDays = d));
  });

  // LICW class exercises. BC1 and BC2 follow the carousel group you are on.
  const cls = $derived.by(() => {
    const id = settings.licwClass;
    if (id === 'bc1' || id === 'bc2') return classById(level.id.startsWith('licw-bc2') ? 'bc2' : 'bc1')!;
    return classById(id) ?? classById('bc1')!;
  });

  const exerciseGroups = $derived(
    EXERCISE_GROUPS.map((g) => ({ g, items: cls.exercises.filter((e) => groupOf(cls, e) === g) })).filter((x) => x.items.length),
  );

  function pickClass(id: ClassId) {
    settings.licwClass = id;
    if (id !== 'bc1' && id !== 'bc2') return;
    if (!level.id.startsWith(`licw-${id}`)) settings.level.licw = levels.find((l) => l.id.startsWith(`licw-${id}`))!.id;
  }
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
      { id: 'familiarity', name: 'Spot the new character', text: 'Tap each time the new character plays.' },
      { id: 'ttr', name: 'TTR drill', text: 'Name each character before the voice does.' },
      { id: 'ifr', name: 'Sound surfing (IFR)', text: 'Copy a continuous stream without stopping.' },
      { id: 'head-copy', name: 'Head copy', text: 'Listen without writing, then answer questions.' },
      { id: 'sprint', name: 'Callsign and word sprint', text: 'Callsigns or words at rising speed.' },
    ] },
  ];
</script>

{#if mode === 'class'}
  {#key route.path.join('/')}<Exercise classId={route.path[2] ?? ''} exerciseId={route.path[3] ?? ''} />{/key}
{:else if mode === 'live'}
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

      {#if !settings.guideSeen}
        <p class="first">
          The <a href={href('guide')}>guide</a> shows where to start, with or without a key.
          <button type="button" class="dismiss" onclick={() => (settings.guideSeen = true)}>Dismiss</button>
        </p>
      {/if}

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
          <span class="label">{TRACK_NAMES[settings.track]}</span>
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
      {#if objectives.length}
        <ol class="objectives">
          {#each objectives as o (o.text)}<li><a href={href('practice', ...o.to)}>{o.text}</a></li>{/each}
        </ol>
      {/if}
      <div class="sessions">
        <Button href={href('practice', 'copy', 'comfort')}>Comfort session</Button>
        <Button href={href('practice', 'copy', 'stretch')}>Stretch session</Button>
      </div>
      {#if wideDays !== null && wideDays > 14}
        <p class="flag">
          Extra spacing on for {wideDays} days ({settings.charWpm}/{settings.effectiveWpm} wpm). Raise effective speed in
          <a href={href('settings')}>Settings</a>.
        </p>
      {/if}
    </section>

    {#if settings.track === 'licw'}
      <section class="bc" aria-labelledby="bc-h">
        <div class="bc-head">
          <h2 id="bc-h">Class exercises</h2>
          <Select label="Class" options={CLASSES.map((c) => ({ value: c.id, label: c.name }))} value={cls.id} onchange={pickClass} />
          {#if cls.carousel}
            {@const which = cls.carousel}
            <Select label="Joined at" options={CAROUSEL_GROUPS[which]} value={settings.carousel[which]} onchange={(v) => (settings.carousel[which] = v)} />
          {/if}
          <span class="band muted">{cls.band}</span>
        </div>
        <ul class="routine">
          {#each cls.routine as r (r)}<li>{r}</li>{/each}
        </ul>
        {#each exerciseGroups as { g, items } (g)}
          <h3 class="ex-group">{g}</h3>
          <ol>
            {#each items as e (e.id)}
              <li>
                <a href={e.drill ? href('practice', ...e.drill) : href('practice', 'class', cls.id, e.id)}>
                  <span class="name">{e.name}</span>
                  <span class="text muted">{e.summary}</span>
                </a>
              </li>
            {/each}
          </ol>
        {/each}
      </section>
    {/if}

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

  .first {
    border-left: 2px solid var(--signal);
    padding-left: var(--s-1);
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-half) var(--s-2);
    align-items: baseline;
    max-width: var(--reading);
  }

  .dismiss {
    border: 0;
    background: none;
    padding: 0;
    color: var(--muted);
    text-decoration: underline;
    font-size: var(--size-s);
    min-height: 32px;
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

  .objectives {
    margin: var(--s-1) 0 0;
    padding-left: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
  }

  .objectives a {
    text-decoration-color: var(--line);
    text-underline-offset: 3px;
  }

  .objectives a:hover {
    text-decoration-color: var(--signal);
  }

  .sessions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    margin-top: var(--s-1);
  }

  .flag {
    border-left: 2px solid var(--signal);
    padding-left: var(--s-1);
    max-width: var(--reading);
  }

  .bc {
    grid-column: 1 / -1;
  }

  .bc-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-2) var(--s-3);
  }

  .bc-head h2 {
    flex-basis: 100%;
  }

  .band {
    padding-bottom: var(--s-1);
  }

  .routine {
    margin: var(--s-2) 0 0;
    padding-left: 1.2em;
    max-width: var(--reading);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ex-group {
    margin-top: var(--s-3);
    font-size: var(--size-s);
    color: var(--muted);
    font-weight: var(--weight-strong);
  }

  .bc ol {
    list-style: none;
    margin: var(--s-1) 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 var(--s-3);
    border-top: var(--hairline) solid var(--line);
  }

  .bc a {
    display: flex;
    flex-direction: column;
    padding: var(--s-2) 0;
    border-bottom: var(--hairline) solid var(--line);
    text-decoration: none;
  }

  .bc a:hover .name {
    text-decoration: underline;
    text-decoration-color: var(--signal);
    text-underline-offset: 3px;
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

    .bc ol {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
