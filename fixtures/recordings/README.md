# Real recordings

Recordings for the decoder test in `src/lib/decoder/recordings.test.ts`. The test is skipped while this folder has none.

For each recording add:

- `name.wav`: any sample rate; 8, 16, 24 or 32-bit PCM or 32-bit float; mono or stereo.
- `name.txt`: the text that was sent. Prosigns as `<AR>`, `<BT>`, `<SK>`.

Optional header lines in the `.txt`:

- `# max 0.08`: allowed character error rate (default 0.05).
- `# wpm 18`: starting speed guess (default 15).

Run: `docker compose run --rm dev npx vitest run src/lib/decoder/recordings.test.ts`
