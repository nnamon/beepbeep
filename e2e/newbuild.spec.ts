// After an update the page keeps running the old build until a safe moment,
// then reloads into the new one (src/main.ts, src/lib/state/update.ts). Two
// builds of the app are served in turn from a small server here, the way a new
// deploy replaces the old files, with the service worker in charge.
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { BASE, settings } from './probe';

test.skip(!!process.env.BASE_URL, 'needs two local builds');
test.describe.configure({ mode: 'serial' });

const OLD_ID = 'aaaaaaa';
const NEW_ID = 'bbbbbbb';
// One pair of builds for the whole run, shared by the workers that need it.
const DIR = join(tmpdir(), `beepbeep-newbuild-${process.ppid}`);
const OLD = join(DIR, 'old');
const NEW = join(DIR, 'new');

/** Builds the app twice. The new build has another id and another audio worklet, as after a change to the decoder. */
async function builds() {
  const done = join(DIR, 'done');
  try {
    mkdirSync(DIR);
  } catch {
    await expect.poll(() => existsSync(done), { timeout: 300_000 }).toBe(true);
    if (readFileSync(done, 'utf8')) throw new Error(`The builds failed: ${readFileSync(done, 'utf8')}`);
    return;
  }
  const sha = process.env.GITHUB_SHA;
  try {
    for (const [id, out, changed] of [[OLD_ID, OLD, false], [NEW_ID, NEW, true]] as const) {
      process.env.GITHUB_SHA = id;
      const worklet = { name: 'changed-worklet', transform: (code: string, file: string) => (file.includes('detector.worklet') ? `${code}\nglobalThis.__build = '${id}';` : undefined) };
      await build({ configFile: 'vite.config.ts', logLevel: 'warn', build: { outDir: out, emptyOutDir: true, sourcemap: false }, worker: changed ? { plugins: () => [worklet] } : {} });
    }
    writeFileSync(done, '');
  } catch (e) {
    writeFileSync(done, String(e));
    throw e;
  } finally {
    if (sha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = sha;
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

/** The deployed build. Files of any other build are gone (404), as on GitHub Pages after a deploy. */
let root = OLD;
let server: Server;
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(400_000);
  await builds();
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = join(root, normalize(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, r));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

test.beforeEach(async ({ page }) => {
  root = OLD;
  await page.addInitScript(() => {
    const w = window as unknown as { __swChanged: number };
    w.__swChanged = 0;
    navigator.serviceWorker?.addEventListener('controllerchange', () => w.__swChanged++);
  });
});

const version = (page: Page) => page.locator('header .ver');
const changes = (page: Page) => page.evaluate(() => (window as unknown as { __swChanged: number }).__swChanged);

/** Opens the old build for the first time and waits until its service worker has saved it and took over. */
async function install(page: Page, path: string) {
  await page.goto(`${origin}/#/${path}`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
  await expect(version(page)).toContainText(OLD_ID);
}

/** Marks this page, to tell later whether it was reloaded. */
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
const same = (page: Page) => page.evaluate(() => (window as unknown as { __same?: boolean }).__same === true).catch(() => false);

/** Does something that should reload the page, and waits for the reload. */
async function reloads(page: Page, action: () => Promise<unknown>) {
  const loaded = page.waitForEvent('load', { timeout: 15_000 });
  await action();
  await loaded;
}

/** Deploys the new build while the page is open; the browser finds it and the new service worker takes over. */
async function update(page: Page) {
  root = NEW;
  const before = await changes(page);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect.poll(() => changes(page), { timeout: 60_000 }).toBeGreaterThan(before);
}

test('after an update the app reloads into the new version at the next main screen, not in the middle of a drill', async ({ page }) => {
  test.setTimeout(120_000);
  await settings(page, BASE);
  await install(page, 'progress');
  // Saving the first version is not an update: a move to a main screen keeps the page.
  await mark(page);
  await page.getByRole('link', { name: 'Practice' }).first().click();
  await expect(page).toHaveURL(/#\/practice$/);
  await page.waitForTimeout(500);
  expect(await same(page)).toBe(true);

  // A new version is deployed; the next time the app opens it starts from the
  // saved old version, in the middle of a drill, and finds the new one.
  await page.evaluate(() => (location.hash = '#/practice/copy'));
  root = NEW;
  await page.reload();
  await expect(version(page)).toContainText(OLD_ID);
  await expect.poll(() => changes(page), { timeout: 60_000 }).toBe(1);
  await mark(page);
  // Moving from one drill to another keeps the page.
  await page.evaluate(() => (location.hash = '#/practice/familiarity'));
  await page.waitForTimeout(500);
  expect(await same(page)).toBe(true);
  await expect(version(page)).toContainText(OLD_ID);

  // The next main screen loads the new version.
  await reloads(page, () => page.getByRole('link', { name: 'Progress' }).first().click());
  await expect(version(page)).toContainText(NEW_ID);
  await expect(page).toHaveURL(/#\/progress$/);
  expect(await same(page)).toBe(false);
});

test('a QSO in progress holds the reload off until it ends', async ({ page }) => {
  test.setTimeout(120_000);
  await settings(page, { ...BASE, input: 'straight', you: { call: '9V1NE', name: 'AMON', qth: 'SINGAPORE', state: '', skcc: '' } });
  await install(page, 'qso');
  await page.reload();
  await expect(version(page)).toContainText(OLD_ID);
  const status = page.locator('.status');
  await page.getByRole('radiogroup', { name: 'Who calls CQ' }).getByRole('radio', { name: 'The station' }).click();
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status).toHaveText(/Station sending/);
  await mark(page);

  await update(page);
  // Leaving the QSO keeps it, paused, in this page: no reload.
  await page.getByRole('link', { name: 'Progress' }).first().click();
  await expect(page).toHaveURL(/#\/progress$/);
  await page.waitForTimeout(500);
  expect(await same(page)).toBe(true);
  await page.getByRole('link', { name: 'QSO', exact: true }).first().click();
  await expect(status).toHaveText(/Paused/);
  await expect(version(page)).toContainText(OLD_ID);

  // Once it has ended, the next main screen loads the new version.
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status).toHaveText(/QSO ended/);
  await reloads(page, () => page.getByRole('link', { name: 'Progress' }).first().click());
  await expect(version(page)).toContainText(NEW_ID);
  expect(await same(page)).toBe(false);
});

test('starting the microphone after an update reloads into the new version when the old decoder file is gone', async ({ page }) => {
  test.skip(test.info().project.name !== 'mic', 'needs the fake microphone');
  test.setTimeout(120_000);
  await settings(page, { ...BASE, input: 'mic' });
  await install(page, 'practice/live');
  // The page that loaded first never listens for updates: open it again.
  await page.reload();
  await expect(version(page)).toContainText(OLD_ID);
  await update(page);
  await mark(page);

  // The old build's worklet is gone from the server and from the saved copy.
  await reloads(page, () => page.getByRole('button', { name: 'Start', exact: true }).click());
  await expect(version(page)).toContainText(NEW_ID);
  await expect(page).toHaveURL(/#\/practice\/live$/);
  expect(await same(page)).toBe(false);
  // The new build's microphone works.
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
});
