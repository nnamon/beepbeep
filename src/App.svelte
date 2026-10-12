<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { route, href, screenTitle } from './lib/state/router.svelte';
  import SignalBar from './ui/SignalBar.svelte';
  import Icon from './ui/Icon.svelte';
  import VisualCue from './ui/VisualCue.svelte';
  import TouchKey from './ui/TouchKey.svelte';
  import Logo from './ui/Logo.svelte';
  import SoundGate from './ui/SoundGate.svelte';
  import Guide from './views/Guide.svelte';
  import Practice from './views/Practice.svelte';
  import Pocket from './views/Pocket.svelte';
  import Qso from './views/Qso.svelte';
  import QsoLearn from './views/QsoLearn.svelte';
  import Progress from './views/Progress.svelte';
  import Settings from './views/Settings.svelte';
  import Setup from './views/Setup.svelte';
  import Reference from './views/Reference.svelte';
  import Changes from './views/Changes.svelte';
  import Specimen from './views/Specimen.svelte';
  import { effectiveMix, settings } from './lib/state/settings.svelte';
  import { setMix } from './lib/train/world';
  import { notify, signal, stopMic } from './lib/state/signal.svelte';
  import { engine } from './lib/audio/engine';
  import { courseSpeedsInUse, laterStage } from './lib/train/session';
  import { inField } from './lib/util/keys';

  // The audio engine follows the saved volume and headphone setting.
  $effect(() => {
    engine.setVolume(settings.volume);
    engine.muteWhilePlaying = !settings.headphones;
  });
  // Practice callsigns come from the areas you hear most.
  $effect(() => setMix(effectiveMix()));

  // Alt+Up / Alt+Down: receive speed. On touch screens the same is in Settings.
  function onKey(e: KeyboardEvent) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || inField(e)) return;
    e.preventDefault();
    // The LICW lesson's own speed is in use, so the setting would change nothing.
    if (courseSpeedsInUse()) return notify(laterStage() ? 'This stage sets the speed.' : 'This lesson sets the speed.');
    settings.charWpm = Math.max(5, Math.min(45, settings.charWpm + (e.key === 'ArrowUp' ? 1 : -1)));
    if (settings.effectiveWpm > settings.charWpm) settings.effectiveWpm = settings.charWpm;
    notify(`Character speed ${settings.charWpm} wpm`);
  }

  // The microphone stays on only while a screen that listens is open: sending
  // drills, QSOs and Setup. Leave them and it is released after a short
  // while, so a quick visit elsewhere doesn't ask for it again.
  const listens = (p: string[]) => p[0] === 'setup' || p[0] === 'qso' || (p[0] === 'practice' && ['live', 'send', 'hear-send'].includes(p[1] ?? ''));
  let micTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const away = !listens(route.path);
    if (micTimer) clearTimeout(micTimer);
    micTimer = null;
    if (away) micTimer = setTimeout(() => signal.micOn && !listens(route.path) && stopMic(), 10_000);
  });

  const tabs = [
    { id: 'practice', label: 'Practice' },
    { id: 'pocket', label: 'Pocket' },
    { id: 'qso', label: 'QSO' },
    { id: 'progress', label: 'Progress' },
  ];
  const top = $derived(route.path[0] ?? 'practice');

  /** Focuses the screen's main heading (or main, if it has none) without showing a focus ring. */
  function focusContent(scroll: boolean) {
    const main = document.querySelector('main');
    const target = main?.querySelector('h1') ?? main;
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: !scroll });
  }

  // Each screen gets its own window title, from its main heading. After a move to another
  // screen, focus goes to that heading, so screen readers start there. Not on first load,
  // and not when the new screen has already put focus in it (a field that focuses itself).
  let focusBefore: Element | null = null;
  let firstScreen = true;
  onMount(() => {
    const note = () => (focusBefore = document.activeElement);
    window.addEventListener('hashchange', note);
    return () => window.removeEventListener('hashchange', note);
  });
  $effect(() => {
    void route.path.join('/');
    const initial = firstScreen;
    firstScreen = false;
    void tick().then(() => {
      const main = document.querySelector('main');
      const h1 = main?.querySelector('h1');
      document.title = `${h1?.textContent?.replace(/\s+/g, ' ').trim() || screenTitle(route.path)} · BeepBeep`;
      if (initial || !main) return;
      const now = document.activeElement;
      if (now && now !== document.body && now !== focusBefore && main.contains(now)) return;
      focusContent(false);
    });
  });
  // The pad stays put on every sending screen; it fades while nothing listens.
  const showPad = $derived(settings.input === 'touch' && (signal.touchArea > 0 || signal.touchKey));
</script>

