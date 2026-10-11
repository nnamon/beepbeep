<script lang="ts">
  // Send prompted text. After the over: what a listener received comes first,
  // then what you meant, one note, and your rhythm beside the standard.
  import { onDestroy } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import TokenText, { type Tok } from '../../ui/TokenText.svelte';
  import RhythmView, { type RhythmRow } from '../../ui/RhythmView.svelte';
  import FistPanel from '../../ui/FistPanel.svelte';
  import InputHelp from '../../ui/InputHelp.svelte';
  import Inspect from '../../ui/Inspect.svelte';
  import { LiveDecoder } from '../../lib/audio/live';
  import { engine } from '../../lib/audio/engine';
  import { settings, strict } from '../../lib/state/settings.svelte';
  import { signal, touchKeyArea, startMic } from '../../lib/state/signal.svelte';
  import { currentLevel, keepSend, playMarks, recordSend, saveSession, sendInput } from '../../lib/train/session';
  import { href } from '../../lib/state/router.svelte';
  import { items, stationLine, type Material } from '../../lib/train/generate';
  import { analyseFist, type FistReport } from '../../lib/train/fist';
  import { compareCopy, describeIssue, oneNote, spacingIssues, type SendIssue } from '../../lib/train/scoring';
  import { buildSchedule } from '../../lib/morse/schedule';
  import { textTokens, align } from '../../lib/util/text';
  import { mulberry32, randomSeed } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';
  import type { DecodedChar } from '../../lib/decoder/decoder';

  // The touch key pad stays in place while this screen is open.
  $effect(() => touchKeyArea());

  type Stage = 'ready' | 'sending' | 'review';

  let material = $state<Material | 'station'>('words');
  let stage = $state<Stage>('ready');
  let prompt = $state('');
  let liveTokens = $state<Tok[]>([]);
  let received = $state('');
  let receivedTokens = $state<Tok[]>([]);
  let issues = $state<SendIssue[]>([]);
  let report = $state<FistReport | null>(null);
  let note = $state('');
  let rhythm = $state<RhythmRow[]>([]);
  let liveRows = $state<RhythmRow[]>([]);
  let inspecting = $state<{ start: number; end: number }[] | null>(null);
  let n = $state(0);
  let correctTotal = 0;
  let tokenTotal = 0;
  let lastFist: FistReport | null = null;
  let lastKey = 0;
  let live: LiveDecoder | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let chars: DecodedChar[] = [];
  const rng = mulberry32(randomSeed());
  const startedAt = Date.now();

  function nextPrompt() {
    const own = material === 'station' ? stationLine(rng, settings.you) : null;
    if (own) {
      prompt = own;
      return;
    }
    const known = new Set(currentLevel().known);
    const useKnown = material === 'characters' || material === 'groups' ? known : known.size >= 26 ? null : known;
    const kind = material === 'characters' ? 'groups' : material === 'station' ? 'phrases' : material;
    const list = items(rng, kind, useKnown, kind === 'groups' ? 3 : 1);
    prompt = list.length ? list.join(' ') : items(rng, 'groups', known, 3).join(' ');
  }

  async function begin() {
    if (settings.input === 'mic' && !signal.micOn) {
      if (!(await startMic())) return;
    }
    nextPrompt();
    liveTokens = [];
    liveRows = [];
    inspecting = null;
    stage = 'sending';
    live?.stop();
    live = new LiveDecoder({
      source: sendInput(),
      charWpm: settings.sendWpm,
      pitch: settings.pitch,
      onOutput: () => {
        // Re-decoded with what has been learned so far, so early letters settle.
        const n = ++liveReq;
        void live?.settled().then((o) => {
          if (n === liveReq && stage === 'sending') liveTokens = o.map((x) => (x.kind === 'space' ? { t: ' ' } : { t: x.char.token ?? '⁇', state: x.char.token ? 'ok' : 'unknown' }));
        });
      },
      onKey: (down) => {
        lastKey = performance.now();
        signal.wpm = live?.decoder.wpm ?? 0;
        if (!down && live) {
          const r = live.recentRhythm(30);
          liveRows = r.standard.length
            ? [{ label: 'yours', marks: r.yours }, { label: 'standard', marks: r.standard, style: 'outline' }]
            : [{ label: 'yours', marks: r.yours }];
        }
      },
    });
    await live.start();
    lastKey = 0;
    void keepAwake(true);
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (stage === 'sending' && lastKey && liveTokens.length && performance.now() - lastKey > settings.overTimeout * 1000) finish();
    }, 200);
  }

  let liveReq = 0;
  let finishing = false;

  async function finish() {
    if (!live || stage !== 'sending' || finishing) return;
    finishing = true;
    live.flush();
    await live.settle();
    finishing = false;
    if (!live || stage !== 'sending') return;
    live.stop();
    chars = live.chars;
    received = live.text;
    const r = compareCopy(prompt, received);
    correctTotal += r.correct;
    tokenTotal += r.total;
    issues = spacingIssues(prompt, received);
    report = analyseFist(live.outputs);
    lastFist = report ?? lastFist;
    note = oneNote(report, issues, settings.sendTolerance);
    void recordSend(prompt, received, issues, chars);
    void keepSend(received, live.marks);
    receivedTokens = markReceived(prompt, received);
    rhythm = buildRhythm();
    n++;
    stage = 'review';
  }

  function markReceived(want: string, got: string): Tok[] {
    const unknownChars = chars.filter((c) => !c.token);
    const ops = align(textTokens(want), textTokens(got));
    const out: Tok[] = [];
    for (const o of ops) {
      if (o.op === 'del') continue;
      if (o.got === '\u2047') {
        const c = unknownChars.shift();
        const m = c ? c.marks.map((x) => ({ start: x.start, end: x.end })) : [];
        out.push({ t: o.got, state: 'unknown', onclick: () => (inspecting = m) });
      } else out.push({ t: o.got, state: o.op === 'match' ? 'ok' : 'miss' });
    }
    return out;
  }

  function buildRhythm(): RhythmRow[] {
    if (!chars.length || !report) return [];
    // Focus on the first spacing issue if there is one, else the last word.
    const words: DecodedChar[][] = [];
    let cur: DecodedChar[] = [];
    for (const o of live!.outputs) {
      if (o.kind === 'space') {
        if (cur.length) words.push(cur);
        cur = [];
      } else cur.push(o.char);
    }
    if (cur.length) words.push(cur);
    const merged = issues.find((i) => i.kind === 'merged-words');
    let pick = words[words.length - 1];
    if (merged) {
      let count = 0;
      for (const w of words) {
        const len = w.length;
        if (merged.at >= count && merged.at <= count + len) {
          pick = w;
          break;
        }
        count += len + 1;
      }
    }
    const marks = pick.flatMap((c) => c.marks.map((m) => ({ start: m.start, end: m.end })));
    const text = pick.map((c) => c.token ?? '').join('');
    const intendedWord = textTokens(prompt).join('').split(' ').find((w) => w && text.startsWith(w.slice(0, 2))) ?? text;
    const std = buildSchedule(merged ? prompt.split(' ').slice(0, 2).join(' ') : intendedWord, { charWpm: report.wpm, leadIn: 0, tail: 0 });
    return [
      { label: 'yours', marks },
      { label: 'standard', marks: std.marks.slice(0, Math.max(marks.length, 1) + 2), style: 'outline' },
    ];
  }

  async function replayMine() {
    const marks = chars.flatMap((c) => c.marks.map((m) => ({ start: m.start, end: m.end })));
    if (marks.length) await playMarks(marks);
  }

  async function hearStandard() {
    await engine.playText(prompt, { charWpm: Math.round(report?.wpm ?? settings.sendWpm), pitch: settings.pitch });
  }

  function end() {
    live?.stop();
    if (timer) clearInterval(timer);
    void keepAwake(false);
    if (n) {
      void saveSession({
        mode: 'send',
        seconds: Math.round((Date.now() - startedAt) / 1000),
        sending: true,
        items: n,
        accuracy: tokenTotal ? correctTotal / tokenTotal : null,
        wpm: settings.sendWpm,
        sentWpm: lastFist?.wpm,
        fist: lastFist,
      });
    }
  }

  onDestroy(end);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (stage === 'sending') finish();
      else void begin();
    } else if (stage === 'review' && (e.key === 'r' || e.key === 'R')) void replayMine();
    else if (stage === 'review' && (e.key === 's' || e.key === 'S')) void hearStandard();
  }
