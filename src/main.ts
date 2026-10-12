import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

// After an update, the new service worker takes over and drops the old build's
// files. This page still runs the old build, which loads some files only when
// first needed (the microphone's audio worklet, the decoder's worker), so it
// reloads into the new build the next time you go to a main screen, never in
// the middle of a drill.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let updated = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => (updated = true));
  window.addEventListener('hashchange', () => {
    const path = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    if (updated && path.length <= 1) location.reload();
  });
}

export default app;
