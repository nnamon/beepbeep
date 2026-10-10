import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const wav = fileURLToPath(new URL('./e2e/.fixtures/paris.wav', import.meta.url));
const fakeMic = {
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  },
};

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/output',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  // Visual baselines are rendered in the Playwright container (Linux), so compare there only.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testMatch: /(screens|visual)\.spec/ },
    { name: 'phone', use: { ...devices['iPhone 13'] }, testMatch: /screens\.spec/ },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, testMatch: /screens\.spec/ },
    // Small Android phones: 360 px is the narrowest common width.
    { name: 'small', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } }, testMatch: /screens\.spec/ },
    { name: 'mic', testMatch: /(decode|flows|voice)\.spec/, use: { ...devices['Desktop Chrome'], ...fakeMic } },
    { name: 'mic-pixel', testMatch: /decode\.spec/, use: { ...devices['Pixel 7'], ...fakeMic } },
  ],
});
