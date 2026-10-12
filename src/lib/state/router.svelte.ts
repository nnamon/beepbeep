// Hash router: #/practice/send-drill -> { path: ['practice', 'send-drill'] }.

function current(): string[] {
  const h = location.hash.replace(/^#\/?/, '');
  const [path] = h.split('?');
  return path ? path.split('/').filter(Boolean) : ['practice'];
}

/** Where you are, and the screen you came from (for a way back from Setup). */
export const route = $state<{ path: string[]; prev: string[] | null }>({ path: current(), prev: null });

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.prev = route.path;
    route.path = current();
    window.scrollTo({ top: 0 });
  });
}

export function go(...parts: string[]) {
  location.hash = `#/${parts.join('/')}`;
}

export function href(...parts: string[]): string {
  return `#/${parts.join('/')}`;
}

/** A screen's name for the window title, used when the screen has no main heading. */
export function screenTitle(path: string[]): string {
  const name = (s: string) => (s === 'qso' ? 'QSO' : s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' '));
  if (path[0] === 'pocket' && path[1] === 'round' && path[2]) return `${name(path[2])} · Pocket`;
  return name(path[0] ?? 'practice');
}
