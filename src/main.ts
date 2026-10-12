import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { markUpdated, reloadIfUpdated } from './lib/state/update';

// After Reload the latest version (Settings), drop the marker that got past the caches.
if (new URLSearchParams(location.search).has('fresh')) history.replaceState(null, '', `${location.pathname}${location.hash}`);

const app = mount(App, { target: document.getElementById('app')! });

// After an update the page reloads into the new build at a safe moment (see
// lib/state/update.ts): the next time you go to a main screen, never in the
// middle of a drill. Checked once the screen you left has packed up, so a QSO
// it keeps can hold the reload off.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', markUpdated);
  window.addEventListener('hashchange', () => {
    const path = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    if (path.length <= 1) setTimeout(() => reloadIfUpdated(), 0);
  });
}

export default app;
