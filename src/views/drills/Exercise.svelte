<script lang="ts">
  // One class exercise: the player runs its pattern of CW, voice and silence
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
  import { atSpeed, classById } from '../../lib/train/classes';
  import { cardsFromText, material, type Card } from '../../lib/train/cards';
  import { Player, type PlayerState } from '../../lib/train/player';
  import { playCw, saveSession, trackLevels, wait } from '../../lib/train/session';
  import { textTokens } from '../../lib/util/text';
  import { mulberry32, randomSeed, shuffle } from '../../lib/util/random';
  import { keepAwake } from '../../lib/util/wakelock';

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

  // BC1 and BC2 follow your carousel group (or start at the group you joined);
  // later classes know every character.
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
  onMount(async () => (texts = await listTexts()));

  const onlyText = ex?.source === 'text';
  const useText = $derived(onlyText || !!prefs.text);
  const chosen = $derived(texts.find((t) => t.id === prefs.text) ?? (onlyText ? texts[0] : undefined));
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
    return material(ex.source, { rng, known: level.known, added: level.added, words: level.words, count: ex.count ?? 20, min: ex.min, max: ex.max });
  }

  // Lesson material can run out early in the carousel (phrases from three letters).
  const playable = $derived.by(() => {
    if (!ex) return false;
    if (useText) return !!chosen && cardsFromText(chosen.text, ex.perLine ?? false).length > 0;
    if (ex.source === 'text') return false;
    return material(ex.source, { rng: mulberry32(1), known: level.known, added: level.added, words: level.words, count: 3, min: ex.min, max: ex.max }).length > 0;
  });

  let player = $state.raw<Player | null>(null);
  let st = $state<PlayerState | null>(null);
  let startedAt = 0;
  let saved = false;

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

  function begin() {
    if (!recipe) return;
    const cards = build();
    if (!cards.length) return;
    player?.stop();
    saved = false;
    startedAt = Date.now();
    player = new Player(cards, recipe, deps, (s) => {
      st = s;
      if (s.phase === 'done') finished();
    });
    st = { ...player.state };
    void keepAwake(true);
    player.start();
  }

  let loopTimer: ReturnType<typeof setTimeout> | null = null;

  function finished() {
    void keepAwake(false);
    record();
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

  async function addText(name: string, text: string) {
    const t = await saveText(name, text);
    texts = await listTexts();
    setPref('text', t.id);
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
    await deleteText(chosen.id);
    texts = await listTexts();
    setPref('text', onlyText ? (texts[0]?.id ?? null) : null);
  }

  function onkey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
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
  <DrillFrame title={ex.name} eyebrow="{cls.name}{cls.carousel ? ` · ${level.name.split(' · ')[1]}` : ''} · {st ? `${st.wpm}/${st.fwpm}` : `${recipe.wpm}/${recipe.fwpm}`} wpm" {count}>
    {#if !st || st.phase === 'ready'}
      <p class="summary">{ex.summary}</p>
      {#if !onlyText}
        <Segmented
          label="Material"
          options={[
            { value: 'lesson', label: cls.carousel ? 'This group' : 'Generated' },
            { value: 'text', label: 'Your text' },
          ]}
          value={useText ? 'text' : 'lesson'}
          onchange={(v) => setPref('text', v === 'text' ? (texts[0]?.id ?? '') : null)}
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
            {#if chosen}<p class="muted small">{cardsFromText(chosen.text, ex.perLine ?? false).length} {ex.perLine ? 'lines' : 'words'}. One card per {ex.perLine ? 'line' : 'word'}.</p>{/if}
          {:else}
            <p class="muted">No texts yet. Paste one or open a .txt file, such as a class handout. {"{cw|speech}"} markup from Morse Browser files works.</p>
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
          {#if texts.length}<Toggle label="Shuffle" checked={!!prefs.shuffle} onchange={(v) => setPref('shuffle', v)} />{/if}
        </div>
      {/if}
      {#if !strict()}
        <Toggle label="Show text as it plays" detail="Each card appears once it has played." checked={!!prefs.show} onchange={(v) => setPref('show', v)} />
      {/if}
      <Toggle label="Loop" detail="Starts again with new material at the end." checked={!!prefs.loop} onchange={(v) => setPref('loop', v)} />
      {#if !useText && !playable}
        <p class="warn">Too few characters for this exercise yet. {ex.source === 'prosigns' ? 'It needs the AR SK BT group.' : 'It works once you have more groups.'} Your text works now.</p>
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
        <Button kind="primary" onclick={begin} hint="Enter" disabled={!playable}>Start</Button>
      {:else if finishedRun}
        <Button kind="primary" onclick={begin} hint="Enter">Again</Button>
        {#if ex.recipe.voice && st.phase === 'done'}<Button onclick={() => player?.recap()}>Read back</Button>{/if}
        <Button kind="quiet" onclick={() => { stop(); st = null; }}>Options</Button>
      {:else}
        {#if st.phase === 'paused'}
          <Button kind="primary" onclick={() => player?.resume()} hint="Space">Resume</Button>
        {:else}
          <Button kind="primary" onclick={() => player?.pause()} hint="Space">Pause</Button>
        {/if}
        <Button onclick={() => player?.back()} label="Previous card" hint="←">Back</Button>
        <Button onclick={() => player?.next()} label="Next card" hint="→">Next</Button>
        <Button kind="quiet" onclick={() => { stop(); st = null; }}>Stop</Button>
      {/if}
    {/snippet}
  </DrillFrame>
{/if}

<style>
  .summary {
    font-size: var(--size-m);
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
