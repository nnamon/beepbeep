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
        // Read only: before the app has made its database, don't make an empty one in its place.
        r.onupgradeneeded = () => r.transaction!.abort();
        r.onerror = () => (r.error?.name === 'AbortError' ? res([]) : rej(r.error));
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

// Before: leaving by a link without Stop saved nothing (Esc, which presses Stop, did).
for (const leave of ['the Back link', 'a link in the header']) {
  test(`a Live decoder session is saved when you leave by ${leave} without Stop`, async ({ page }) => {
    await open(page, 'practice/live');
    await page.getByRole('button', { name: /Start/ }).click();
    await key(page, 'CQ CQ DE K1ABC K');
    await page.waitForTimeout(500);
    if (leave === 'the Back link') await page.getByRole('link', { name: 'Back', exact: true }).click();
    else await page.locator('nav.nav a', { hasText: 'Progress' }).click();
    await expect.poll(async () => (await all(page, 'sessions')).filter((s) => s.mode === 'live').length).toBe(1);
    const s = (await all(page, 'sessions')).find((x) => x.mode === 'live')!;
    expect(s.items).toBeGreaterThanOrEqual(10);
    expect(s.fist).toBeTruthy();
  });
}

test('a Live decoder left with nothing sent saves nothing', async ({ page }) => {
  await open(page, 'practice/live');
  await page.getByRole('button', { name: /Start/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/practice$/);
  await page.waitForTimeout(800);
  expect((await all(page, 'sessions')).filter((s) => s.mode === 'live')).toEqual([]);
});

const THEM = { call: 'W1AW', name: 'BOB', qth: 'NEWINGTON', state: 'CT', skcc: '1234', rig: 'K3', ant: 'DIPOLE', pwr: '100', wx: 'SUNNY', age: '50', job: 'PILOT', rst: '579', serial: 42, pitchOffset: 0, verbosity: 0.5, repeats: 2, pace: 0, abbrev: 1 };

// Before: the lesson's tally was saved without a catch, so an unavailable store
// raised an unhandled error at the end of the lesson.
test('finishing a Learn QSOs lesson with storage unavailable raises no error', async ({ page }) => {
  await page.addInitScript((them) => {
    const w = window as unknown as { __rejections: string[] };
    w.__rejections = [];
    window.addEventListener('unhandledrejection', (e) => w.__rejections.push(String((e.reason as Error)?.message ?? e.reason)));
    IDBFactory.prototype.open = function () {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    } as typeof IDBFactory.prototype.open;
    // The lesson's last step: a note, then Next finishes it.
    sessionStorage.setItem('beepbeep.qsoLearn.run', JSON.stringify({ lesson: 'answer-cq', them, idx: 2, firstTry: 2, at: Date.now() }));
  }, THEM);
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'type', you: { call: '9V1NE', name: 'AMON', qth: 'SINGAPORE', state: '', skcc: '' } });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('You finished this lesson.')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
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

/** Opens the screens that read progress, and starts a Pocket round where there is one; returns the page errors. */
async function visitProgressScreens(page: Page): Promise<string[]> {
  const errors: string[] = [];
  const on = (e: Error) => errors.push(`${page.url().split('#')[1]}: ${e.message}`);
  page.on('pageerror', on);
  for (const r of ['progress', 'practice', 'pocket', 'pocket/custom', 'pocket/round/characters', 'pocket/round/custom']) {
    await page.goto(`./#/${r}`);
    await page.waitForTimeout(700);
    const start = page.getByRole('button', { name: 'Start the round' });
    if (await start.isVisible().catch(() => false)) {
      await start.click();
      await page.waitForTimeout(1200);
    }
  }
  await page.goto('./#/progress');
  await page.waitForTimeout(700);
  page.off('pageerror', on);
  return errors;
}

const NOW = Date.now();
const DAMAGED = 'That export file is damaged. Nothing was changed.';

// Before: rows that only had their key field were taken whole, and the wrong
// types broke Progress, Pocket and the Pocket round after the import.
const ODD: [string, Record<string, unknown>, string | RegExp][] = [
  ['items whose numbers are text', { items: [{ key: 'rx:K', heat: 'hot', seen: 'x', correct: null, avgMs: 0, recent: 'abc', log: 5, lastSeen: 'yesterday' }] }, DAMAGED],
  ['an item whose answer log is not a list', { items: [{ key: 'rx:K', heat: 1, seen: 1, correct: 1, avgMs: 0, recent: [1], lastSeen: NOW, log: 5 }] }, /^Imported 0 sessions/],
  [
    'sessions with a bad timing report and speed',
    {
      sessions: [
        { at: NOW, mode: 'send', seconds: 60, sending: true, items: 1, accuracy: 1, wpm: 15, sentWpm: 'quick', fist: 'bad' },
        { at: NOW + 1, mode: 'send', seconds: 60, sending: true, items: 1, accuracy: 1, wpm: 15, fist: { chars: 'x', wpm: 'y' } },
      ],
    },
    /^Imported 2 sessions/,
  ],
  ['a confusion with nothing heard', { confusions: [{ pair: 'H>5', want: 'H', got: null, count: 1, last: NOW }] }, DAMAGED],
  ['a Pocket custom set that is a number', { kv: [{ key: 'pocket.custom', value: 5 }] }, /^Imported/],
  ['a Pocket custom set without lists', { kv: [{ key: 'pocket.custom', value: { chars: 'KM', words: null } }] }, /^Imported/],
];

for (const [label, body, note] of ODD) {
  test(`an import of ${label} is refused or mended, and the progress screens still work`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, 'progress');
    await seed(page);
    await page.goto('./#/settings');
    page.on('dialog', (d) => void d.accept());
    await importFile(page, { app: 'beepbeep', ...body });
    await expect(page.getByText(note)).toBeVisible();
    expect(await visitProgressScreens(page)).toEqual([]);
  });
}

function put(page: Page, rows: Record<string, Record<string, unknown>[]>): Promise<void> {
  return page.evaluate(
    (rows) =>
      new Promise<void>((res, rej) => {
        const r = indexedDB.open('beepbeep', 1);
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction(Object.keys(rows), 'readwrite');
          for (const [s, list] of Object.entries(rows)) for (const row of list) tx.objectStore(s).put(row);
          tx.oncomplete = () => {
            r.result.close();
            res();
          };
          tx.onerror = () => rej(tx.error);
        };
      }),
    rows,
  );
}

test('bad values already stored do not break the progress screens', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, 'progress');
  await page.waitForTimeout(500);
  await put(page, {
    items: [{ key: 'rx:K', heat: 1, seen: 1, correct: 1, avgMs: 0, recent: [1], lastSeen: NOW, log: 5 }],
    sessions: [{ at: NOW, mode: 'send', seconds: 60, sending: true, items: 1, accuracy: 1, wpm: 15, sentWpm: 'quick', fist: 'bad' }],
    confusions: [{ pair: 'H>5', want: 'H', got: null, count: 1, last: NOW }],
    kv: [
      { key: 'pocket.custom', value: { chars: 'KM', words: null } },
      { key: 'recentSends', value: {} },
      { key: 'sendSlips', value: 'x' },
    ],
  });
  expect(await visitProgressScreens(page)).toEqual([]);
});
