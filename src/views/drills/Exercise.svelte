<script lang="ts">
  // One LICW exercise: the player runs its pattern of CW, voice and silence
  // over cards from your lesson or your own text, with notes on how to do it.
  import { onDestroy, onMount, untrack } from 'svelte';
  import DrillFrame from '../../ui/DrillFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Select from '../../ui/Select.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import TokenText from '../../ui/TokenText.svelte';
  import { sayCard, stopSpeech } from '../../lib/audio/speech';
  import { href } from '../../lib/state/router.svelte';
  import { settings, strict, type ExercisePrefs } from '../../lib/state/settings.svelte';
  import { signal } from '../../lib/state/signal.svelte';
  import { deleteText, listTexts, saveText, type SavedText } from '../../lib/state/texts';
  import { atSpeed, classById, speedShort } from '../../lib/train/classes';
  import { cardsFromText, material, type Card } from '../../lib/train/cards';
  import { Player, type PlayerState } from '../../lib/train/player';
  import { playCw, saveSession, trackLevels, wait } from '../../lib/train/session';
  import { textTokens } from '../../lib/util/text';
  import { mulberry32, randomSeed, shuffle } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';
  import { forControl, inField } from '../../lib/util/keys';

  let { classId, exerciseId }: { classId: string; exerciseId: string } = $props();

  // Practice remounts this screen for each route, so the ids are read once.
  const [cid, eid] = untrack(() => [classId, exerciseId]);
  const cls = classById(cid);
  const ex = cls?.exercises.find((e) => e.id === eid);
  const key = `${cid}/${eid}`;
  const prefs = $derived<ExercisePrefs>(settings.exercisePrefs[key] ?? {});
  function setPref<K extends keyof ExercisePrefs>(k: K, v: ExercisePrefs[K]) {
    settings.exercisePrefs[key] = { ...prefs, [k]: v };
  }
  function setPrefs(p: Partial<ExercisePrefs>) {
    settings.exercisePrefs[key] = { ...prefs, ...p };
  }

  // BC1 and BC2 follow your carousel group; later stages know every character.
  const licw = trackLevels('licw');
  const mine = licw.find((l) => l.id === settings.level.licw);
  const level = cls?.carousel
    ? mine?.id.startsWith(`licw-${cls.carousel}`)
      ? mine
      : licw.find((l) => l.id.startsWith(`licw-${cls.carousel}`))!
    : licw.at(-1)!;
  const rng = mulberry32(randomSeed());
  signal.receiving = true;

  let texts = $state<SavedText[]>([]);
  onMount(async () => (texts = await listTexts().catch(() => [])));

  const onlyText = ex?.source === 'text';
  // "Your text" stays chosen with no texts saved yet, so the paste and file controls show.
  const useText = $derived(onlyText || (prefs.source ? prefs.source === 'text' : !!prefs.text));
  // A text deleted from another exercise falls back to the first one left, as the list shows.
  const chosen = $derived(useText ? (texts.find((t) => t.id === prefs.text) ?? texts[0]) : undefined);
  const speed = $derived(prefs.speed ?? ex?.speeds?.[0] ?? ex?.recipe.wpm ?? 12);
  const recipe = $derived(ex ? atSpeed(ex.recipe, speed, ex.keepSpacing) : null);

  function build(): Card[] {
    if (!ex) return [];
    if (useText) {
      if (!chosen) return [];
      const c = cardsFromText(chosen.text, ex.perLine ?? false);
      return prefs.shuffle ? shuffle(rng, c) : c;
    }
    if (ex.source === 'text') return [];
    return material(ex.source, { rng, known: level.known, added: level.added, words: level.words, addedWords: level.addedWords, count: ex.count ?? 20, min: ex.min, max: ex.max });
  }

  // Lesson material can run out early in the carousel (phrases from three letters).
  const playable = $derived.by(() => {
    if (!ex) return false;
    if (useText) return !!chosen && cardsFromText(chosen.text, ex.perLine ?? false).length > 0;
    if (ex.source === 'text') return false;
    return material(ex.source, { rng: mulberry32(1), known: level.known, added: level.added, words: level.words, addedWords: level.addedWords, count: ex.count ?? 20, min: ex.min, max: ex.max }).length > 0;
  });

  let player = $state.raw<Player | null>(null);
  let st = $state<PlayerState | null>(null);
  let startedAt = 0;
  let saved = false;

  // A run left part-way (another tab, another screen) can be picked up again
  // for half an hour in this browser tab. Timed runs (VET, VST) start afresh.
  const LEFT = 'beepbeep.exercise.left';
  type Left = { key: string; cards: Card[]; index: number; at: number; elapsedMs?: number; length?: number | null };
  let left = $state<Left | null>(null);
  try {
    const l = JSON.parse(sessionStorage.getItem(LEFT) ?? 'null') as Left | null;
    if (l && l.key === key && Date.now() - l.at < 30 * 60_000 && l.cards?.length) left = l;
  } catch {
    /* storage unavailable */
  }
  function keepPlace() {
    try {
      if (player && st && !['ready', 'done', 'recap'].includes(st.phase) && (st.index > 0 || st.elapsed > 5)) {
        const left: Left = { key, cards: player.cards, index: st.index, at: Date.now(), elapsedMs: st.elapsed * 1000, length: player.length };
        sessionStorage.setItem(LEFT, JSON.stringify(left));
      } else if (left === null) sessionStorage.removeItem(LEFT);
    } catch {
      /* storage unavailable */
    }
  }
  function carryOn() {
    if (!left || !recipe) return;
    const l = left;
    left = null;
    try {
      sessionStorage.removeItem(LEFT);
    } catch {
      /* storage unavailable */
    }
    begin(l.cards, l.index, l.length ? l.elapsedMs : undefined);
  }

  const deps = {
    cw: async (text: string, wpm: number, fwpm: number) => {
      const pb = await playCw(text, { charWpm: wpm, effectiveWpm: fwpm, plain: true });
      return { done: pb.done, stop: () => pb.stop() };
    },
    say: (text: string, spell: boolean) => sayCard(text, spell),
    hush: () => stopSpeech(),
    sleep: (ms: number) => wait(ms),
    now: () => performance.now(),
  };

  function begin(given?: Card[], at?: number, elapsedMs?: number) {
    if (!recipe) return;
    const cards = given ?? build();
    if (!cards.length) return;
    if (!given) left = null;
    player?.stop();
    saved = false;
    startedAt = Date.now();
    player = new Player(cards, recipe, deps, (s) => {
      const was = st?.phase;
      st = s;
      if (s.phase === 'done' && was !== 'done') finished();
    });
    st = { ...player.state };
    void keepAwake(true);
    player.start(at, elapsedMs);
  }

  let loopTimer: ReturnType<typeof setTimeout> | null = null;

  function finished() {
    void keepAwake(false);
    record();
    if (loopTimer) clearTimeout(loopTimer);
    if (prefs.loop) loopTimer = setTimeout(begin, 2000);
  }

  function record() {
    if (saved || !player || !st || !st.done) return;
    saved = true;
    void saveSession({
      mode: `class:${key}`,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      sending: false,
      items: st.done,
      accuracy: null,
      wpm: player.recipe.wpm,
      effectiveWpm: player.recipe.fwpm,
    });
  }

  function stop() {
    if (loopTimer) clearTimeout(loopTimer);
    record();
    player?.stop();
    void keepAwake(false);
  }

  onDestroy(() => {
    keepPlace();
    if (loopTimer) clearTimeout(loopTimer);
    record();
    player?.stop();
    signal.receiving = false;
    void keepAwake(false);
  });

  const running = $derived(!!st && !['ready', 'done', 'paused'].includes(st.phase));
  const finishedRun = $derived(st?.phase === 'done' || st?.phase === 'recap');

  // What may be shown: strict mode keeps everything for the end. Otherwise a
  // card shows once its voice has spoken (before or after the CW), at the end
  // of a read-back run, or as soon as it has played with Show text on.
  function visible(i: number): boolean {
    if (!st || !ex) return false;
    if (finishedRun) return i < Math.max(st.done, 1);
    if (strict()) return false;
    const when = ex.recipe.voice?.when;
    if (when === 'before' && i === st.index && st.phase !== 'gap') return true;
    if (i < st.done) return prefs.show || when === 'before' || when === 'after';
    return false;
  }

  const cards = $derived(player?.cards ?? []);
  const shown = $derived(st ? cards.map((c, i) => ({ c, i })).filter(({ i }) => visible(i)) : []);
  const current = $derived(st && cards[st.index] && visible(st.index) ? cards[st.index] : null);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const count = $derived.by(() => {
    if (!st || !player) return '';
    const len = player.length;
    if (len !== null) return `${fmt(Math.max(0, len - st.elapsed))} left`;
    return `${Math.min(st.index + 1, st.total)} / ${st.total}`;
  });

  const phaseText = $derived(
    !st ? '' : st.phase === 'voice' ? 'Voice' : st.phase === 'cw' ? 'Listen' : st.phase === 'gap' ? '' : st.phase === 'paused' ? 'Paused' : st.phase === 'recap' ? 'Reading back' : '',
  );

  // Your text: paste or open a file; saved in this browser.
  let adding = $state(false);
  let newName = $state('');
  let newText = $state('');

  let textError = $state('');

  async function addText(name: string, text: string) {
    try {
      const t = await saveText(name, text);
      texts = await listTexts();
      setPrefs({ source: 'text', text: t.id });
      textError = '';
    } catch {
      textError = "The text couldn't be saved. The browser's storage isn't available.";
      return;
    }
    adding = false;
    newName = '';
    newText = '';
  }

  async function openFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    await addText(f.name.replace(/\.[^.]+$/, ''), await f.text());
  }

  async function removeText() {
    if (!chosen) return;
    if (!confirm(`Delete "${chosen.name}"? Other exercises that play it will play your first text instead.`)) return;
    try {
      await deleteText(chosen.id);
      texts = await listTexts();
    } catch {
      textError = "The text couldn't be deleted. The browser's storage isn't available.";
      return;
    }
    setPref('text', texts[0]?.id ?? null);
  }

  function onkey(e: KeyboardEvent) {
    if (inField(e)) return;
    // Arrows move between radio buttons and sliders when one has focus.
    const role = (e.target as HTMLElement | null)?.getAttribute?.('role');
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (role === 'radio' || role === 'slider')) return;
    if ((e.key === 'Enter' || e.key === ' ') && forControl(e)) return;
    if (e.key === 'Enter' && !running && st?.phase !== 'paused' && playable) {
      e.preventDefault();
      begin();
    } else if (e.key === ' ' && player && st && st.phase !== 'ready' && !finishedRun) {
      e.preventDefault();
      if (st.phase === 'paused') player.resume();
      else player.pause();
    } else if (e.key === 'ArrowLeft' && player) player.back();
    else if (e.key === 'ArrowRight' && player) player.next();
  }
