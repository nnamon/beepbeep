import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The commit a Pages build came from (Actions sets GITHUB_SHA); local builds say so.
const build = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local';

// GitHub Pages serves the app under /beepbeep/; local builds use /.
const base = process.env.BASE_PATH ?? '/';

// Debug server (BEEPBEEP_DEBUG=1): https on the local network so a laptop's
// microphone works, and the sample recorder in Setup saves into samples/.
const debug = process.env.BEEPBEEP_DEBUG === '1';

function sampleUpload(): Plugin {
  const dir = new URL('./samples/', import.meta.url);
  return {
    name: 'beepbeep-samples',
    configureServer(server) {
      server.middlewares.use('/__samples', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(existsSync(dir) ? readdirSync(dir).sort() : []));
          return;
        }
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (req.method !== 'POST' || !/^[\w-]+\.(wav|json)$/.test(name)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        const parts: Buffer[] = [];
        req.on('data', (c: Buffer) => parts.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(new URL(name, dir), Buffer.concat(parts));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(build), __DEBUG__: JSON.stringify(debug) },
  plugins: [
    svelte(),
    ...(debug ? [sampleUpload()] : []),
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
  server: {
    host: '0.0.0.0',
    port: 7373,
    strictPort: true,
    https: debug && existsSync('certs/cert.pem') ? { key: readFileSync('certs/key.pem'), cert: readFileSync('certs/cert.pem') } : undefined,
    // Editing code must not reload a page that is recording a sample.
    hmr: debug ? false : undefined,
  },
  preview: { host: '0.0.0.0', port: 7373, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
