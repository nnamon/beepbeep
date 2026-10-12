// Local storage of progress: item stats, sessions, the QSO log, confusions and
// recorded voice clips. Nothing leaves the device; export/import is a file.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ItemStat } from '../train/srs';
import type { FistReport } from '../train/fist';
import { confusionRow, DAMAGED, itemRow, kvRow, qsoRow, sessionRow } from './records';

export interface SessionRecord {
  id?: number;
  at: number;
  mode: string;
  track?: string;
  level?: string;
  seconds: number;
  sending: boolean;
  items: number;
  accuracy: number | null;
  /** Character / effective speed used. */
  wpm: number;
  effectiveWpm?: number;
  /** Measured sending speed (send drills). */
  sentWpm?: number;
  ttrDelay?: number;
  /** Average characters to recover after a miss (IFR). */
  recovery?: number | null;
  fist?: FistReport | null;
  stretch?: boolean;
}

export interface QsoRecord {
  id?: number;
  at: number;
  format: string;
  opener: string;
  call: string;
  name: string;
  qth: string;
  state: string;
  rstSent: string;
  rstRcvd: string;
  seconds: number;
  overs: number;
  /** Share of the bot's details you copied correctly (0..1). */
  copyScore: number;
  /** Share of your details the bot received (0..1). */
  sendScore: number;
  wpm: number;
}

interface Schema extends DBSchema {
  items: { key: string; value: ItemStat };
  sessions: { key: number; value: SessionRecord; indexes: { at: number; mode: string } };
  qsos: { key: number; value: QsoRecord; indexes: { at: number } };
  confusions: { key: string; value: { pair: string; want: string; got: string; count: number; last: number } };
  voice: { key: string; value: { token: string; blob: Blob } };
  kv: { key: string; value: { key: string; value: unknown } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>('beepbeep', 1, {
      upgrade(d) {
        d.createObjectStore('items', { keyPath: 'key' });
        const s = d.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        s.createIndex('at', 'at');
        s.createIndex('mode', 'mode');
        const q = d.createObjectStore('qsos', { keyPath: 'id', autoIncrement: true });
        q.createIndex('at', 'at');
        d.createObjectStore('confusions', { keyPath: 'pair' });
        d.createObjectStore('voice', { keyPath: 'token' });
        d.createObjectStore('kv', { keyPath: 'key' });
      },
    });
  }
  return dbp;
}

/**
 * A plain copy for storage. Svelte state is a proxy, which IndexedDB cannot
 * store (DataCloneError), so every record goes through this first.
 */
function plain<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export async function getItems(prefix: string): Promise<Map<string, ItemStat>> {
  const all = await (await db()).getAll('items', IDBKeyRange.bound(prefix, `${prefix}￿`));
  return new Map(all.map((s) => [s.key, s]));
}

export async function putItem(s: ItemStat) {
  await (await db()).put('items', plain(s));
}

export async function addSession(s: SessionRecord): Promise<number> {
  return (await db()).add('sessions', plain(s));
}

export async function sessions(): Promise<SessionRecord[]> {
  return (await db()).getAllFromIndex('sessions', 'at');
}

export async function addQso(q: QsoRecord): Promise<number> {
  return (await db()).add('qsos', plain(q));
}

export async function qsos(): Promise<QsoRecord[]> {
  return (await db()).getAllFromIndex('qsos', 'at');
}

export async function addConfusion(want: string, got: string) {
  const d = await db();
  const pair = `${want}>${got}`;
  const cur = await d.get('confusions', pair);
  await d.put('confusions', { pair, want, got, count: (cur?.count ?? 0) + 1, last: Date.now() });
}

export async function confusions() {
  return (await db()).getAll('confusions');
}

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const r = await (await db()).get('kv', key);
  return (r?.value as T) ?? fallback;
}

export async function setKv(key: string, value: unknown) {
  await (await db()).put('kv', { key, value: plain(value) });
}

export async function voiceClip(token: string): Promise<Blob | null> {
  return (await (await db()).get('voice', token))?.blob ?? null;
}

export async function saveVoiceClip(token: string, blob: Blob) {
  await (await db()).put('voice', { token, blob });
}

export async function deleteVoiceClip(token: string) {
  await (await db()).delete('voice', token);
}

export async function voiceTokens(): Promise<string[]> {
  return (await db()).getAllKeys('voice');
}

/** Everything except voice clips, as one JSON-able object. */
export async function exportAll() {
  const d = await db();
  return {
    app: 'beepbeep',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: await d.getAll('items'),
    sessions: await d.getAll('sessions'),
    qsos: await d.getAll('qsos'),
    confusions: await d.getAll('confusions'),
    kv: await d.getAll('kv'),
  };
}

type Export = Awaited<ReturnType<typeof exportAll>>;

/**
 * The records in an export file, checked field by field before anything is
 * replaced. A bad optional field is left out or mended; a record the app
 * couldn't use throws a plain message, and nothing is imported.
 */
export function readExport(data: unknown): Export {
  const d = data as Partial<Record<keyof Export, unknown>> | null;
  if (!d || typeof d !== 'object' || d.app !== 'beepbeep') throw new Error('That is not a BeepBeep export file. Nothing was changed.');
  const list = <T>(v: unknown, row: (r: unknown) => T): T[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Error(DAMAGED);
    return v.map(row);
  };
  return {
    app: 'beepbeep',
    version: 1,
    exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : '',
    items: list(d.items, itemRow),
    sessions: list(d.sessions, sessionRow),
    qsos: list(d.qsos, qsoRow),
    confusions: list(d.confusions, confusionRow),
    kv: list(d.kv, kvRow).filter((r) => r !== null),
  };
}

/** Replaces all progress with an export's. All or nothing: a failure part-way leaves everything as it was. */
export async function importAll(data: unknown) {
  const v = readExport(data);
  const d = await db();
  const tx = d.transaction(['items', 'sessions', 'qsos', 'confusions', 'kv'], 'readwrite');
  tx.done.catch(() => undefined);
  try {
    for (const s of ['items', 'sessions', 'qsos', 'confusions', 'kv'] as const) await tx.objectStore(s).clear();
    for (const r of v.items) await tx.objectStore('items').put(plain(r));
    for (const r of v.sessions) await tx.objectStore('sessions').put(plain(r));
    for (const r of v.qsos) await tx.objectStore('qsos').put(plain(r));
    for (const r of v.confusions) await tx.objectStore('confusions').put(plain(r));
    for (const r of v.kv) await tx.objectStore('kv').put(plain(r));
    await tx.done;
  } catch {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    throw new Error('That export file could not be read. Nothing was changed.');
  }
}

/** Things you made rather than progress: kept by Delete progress. */
const KEPT_KV = ['texts', 'pocket.custom'];

/** Deletes progress: scores, sessions, the QSO log, notes kept about your sending, and recorded voice clips. */
export async function clearAll() {
  const d = await db();
  const kept = await Promise.all(KEPT_KV.map((key) => d.get('kv', key)));
  for (const s of ['items', 'sessions', 'qsos', 'confusions', 'kv', 'voice'] as const) await d.clear(s);
  for (const row of kept) if (row) await d.put('kv', row);
}
