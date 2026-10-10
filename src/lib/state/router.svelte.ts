// Hash router: #/practice/send-drill -> { path: ['practice', 'send-drill'] }.

function current(): string[] {
  const h = location.hash.replace(/^#\/?/, '');
  const [path] = h.split('?');
  return path ? path.split('/').filter(Boolean) : ['practice'];
}

export const route = $state({ path: current() });

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
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
