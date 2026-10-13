// Radio with two stations 150 Hz apart sending at the same time
// (e2e/.fixtures/radio-pair.wav, played over and over by the fake microphone):
// ZL1RTE at 650 Hz, 20 wpm, and PY2WQS at 800 Hz, 16 wpm (RADIO_PAIR in
// global-setup.ts). Both are read, each as a signal of its own.
import { test, expect } from '@playwright/test';
import { BASE, collectErrors, instrument, savedSignals, settings, watchRadio } from './probe';
import { RADIO_PAIR } from './global-setup';

test.setTimeout(150_000);

test('two stations sending at the same time 150 Hz apart are both read, each as its own signal', async ({ page }) => {
  const errors = collectErrors(page);
  await instrument(page);
  await watchRadio(page);
  await settings(page, { ...BASE, input: 'mic' });
  await page.goto('./#/radio');
  await page.getByRole('button', { name: 'Start' }).click();
  // One followed, the other listed.
  await expect(page.locator('.side ul li button')).toHaveCount(1, { timeout: 60_000 });
  // Both key at the same moment.
  await expect.poll(() => page.locator('main .led.on').count(), { intervals: [100], timeout: 30_000 }).toBe(2);
  let saved: Awaited<ReturnType<typeof savedSignals>> = [];
  await expect
    .poll(
      async () => {
        saved = await savedSignals(page);
        return RADIO_PAIR.map((st) => saved.filter((s) => Math.abs(s.hz - st.pitch) < 15 && s.text.includes(st.text)).length);
      },
      { intervals: [3000], timeout: 60_000 },
    )
    .toEqual([1, 1]);
  expect(saved).toHaveLength(2);
  for (const st of RADIO_PAIR) {
    const s = saved.find((x) => Math.abs(x.hz - st.pitch) < 15)!;
    expect(Math.abs(s.wpm! - st.wpm), `${st.pitch} Hz: ${s.wpm} wpm`).toBeLessThanOrEqual(2);
  }
  // On screen: each one, followed in large text, shows what it sent.
  const hzOf = (s: string) => Number(s.match(/(\d+) Hz/)![1]);
  for (let k = 0; k < 2; k++) {
    const row = page.locator('.side ul li button');
    const hz = hzOf(await row.innerText());
    const st = RADIO_PAIR.find((x) => Math.abs(x.pitch - hz) < 15)!;
    await row.click();
    // Chosen, it stays followed while the other sends.
    expect(Math.abs(hzOf(await page.locator('.following').innerText()) - hz)).toBeLessThan(4);
    await expect(page.getByRole('region', { name: /^Text from the signal at \d+ Hz$/ })).toContainText(st.text);
  }
  expect(errors).toEqual([]);
});