</script>

<svelte:window onkeydown={onkey} />

{#if !cls || !ex || !recipe}
  <DrillFrame title="Exercise">
    <p>No such exercise. <a href={href('practice')}>Back to Practice</a></p>
  </DrillFrame>
{:else}
  <DrillFrame title={ex.name} eyebrow="{cls.name}{cls.carousel ? ` · ${level.name.split(' · ')[1]}` : ''} · {st ? speedShort(st.wpm, st.fwpm) : speedShort(recipe.wpm, recipe.fwpm)}" {count}>
    {#if !st || st.phase === 'ready'}
      <p class="summary">{ex.summary}</p>
      {#if left}
        <div class="left">
          <p>
            {#if left.length && left.elapsedMs !== undefined}
              You left this exercise with {fmt(Math.max(0, left.length - left.elapsedMs / 1000))} to go.
            {:else}
              You left this exercise at {left.index + 1} of {left.cards.length}.
            {/if}
          </p>
          <Button kind="primary" onclick={carryOn}>Carry on from there</Button>
        </div>
      {/if}
      {#if !onlyText}
        <Segmented
          label="Material"
          options={[
            { value: 'lesson', label: cls.carousel ? 'This lesson' : 'Generated' },
            { value: 'text', label: 'Your text' },
          ]}
          value={useText ? 'text' : 'lesson'}
          onchange={(v) => setPrefs({ source: v, text: v === 'text' ? (chosen?.id ?? texts[0]?.id ?? null) : prefs.text })}
        />
      {/if}
      {#if ex.speeds && ex.speeds.length > 1}
        <Segmented label="Speed" options={ex.speeds.map((w) => ({ value: w, label: `${w} wpm` }))} value={speed} onchange={(v) => setPref('speed', v)} />
      {/if}
      {#if useText}
        <div class="texts">
          {#if texts.length}
            <div class="row">
              <Select label="Text" options={texts.map((t) => ({ value: t.id, label: t.name }))} value={chosen?.id ?? texts[0].id} onchange={(v) => setPref('text', v)} />
              <Button kind="quiet" onclick={removeText}>Delete</Button>
            </div>
            {#if chosen}<p class="muted small">{cardsFromText(chosen.text, ex.perLine ?? false).length} {ex.perLine ? 'lines' : 'words'}. Each {ex.perLine ? 'line' : 'word'} plays on its own.</p>{/if}
          {:else}
            <p class="muted">No texts yet. Paste one or open a .txt file{settings.licwEnrolled ? ', such as a class handout' : ''}. Files made for Morse Browser work too.</p>
          {/if}
          {#if adding}
            <label class="field"><span class="label">Name</span><input bind:value={newName} placeholder="BC2 phrases" /></label>
            <label class="field"><span class="label">Text</span><textarea bind:value={newText} rows="6" spellcheck="false"></textarea></label>
            <div class="row">
              <Button kind="primary" onclick={() => addText(newName, newText)} disabled={!newText.trim()}>Save text</Button>
              <Button kind="quiet" onclick={() => (adding = false)}>Cancel</Button>
            </div>
          {:else}
            <div class="row">
              <Button onclick={() => (adding = true)}>Paste text</Button>
              <label class="file"><input type="file" accept=".txt,text/plain" onchange={openFile} /><span>Open a .txt file</span></label>
            </div>
          {/if}
          {#if textError}<p class="warn">{textError}</p>{/if}
          {#if texts.length}<Toggle label="Shuffle" checked={!!prefs.shuffle} onchange={(v) => setPref('shuffle', v)} />{/if}
        </div>
      {/if}
      {#if !strict()}
        <Toggle label="Show each one after it plays" detail="Otherwise you see it when the voice says it, or at the end." checked={!!prefs.show} onchange={(v) => setPref('show', v)} />
      {/if}
      <Toggle label="Repeat" detail="Start again when it finishes." checked={!!prefs.loop} onchange={(v) => setPref('loop', v)} />
      {#if !useText && !playable}
        <p class="warn">
          Your lesson doesn't have enough characters for this exercise yet. {ex.source === 'prosigns' ? 'It needs the lesson with AR, SK and BT.' : 'It works from a later lesson.'}
          You can play a text of your own instead: choose Your text above.
        </p>
      {/if}
      {#if ex.recipe.voice && settings.voice === 'off'}
        <p class="warn">Voice is off in Settings, so nothing is said. <button type="button" class="link" onclick={() => (settings.voice = 'builtin')}>Turn it on</button></p>
      {/if}
    {:else}
      <div class="stage" aria-live="polite">
        <span class="phase muted">{phaseText}</span>
        {#if current}
          <TokenText tokens={textTokens(current.cw || current.speech).map((t) => ({ t }))} size="xl" />
          {#if current.speech && current.speech.toUpperCase() !== current.cw}<p class="muted">{current.speech}</p>{/if}
        {:else if !finishedRun}
          <span class="blank" aria-hidden="true"></span>
        {/if}
      </div>
      {#if shown.length && (finishedRun || prefs.show)}
        <div class="played">
          <span class="label">{finishedRun ? 'What played' : 'Played'}</span>
          <ol class="mono">
            {#each shown as { c, i } (i)}<li>{c.cw || c.speech}</li>{/each}
          </ol>
        </div>
      {/if}
    {/if}

    {#snippet side()}
      <div class="guide">
        <h2 class="label">How</h2>
        <p>{ex.how}</p>
        <h2 class="label">Aim</h2>
        <p>{ex.aim}</p>
        {#if ex.mind}
          <h2 class="label">Watch for</h2>
          <p>{ex.mind}</p>
        {/if}
      </div>
    {/snippet}

    {#snippet footer()}
      {#if !st || st.phase === 'ready'}
        <Button kind={left ? 'secondary' : 'primary'} onclick={() => begin()} hint="Enter" disabled={!playable}>{left ? 'Start again' : 'Start'}</Button>
      {:else if finishedRun}
        <Button kind="primary" onclick={() => begin()} hint="Enter">Again</Button>
        {#if ex.recipe.voice && st.phase === 'done'}<Button onclick={() => player?.recap()}>Read back</Button>{/if}
        <Button kind="quiet" onclick={() => { stop(); st = null; }}>Change options</Button>
      {:else}
        {#if st.phase === 'paused'}
          <Button kind="primary" onclick={() => player?.resume()} hint="Space">Resume</Button>
        {:else}
          <Button kind="primary" onclick={() => player?.pause()} hint="Space">Pause</Button>
        {/if}
        <Button onclick={() => player?.back()} hint="←">Previous</Button>
        <Button onclick={() => player?.next()} hint="→">Next</Button>
        <Button kind="quiet" onclick={() => { stop(); st = null; }}>Stop</Button>
      {/if}
    {/snippet}
  </DrillFrame>
{/if}

<style>
  .summary {
    font-size: var(--size-m);
  }

  .left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) var(--s-2);
    border-left: 2px solid var(--signal);
    padding-left: var(--s-2);
  }

  .texts {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    align-items: flex-end;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  input:not([type='file']),
  textarea {
    border: var(--hairline) solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    padding: var(--s-1);
    font: inherit;
    font-size: var(--size-field);
    max-width: 560px;
  }

  textarea {
    font-family: var(--font-mono);
    resize: vertical;
  }

  .file {
    display: inline-flex;
    align-items: center;
    min-height: var(--target);
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .file input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .file:focus-within {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
  }

  .small {
    font-size: var(--size-s);
  }

  .warn {
    border-left: 2px solid var(--signal);
    padding-left: var(--s-1);
  }

  .link {
    border: 0;
    background: none;
    color: inherit;
    text-decoration: underline;
    padding: 0;
    font: inherit;
  }

  .stage {
    min-height: 140px;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    justify-content: center;
  }

  .phase {
    font-size: var(--size-s);
    min-height: 1.2em;
  }

  .blank {
    display: block;
    height: 56px;
  }

  .played ol {
    list-style: none;
    padding: 0;
    margin: var(--s-1) 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-3);
    font-size: var(--size-m);
  }

  .guide {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .guide h2 {
    margin: var(--s-1) 0 0;
  }

  .guide h2:first-child {
    margin-top: 0;
  }
</style>
