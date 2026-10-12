// What is saved really reaches storage, and an import can't wipe progress.
import { test, expect, type Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';
import { seed } from './seed';

test.skip(({ browserName }) => browserName !== 'chromium');

async function key(page: Page, text: string, wpm = 18) {
  const dit = 1200 / wpm;
  const evs: [number, boolean][] = [];
  let t = 100;
  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      t += dit * 4;
      continue;
    }
    for (const el of patternOf(tok)!) {
      evs.push([t, true]);
      t += el === '.' ? dit : dit * 3;
      evs.push([t, false]);
      t += dit;
    }
    t += dit * 2;
  }
  await page.evaluate(async (evs) => {
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true }));
    }
  }, evs);
}

function all(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (store) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('beepbeep', 1);
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const g = r.result.transaction(store).objectStore(store).getAll();
          g.onsuccess = () => {
            res(g.result);
            r.result.close();
          };
        };
      }),
    store,
  );
}

const SETTINGS = { input: 'straight', sendWpm: 18, voice: 'off', overTimeout: 2, guideSeen: true };
const open = async (page: Page, route: string, extra: Record<string, unknown> = {}) => {
  await page.addInitScript((s) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify(s)), { ...SETTINGS, ...extra });
  await page.goto(`./#/${route}`);
};

test('a send drill session, with its fist report, is saved', async ({ page }) => {
  await open(page, 'practice/send');
  await page.getByRole('radio', { name: 'Callsigns' }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  const prompt = (await page.locator('.block').first().locator('p').first().innerText()).trim();
  await key(page, prompt);
  await page.getByRole('button', { name: /Done/ }).click();
  await expect(page.getByText('Received')).toBeVisible();
  // Saved when you leave the drill.
  await page.goto('./#/progress');
  await expect.poll(async () => (await all(page, 'sessions')).map((s) => s.mode)).toContain('send');
  const s = (await all(page, 'sessions')).find((x) => x.mode === 'send')!;
  expect(s.fist).toBeTruthy();
});

test('a Live decoder session is saved when you stop', async ({ page }) => {
  await open(page, 'practice/live');
  await page.getByRole('button', { name: /Start/ }).click();
  await key(page, 'CQ CQ DE K1ABC K');
  await page.getByRole('button', { name: 'Done sending' }).click();
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect.poll(async () => (await all(page, 'sessions')).map((s) => s.mode)).toContain('live');
});

async function importFile(page: Page, json: unknown) {
  await page.locator('input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
}

test("a damaged import changes nothing; a good one asks first", async ({ page }) => {
  await open(page, 'progress');
  await seed(page);
  await page.goto('./#/settings');
  const before = (await all(page, 'sessions')).length;
  expect(before).toBeGreaterThan(10);
  // Damaged: items without keys.
  await importFile(page, { app: 'beepbeep', items: [{ heat: 1 }], sessions: [] });
  await expect(page.getByText('That export file is damaged. Nothing was changed.')).toBeVisible();
  expect((await all(page, 'sessions')).length).toBe(before);
  // Not an export at all.
  await importFile(page, { hello: 1 });
  await expect(page.getByText('That is not a BeepBeep export file. Nothing was changed.')).toBeVisible();
  // A good file: declining keeps everything.
  const good = { app: 'beepbeep', version: 1, items: [], sessions: [{ at: Date.now(), mode: 'copy', seconds: 60, sending: false, items: 20, accuracy: 0.9, wpm: 12 }], qsos: [], confusions: [], kv: [] };
  page.once('dialog', (d) => d.dismiss());
  await importFile(page, good);
  await expect(page.getByText('Nothing was changed.', { exact: true })).toBeVisible();
  expect((await all(page, 'sessions')).length).toBe(before);
  // Accepting replaces it, and says what came in.
  page.once('dialog', (d) => {
    expect(d.message()).toContain("the file's 1 session and 0 QSOs");
    void d.accept();
  });
  await importFile(page, good);
  await expect(page.getByText('Imported 1 session and 0 QSOs.')).toBeVisible();
  expect((await all(page, 'sessions')).length).toBe(1);
});

test('an import with old or partial settings keeps every screen working', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'settings');
  page.once('dialog', (d) => void d.accept());
  await importFile(page, { app: 'beepbeep', settings: { you: { call: 'K1ABC' }, level: { licw: 'licw-bc1-2' }, exercisePrefs: null, theme: 'dark' } });
  await expect(page.getByText(/^Imported/)).toBeVisible();
  for (const r of ['settings', 'qso', 'qso/learn', 'practice/class/bc1/vet']) {
    await page.goto(`./#/${r}`);
    await page.waitForTimeout(300);
  }
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!));
  expect(s.you).toEqual({ call: 'K1ABC', name: '', qth: '', state: '', skcc: '' });
  expect(s.level.licw).toBe('licw-bc1-TIN');
  expect(errors).toEqual([]);
});
