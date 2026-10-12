import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const micPlaying = (file: string) => ({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fileURLToPath(new URL(`./e2e/.fixtures/${file}`, import.meta.url))}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});
const fakeMic = micPlaying('paris.wav');

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/output',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  // Visual baselines are rendered in the Playwright container (Linux), so compare there only.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  // Tight per-pixel threshold so palette changes register; rendering is deterministic in the container.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.02 } },
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testMatch: /(screens|visual|a11y|classes|qsolearn|qso|storage|drills|shell|update)\.spec/ },
    { name: 'phone', use: { ...devices['iPhone 13'] }, testMatch: /(screens|touch|ios|calibrate|classes|layout|qsolearn|qso|tokentext|update|newbuild)\.spec/ },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, testMatch: /screens\.spec/ },
    // Small Android phones: 360 px is the narrowest common width.
    { name: 'small', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } }, testMatch: /(screens|tokentext)\.spec/ },
    { name: 'mic', testMatch: /(decode|flows|voice|touch|calibrate|station|micrelease|newbuild)\.spec/, use: { ...devices['Desktop Chrome'], ...fakeMic } },
    { name: 'mic-pixel', testMatch: /(decode|touch)\.spec/, use: { ...devices['Pixel 7'], ...fakeMic } },
    // README images, on demand (README_SHOTS=1; see e2e/readme.spec.ts).
    { name: 'readme', testMatch: /readme\.spec/, use: { ...devices['Desktop Chrome'], ...micPlaying('room-cq.wav') } },
  ],
});
