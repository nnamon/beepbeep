# Handoff: audit fixes, October 2026

Where the work stopped and what is left. Read [AGENTS.md](../AGENTS.md) first: it has the tooling, the test rules and the rules for the app's wording.

## What happened

A skeptical audit of the whole app found 3 critical, 16 high and about 60 medium and low problems, plus a list of wording problems. Almost all of them are fixed on `main`. Every fix has a test that failed on the old code.

| Commit | What |
| --- | --- |
| `5d689de` | The 3 critical bugs: sessions not saved, a damaged import wiping progress, Learn QSOs freezing |
| `04e9941` | AGENTS.md: wording rules, the words we use, tooling, design rules |
| `abfdc16`, `32dd369`, `ce4bf02`, `b7544f0` | Drills, Pocket, Today, LICW exercises, Settings, Setup, Progress, Guide, keyboard handling, wording |
| `7febe48` | Merge: layout and accessibility (phones on their side, tap targets, titles and focus, word wrapping) |
| `2d04706` | Merge: QSO simulator and Learn QSOs (when your turn ends, scoring, the checker, region instead of state) |
| the merge after `2d04706` | Merge: decoder (one-letter words keep their spaces, unpinned pitch search, speech near the mic, end-of-over re-read) |

Decoder results recorded in the decoder commits (fists.ts beginner fists and your recordings in `samples/`):

- V V V read exactly: 0 of 192 sends before, 108 after. Other one-letter words: 103 to 242 of 384.
- Nothing pinned: every labelled keying take in `samples/` used to lock onto room rumble near 300 Hz and read nothing; now they read as well as with the 600 Hz pin, except one take (33% against 17% pinned).
- Speech 13 dB below the tone, nothing pinned: 64.5% to 34.1% letter error. Speech alone for 6 minutes, pinned: 38 to 19 stray letters.
- End-of-over re-read making a right reading wrong: 4 to 1 in 1,320 sends.

## What is left, in order

### Decoder (`src/lib/dsp`, `src/lib/decoder`)

Known and left as they are:

- **Joined short texts against words of one letter.** Whole-over benchmark (fists.ts beginner fists, read as shown, 8 seeds): before the V V V fix 438 of 512 joined texts exact (14.5% letter error), now 425 (13.4%); V V V 0 to 111 of 192, R R and E E 43 to 209 of 384. The lost readings are joined texts read as words of one letter (VVV as V V V, RR as R R, EE as E E or I). Moving the gap thresholds in `breaks.ts` trades them straight back, so there is no cheap win.
- **Groups of K and M (Koch lesson 1) split into words of one letter.** "KKKMM MKMK KKMM" keyed with textbook timing at 15 to 20 wpm reads "K K K MM MK MK K K MM", and "TTMT MMT" reads "OM TMM". Before the V V V fix they read "K K KMMMKMK KKMM" and "MO MO", so this is old, not new; it showed when Send drill callsigns at lesson 1 started falling back to groups of the lesson's characters. Being worked on.
- **II reads as H at the end of the over** (textbook timing at 8, 10, 15 and 20 wpm, the speed setting the same), though the live reading is II: with only dits, the end-of-over search takes the letter gap for a gap inside a letter. EEE and SS read right.
- **The second ear is placed once, from the pitch of the first marks.** With nothing pinned, the first marks under a radio put the tone 7 Hz off (163935), and the second ear sat 21 Hz from the harmonic and kept none of its marks for the rest of the over; under talking (154331) it sat 6 Hz off and kept none either. Starting it again where later marks put the tone made the radio take read worse (78% to 89%), and moving the learned offset with the lock as it follows drift added stray letters on a talking take (6 to 11), so neither was kept. Pinned, it sits within 3 Hz on every take.
- **The quieter-sidetone take (154117, no label)** has marks at the harmonic about 11 dB over its floor where the fundamental hears almost nothing. The second ear ignores them, since the fundamental hears silence. Whether they are the keying is not known.

### Timing notes beside the Send drill and Live decoder

`src/lib/train/fist.ts`, the note functions in `src/lib/train/scoring.ts` (from about line 60), `src/ui/FistPanel.svelte`:

8. A dah ratio of 3.0 is shown for sends with no dits; it is made up. Show none when it can't be measured.
9. "Letter gap, aim 3: 6.7 units" can show together with "Timing within range." Pick one.
10. "Weighting, aim 1.0" and "Clean characters" are unexplained. Progress now calls the first "Dit length against the gaps inside letters"; use the same words in the panel and in the note ("Light weighting: 0.50, aim 1.0."). Keep the measured-note format ("Word gaps short: 4.8 units, aim 7.").
11. `FistPanel.svelte` uses a dash as an empty value; write "none" or "no data yet".
12. If `dahRatio` becomes nullable, `Progress.svelte` already guards it with `?.`; check the type.

### Small

14. **README images** (`docs/images/`) show a few old labels (Level 14, older layout). Regenerate: `docker compose run --rm -T -e README_SHOTS=1 -e GITHUB_SHA=$(git rev-parse HEAD) e2e npx playwright test --project=readme`, then look at every image before committing.

## Not checked

- A real iPhone, the installed app, real notch insets (only emulated with the safe-area tokens) and VoiceOver.
- The reload into a new build after an update (`src/main.ts`): it reloads at the next main screen after the service worker changes. No test covers it.
- Starting sound on the first tap after a reload in Learn QSOs is tried only in emulated WebKit. With paddles, that first press starts the sound but is not decoded.

## Tests that fail at random on a busy machine

The tests that key in the browser with timers (Learn QSOs on the touch key and straight key, "go to Setup mid-lesson", calibrate on the touch key, the Send drill flow on the mic project) misread when the machine is loaded (load average over about 10), because the page's timers and audio clock run late. They pass when run alone. `e2e/qso.spec.ts` and `e2e/qsolearn.spec.ts` retry twice for this reason. Before believing such a failure, run the spec alone with `--workers=1`.

## Housekeeping

- The unfinished `settle.ts` change was measured and dropped (commit "Handoff: the last decoder items"); its patch file is deleted.
- The audit's own files (specs, logs, screenshots) were in a temporary scratch folder and may be gone. The findings that matter are written out above.

## How to resume

1. Read AGENTS.md and this file.
2. `docker compose run --rm -T dev npm install`, then the checks in AGENTS.md, to see that `main` is green.
3. Work down "What is left" from item 1. Decoder changes: run `npm test` (it includes the accuracy suites and the `samples/` takes) and `npm run bench`, and give before and after numbers in the commit message, as the decoder commits do.
4. Delete each item from this file when it is done; delete the file when the list is empty.
