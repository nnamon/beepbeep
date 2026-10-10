<script lang="ts">
  // How the app is laid out and where to start, by situation.
  import { onMount } from 'svelte';
  import { href } from '../lib/state/router.svelte';
  import { settings } from '../lib/state/settings.svelte';

  onMount(() => {
    settings.guideSeen = true;
  });

  const START = [
    { when: 'No key with you', go: 'Pocket', to: ['pocket'], what: 'Learn and quiz by ear. Answers go on the on-screen keyboard.' },
    { when: 'No key, but you want to send', go: 'Touch key', to: ['setup'], what: 'Set Input to Touch key. A pad appears at the bottom of the screen while a drill listens.' },
    { when: 'Key, rig or CW toy nearby', go: 'Setup', to: ['setup'], what: 'Start the mic and send V V V to calibrate. Then Practice, Send.' },
    { when: 'At a computer, no key', go: 'Setup', to: ['setup'], what: 'Keyboard straight key (hold Space) or paddles ([ and ], or Z and X).' },
    { when: 'Ready for contacts', go: 'QSO', to: ['qso'], what: 'Pick a format; a simulated station answers your overs.' },
  ];

  const AREAS = [
    { name: 'Practice', to: ['practice'], what: 'Your course (Koch or LICW) and lesson, the session plan, and every drill: sending drills on the left, receive drills on the right.' },
    { name: 'Pocket', to: ['pocket'], what: 'Phone rounds by ear: characters, chunks, words, callsigns, phrases, or your own set.' },
    { name: 'QSO', to: ['qso'], what: 'A simulated station: ragchew, LICW, SKCC, SST, POTA, SOTA, contest or pileup.' },
    { name: 'Progress', to: ['progress'], what: 'Speeds over time, accuracy by character, spacing slips, recent sends, QSO log.' },
    { name: 'Settings', to: ['settings'], what: 'Speeds, pitch, spoken answers, band conditions, input, export and import.' },
    { name: 'Signal bar', to: ['setup'], what: 'Top right, or under the header on a phone. Shows the input, tone and key light. Select it to open Setup.' },
  ];

  const INPUTS = [
    { name: 'Microphone', key: 'Your rig, oscillator or CW toy near the mic', when: 'You have a key and a tone' },
    { name: 'Touch key', key: 'Hold the pad at the bottom of the screen', when: 'Phone or tablet, no key' },
    { name: 'Keyboard straight key', key: 'Hold Space', when: 'At a computer, no key' },
    { name: 'Paddles A or B', key: '[ or Z for dit, ] or X for dah', when: 'At a computer, iambic practice' },
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
      <li>A Copy drill, or a Pocket Characters round, at 90% (Koch) or 80% (LICW) opens the next lesson.</li>
      <li>Koch adds one character per level. LICW adds up to three per lesson, BC1 then BC2.</li>
      <li>LICW strict mode, in Settings, follows the LICW guardrails: no rhythm visuals, answers at the end, straight key only in BC.</li>
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
      <li><span class="mono">Enter</span> starts a drill. <span class="mono">Esc</span> leaves it.</li>
      <li><span class="mono">Alt + ↑</span> and <span class="mono">Alt + ↓</span> change receive speed.</li>
      <li>On a phone or tablet every shortcut has a button.</li>
    </ul>
  </div>
</section>

<style>
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
