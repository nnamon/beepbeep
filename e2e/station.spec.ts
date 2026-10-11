// Your station: set once in Settings, kept across visits, used in practice.
import { test, expect } from '@playwright/test';

test('your station details persist and feed the send drill', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('beepbeep.settings.v1')) localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'straight', voice: 'off', guideSeen: true }));
  });
  await page.goto('./#/settings');
  await page.locator('#you-call').fill('9v1ab');
  await page.locator('#you-name').fill('jose');
  await page.locator('#you-qth').fill('tampines');
  await page.locator('#you-region').fill('singapore');
  await page.reload();
  await expect(page.locator('#you-call')).toHaveValue('9v1ab');
  await expect(page.locator('#you-region')).toHaveValue('singapore');

  await page.goto('./#/practice/send');
  await page.getByRole('radio', { name: 'My station' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  const prompt = page.locator('.block', { hasText: 'Send' }).first();
  await expect(prompt).toContainText(/9V1AB|JOSE|TAMPINES|SINGAPORE/);
  await page.screenshot({ path: 'test-results/screens/flow-my-station.png' });
});
