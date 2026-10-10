import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ALL_TOKENS } from '../morse/code';
import { clipName } from './speech';

describe('built-in voice clips', () => {
  const lines = JSON.parse(readFileSync('scripts/voice-lines.json', 'utf8')) as Record<string, string>;

  it('has a clip and a script line for every character and prosign', () => {
    for (const t of ALL_TOKENS) {
      const name = clipName(t);
      expect(name, t).not.toBeNull();
      expect(lines[name!], `${t} line`).toBeTruthy();
      expect(existsSync(`public/voice/${name}.mp3`), `${t} file`).toBe(true);
    }
  });

  it('has no lines without a token', () => {
    const names = new Set(ALL_TOKENS.map(clipName));
    expect(Object.keys(lines).filter((k) => !names.has(k))).toEqual([]);
  });

  it('leaves words to the device voice', () => {
    expect(clipName('TNX')).toBeNull();
  });
});
