<script lang="ts">
  import { route, href } from './lib/state/router.svelte';
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
  import Specimen from './views/Specimen.svelte';
  import { effectiveMix, settings } from './lib/state/settings.svelte';
  import { setMix } from './lib/train/world';
  import { notify, signal, stopMic } from './lib/state/signal.svelte';
  import { engine } from './lib/audio/engine';
  import { courseSpeedsInUse } from './lib/train/session';
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
    if (courseSpeedsInUse()) return notify('This lesson sets the speed.');
    settings.charWpm = Math.max(5, Math.min(45, settings.charWpm + (e.key === 'ArrowUp' ? 1 : -1)));
    if (settings.effectiveWpm > settings.charWpm) settings.effectiveWpm = settings.charWpm;
    notify(`Receive ${settings.charWpm} wpm`);
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
  // The pad stays put on every sending screen; it fades while nothing listens.
  const showPad = $derived(settings.input === 'touch' && (signal.touchArea > 0 || signal.touchKey));
</script>

<div class="shell" class:keying={showPad}>
  <header class="head">
    <a class="mark" href={href('practice')}><Logo />BeepBeep</a>
    <span class="ver num" title="Version and build">v{__APP_VERSION__} · {__APP_BUILD__}</span>
    <nav class="nav" aria-label="Main">
      {#each tabs as t (t.id)}
        <a href={href(t.id)} class:on={top === t.id} aria-current={top === t.id ? 'page' : undefined}>{t.label}</a>
      {/each}
      <a href={href('settings')} class:on={top === 'settings'} aria-current={top === 'settings' ? 'page' : undefined}>Settings</a>
      <a href={href('guide')} class:on={top === 'guide'} aria-current={top === 'guide' ? 'page' : undefined}>Guide</a>
    </nav>
    <div class="signal"><SignalBar /></div>
    <a class="guide-link" href={href('guide')} class:on={top === 'guide'}>Guide</a>
    <a class="gear" href={href('settings')} aria-label="Settings"><Icon name="settings" /></a>
  </header>
  <SoundGate />
  {#if top !== 'pocket'}<div class="signal-strip"><SignalBar compact /></div>{/if}

  <main class="main">
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
</div>

<svelte:window onkeydown={onKey} />

{#if settings.visualCue}<VisualCue />{/if}
{#if showPad}<TouchKey />{/if}

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-2) var(--s-3);
    padding-top: max(var(--s-2), var(--safe-top));
    border-bottom: var(--hairline) solid var(--line);
  }

  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
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
    padding: var(--s-1) 0;
    border-bottom: 2px solid transparent;
  }

  .nav a:hover {
    color: var(--ink);
  }

  .nav a.on {
    color: var(--ink);
    font-weight: var(--weight-strong);
    border-bottom-color: var(--signal);
  }

  .signal {
    margin-left: auto;
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
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--s-4) var(--s-3) var(--s-8);
  }

  .tabbar {
    display: none;
  }

  .guide-link {
    display: none;
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

  @media (max-width: 760px) {
    .nav,
    .signal {
      display: none;
    }

    .guide-link {
      display: inline-flex;
      align-items: center;
      margin-left: auto;
      min-height: var(--target);
      padding: 0 var(--s-1);
      color: var(--muted);
      text-decoration: none;
      font-size: var(--size-s);
    }

    .guide-link.on {
      color: var(--ink);
    }

    .gear {
      display: inline-flex;
    }

    /* While the touch key is out, it takes the tab bar's place. */
    .shell.keying .tabbar {
      display: none;
    }

    .head {
      gap: var(--s-1);
      padding: var(--s-1) var(--s-2);
      padding-top: max(var(--s-1), var(--safe-top));
    }

    /* The narrowest phones (360 px) cut the build short rather than overflow. */
    .ver {
      margin-left: 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .signal-strip {
      display: block;
      padding: var(--s-1) var(--s-2) 0;
    }

    .main {
      padding: var(--s-2) var(--s-2) calc(var(--s-8) + var(--s-6) + var(--safe-bottom));
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
      padding-bottom: var(--safe-bottom);
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
</style>
