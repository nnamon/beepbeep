// Your own practice texts: class handouts and word lists you paste or open,
// kept in this browser with the rest of your progress.

import { getKv, setKv } from './db';
import { textsOf } from './records';

export interface SavedText {
  id: string;
  name: string;
  text: string;
  at: number;
}

const KEY = 'texts';

/** Your texts; a stored entry of the wrong shape is left out. */
export async function listTexts(): Promise<SavedText[]> {
  return textsOf(await getKv(KEY, []));
}

export async function saveText(name: string, text: string): Promise<SavedText> {
  const all = await listTexts();
  const t: SavedText = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || 'Untitled', text, at: Date.now() };
  await setKv(KEY, [...all, t]);
  return t;
}

export async function deleteText(id: string): Promise<void> {
  await setKv(KEY, (await listTexts()).filter((t) => t.id !== id));
}
