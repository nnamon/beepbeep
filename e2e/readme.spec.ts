// Preview images for the README (docs/images/), in both themes. Not part of
// the normal run:
//
//   docker compose run --rm -T -e README_SHOTS=1 -e GITHUB_SHA=$(git rev-parse HEAD) e2e \
//     npx playwright test --project=readme
//
// Math.random is seeded, so both themes show the same prompts and stations.
// The project's fake microphone plays e2e/.fixtures/room-cq.wav: a hand-keyed
// CQ at 600 Hz with a fan and someone talking (written by global-setup.ts).
import { test, expect, type Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';
import { seed } from './seed';

test.skip(!process.env.README_SHOTS, 'README_SHOTS=1 renders the README images');

const OUT = 'docs/images';
const YOU = { call: 'K1ABC', name: 'TOM', qth: 'BOSTON', state: 'MA', skcc: '' };
const DESKTOP = { viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const THEMES = ['dark', 'light'] as const;

async function open(page: Page, route: string, theme: string, settings: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([t, s]) => {
      let a = 20261011;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
      localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ theme: t, voice: 'off', guideSeen: true, licwAsked: true, ...s }));
    },
    [theme, { you: YOU, ...settings }] as const,
  );
  await page.goto(`./#/${route}`);
  await page.waitForTimeout(500);
}

/**
 * Keys text on the Space-bar straight key like a fairly steady hand: each
 * element and gap varies a few percent. `letterGap` in dits (3 by the book).
 */
async function key(page: Page, text: string, wpm: number, letterGap = 3) {
  const dit = 1200 / wpm;
  let r = 7;
  const wobble = () => {
    r = (r * 16807) % 2147483647;
    return 1 + ((r / 2147483647) - 0.5) * 0.16;
  };
  const events: [number, boolean][] = [];
  let t = 200;
  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      t += dit * 4 * wobble();
      continue;
    }
    for (const el of patternOf(tok)!) {
      events.push([t, true]);
      t += (el === '.' ? dit : dit * 3) * wobble();
      events.push([t, false]);
      t += dit * wobble();
    }
    t += dit * (letterGap - 1) * wobble();
  }
  await page.evaluate(async (evs) => {
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true }));
    }
  }, events);
}

const shot = (page: Page, name: string, theme: string, fullPage = false) => page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage });

test.describe('desktop', () => {
  test.use(DESKTOP);
  for (const theme of THEMES) {
    test(`${theme} live decoder`, async ({ page }) => {
      test.setTimeout(90_000);
      // Pinned at the tone, as after calibration.
      await open(page, 'practice/live', theme, { input: 'mic', sendWpm: 16, pinnedHz: 600 });
      await page.getByRole('button', { name: /Start/ }).click();
      await expect(page.getByLabel('Decoded sending')).toContainText('K1ABC K', { timeout: 60_000 });
      await page.getByRole('button', { name: 'Done sending' }).click();
      await page.waitForTimeout(1500);
      await shot(page, 'live-decoder', theme);
    });

    test(`${theme} send drill`, async ({ page }) => {
      await open(page, 'practice/send', theme, { input: 'straight', sendWpm: 18, level: { koch: 'koch-25' } });
      await page.getByRole('radio', { name: 'Words' }).click();
      await page.getByRole('button', { name: /Start/ }).click();
      const prompt = (await page.locator('.block').first().locator('p').innerText()).trim();
      // Letters run a little close, as they often do: the review names it.
      await key(page, prompt, 18, 2.2);
      await page.getByRole('button', { name: /Done/ }).click();
      await expect(page.getByText('Received')).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, 'send-drill', theme);
    });

    test(`${theme} qso`, async ({ page }) => {
      test.setTimeout(120_000);
      await open(page, 'qso', theme, { input: 'straight', sendWpm: 18, overTimeout: 2 });
      await page.getByText('Contest', { exact: true }).click();
      await page.getByRole('button', { name: 'Start QSO' }).click();
      await expect(page.getByText('Your turn', { exact: true })).toBeVisible({ timeout: 30_000 });
      await key(page, 'K1ABC', 18);
      await page.keyboard.press('Enter');
      await expect(page.getByText('Station sending')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Your turn', { exact: true })).toBeVisible({ timeout: 30_000 });
      const serial = (await page.locator('main').innerText()).match(/K1ABC 5NN (\d+)/)![1];
      await page.getByLabel('Serial').fill(serial);
      await page.getByRole('heading', { level: 1 }).click();
      await key(page, 'TU 5NN 001', 18);
      await page.keyboard.press('Enter');
      await expect(page.getByText('QSO ended')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(400);
      await shot(page, 'qso', theme, true);
    });

    test(`${theme} progress`, async ({ page }) => {
      await open(page, 'progress', theme, { keepSends: true, level: { koch: 'koch-40' } });
      await seed(page);
      await page.reload();
      await page.setViewportSize({ width: 1280, height: 1080 });
      await page.waitForTimeout(800);
      await shot(page, 'progress', theme);
    });
  }
});

test.describe('phone', () => {
  test.use(PHONE);
  for (const theme of THEMES) {
    test(`${theme} practice`, async ({ page }) => {
      await open(page, 'practice', theme, { level: { koch: 'koch-14' } });
      await shot(page, 'phone-practice', theme);
    });

    test(`${theme} pocket round`, async ({ page }) => {
      test.setTimeout(90_000);
      await open(page, 'pocket/round/characters', theme, { level: { koch: 'koch-14' } });
      await page.getByRole('button', { name: 'Start the round' }).click();
      // Answer until one is wrong: the reveal shows both rhythms.
      const kb = page.getByRole('group', { name: 'Answer keyboard' });
      for (let i = 0; i < 8; i++) {
        await expect(page.getByRole('button', { name: 'Play again' })).toBeEnabled({ timeout: 20_000 });
        await page.waitForTimeout(600);
        await kb.getByRole('button', { name: 'M', exact: true }).click();
        if (await page.getByText('You typed').isVisible({ timeout: 2000 }).catch(() => false)) break;
      }
      await expect(page.getByText('You typed')).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, 'phone-pocket', theme);
    });
  }
});

// The project feeds e2e/.fixtures/paris.wav in as the microphone.
test.describe('phone, microphone', () => {
  test.use(PHONE);
  for (const theme of THEMES) {
    test(`${theme} setup`, async ({ page }) => {
      await open(page, 'setup', theme, { input: 'mic' });
      await page.getByRole('button', { name: 'Start mic' }).click();
      // Talking before the keying starts can lock the search onto a voice for a while; wait for the tone.
      await expect(page.getByText(/Heard at 6\d\d/)).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(1500);
      // From "Your tone" down: the device list above names the test's fake microphone.
      await page.getByRole('heading', { name: 'Your tone' }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24));
      await page.waitForTimeout(300);
      await shot(page, 'phone-setup', theme);
    });
  }
});
