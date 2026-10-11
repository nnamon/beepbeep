import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The commit a Pages build came from (Actions sets GITHUB_SHA); local builds say so.
const build = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local';

// GitHub Pages serves the app under /beepbeep/; local builds use /.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(build) },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'BeepBeep',
        short_name: 'BeepBeep',
        description: 'CW trainer that decodes your key through the microphone.',
        theme_color: '#0F1113',
        background_color: '#0F1113',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest,mp3}'],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  worker: { format: 'es' },
  server: { host: '0.0.0.0', port: 7373, strictPort: true },
  preview: { host: '0.0.0.0', port: 7373, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
