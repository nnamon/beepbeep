// E0's tables over runs split with PART (see e0.bench.ts), and the joined rows
// in one file.
//
//   FILES=bench/results/e0-x-0of6-...json,... or FILES=e0-x- (a prefix in bench/results/)

import { it } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { e0Report, type E0Row } from './lib/e0report';

it('e0merge', () => {
  const spec = process.env.FILES ?? '';
  const files = spec.includes(',') || spec.endsWith('.json') ? spec.split(',') : readdirSync('bench/results').filter((f) => f.startsWith(spec) && /of\d+-/.test(f)).map((f) => `bench/results/${f}`);
  if (!files.length) throw new Error(`no result files for FILES=${spec}`);
  const runs = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const rows: E0Row[] = runs.flatMap((r) => r.results);
  const { snrs, pitches, timbres, keyings } = runs[0];
  // One array per row, numbers to 4 places: the same data in a tenth of the space.
  const columns = Object.keys(rows[0]) as (keyof E0Row)[];
  const table = rows.map((r) => columns.map((c) => (typeof r[c] === 'number' ? Math.round((r[c] as number) * 1e4) / 1e4 : r[c])));
  writeFileSync(`bench/results/${spec.replace(/-$/, '').replace(/^.*\//, '')}-merged.json`, JSON.stringify({ snrs, pitches, timbres, keyings, files: files.map((f) => f.replace(/^.*\//, '')), columns, rows: table }));
  console.log(`\nE0 over ${files.length} parts: letter error added by noise, mark recall and precision (%)\n${e0Report(rows, snrs)}\n`);
});
