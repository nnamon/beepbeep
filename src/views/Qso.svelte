<script module lang="ts">
  import type { BotIdentity, BotTurn, Format, Opener, QsoBot } from '../lib/qso/bot';
  import type { FistReport } from '../lib/train/fist';
  import type { DecoderOutput } from '../lib/decoder/decoder';
  import type { Schedule } from '../lib/morse/schedule';

  export type FieldKey = 'call' | 'rst' | 'name' | 'qth' | 'state' | 'skcc' | 'serial';
  type Line = { from: 'bot' | 'you'; who: string; text: string };
  type Result = { station: BotIdentity; copied: Record<FieldKey, string> };
  /** A station transmission as played: the sound, and the keying the visual cue follows. */
  type Audio = { mix: Float32Array; schedule: Schedule };

  /**
   * A QSO left open when you went to another tab. It waits here, paused, and
   * the QSO screen picks it up when you come back (until the page reloads).
   */
  interface Kept {
    at: number;
    stage: 'paused' | 'copying';
    bot: QsoBot;
    format: Format;
    opener: Opener;
    crowd: number;
    botWpm: number;
    botEff: number;
    transcriptOn: boolean;
    lines: Line[];
    copied: Record<FieldKey, string>;
    results: Result[];
    started: number;
    away: number;
    lastAudio: Audio | null;
    lastTurns: BotTurn[];
    interrupted: boolean;
    pastOutputs: DecoderOutput[];
    sendReport: FistReport | null;
    sendNote: string;
  }
  let kept: Kept | null = null;
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Slider from '../ui/Slider.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import TokenText, { type Tok } from '../ui/TokenText.svelte';
  import InputHelp from '../ui/InputHelp.svelte';
  import { engine, type Playback } from '../lib/audio/engine';
  import { LiveDecoder } from '../lib/audio/live';
  import { settings, strict, effectiveMix } from '../lib/state/settings.svelte';
  import { signal, touchKeyArea, startMic } from '../lib/state/signal.svelte';
  import { href } from '../lib/state/router.svelte';
  import { QsoBot as Bot, FORMATS, reportSent } from '../lib/qso/bot';
  import { endsTurn, words } from '../lib/qso/parse';
  import { buildSchedule } from '../lib/morse/schedule';
  import { renderSchedule } from '../lib/morse/render';
  import { conditions, followInput, saveSession, sendInput } from '../lib/train/session';
  import { analyseFist } from '../lib/train/fist';
  import FistPanel from '../ui/FistPanel.svelte';
  import { oneNote } from '../lib/train/scoring';
  import { addQso } from '../lib/state/db';
  import { textTokens } from '../lib/util/text';
  import { randomSeed } from '../lib/util/random';
  import { keepAwake } from '../lib/util/wakelock';

  const FIELDS: Record<Format, FieldKey[]> = {
    ragchew: ['rst', 'name', 'qth'],
    licw: ['rst', 'name', 'qth'],
    skcc: ['rst', 'state', 'name', 'skcc'],
    sst: ['name', 'state'],
    pota: ['rst', 'state'],
    sota: ['rst', 'state'],
    contest: ['serial'],
    pileup: ['call', 'state'],
  };
  const LABEL: Record<FieldKey, string> = { call: 'Callsign', rst: 'Report (RST)', name: 'Name', qth: 'QTH', state: 'Region', skcc: 'SKCC number', serial: 'Serial number' };
  /** What ends your turn without K, in formats with short exchanges (see QsoBot.turnComplete). */
  const NO_K: Partial<Record<Format, string>> = {
    contest: 'your callsign when you answer a CQ; CQ and your callsign when you call; 5NN and your serial number',
    sst: 'your callsign when you answer a CQ; CQ and your callsign when you call; your name and region',
    pota: 'your callsign when you answer a CQ; CQ and your callsign when you call; your report and region',
    sota: 'your callsign when you answer a CQ; CQ and your callsign when you call; your report and region',
    pileup: 'CQ and your callsign; a callsign, or part of one with ?, to pick a station; any reply to the station you are working',
  };

  type Stage = 'setup' | 'running' | 'copying' | 'paused' | 'ended';

  let format = $state<Format>('ragchew');
  let opener = $state<Opener>('bot');
  let botWpm = $state(Math.min(30, settings.sendWpm + 2));
  let botEff = $state(Math.min(30, settings.sendWpm + 2));
  let crowd = $state(3);
  let transcriptOn = $state(!strict());
  let stage = $state<Stage>('setup');
  let turn = $state<'bot' | 'you'>('you');
  let bot = $state<QsoBot | null>(null);
  let lines = $state<Line[]>([]);
  let overTokens = $state<Tok[]>([]);
  let copied = $state<Record<FieldKey, string>>({ call: '', rst: '', name: '', qth: '', state: '', skcc: '', serial: '' });
  let results = $state<Result[]>([]);
  let elapsed = $state(0);
  let sendNote = $state('');
  let sendReport = $state.raw<FistReport | null>(null);
  let received = $state<number | null>(null);
  let lastAudio = $state.raw<Audio | null>(null);
  /** Their transmission was cut short when you left: it plays again when you carry on. */
  let interrupted = $state(false);

  let live: LiveDecoder | null = null;
  let watch: ReturnType<typeof setInterval> | null = null;
  let onBotKey: (() => void) | null = null;
  let playing: Playback | null = null;
  let lastTurns: BotTurn[] = [];
  let pastOutputs: DecoderOutput[] = [];
  let overReq = 0;
  let lastKey = 0;
  let started = 0;
  /** Time spent away from the screen while paused, ms. */
  let away = 0;
  let pausedAt = 0;
  let starting = false;
  /** The screen was left: async work that is still running stops. */
  let gone = false;
  /**
   * What you have sent so far ends your turn after a pause: 'end' after an
   * ending prosign, 'exchange' after a whole exchange that needs no K.
   * `armedKey` is the key event it was armed after; any later key cancels it.
   */
  let armed: 'end' | 'exchange' | null = null;
  let armedKey = 0;

  const fields = $derived(FIELDS[format]);

  // Coming back to a QSO you left: it waits, paused, where you were.
  {
    const k = kept;
    kept = null;
    if (k && Date.now() - k.at < 2 * 3600_000) {
      format = k.format;
      opener = k.opener;
      crowd = k.crowd;
      botWpm = k.botWpm;
      botEff = k.botEff;
      transcriptOn = k.transcriptOn;
      started = k.started;
      away = k.away;
      lastAudio = k.lastAudio;
      lastTurns = k.lastTurns;
      interrupted = k.interrupted;
      pastOutputs = k.pastOutputs;
      sendReport = k.sendReport;
      sendNote = k.sendNote;
      bot = k.bot;
      lines = k.lines;
      copied = k.copied;
      results = k.results;
      pausedAt = k.at;
      stage = k.stage;
      turn = 'you';
      elapsed = Math.round((k.at - k.started - k.away) / 1000);
    }
  }

  // The touch key pad stays in place from the start of a QSO to its log.
  $effect(() => {
    if (stage !== 'setup') return touchKeyArea();
  });
  // Start QSO sits at the bottom of a long page: the running QSO opens at its top, with your turn in view.
  let shownStage: Stage | null = null;
  $effect(() => {
    const s = stage;
    if ((shownStage === 'setup' && s === 'running') || (shownStage === 'ended' && s === 'setup')) window.scrollTo(0, 0);
    shownStage = s;
  });
  // Switching input while sending (Use the touch key) moves the decoder over at once.
  $effect(() => {
    void settings.input;
    void followInput(live);
  });

  const toTokens = (outs: DecoderOutput[]): Tok[] =>
    outs.map((x) => (x.kind === 'space' ? { t: ' ' } : { t: x.char.token ?? '⁇', state: x.char.token ? 'ok' : 'unknown' }));

  async function start() {
    if (starting) return;
    starting = true;
    try {
      if (settings.input === 'mic' && !signal.micOn && !(await startMic())) return;
      await engine.ensure();
      if (gone) return;
      bot = new Bot({
        format,
        opener: format === 'pileup' ? 'you' : opener,
        you: { ...settings.you },
        mix: effectiveMix(),
        wpm: format === 'sst' ? Math.min(botWpm, 20) : botWpm,
        seed: randomSeed(),
        crowd,
      });
      lines = [];
      results = [];
      clearCopied();
      turn = bot.opener === 'bot' ? 'bot' : 'you';
      stage = 'running';
      started = Date.now();
      away = 0;
      elapsed = 0;
      sendNote = '';
      sendReport = null;
      received = null;
      pastOutputs = [];
      interrupted = false;
      void keepAwake(true);
      await listen();
      if (gone) return;
      const opening = bot.start();
      if (opening.length) await botSays(opening);
      else yourTurn();
    } finally {
      starting = false;
    }
  }

  /** Starts decoding your sending, and the clock that ends your turn. */
  async function listen() {
    const l = new LiveDecoder({
      source: sendInput(),
      charWpm: settings.sendWpm,
      pitch: settings.pitch,
      onOutput: (o) => {
        if (turn !== 'you' || stage !== 'running' || live !== l) return;
        // Re-decoded with what has been learned so far, so early letters settle.
        const n = ++overReq;
        const keyAt = lastKey;
        void l.settled().then((outs) => {
          if (n !== overReq || turn !== 'you' || gone) return;
          overTokens = toTokens(outs);
          // Only a finished word can end your turn: "K" may be the start of K1ABC.
          if (o.kind === 'space') {
            const text = overText();
            armed = endsTurn(text) ? 'end' : bot?.turnComplete(text) ? 'exchange' : null;
            armedKey = keyAt;
          }
        });
      },
      onKey: (down) => {
        lastKey = performance.now();
        if (down && turn === 'bot') onBotKey?.();
      },
    });
    live = l;
    await l.start();
    if (gone || live !== l) {
      l.stop();
      return;
    }
    if (watch) clearInterval(watch);
    watch = setInterval(tick, 200);
  }

  /**
   * About two word spaces at your speed after an ending prosign, three after a
   * whole exchange; never longer than the silence that always ends your turn.
   */
  function pauseMs(kind: 'end' | 'exchange'): number {
    const unit = 1200 / Math.max(5, live?.decoder.wpm || settings.sendWpm);
    const ms = kind === 'end' ? Math.max(1000, 14 * unit) : Math.max(1500, 21 * unit);
    return Math.min(ms, settings.overTimeout * 1000);
  }

  function tick() {
    elapsed = Math.round((Date.now() - started - away) / 1000);
    if (stage !== 'running' || turn !== 'you' || !overTokens.length || !lastKey) return;
    const quiet = performance.now() - lastKey;
    if (armed && armedKey === lastKey && quiet > pauseMs(armed)) void endOver();
    else if (quiet > settings.overTimeout * 1000) void endOver();
  }

  function overText(): string {
    return overTokens.map((t) => t.t).join('').trim();
  }

  function yourTurn() {
    if (gone) return;
    turn = 'you';
    overTokens = [];
    armed = null;
    lastKey = 0;
    live?.resetOver();
  }

  let ending = false;
  async function endOver() {
    if (ending || stage !== 'running' || turn !== 'you' || !bot || !live) return;
    ending = true;
    try {
      armed = null;
      live.flush();
      overReq++;
      overTokens = toTokens(await live.settle());
      if (gone || stage !== 'running') return;
      const text = overText();
      if (!text) return yourTurn();
      lines.push({ from: 'you', who: settings.you.call || 'You', text });
      const before = bot.completed.length;
      const replies = bot.hear(text);
      logCompleted(before);
      if (replies.length) await botSays(replies);
      else if (bot.done) await contactOver();
      else yourTurn();
    } finally {
      ending = false;
    }
  }

  /** In a pileup each station's copy is kept as you finish with it; the boxes clear for the next. */
  function logCompleted(before: number) {
    if (!bot || format !== 'pileup') return;
    for (const s of bot.completed.slice(before)) {
      results.push({ station: s, copied: { ...copied } });
      clearCopied();
    }
  }

  /**
   * The stations' keying, mixed, and their marks for the visual cue (all of
   * them in a pileup). The marks are the keying itself, before band noise.
   */
  function render(turns: BotTurn[], sampleRate: number): Audio {
    const schedules = turns.map((t) =>
      buildSchedule(t.text, {
        charWpm: t.wpm,
        effectiveWpm: Math.min(t.wpm, botEff + (t.wpm - botWpm)),
        fist: settings.humanFist ? { jitter: 0.06, seed: randomSeed() } : undefined,
        leadIn: 0.2 + (turns.length > 1 ? Math.random() * 0.9 : 0),
      }),
    );
    const rendered = schedules.map((s, i) =>
      renderSchedule(s, {
        sampleRate,
        pitch: settings.pitch + turns[i].pitchOffset,
        amplitude: turns.length > 1 ? 0.3 : 0.45,
        ...(i === 0 ? conditions() : {}),
        seed: randomSeed(),
      }),
    );
    const len = Math.max(...rendered.map((r) => r.length));
    const mix = new Float32Array(len);
    for (const r of rendered) for (let k = 0; k < r.length; k++) mix[k] += r[k];
    const schedule = { ...schedules[0], marks: schedules.flatMap((s) => s.marks).sort((a, b) => a.start - b.start) };
    return { mix, schedule };
  }

  /** The station sends (or sends `again` once more), then it is your turn, or the contact is over. */
  async function botSays(turns: BotTurn[], again?: Audio) {
    turn = 'bot';
    armed = null;
    const ctx = await engine.ensure();
    if (gone || stage !== 'running') return;
    const audio = again ?? render(turns, ctx.sampleRate);
    lastAudio = audio;
    lastTurns = turns;
    const pb = await engine.play(audio.mix, { schedule: audio.schedule });
    if (gone || stage !== 'running') return pb.stop();
    playing = pb;
    interrupted = true;
    // Break-in: keying stops the station and starts your turn. Keys typed into
    // the copy boxes don't key (the decoder ignores text fields). With the mic
    // this needs headphones, since otherwise the mic is muted while the station sends.
    if (settings.input !== 'mic' || settings.headphones) onBotKey = () => pb.stop();
    await pb.done;
    onBotKey = null;
    playing = null;
    if (gone || stage !== 'running') return;
    interrupted = false;
    if (transcriptOn) for (const t of turns) lines.push({ from: 'bot', who: t.who, text: t.text });
    if (bot?.done) return contactOver();
    yourTurn();
  }

  async function replayLast() {
    if (!lastAudio || (stage === 'running' && turn !== 'you')) return;
    playing?.stop();
    const pb = await engine.play(lastAudio.mix, { schedule: lastAudio.schedule });
    if (gone) return pb.stop();
    playing = pb;
  }

  function clearCopied() {
    copied = { call: '', rst: '', name: '', qth: '', state: '', skcc: '', serial: '' };
  }

  /** Stops decoding your sending and measures your fist over the whole QSO. */
  async function stopListening() {
    if (watch) clearInterval(watch);
    watch = null;
    const l = live;
    live = null;
    if (!l) return;
    l.flush();
    await l.settle();
    l.stop();
    const rep = analyseFist([...pastOutputs, ...l.outputs]);
    sendReport = rep;
    sendNote = rep ? oneNote(rep, [], settings.sendTolerance) : '';
  }

  /** Values as they are sent: 5NN is 599, 042 is 42. */
  function asSent(text: string): string {
    return ` ${words(text)
      .map((w) => (/^[1-5][1-9N][1-9N]$/.test(w) ? w.replace(/N/g, '9') : /^\d+$/.test(w) ? String(Number(w)) : w))
      .join(' ')} `;
  }

  /**
   * The contact is complete. When their last transmission carried something
   * you copy, or a box is still empty, you get time to finish typing and press
   * Score; otherwise it is scored at once.
   */
  async function contactOver() {
    if (stage !== 'running' || !bot) return;
    await stopListening();
    if (gone || stage !== 'running') return;
    const s = bot.active ?? bot.completed[0];
    if (format !== 'pileup' && s) {
      const last = asSent(lastTurns.map((t) => t.text).join(' '));
      const pending = FIELDS[format].some((k) => !copied[k].trim() || last.includes(` ${truth(s, k).toUpperCase()} `));
      if (pending) {
        stage = 'copying';
        return;
      }
    }
    await finalize();
  }

  /** Scores what you copied, logs the QSO and records the session. */
  async function finalize() {
    if (!bot || (stage !== 'running' && stage !== 'copying' && stage !== 'paused')) return;
    const from = stage;
    stage = 'ended';
    if (from === 'paused') away += Date.now() - pausedAt;
    if (from === 'running') await stopListening();
    void keepAwake(false);
    const b = bot;
    if (format !== 'pileup') {
      const s = b.active ?? b.completed[0];
      results = b.done && s ? [{ station: s, copied: { ...copied } }] : [];
    }
    received = sendScore();
    const seconds = Math.round((Date.now() - started - away) / 1000);
    elapsed = seconds;
    const overs = lines.filter((l) => l.from === 'you').length;
    for (const r of results) {
      await addQso({
        at: Date.now(),
        format,
        opener,
        call: r.station.call,
        name: r.station.name,
        qth: r.station.qth,
        state: r.station.state,
        rstSent: b.copied.rst ?? '',
        rstRcvd: reportSent(format, r.station),
        seconds,
        overs,
        copyScore: score(r.station, r.copied).copy,
        sendScore: received,
        wpm: b.botWpm,
      }).catch(() => undefined);
    }
    // The time counts in Progress, as sending practice.
    if (overs) {
      await saveSession({
        mode: 'qso',
        seconds,
        sending: true,
        items: overs,
        accuracy: results.length ? results.reduce((a, r) => a + score(r.station, r.copied).copy, 0) / results.length : null,
        wpm: b.botWpm,
        sentWpm: sendReport?.wpm,
        fist: sendReport,
      });
    }
  }

  function stop() {
    if (stage === 'running') {
      engine.stopAll();
      void finalize();
    } else if (stage === 'copying' || stage === 'paused') void finalize();
  }

  /** Picks up a QSO you left: their cut-off transmission again, then your turn. */
  async function carryOn() {
    if (stage !== 'paused' || !bot || starting) return;
    starting = true;
    try {
      if (settings.input === 'mic' && !signal.micOn && !(await startMic())) return;
      await engine.ensure();
      if (gone) return;
      away += Date.now() - pausedAt;
      stage = 'running';
      void keepAwake(true);
      await listen();
      if (gone) return;
      if (interrupted && lastAudio) await botSays(lastTurns, lastAudio);
      else yourTurn();
    } finally {
      starting = false;
    }
  }

  function truth(s: BotIdentity, k: FieldKey): string {
    switch (k) {
      case 'call':
        return s.call;
      case 'rst':
        return reportSent(format, s);
      case 'name':
        return s.name;
      case 'qth':
        return s.qth;
      case 'state':
        return s.state;
      case 'skcc':
        return s.skcc;
      case 'serial':
        return String(s.serial);
    }
  }

  /** As the station keyed it: 5NN rather than 599, 042 rather than 42. */
  function asKeyed(s: BotIdentity, k: FieldKey): string {
    if (k === 'rst' && truth(s, k) === '599' && (format === 'pota' || format === 'contest' || format === 'pileup')) return '5NN';
    if (k === 'serial') return truth(s, k).padStart(3, '0');
    return truth(s, k);
  }

  const norm = (k: FieldKey, v: string) => {
    let x = v.trim().toUpperCase().replace(/\s+/g, ' ');
    if (k === 'rst') x = x.replace(/N/g, '9');
    if (k === 'serial') x = String(Number(x.replace(/T/g, '0').replace(/N/g, '9')) || x);
    return x;
  };

  function score(s: BotIdentity, c: Record<FieldKey, string>) {
    const ks = FIELDS[format];
    const ok = ks.filter((k) => norm(k, c[k]) === norm(k, truth(s, k)) || (k === 'qth' && norm(k, c[k]).startsWith(norm(k, truth(s, k)))));
    return { copy: ok.length / ks.length, ok };
  }

  function sendScore(): number {
    if (!bot) return 0;
    const you = settings.you;
    const checks: [string | null, string][] = [];
    if (you.call) checks.push([bot.copied.call, you.call]);
    if (you.name && ['ragchew', 'licw', 'skcc', 'sst'].includes(format)) checks.push([bot.copied.name, you.name]);
    if (you.state && ['skcc', 'sst', 'pota', 'sota'].includes(format)) checks.push([bot.copied.state, you.state]);
    if (you.skcc && format === 'skcc') checks.push([bot.copied.skcc, you.skcc]);
    if (!checks.length) return bot.copied.call ? 1 : 0;
    return checks.filter(([a, b]) => (a ?? '').toUpperCase() === b.toUpperCase()).length / checks.length;
  }

  onDestroy(() => {
    gone = true;
    if (watch) clearInterval(watch);
    watch = null;
    if (live) pastOutputs = [...pastOutputs, ...live.outputs];
    live?.stop();
    live = null;
    engine.stopAll();
    void keepAwake(false);
    // Left mid-QSO: keep it, paused, for when you come back.
    if (bot && (stage === 'running' || stage === 'paused' || stage === 'copying')) {
      kept = {
        at: Date.now(),
        stage: stage === 'copying' ? 'copying' : 'paused',
        bot,
        format,
        opener,
        crowd,
        botWpm,
        botEff,
        transcriptOn,
        lines: $state.snapshot(lines),
        copied: { ...copied },
        results: $state.snapshot(results) as Result[],
        started,
        away: stage === 'paused' ? away + (Date.now() - pausedAt) : away,
        lastAudio,
        lastTurns,
        interrupted: interrupted && stage === 'running',
        pastOutputs,
        sendReport,
        sendNote,
      };
    }
  });

  function onkey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    // Focused buttons, links and lists do their own thing with Enter.
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Enter') {
      if (stage === 'running' && tag !== 'INPUT') {
        e.preventDefault();
        void endOver();
      } else if (stage === 'copying') {
        e.preventDefault();
        void finalize();
      }
    } else if (e.key === 'Escape' && tag !== 'INPUT') stop();
  }

  const toks = (s: string): Tok[] => textTokens(s).map((t) => ({ t }));
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const lasted = (s: number) => (s < 60 ? plural(s, 'second') : `${plural(Math.floor(s / 60), 'minute')} ${plural(s % 60, 'second')}`);
  const listed = (parts: string[]) => (parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
  // The station changes what it has copied as the QSO goes on: read again after each transmission.
  const working = $derived.by(() => {
    void lines.length;
    void turn;
    return bot?.active?.call && bot.copied.call ? bot.active.call : null;
  });
  const formatName = $derived(FORMATS.find((f) => f.id === format)?.name ?? '');

  /** What the station copied from your sending, in a sentence. */
  const heard = $derived.by(() => {
    if (!bot) return '';
    const c = bot.copied;
    const parts = [
      c.call && `your callsign as ${c.call}`,
      c.name && `your name as ${c.name}`,
      c.state && `your region as ${c.state}`,
      c.skcc && `your SKCC number as ${c.skcc}`,
      c.serial && `your serial number as ${c.serial}`,
      c.rst && `your report on them as ${c.rst}`,
    ].filter((x): x is string => !!x);
    const what = parts.length ? `It copied ${listed(parts)}.` : 'It copied nothing from you.';
    return received === null ? what : `${what} That is ${Math.round(received * 100)}% of what it needed from you.`;
  });
</script>

<svelte:window onkeydown={onkey} />

{#if stage === 'setup'}
  <section class="setup">
    <h1>QSO</h1>
    <p class="learn">
      A QSO is a contact between two stations. Here you make one with a simulated station, which answers what it copies
      from your sending. If you are new to contacts, start with <a href={href('qso', 'learn')}>Learn QSOs</a>: guided
      lessons that take a contact apart and check each part.
    </p>
    <div class="grid">
      <div class="col field">
        <h3>Format</h3>
        <div class="formats" role="radiogroup" aria-label="Format">
          {#each FORMATS as f (f.id)}
            <label class:on={format === f.id}>
              <input type="radio" name="format" value={f.id} bind:group={format} />
              <span class="name">{f.name}</span>
              <span class="muted ex">{f.exchange}</span>
            </label>
          {/each}
        </div>
      </div>
      <div class="col">
        {#if format !== 'pileup'}
          <div class="field">
            <h3>Who calls CQ</h3>
            <Segmented label="Who calls CQ" bind:value={opener} options={[{ value: 'bot', label: 'The station' }, { value: 'you', label: 'You' }]} />
          </div>
        {:else}
          <Slider label="Stations calling" bind:value={crowd} min={2} max={4} />
        {/if}
        <Slider label="Station character speed" bind:value={botWpm} min={8} max={40} unit="wpm" onchange={() => (botEff = Math.min(botEff, botWpm))} />
        <Slider label="Station overall speed" bind:value={botEff} min={5} max={botWpm} unit="wpm" />
        <p class="muted small">An overall speed below the character speed leaves more space between characters.</p>
        {#if format === 'sst'}<p class="muted small">SST runs at 20 wpm or slower.</p>{/if}
        <Toggle bind:checked={transcriptOn} label="Show transcript" detail="Each transmission shows after it ends." />
        <div class="field">
          <h3>You</h3>
          <div class="you">
            <label><span class="label">Callsign</span><input class="mono" bind:value={settings.you.call} autocapitalize="characters" spellcheck="false" /></label>
            <label><span class="label">Name</span><input class="mono" bind:value={settings.you.name} autocapitalize="characters" spellcheck="false" /></label>
            <label><span class="label">QTH</span><input class="mono" bind:value={settings.you.qth} autocapitalize="characters" spellcheck="false" /></label>
            <label class="wide"><span class="label">Region: state, province or country (optional)</span><input class="mono" bind:value={settings.you.state} autocapitalize="characters" spellcheck="false" placeholder="NSW, ON, JAPAN" /></label>
            {#if format === 'skcc'}<label><span class="label">SKCC member number</span><input class="mono" bind:value={settings.you.skcc} autocapitalize="characters" spellcheck="false" /></label>{/if}
          </div>
          <p class="muted small">
            These are saved for next time. You can also change them in <a href={href('settings')}>Settings</a>, under Your
            station. Leave the region blank if it would repeat your QTH, as in Singapore.
          </p>
        </div>
        <p class="muted small">Band conditions are set in <a href={href('settings')}>Settings</a>.</p>
        <InputHelp />
        <div><Button kind="primary" onclick={start} disabled={signal.starting}>Start QSO</Button></div>
      </div>
    </div>
  </section>
{:else}
  <section class="run">
    <div class="head">
      <h1>QSO · {formatName}</h1>
      <span class="num muted">{mins(elapsed)}</span>
    </div>

    <div class="bar">
      <div class="status" class:you={turn === 'you' && stage === 'running'} role="status" aria-live="polite">
        {#if stage === 'ended' || stage === 'copying'}
          <span>QSO ended</span>
        {:else if stage === 'paused'}
          <span>Paused</span>
        {:else if turn === 'bot'}
          <span>Station sending</span>
        {:else}
          <span class="dot" aria-hidden="true"></span><span>Your turn</span>
        {/if}
      </div>
      <div class="actions">
        {#if stage === 'running'}
          <Button kind="primary" onclick={endOver} disabled={turn !== 'you'} hint="Enter">End my turn</Button>
          <Button onclick={replayLast} disabled={turn !== 'you' || !lastAudio}>Replay last</Button>
          <Button kind="quiet" onclick={stop} hint="Esc">Stop</Button>
        {:else if stage === 'copying'}
          <Button kind="primary" onclick={finalize} hint="Enter">Score</Button>
          <Button onclick={replayLast} disabled={!lastAudio}>Replay last</Button>
        {:else if stage === 'paused'}
          <Button kind="primary" onclick={carryOn} disabled={signal.starting}>Carry on</Button>
          <Button kind="quiet" onclick={stop} hint="Esc">Stop</Button>
        {:else}
          <Button kind="primary" onclick={() => (stage = 'setup')}>New QSO</Button>
          <Button href={href('progress')}>QSO log</Button>
        {/if}
      </div>
    </div>

    {#if stage === 'running' && turn === 'you' && !strict()}
      <div class="over" aria-live="polite">
        <span class="label">You, decoded</span>
        {#if overTokens.length}<TokenText tokens={overTokens} size="l" />{:else}<p class="muted">Nothing yet.</p>{/if}
      </div>
    {:else if stage === 'copying'}
      <p class="note">The contact is complete. Finish copying what they sent, then press Score. Replay last plays their last transmission again.</p>
    {:else if stage === 'paused'}
      <p class="note">
        You left the QSO screen, so this QSO is paused. Carry on picks it up at your turn{interrupted ? ', after their last transmission plays again' : ''}.
        Stop ends it and shows how you did.
      </p>
    {/if}

    <div class="cols" class:ended={stage === 'ended'}>
      <div class="main">
        {#if stage === 'ended'}
          {#each results as r, k (k)}
            {@const sc = score(r.station, r.copied)}
            <table class="res">
              <caption>{r.station.call}: you copied {Math.round(sc.copy * 100)}%</caption>
              <thead><tr><th>What</th><th>They sent</th><th>You copied</th></tr></thead>
              <tbody>
                {#each fields as f (f)}
                  <tr><td class="muted">{LABEL[f]}</td><td class="mono">{asKeyed(r.station, f)}</td><td class="mono" class:miss={!sc.ok.includes(f)}>{r.copied[f] || 'nothing'}</td></tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p>The contact wasn't finished, so nothing went into the QSO log.</p>
          {/each}
          {#if bot}
            <div class="heard">
              <h3>What the station copied from you</h3>
              <p>{heard}</p>
              <p class="muted">The QSO lasted {lasted(elapsed)}.</p>
            </div>
          {/if}
          {#if sendReport}<div class="fist"><FistPanel report={sendReport} note={sendNote} /></div>{:else if sendNote}<p>{sendNote}</p>{/if}
        {/if}
        {#if stage === 'running'}
          <p class="muted small">
            Your turn ends when you finish with K, KN, BK, AR or SK and then stop keying for about two word spaces. Press
            Enter or End my turn to end it at once. It also ends after {settings.overTimeout} s without keying.
            {#if NO_K[format]}In this format K is optional: your turn also ends when you stop for about three word spaces
              after any of these: {NO_K[format]}.{/if}
          </p>
        {/if}
        {#if transcriptOn || stage === 'ended'}
          <div class="log">
            {#each lines as l, k (k)}
              <div class="line" class:mine={l.from === 'you'}>
                <span class="who mono muted">{l.from === 'you' ? 'You' : l.who}</span>
                <TokenText tokens={toks(l.text)} size="m" />
              </div>
            {/each}
          </div>
        {/if}
      </div>
      {#if stage !== 'ended'}
        <aside class="side">
          <h3>{working ? `Copy what ${working} sends` : format === 'pileup' ? 'Copy the station you work' : 'Copy what they send'}</h3>
          <div class="copy">
            {#each fields as f (f)}
              <label><span class="label">{LABEL[f]}</span><input class="mono" bind:value={copied[f]} autocapitalize="characters" autocomplete="off" spellcheck="false" /></label>
            {/each}
          </div>
        </aside>
      {/if}
    </div>
  </section>
{/if}

<style>
  .fist {
    max-width: 360px;
  }

  .setup,
  .run {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .grid,
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-4) var(--s-6);
    align-items: start;
  }

  .cols {
    grid-template-columns: minmax(0, 1fr) 260px;
  }

  .cols.ended {
    grid-template-columns: minmax(0, 1fr);
  }

  .col,
  .main {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .col.field {
    gap: var(--s-1);
  }

  .formats {
    display: flex;
    flex-direction: column;
    border-top: var(--hairline) solid var(--line);
  }

  .formats label {
    display: flex;
    flex-direction: column;
    padding: var(--s-1) var(--s-2);
    border-bottom: var(--hairline) solid var(--line);
    border-left: 2px solid transparent;
    cursor: pointer;
    min-height: var(--target);
  }

  .formats label.on {
    border-left-color: var(--signal);
    background: var(--surface);
  }

  .formats input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }

  .formats label:has(input:focus-visible) {
    outline: 2px solid var(--signal);
    outline-offset: -2px;
  }

  .name {
    font-weight: var(--weight-strong);
  }

  .ex,
  .small {
    font-size: var(--size-s);
  }

  .you,
  .copy {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: var(--s-1) var(--s-2);
    align-items: end;
  }

  .you .wide {
    grid-column: 1 / -1;
  }

  .copy {
    grid-template-columns: 1fr;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  input:not([type='radio']) {
    min-height: 44px;
    padding: 0 var(--s-1);
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--size-field);
    text-transform: uppercase;
    width: 100%;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) var(--s-3);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: var(--target);
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    font-weight: var(--weight-strong);
  }

  .status.you {
    border: 1.5px solid var(--signal);
    background: var(--signal-soft);
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--signal);
  }

  .over {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    padding-bottom: var(--s-2);
    border-bottom: var(--hairline) solid var(--line);
  }

  .note {
    max-width: var(--reading);
    border-left: 2px solid var(--signal);
    padding-left: var(--s-1);
  }

  .log {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .line {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: var(--s-2);
    align-items: baseline;
  }

  .who {
    font-size: var(--size-s);
  }

  .side {
    border-left: var(--hairline) solid var(--line);
    padding-left: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .res {
    border-collapse: collapse;
    width: 100%;
    max-width: 480px;
  }

  .res caption {
    text-align: left;
    font-weight: var(--weight-strong);
    padding-bottom: var(--s-1);
  }

  .res th {
    text-align: left;
    font-size: var(--size-s);
    color: var(--muted);
    font-weight: var(--weight-strong);
  }

  .res td,
  .res th {
    padding: var(--s-half) var(--s-2) var(--s-half) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  .miss {
    color: var(--muted);
    text-decoration: underline dotted;
  }

  .heard {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    max-width: var(--reading);
  }

  .actions {
    display: flex;
    gap: var(--s-1);
    flex-wrap: wrap;
  }

  @media (max-width: 860px) {
    .grid,
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      border-left: 0;
      padding-left: 0;
      order: -1;
    }

    .line {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