<a
  class="skip"
  href="#main-content"
  onclick={(e) => {
    e.preventDefault();
    focusContent(true);
  }}>Skip to content</a
>
<div class="shell" class:keying={showPad}>
  <header class="head">
    <a class="mark" href={href('practice')}><Logo /><span class="word">BeepBeep</span></a>
    <span class="ver num" title="Version and build"><span>v{__APP_VERSION__}</span><span class="sep">{' · '}</span><span>{__APP_BUILD__}</span></span>
    <nav class="nav" aria-label="Main">
      {#each tabs as t (t.id)}
        <a href={href(t.id)} class:on={top === t.id} aria-current={top === t.id ? 'page' : undefined}>{t.label}</a>
      {/each}
      <a href={href('settings')} class:on={top === 'settings'} aria-current={top === 'settings' ? 'page' : undefined}>Settings</a>
      <a href={href('guide')} class:on={top === 'guide'} aria-current={top === 'guide' ? 'page' : undefined}>Guide</a>
    </nav>
    <!-- The visual cue light sits in the header's free space, clear of every control. -->
    <span class="cue-slot">{#if settings.visualCue}<VisualCue />{/if}</span>
    <div class="signal"><SignalBar /></div>
    <a class="guide-link" href={href('guide')} class:on={top === 'guide'}>Guide</a>
    <a class="gear" href={href('settings')} aria-label="Settings"><Icon name="settings" /></a>
  </header>
  <SoundGate />
  {#if top !== 'pocket'}<div class="signal-strip"><SignalBar compact /></div>{/if}

  <main class="main" id="main-content">
    {#if top === 'practice'}
      <Practice />
    {:else if top === 'pocket'}
      <Pocket />
    {:else if top === 'qso'}
      {#if route.path[1] === 'learn'}<QsoLearn />{:else}<Qso />{/if}
    {:else if top === 'progress'}
      <Progress />
    {:else if top === 'settings'}
      <Settings />
    {:else if top === 'setup'}
      <Setup />
    {:else if top === 'reference'}
      <Reference />
    {:else if top === 'changes'}
      <Changes />
    {:else if top === 'specimen'}
      <Specimen />
    {:else if top === 'guide'}
      <Guide />
    {:else}
      <Practice />
    {/if}
  </main>

  <nav class="tabbar" aria-label="Main">
    {#each tabs as t (t.id)}
      <a href={href(t.id)} class:on={top === t.id} aria-current={top === t.id ? 'page' : undefined}>{t.label}</a>
    {/each}
  </nav>

  <!-- Short notices (a speed change, a session that could not be saved) are read out. -->
  <div class="visually-hidden" role="status">{signal.notice}</div>
</div>

<svelte:window onkeydown={onKey} />

{#if showPad}<TouchKey />{/if}

<style>
  /* The first stop for the keyboard on every screen. Off screen until it has focus. */
  .skip {
    position: fixed;
    top: calc(var(--safe-top) + var(--s-1));
    left: calc(var(--safe-left) + var(--s-1));
    z-index: 30;
    display: inline-flex;
    align-items: center;
    min-height: var(--target);
    padding: 0 var(--s-2);
    border: var(--hairline) solid var(--signal);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font-weight: var(--weight-strong);
    text-decoration: none;
    transform: translateY(calc(-100% - var(--s-4) - var(--safe-top)));
  }

  .skip:focus {
    transform: none;
  }

  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-1) calc(var(--s-3) + var(--safe-right)) var(--s-1) calc(var(--s-3) + var(--safe-left));
    padding-top: max(var(--s-1), var(--safe-top));
    border-bottom: var(--hairline) solid var(--line);
  }

  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: var(--target-min);
    min-width: var(--target-min);
    font-size: var(--size-m);
    font-weight: var(--weight-strong);
    text-decoration: none;
    letter-spacing: 0.01em;
  }

  .ver {
    font-size: var(--size-s);
    color: var(--muted);
    margin-left: calc(-1 * var(--s-3));
    white-space: nowrap;
  }

  .nav {
    display: flex;
    gap: var(--s-3);
  }

  .nav a,
  .tabbar a {
    color: var(--muted);
    text-decoration: none;
    font-size: var(--size-m);
    border-bottom: 2px solid transparent;
  }

  .nav a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--target-min);
    min-width: var(--target-min);
    border-top: 2px solid transparent;
  }

  .nav a:hover {
    color: var(--ink);
  }

  .nav a.on {
    color: var(--ink);
    font-weight: var(--weight-strong);
    border-bottom-color: var(--signal);
  }

  /* Takes the free space in the header, so the light never sits on a control. */
  .cue-slot {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
  }

  /* Header items keep their size; only the signal bar gives way (a long notice wraps). */
  .mark,
  .ver,
  .nav,
  .cue-slot,
  .guide-link,
  .gear {
    flex: none;
  }

  .signal {
    min-width: 0;
  }

  .gear {
    display: none;
    color: var(--muted);
    min-width: var(--target);
    min-height: var(--target);
    align-items: center;
    justify-content: center;
  }

  .signal-strip {
    display: none;
  }

  .main {
    flex: 1;
    width: 100%;
    max-width: calc(1120px + var(--safe-left) + var(--safe-right));
    margin: 0 auto;
    padding: var(--s-4) calc(var(--s-3) + var(--safe-right)) var(--s-8) calc(var(--s-3) + var(--safe-left));
  }

  .tabbar {
    display: none;
  }

  /* The phone header's short links: shown where the full row of links does not fit. */
  .guide-link {
    display: none;
    align-items: center;
    min-height: var(--target);
    padding: 0 var(--s-1);
    color: var(--muted);
    text-decoration: none;
    font-size: var(--size-s);
  }

  .guide-link.on {
    color: var(--ink);
  }

  /* While keying on the touch key, quick taps must not select text anywhere. Fields stay editable. */
  .shell.keying {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .shell.keying :global(:is(input, textarea)) {
    user-select: text;
    -webkit-user-select: text;
  }

  /* Room for the touch key pad (96 px plus its padding) under the content. */
  .shell.keying .main {
    padding-bottom: calc(96px + var(--s-6) + var(--safe-bottom));
  }

  /* Narrower windows and phones on their side: tighter header, version over build. */
  @media (max-width: 1000px) {
    .head,
    .nav {
      gap: var(--s-2);
    }

    .ver {
      margin-left: 0;
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }

    .sep {
      display: none;
    }
  }

  /* Where the links and the signal bar need the room, the logo stands alone; the link keeps its name. */
  @media (min-width: 761px) and (max-width: 860px), (orientation: landscape) and (max-height: 500px) {
    .word {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  /* Phones held upright. A phone on its side keeps the header with the links, below. */
  @media (max-width: 760px) and (min-height: 501px) {
    .nav,
    .signal {
      display: none;
    }

    .guide-link,
    .gear {
      display: inline-flex;
    }

    /* While the touch key is out, it takes the tab bar's place. */
    .shell.keying .tabbar {
      display: none;
    }

    .head {
      gap: var(--s-1);
      padding: var(--s-1) calc(var(--s-2) + var(--safe-right)) var(--s-1) calc(var(--s-2) + var(--safe-left));
      padding-top: max(var(--s-1), var(--safe-top));
    }

    /* Version over build, so both fit beside the name on the narrowest phones. */
    .ver {
      margin-left: 0;
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }

    .sep {
      display: none;
    }

    .signal-strip {
      display: block;
      padding: var(--s-1) calc(var(--s-2) + var(--safe-right)) 0 calc(var(--s-2) + var(--safe-left));
    }

    .main {
      padding: var(--s-2) calc(var(--s-2) + var(--safe-right)) calc(var(--s-8) + var(--s-6) + var(--safe-bottom))
        calc(var(--s-2) + var(--safe-left));
    }

    .tabbar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      justify-content: space-around;
      background: var(--bg);
      border-top: var(--hairline) solid var(--line);
      padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
      z-index: 10;
    }

    .tabbar a {
      flex: 1;
      text-align: center;
      min-height: var(--target);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--size-s);
      border-bottom: 0;
      border-top: 2px solid transparent;
    }

    .tabbar a.on {
      color: var(--ink);
      font-weight: var(--weight-strong);
      border-top-color: var(--signal);
    }
  }

  /*
   * A phone on its side: little height, a notch at one side. The header stays one slim row
   * with the links, and drills put their answer keys beside the content (see DrillFrame).
   */
  @media (orientation: landscape) and (max-height: 500px) {
    .head {
      padding-top: max(var(--s-half), var(--safe-top));
      padding-bottom: var(--s-half);
    }

    .main {
      padding-top: var(--s-2);
      padding-bottom: calc(var(--s-5) + var(--safe-bottom));
    }

    /* Room for the lower pad (64 px plus its padding). */
    .shell.keying .main {
      padding-bottom: calc(64px + var(--s-3) + var(--safe-bottom));
    }
  }

  /* Small phones on their side (an iPhone SE, 640 px Androids): the gear and Guide replace two links, and the version is left to Settings. */
  @media (orientation: landscape) and (max-height: 500px) and (max-width: 720px) {
    .ver,
    .nav a:nth-child(n + 5) {
      display: none;
    }

    .guide-link,
    .gear {
      display: inline-flex;
    }
  }
</style>
