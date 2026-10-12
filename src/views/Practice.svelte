<script lang="ts">
  import { route, href } from '../lib/state/router.svelte';
  import { settings, strict } from '../lib/state/settings.svelte';
  import { CAROUSEL_GROUPS, TRACK_NAMES, type TrackId } from '../lib/train/courses';
  import { CLASSES, EXERCISE_GROUPS, classById, groupOf, type ClassId } from '../lib/train/classes';
  import Select from '../ui/Select.svelte';
  import Exercise from './drills/Exercise.svelte';
  import { currentLevel, farnsworthDays, laterStage, receiveSpeeds, trackLevels } from '../lib/train/session';
  import { getItems, getKv, qsos, sessions, setKv } from '../lib/state/db';
  import { localDay, todaySteps, type Step } from '../lib/train/today';
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
  // BC3 and later: every character is known, and the stage replaces the lesson.
  const later = $derived(laterStage());

  // Today's checklist. A step ticks itself when a session of its kind is
  // recorded today; you can also tick it yourself. It is read again each time
  // you come back to this screen, and when the app comes back into view (a new
  // day may have started).
  let day = $state(localDay());
  let shown = $state(0);
  let fresh = $state<string[]>([]);
  let weak = $state<string[]>([]);
  let doneModes = $state<Set<string>>(new Set());
  let ticked = $state<string[]>([]);
  $effect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') shown++;
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  });
  $effect(() => {
    const lvl = level;
    void shown;
    if (mode !== '') return;
    const today = localDay();
    day = today;
    void (async () => {
      try {
        const [rx, list, logged, mine] = await Promise.all([getItems('rx:'), sessions(), qsos(), getKv<{ day: number; ids: string[] }>('today', { day: today, ids: [] })]);
        fresh = lvl.added.filter((c) => {
          const st = rx.get(`rx:${c}`);
          return !st || st.seen < 10 || (accuracy(st) ?? 0) < 0.9;
        });
        const since = Date.now() - 30 * 864e5;
        weak = lvl.known
          .filter((c) => !lvl.added.includes(c))
          .map((c) => ({ c, w: windowStats(rx.get(`rx:${c}`), since) }))
          .filter((x) => x.w && x.w.n >= 5 && x.w.accuracy < 0.8)
          .sort((a, b) => a.w!.accuracy - b.w!.accuracy)
          .slice(0, 3)
          .map((x) => x.c);
        const modes = new Set(list.filter((x) => localDay(x.at) === today).map((x) => x.mode));
        if (logged.some((q) => localDay(q.at) === today)) modes.add('qso');
        doneModes = modes;
        ticked = mine.day === today ? mine.ids : [];
      } catch {
        doneModes = new Set();
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

  // LICW exercises. BC1 and BC2 follow the carousel lesson you are on.
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
    // Past the carousel every character is known: stand on its last lesson.
    if (id !== 'bc1' && id !== 'bc2') settings.level.licw = levels[levels.length - 1].id;
    else if (!level.id.startsWith(`licw-${id}`)) settings.level.licw = levels.find((l) => l.id.startsWith(`licw-${id}`))!.id;
  }

  const steps = $derived(
    todaySteps({
      track: settings.track,
      stage: cls.id,
      fresh: fresh.map(displayToken),
      weak: weak.map(displayToken),
      added: [...level.added, ...(level.addedWords ?? [])].map(displayToken),
      sessionMinutes: settings.sessionMinutes,
      day,
    }),
  );
  const auto = (s: Step) => s.modes.some((m) => doneModes.has(m));
  const isDone = (s: Step) => auto(s) || ticked.includes(s.id);
  const required = $derived(steps.filter((s) => !s.optional));
  const extras = $derived(steps.filter((s) => s.optional));

  function toggle(s: Step) {
    if (auto(s)) return;
    ticked = ticked.includes(s.id) ? ticked.filter((x) => x !== s.id) : [...ticked, s.id];
    void setKv('today', { day, ids: [...ticked] });
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
      { id: 'send', name: 'Send drill', text: 'Send the text shown and see what was received.' },
    ] },
    { group: 'Both', items: [
      { id: 'hear-send', name: 'Hear it, send it', text: 'Copy a character or word, then send it.' },
      { id: 'qso-learn', name: 'Learn QSOs', text: 'Guided lessons on each part of a QSO, a contact with another station. Repeat each step until you get it right.', href: href('qso', 'learn') },
      { id: 'qso', name: 'QSO simulator', text: 'Make whole contacts with a simulated station: a chat, a contest, a park activation and more.', href: href('qso') },
    ] },
    { group: 'Receive', items: [
      { id: 'copy', name: 'Copy drill', text: "Type groups or words made from your lesson's characters." },
      { id: 'familiarity', name: 'Spot the new character', text: 'Tap each time the new character plays.' },
      { id: 'ttr', name: 'Time to recognise (TTR)', text: 'Type each character before a voice names it.' },
      { id: 'ifr', name: 'Sound surfing', text: 'Copy a continuous stream without stopping.' },
      { id: 'head-copy', name: 'Head copy', text: 'Listen without writing, then answer questions.' },
      { id: 'sprint', name: 'Callsign and word sprint', text: 'Copy callsigns or words as the speed rises.' },
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
            Follows LICW's method closely: no rhythm bars or character chart, your decoded sending appears only after you
            finish, and receive drills show the answers only at the end. You can change this in Settings.
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
          {#if later}
            <strong class="stage">Stage {later.name}</strong>
          {:else}
            <div class="stepper">
              <Button kind="secondary" label="Previous lesson" disabled={idx <= 0} onclick={() => step(-1)}><Icon name="back" size={18} /></Button>
              <strong>{level.name}</strong>
              <Button kind="secondary" label="Next lesson" disabled={idx >= levels.length - 1} onclick={() => step(1)}><Icon name="forward" size={18} /></Button>
            </div>
          {/if}
        </div>
        {#if !later}
          <div class="level-chars">
            <span class="label">New in this lesson</span>
            <TokenText tokens={level.added.flatMap((t, i) => (i ? [{ t: ' ' }, { t }] : [{ t }]))} size="l" />
          </div>
        {/if}
        <div class="level-meta">
          {#if speeds.charWpm === speeds.effectiveWpm}
            <span class="label">Receive speed</span>
            <Value value={speeds.charWpm} unit="wpm" size="l" />
          {:else}
            <span class="label">Receive speed: characters / overall</span>
            <Value value="{speeds.charWpm} / {speeds.effectiveWpm}" unit="wpm" size="l" />
          {/if}
        </div>
        <div class="level-meta">
          <span class="label">Characters known</span>
          <Value value={level.known.length} size="l" />
        </div>
        {#if !strict()}<a class="ref" href={href('reference')}>Character reference</a>{/if}
      </div>
    </section>

    <section class="today" aria-labelledby="today-h">
      <div class="today-head">
        <h2 id="today-h">Today</h2>
        <span class="muted">{required.filter(isDone).length} of {required.length} done · about {required.reduce((a, x) => a + x.minutes, 0)} min</span>
      </div>
      <p class="muted lead">Work down the list from the top.</p>
      {#snippet stepList(list: Step[])}
        <ol class="steps">
          {#each list as s (s.id)}
            <li class:done={isDone(s)}>
              <button type="button" class="tick" role="checkbox" aria-checked={isDone(s)} aria-label="Done: {s.title}" onclick={() => toggle(s)}>
                {#if isDone(s)}<Icon name="check" size={16} />{/if}
              </button>
              <a href={href(...s.to)}>
                <span class="name">{s.title}</span>
                <span class="text muted">{s.why}</span>
              </a>
              <span class="min muted num">{s.minutes} min</span>
            </li>
          {/each}
        </ol>
      {/snippet}
      {@render stepList(required)}
      {#if extras.length}
        <h3 class="ex-group">If you have time</h3>
        {@render stepList(extras)}
      {/if}
      <p class="muted small">
        Extra copy practice: comfort is a speed you copy easily ({settings.comfortWpm} wpm), stretch is one that pushes you
        ({settings.stretchWpm} wpm).
      </p>
      <div class="sessions">
        <Button href={href('practice', 'copy', 'comfort')}>Comfort session</Button>
        <Button href={href('practice', 'copy', 'stretch')}>Stretch session</Button>
      </div>
      {#if wideDays !== null && wideDays > 14}
        <p class="flag">
          You have practised with extra space between characters ({settings.charWpm} wpm characters, {settings.effectiveWpm} wpm
          overall) for {wideDays} days. Raise the overall speed in
          <a href={href('settings')}>Settings</a>.
        </p>
      {/if}
    </section>

    {#if settings.track === 'licw'}
      <section class="bc" aria-labelledby="bc-h">
        <div class="bc-head">
          <h2 id="bc-h">LICW exercises</h2>
          <Select label="Stage" options={CLASSES.map((c) => ({ value: c.id, label: c.name }))} value={cls.id} onchange={pickClass} />
          {#if cls.carousel && settings.licwEnrolled}
            {@const which = cls.carousel}
            <Select label="Lesson you joined at" options={CAROUSEL_GROUPS[which]} value={settings.carousel[which]} onchange={(v) => (settings.carousel[which] = v)} />
          {/if}
          <span class="band muted">{cls.band}</span>
        </div>
        <ul class="routine">
          {#if cls.carousel && settings.licwEnrolled}<li>Set the lesson you joined at here. Then use the Previous lesson and Next lesson buttons at the top to match the lesson your class is on.</li>{/if}
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
            <li>
              <a href={m.href ?? href('practice', m.id)}>
                <span class="name">{m.name}</span>
                <span class="text muted">{m.text}</span>
              </a>
            </li>
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

  .today-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-1) var(--s-3);
  }

  .lead {
    max-width: var(--reading);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--hairline) solid var(--line);
    max-width: 760px;
  }

  .steps li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  .tick {
    width: 28px;
    height: 28px;
    border: 1.5px solid var(--muted);
    border-radius: 50%;
    background: none;
    color: var(--signal-ink);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .done .tick {
    background: var(--signal);
    border-color: var(--signal);
  }

  .steps a {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    min-width: 0;
  }

  .steps a:hover .name {
    text-decoration: underline;
    text-decoration-color: var(--signal);
    text-underline-offset: 3px;
  }

  .done .name {
    color: var(--muted);
  }

  .min {
    font-size: var(--size-s);
  }

  .small {
    font-size: var(--size-s);
    max-width: var(--reading);
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
