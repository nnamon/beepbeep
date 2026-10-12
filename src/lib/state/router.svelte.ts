// Hash router: #/practice/send-drill -> { path: ['practice', 'send-drill'] }.

function current(): string[] {
  const h = location.hash.replace(/^#\/?/, '');
  const [path] = h.split('?');
  return path ? path.split('/').filter(Boolean) : ['practice'];
}

/** Where you are, and the screen you came from (for a way back from Setup). */
export const route = $state<{ path: string[]; prev: string[] | null }>({ path: current(), prev: null });

/** Where each screen was scrolled to when you left it. */
const scrolled = new Map<string, number>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const from = route.path.join('/');
    scrolled.set(from, window.scrollY);
    route.prev = route.path;
    route.path = current();
    // Coming back to a main screen (Practice, Pocket, Progress...) puts you
    // where you were on it, as after Back from a drill. A drill or any other
    // screen opens at the top.
    const y = route.path.length <= 1 ? scrolled.get(route.path.join('/')) : undefined;
    if (y === undefined) window.scrollTo({ top: 0 });
    else requestAnimationFrame(() => window.scrollTo({ top: y }));
  });
}

export function go(...parts: string[]) {
  location.hash = `#/${parts.join('/')}`;
}

export function href(...parts: string[]): string {
  return `#/${parts.join('/')}`;
}
