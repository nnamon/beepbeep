// After an update the new service worker takes over and the old build's files
// are gone from the server. This page still runs the old build, which loads
// some files only when first needed (the microphone's audio worklet). So the
// page reloads into the new build at a safe moment: the next time you go to a
// main screen, unless something lives only in this page's memory (a paused
// QSO), or at once when a file of the old build fails to load.

let updated = false;
const holds = new Set<string>();

/** A new version has taken over from the one this page runs. */
export function markUpdated() {
  updated = true;
}

export function appUpdated(): boolean {
  return updated;
}

/** While held (a paused QSO kept in memory), a move to another screen doesn't reload the page. */
export function holdReload(what: string, held: boolean) {
  if (held) holds.add(what);
  else holds.delete(what);
}

/** Reloads into the new build if there is one and nothing is held. True when it reloads. */
export function reloadIfUpdated(force = false): boolean {
  if (!updated || (!force && holds.size)) return false;
  location.reload();
  return true;
}

/**
 * Loads the latest version from the internet, skipping the copy saved on this
 * device: drops the service worker and its caches, refetches the page past the
 * browser's own cache, then reloads. Progress and settings are kept (they live
 * in IndexedDB and localStorage, not in these caches). Refused when offline,
 * since without the saved copy the app couldn't load.
 */
export async function reloadFresh(): Promise<'offline' | 'reloading'> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* no service worker support */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* no Cache Storage */
  }
  try {
    await fetch(location.pathname, { cache: 'reload' });
  } catch {
    /* the reload below still asks the network */
  }
  location.replace(`${location.pathname}?fresh=${Date.now()}${location.hash}`);
  return 'reloading';
}
