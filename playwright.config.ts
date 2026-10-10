import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const wav = fileURLToPath(new URL('./e2e/.fixtures/paris.wav', import.meta.url));

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/output',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  // BASE_URL runs the suite against a deployed copy, e.g. https://nnamon.github.io/beepbeep/
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:4173/' },
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    timeout: 180_000,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testMatch: /screens\.spec/ },
    { name: 'phone', use: { ...devices['iPhone 13'] }, testMatch: /screens\.spec/ },
    {
      name: 'mic',
      testMatch: /(decode|flows)\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
});
