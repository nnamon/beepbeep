<script lang="ts">
  // How the app is laid out and where to start, by situation.
  import { onMount } from 'svelte';
  import { href } from '../lib/state/router.svelte';
  import { settings } from '../lib/state/settings.svelte';

  onMount(() => {
    settings.guideSeen = true;
  });

  const START = [
    { when: 'No key with you', go: 'Pocket', to: ['pocket'], what: 'Quiz yourself by ear. You type the answers on the on-screen keyboard.' },
    { when: 'No key, but you want to send', go: 'Touch key', to: ['setup'], what: 'Set Input to Touch key. A pad appears at the bottom of the screen while a drill listens.' },
    { when: 'Key, rig or CW toy nearby', go: 'Setup', to: ['setup'], what: 'Start the mic and send V V V to calibrate. Then open Practice and choose Send drill.' },
    { when: 'At a computer, no key', go: 'Setup', to: ['setup'], what: 'Use the keyboard: hold Space as a straight key, or use [ and ] (or Z and X) as paddles.' },
    { when: 'New to QSOs (contacts with other stations)', go: 'Learn QSOs', to: ['qso', 'learn'], what: 'Guided lessons: answer a CQ, swap reports, sign off. Each step is checked, and you can try it again.' },
    { when: 'Ready for whole QSOs', go: 'QSO', to: ['qso'], what: 'Pick a kind of contact. A simulated station answers each time you finish sending.' },
  ];

  const AREAS = [
    { name: 'Practice', to: ['practice'], what: "Your course (Koch or LICW) and lesson, today's list, and every drill: sending drills first, then receive drills." },
    { name: 'Pocket', to: ['pocket'], what: 'Quiz yourself by ear on characters, chunks, words, callsigns, phrases, or your own set.' },
    { name: 'QSO', to: ['qso'], what: 'Learn QSOs, with guided lessons on each part of a contact, and a simulated station for several kinds of contact, from a chat to a contest.' },
    { name: 'Progress', to: ['progress'], what: 'Your speeds over time, accuracy for each character, spacing slips, recent sends and your QSO log.' },
    { name: 'Settings', to: ['settings'], what: 'Speeds, pitch, spoken answers, band conditions, input, and export and import of your progress.' },
    { name: 'Signal bar', to: ['setup'], what: 'It sits at the top right, or under the header on a phone. It shows the input, your tone and a key light. Select it to open Setup.' },
  ];

  const INPUTS = [
    { name: 'Microphone', key: 'Your rig, oscillator or CW toy near the mic', when: 'You have a key and a tone' },
    { name: 'Touch key', key: 'Hold the pad at the bottom of the screen', when: 'Phone or tablet, no key' },
    { name: 'Straight key (keyboard)', key: 'Hold Space', when: 'At a computer, no key' },
    { name: 'Paddles A or B (keyboard)', key: '[ or Z for dit, ] or X for dah', when: 'At a computer, practising for paddles. A and B are the two usual keyer modes.' },
  ];
</script>

<section class="guide">
  <h1>Guide</h1>

  <div class="block">
    <h2>Where to start</h2>
    <table>
      <thead><tr><th>If</th><th>Go to</th><th>Then</th></tr></thead>
      <tbody>
        {#each START as s (s.when)}
          <tr><td>{s.when}</td><td><a href={href(...s.to)}>{s.go}</a></td><td>{s.what}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="block">
    <h2>Where things are</h2>
    <dl class="areas">
      {#each AREAS as a (a.name)}
        <div><dt><a href={href(...a.to)}>{a.name}</a></dt><dd>{a.what}</dd></div>
      {/each}
    </dl>
  </div>

  <div class="block">
    <h2>Lessons</h2>
    <ul>
      <li>The lesson sets which characters the drills and Pocket use. Change it with the arrows on Practice or Pocket.</li>
      <li>When a Copy drill or a Pocket Characters round scores 90% (Koch) or 80% (LICW), you are offered the next lesson. You can also move on any time with the arrows.</li>
      <li>Each Koch lesson adds one character (the first adds two). Each LICW lesson adds up to three, through BC1 and then BC2. Students in an LICW class can start the carousel at the lesson they joined at: turn on In an LICW class in Settings.</li>
      <li>On the LICW track, Practice lists the syllabus exercises for each stage, BC1 to ADV 3, TTR+ and OverLearn, with notes on how to do each one. Any exercise can play your own text: paste it or open a .txt file.</li>
      <li>LICW strict mode, in Settings, follows LICW's method: no rhythm bars or character reference, your sending is shown only when you finish, receive drills show the answers at the end, and BC lessons use the straight key.</li>
    </ul>
  </div>

  <div class="block">
    <h2>Inputs</h2>
    <table>
      <thead><tr><th>Input</th><th>How to key</th><th>Use when</th></tr></thead>
      <tbody>
        {#each INPUTS as i (i.name)}
          <tr><td>{i.name}</td><td>{i.key}</td><td>{i.when}</td></tr>
        {/each}
      </tbody>
    </table>
    <p class="muted small">Change the input in <a href={href('setup')}>Setup</a> or Settings. The current one shows in the signal bar.</p>
  </div>

  <div class="block">
    <h2>Keys</h2>
    <ul>
      <li><span class="mono">Enter</span> starts a drill. <span class="mono">Esc</span> stops it if it has a Stop button, and otherwise leaves it.</li>
      <li><span class="mono">Alt + ↑</span> and <span class="mono">Alt + ↓</span> change the receive speed, except on the LICW track while lesson speeds are on.</li>
      <li>On a phone or tablet every shortcut has a button.</li>
      <li>On iPhone and iPad, sound starts from a tap: use Turn sound on, or any Start button. After that it plays even with the silent switch on.</li>
    </ul>
  </div>
</section>

<style>
  /* Links in the tables and the list are tap targets of their own, not words in a sentence. */
  td a,
  dt a {
    display: inline-flex;
    align-items: center;
    min-height: var(--target-min);
  }

  .guide {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 840px;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: var(--s-1) var(--s-2) var(--s-1) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  th {
    color: var(--muted);
    font-size: var(--size-s);
    font-weight: var(--weight-strong);
  }

  td:first-child {
    font-weight: var(--weight-strong);
    min-width: 12ch;
  }

  td:nth-child(2) {
    white-space: nowrap;
  }

  .areas {
    margin: 0;
    display: flex;
    flex-direction: column;
    border-top: var(--hairline) solid var(--line);
  }

  .areas div {
    display: grid;
    grid-template-columns: 12ch minmax(0, 1fr);
    gap: var(--s-2);
    padding: var(--s-1) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  .areas dt {
    font-weight: var(--weight-strong);
  }

  .areas dd {
    margin: 0;
  }

  ul {
    margin: 0;
    padding-left: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    max-width: var(--reading);
  }

  .small {
    font-size: var(--size-s);
  }

  @media (max-width: 600px) {
    .areas div {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }

    td:nth-child(2) {
      white-space: normal;
    }
  }
</style>