</script>

<svelte:window onkeydown={onKey} />

<DrillFrame
  title="Send drill"
  eyebrow={currentLevel().name}
  count={n ? `${n} sent` : ''}
>
  {#if stage === 'ready'}
    <div class="intro">
      <Segmented
        label="Material"
        bind:value={material}
        options={[
          { value: 'characters', label: 'Characters' },
          { value: 'words', label: 'Words' },
          { value: 'callsigns', label: 'Callsigns' },
          { value: 'phrases', label: 'Phrases' },
          { value: 'station', label: 'My station' },
        ]}
      />
      {#if material === 'station' && !settings.you.call.trim()}
        <p class="muted">Set your callsign in <a href={href('settings')}>Settings</a>, Your station. Until then this sends practice phrases.</p>
      {/if}
      <p class="muted">Send the text shown. Press Done or pause {settings.overTimeout} s to end the over.</p>
      <InputHelp />
    </div>
  {:else if stage === 'sending'}
    <div class="block">
      <span class="label">Send</span>
      <TokenText tokens={textTokens(prompt).map((t) => ({ t }))} size="xl" />
    </div>
    {#if !strict()}
      <div class="block live" aria-live="polite">
        <span class="label">Decoded so far</span>
        {#if liveTokens.length}<TokenText tokens={liveTokens} size="l" />{:else}<p class="muted">Nothing yet.</p>{/if}
      </div>
      {#if liveRows.length && liveRows[0].marks.length}<RhythmView rows={liveRows} />{/if}
    {/if}
  {:else}
    <div class="block">
      <span class="label">Received</span>
      {#if receivedTokens.length}<TokenText tokens={receivedTokens} size="xl" />{:else}<p class="muted">Nothing decoded.</p>{/if}
      {#each issues as i (i.at + i.kind)}<p class="issue muted">{describeIssue(i)}</p>{/each}
    </div>
    <div class="block">
      <span class="label">Intended</span>
      <TokenText tokens={textTokens(prompt).map((t) => ({ t }))} size="m" />
    </div>
    {#if inspecting}<Inspect marks={inspecting} onclose={() => (inspecting = null)} />{/if}
    {#if rhythm.length}
      <div class="block">
        <span class="label">Rhythm</span>
        <RhythmView rows={rhythm} />
      </div>
    {/if}
  {/if}

  {#snippet side()}
    <FistPanel {report} {note} />
  {/snippet}

  {#snippet footer()}
    {#if stage === 'ready'}
      <Button kind="primary" onclick={begin} hint="Enter">Start</Button>
    {:else if stage === 'sending'}
      <Button kind="primary" onclick={finish} hint="Enter">Done</Button>
    {:else}
      <Button kind="primary" onclick={begin} hint="Enter">Next</Button>
      <Button onclick={replayMine} hint="R">Replay mine</Button>
      <Button onclick={hearStandard} hint="S">Play standard</Button>
    {/if}
  {/snippet}
</DrillFrame>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    align-items: flex-start;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .live {
    padding-top: var(--s-2);
    border-top: var(--hairline) solid var(--line);
  }

  .issue {
    font-size: var(--size-s);
  }
</style>
