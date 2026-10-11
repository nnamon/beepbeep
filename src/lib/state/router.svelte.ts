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
