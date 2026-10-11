<script lang="ts">
  import { onDestroy } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Slider from '../ui/Slider.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import TokenText, { type Tok } from '../ui/TokenText.svelte';
  import InputHelp from '../ui/InputHelp.svelte';
  import { engine } from '../lib/audio/engine';
  import { LiveDecoder } from '../lib/audio/live';
  import { settings, strict, effectiveMix } from '../lib/state/settings.svelte';
  import { signal, touchKeyArea, startMic } from '../lib/state/signal.svelte';
  import { href } from '../lib/state/router.svelte';
  import { QsoBot, FORMATS, type BotIdentity, type BotTurn, type Format, type Opener } from '../lib/qso/bot';
  import { parse } from '../lib/qso/parse';
  import { buildSchedule } from '../lib/morse/schedule';
  import { renderSchedule } from '../lib/morse/render';
  import { conditions, followInput, sendInput } from '../lib/train/session';
  import { analyseFist, type FistReport } from '../lib/train/fist';
  import FistPanel from '../ui/FistPanel.svelte';
  import { oneNote } from '../lib/train/scoring';
  import { addQso } from '../lib/state/db';
  import { textTokens } from '../lib/util/text';
  import { randomSeed } from '../lib/util/random';
  import { keepAwake } from '../lib/util/wakelock';

  // The touch key pad stays in place from the start of a QSO to its log.
  $effect(() => {
    if (stage !== 'setup') return touchKeyArea();
  });
  // Switching input while sending (Use the touch key) moves the decoder over at once.
  $effect(() => {
    void settings.input;
    void followInput(live);
  });

  type FieldKey = 'call' | 'rst' | 'name' | 'qth' | 'state' | 'skcc' | 'serial';
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
  const LABEL: Record<FieldKey, string> = { call: 'Call', rst: 'RST', name: 'Name', qth: 'QTH', state: 'State', skcc: 'SKCC nr', serial: 'Serial' };

  let format = $state<Format>('ragchew');
  let opener = $state<Opener>('bot');
  let botWpm = $state(Math.min(30, settings.sendWpm + 2));
  let botEff = $state(Math.min(30, settings.sendWpm + 2));
  let sendNote = $state('');
  let onBotKey: (() => void) | null = null;
  let overReq = 0;
  let sendReport = $state<FistReport | null>(null);
  let received = $state<number | null>(null);
  let crowd = $state(3);
  let transcriptOn = $state(!strict());
  let stage = $state<'setup' | 'running' | 'ended'>('setup');
  let turn = $state<'bot' | 'you'>('you');
  let bot = $state<QsoBot | null>(null);
  let lines = $state<{ from: 'bot' | 'you'; who: string; text: string }[]>([]);
  let overTokens = $state<Tok[]>([]);
  let copied = $state<Record<FieldKey, string>>({ call: '', rst: '', name: '', qth: '', state: '', skcc: '', serial: '' });
  let results = $state<{ station: BotIdentity; copied: Record<FieldKey, string> }[]>([]);
  let elapsed = $state(0);
  let live: LiveDecoder | null = null;
  let lastKey = 0;
  let overStart = 0;
  let watch: ReturnType<typeof setInterval> | null = null;
  let lastAudio = $state.raw<Float32Array | null>(null);
  let started = 0;

  const fields = $derived(FIELDS[format]);

  async function start() {
    if (settings.input === 'mic' && !signal.micOn) {
      if (!(await startMic())) return;
    }
    await engine.ensure();
    bot = new QsoBot({
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
    stage = 'running';
    started = Date.now();
    void keepAwake(true);
    sendNote = '';
    sendReport = null;
    received = null;
    live = new LiveDecoder({
      source: sendInput(),
      charWpm: settings.sendWpm,
      pitch: settings.pitch,
      onOutput: (o) => {
        if (turn !== 'you' || !live) return;
        // Re-decoded with what has been learned so far, so early letters settle.
        const n = ++overReq;
        void live.settled().then((outs) => {
          if (n !== overReq || turn !== 'you') return;
          overTokens = outs.map((x) => (x.kind === 'space' ? { t: ' ' } : { t: x.char.token ?? '⁇', state: x.char.token ? 'ok' : 'unknown' }));
          // Only a finished word can end the over: "K" may be the start of K1ABC.
          if (o.kind === 'space') {
            const p = parse(overText());
            if (p.handover || p.signoff) setTimeout(() => endOver(), 300);
          }
        });
      },
      onKey: (down) => {
        lastKey = performance.now();
        if (down && turn === 'bot') onBotKey?.();
      },
    });
    await live.start();
    watch = setInterval(() => {
      elapsed = Math.round((Date.now() - started) / 1000);
      if (turn === 'you' && overTokens.length && lastKey && performance.now() - lastKey > settings.overTimeout * 1000) endOver();
    }, 200);
    const opening = bot.start();
    if (opening.length) await botSays(opening);
    else yourTurn();
  }

  function overText(): string {
    return overTokens.map((t) => t.t).join('').trim();
  }

  function yourTurn() {
    turn = 'you';
    overTokens = [];
    overStart = performance.now();
    lastKey = 0;
    live?.resetOver();
  }

  let ending = false;
  async function endOver() {
    if (ending || turn !== 'you' || !bot || !live) return;
    ending = true;
    live.flush();
    overReq++;
    overTokens = (await live.settle()).map((x) => (x.kind === 'space' ? { t: ' ' } : { t: x.char.token ?? '⁇', state: x.char.token ? 'ok' : 'unknown' }));
    const text = overText();
    if (text) {
      lines.push({ from: 'you', who: settings.you.call || 'You', text });
      const before = bot.completed.length;
      const replies = bot.hear(text);
      logCompleted(before);
      if (replies.length) await botSays(replies);
      else yourTurn();
    } else yourTurn();
    ending = false;
    if (bot.done) finish();
  }

  function logCompleted(before: number) {
    if (!bot) return;
    for (const s of bot.completed.slice(before)) {
      results.push({ station: s, copied: { ...copied } });
      if (format === 'pileup') clearCopied();
    }
  }

  async function botSays(turns: BotTurn[]) {
    turn = 'bot';
    const ctx = await engine.ensure();
    const rendered = turns.map((t, i) => {
      const s = buildSchedule(t.text, {
        charWpm: t.wpm,
        effectiveWpm: Math.min(t.wpm, botEff + (t.wpm - botWpm)),
        fist: settings.humanFist ? { jitter: 0.06, seed: randomSeed() } : undefined,
        leadIn: 0.2 + (turns.length > 1 ? Math.random() * 0.9 : 0),
      });
      const cond = i === 0 ? conditions() : {};
      return renderSchedule(s, {
        sampleRate: ctx.sampleRate,
        pitch: settings.pitch + t.pitchOffset,
        amplitude: turns.length > 1 ? 0.3 : 0.45,
        ...cond,
        seed: randomSeed(),
      });
    });
    const len = Math.max(...rendered.map((r) => r.length));
    const mix = new Float32Array(len);
    for (const r of rendered) for (let k = 0; k < r.length; k++) mix[k] += r[k];
    lastAudio = mix;
    const pb = await engine.play(mix);
    // Break-in: keying stops the station and starts your over. With the mic this
    // needs headphones, since otherwise the mic is muted while the station sends.
    const breakIn = (e: KeyboardEvent) => {
      if (['Space', 'BracketLeft', 'BracketRight', 'KeyZ', 'KeyX', 'Comma', 'Period'].includes(e.code)) pb.stop();
    };
    if (settings.input !== 'mic') window.addEventListener('keydown', breakIn, true);
    if (settings.input === 'touch' || (settings.input === 'mic' && settings.headphones)) onBotKey = () => pb.stop();
    await pb.done;
    onBotKey = null;
    window.removeEventListener('keydown', breakIn, true);
    if (transcriptOn) for (const t of turns) lines.push({ from: 'bot', who: t.who, text: t.text });
    if (bot?.done) return finish();
    yourTurn();
  }

  async function replayLast() {
    if (lastAudio && turn === 'you') await engine.play(lastAudio);
  }

  function clearCopied() {
    copied = { call: '', rst: '', name: '', qth: '', state: '', skcc: '', serial: '' };
  }

  async function finish() {
    if (stage !== 'running' || !bot) return;
    stage = 'ended';
    if (live) {
      live.flush();
      await live.settle();
      const rep = analyseFist(live.outputs);
      sendReport = rep;
      sendNote = rep ? oneNote(rep, [], settings.sendTolerance) : '';
    }
    live?.stop();
    if (watch) clearInterval(watch);
    void keepAwake(false);
    if (!results.length && bot.active && bot.done) results.push({ station: bot.active, copied: { ...copied } });
    received = sendScore();
    for (const r of results) {
      const sc = score(r.station, r.copied);
      await addQso({
        at: Date.now(),
        format,
        opener,
        call: r.station.call,
        name: r.station.name,
        qth: r.station.qth,
        state: r.station.state,
        rstSent: bot.copied.rst ?? '',
        rstRcvd: r.station.rst,
        seconds: Math.round((Date.now() - started) / 1000),
        overs: lines.filter((l) => l.from === 'you').length,
        copyScore: sc.copy,
        sendScore: sendScore(),
        wpm: bot.botWpm,
      }).catch(() => undefined);
    }
  }

  function stop() {
    if (stage === 'running') {
      engine.stopAll();
      void finish();
    }
  }

  function truth(s: BotIdentity, k: FieldKey): string {
    switch (k) {
      case 'call':
        return s.call;
      case 'rst':
        return format === 'pota' || format === 'pileup' || format === 'contest' ? '599' : s.rst;
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
    live?.stop();
    if (watch) clearInterval(watch);
    engine.stopAll();
    void keepAwake(false);
  });

  const toks = (s: string): Tok[] => textTokens(s).map((t) => ({ t }));
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const working = $derived(bot?.active?.call && bot.copied.call ? bot.active.call : null);
</script>

<svelte:window onkeydown={(e) => {
  if (stage !== 'running') return;
  const t = e.target as HTMLElement;
  if (t?.tagName === 'INPUT') return;
  if (e.key === 'Enter') { e.preventDefault(); void endOver(); }
  if (e.key === 'Escape') stop();
}} />

{#if stage === 'setup'}
  <section class="setup">
    <h1>QSO</h1>
    <p class="learn">Learn QSOs step by step first: <a href={href('qso', 'learn')}>guided lessons</a> on each part of a contact, checked as you go.</p>
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
            <h3>Calls CQ</h3>
            <Segmented label="Who calls CQ" bind:value={opener} options={[{ value: 'bot', label: 'The station' }, { value: 'you', label: 'You' }]} />
          </div>
        {:else}
          <Slider label="Stations calling" bind:value={crowd} min={2} max={4} />
        {/if}
        <Slider label="Station speed" bind:value={botWpm} min={8} max={40} unit="wpm" onchange={() => (botEff = Math.min(botEff, botWpm))} />
        <Slider label="Station spacing" bind:value={botEff} min={5} max={botWpm} unit="wpm effective" />
        {#if format === 'sst'}<p class="muted small">SST runs at 20 wpm or slower.</p>{/if}
        <Toggle bind:checked={transcriptOn} label="Show transcript" detail="Each over appears after it ends" />
        <div class="field">
          <h3>You</h3>
          <div class="you">
            <label><span class="label">Call</span><input class="mono" bind:value={settings.you.call} autocapitalize="characters" spellcheck="false" /></label>
            <label><span class="label">Name</span><input class="mono" bind:value={settings.you.name} autocapitalize="characters" spellcheck="false" /></label>
            <label><span class="label">QTH</span><input class="mono" bind:value={settings.you.qth} autocapitalize="characters" spellcheck="false" /></label>
            <label><span class="label">Region (optional)</span><input class="mono" bind:value={settings.you.state} autocapitalize="characters" spellcheck="false" placeholder="MA, ON, JAPAN" /></label>
            {#if format === 'skcc'}<label><span class="label">SKCC nr</span><input class="mono" bind:value={settings.you.skcc} autocapitalize="characters" spellcheck="false" /></label>{/if}
          </div>
          <p class="muted small">Saved for next time. Also in <a href={href('settings')}>Settings</a>, Your station.</p>
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
      <h1>QSO · {FORMATS.find((f) => f.id === format)?.name}</h1>
      <span class="num muted">{mins(elapsed)}</span>
    </div>
    <div class="cols">
      <div class="main">
        <div class="status" class:you={turn === 'you' && stage === 'running'}>
          {#if stage === 'ended'}
            <span>QSO ended</span>
          {:else if turn === 'bot'}
            <span>Station sending</span>
          {:else}
            <span class="dot" aria-hidden="true"></span><span>Your turn</span>
          {/if}
        </div>
        {#if stage === 'running'}
          <p class="muted small">Your turn ends when you send K, KN or BK, press Enter, or stop sending for {settings.overTimeout} s.</p>
          {#if !strict() && turn === 'you'}
            <div class="over" aria-live="polite">
              <span class="label">You, decoded</span>
              {#if overTokens.length}<TokenText tokens={overTokens} size="l" />{:else}<p class="muted">Nothing yet.</p>{/if}
            </div>
          {/if}
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
        {#if stage === 'ended'}
          {#each results as r, k (k)}
            {@const sc = score(r.station, r.copied)}
            <table class="res">
              <caption>{r.station.call} · copied {Math.round(sc.copy * 100)}%</caption>
              <thead><tr><th>Field</th><th>Sent</th><th>You copied</th></tr></thead>
              <tbody>
                {#each fields as f (f)}
                  <tr><td class="muted">{LABEL[f]}</td><td class="mono">{truth(r.station, f)}</td><td class="mono" class:miss={!sc.ok.includes(f)}>{r.copied[f] || '–'}</td></tr>
                {/each}
              </tbody>
            </table>
          {/each}
          {#if bot}
            <p>
              <span class="label">Station received you</span><br />
              {#if received !== null}<span class="num">{Math.round(received * 100)}%</span> ·{/if}
              call <span class="mono">{bot.copied.call ?? 'nothing'}</span>{bot.copied.name ? `, name ${bot.copied.name}` : ''}{bot.copied.state ? `, state ${bot.copied.state}` : ''}{bot.copied.rst ? `, RST sent ${bot.copied.rst}` : ''}.
              <span class="muted">{mins(elapsed)} on the air.</span>
            </p>
          {/if}
          {#if sendReport}<div class="fist"><FistPanel report={sendReport} note={sendNote} /></div>{:else if sendNote}<p>{sendNote}</p>{/if}
        {/if}
      </div>
      <aside class="side">
        <h3>{working ? `Working ${working}` : format === 'pileup' ? 'Pileup' : 'Copied'}</h3>
        <div class="copy">
          {#each fields as f (f)}
            <label><span class="label">{LABEL[f]}</span><input class="mono" bind:value={copied[f]} autocapitalize="characters" autocomplete="off" spellcheck="false" disabled={stage === 'ended'} /></label>
          {/each}
        </div>
      </aside>
    </div>
    <div class="actions">
      {#if stage === 'running'}
        <Button kind="primary" onclick={endOver} disabled={turn !== 'you'} hint="Enter">End over</Button>
        <Button onclick={replayLast} disabled={turn !== 'you' || !lastAudio}>Replay last</Button>
        <Button kind="quiet" onclick={stop} hint="Esc">Stop</Button>
      {:else}
        <Button kind="primary" onclick={() => (stage = 'setup')}>New QSO</Button>
        <Button href={href('progress')}>QSO log</Button>
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

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: var(--target);
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    font-weight: var(--weight-strong);
    align-self: flex-start;
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
