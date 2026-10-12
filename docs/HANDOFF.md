# Handoff

Where the work stands and what is left. Read [AGENTS.md](../AGENTS.md) first: it has the tooling, the test rules, the release rule and the rules for the app's wording.

## What happened

In October 2026 a skeptical audit of the whole app found 3 critical, 16 high and about 60 medium and low problems, plus a list of wording problems. Two later independent checks (layout and accessibility; drills and storage) and a check of the QSO screens found more. All of those are fixed, each with a test that failed on the old code. What changed in each version is in [CHANGELOG.md](../CHANGELOG.md) (0.2.0 to 0.2.5) and in the app under Settings, What's new.

## What is left

### Decoder (`src/lib/dsp`, `src/lib/decoder`)

Known and left as they are:

- **Joined short texts against words of one letter.** Whole-over benchmark (fists.ts beginner fists, read as shown, 8 seeds): before the V V V fix 438 of 512 joined texts exact (14.5% letter error), now 425 (13.4%); V V V 0 to 111 of 192, R R and E E 43 to 209 of 384. The lost readings are joined texts read as words of one letter (VVV as V V V, RR as R R, EE as E E or I). Moving the gap thresholds in `breaks.ts` trades them straight back, so there is no cheap win.
- **All-dah practice groups from beginner fists** (T, M and O only) still read badly: about half their letters wrong (53% for groups of T, M and O, 8 beginner fists, 112 sends), against 8% for groups of K and M and 20% for K, M and R. With no dits in the over, only the gaps tell dits from dahs, and a touch key's gaps inside letters (0.6 to 0.75 of a dah) look like heavy weighting's gaps after dits. With textbook timing they read right.
- **II reads as H at the end of the over** (textbook timing at 8, 10, 15 and 20 wpm, the speed setting the same), though the live reading is II; SII reads SH and EEII reads HI. Over four marks there are too few gaps to call the fist regular, and the search pays less for one pause inside a letter than for a second letter. EEE and SS read right.
- **The second ear is placed once, from the pitch of the first marks.** With nothing pinned, the first marks under a radio put the tone 7 Hz off (163935), and the second ear sat 21 Hz from the harmonic and kept none of its marks for the rest of the over; under talking (154331) it sat 6 Hz off and kept none either. Starting it again where later marks put the tone made the radio take read worse (78% to 89%), and moving the learned offset with the lock as it follows drift added stray letters on a talking take (6 to 11), so neither was kept. Pinned, it sits within 3 Hz on every take.
- **The quieter-sidetone take (154117, no label)** has marks at the harmonic about 11 dB over its floor where the fundamental hears almost nothing. The second ear ignores them, since the fundamental hears silence. Whether they are the keying is not known.

## Not checked

- A real iPhone, the installed app, real notch insets (only emulated with the safe-area tokens) and VoiceOver.
- The reload into a new build after an update (`src/main.ts`, `src/lib/state/update.ts`): checked once by hand with two builds swapped under a running page (a microphone start that hits a file of the old build reloads into the new one; a QSO in progress holds the reload off), but no repo test covers it.
- Starting sound on the first tap after a reload in Learn QSOs is tried only in emulated WebKit. With paddles, that first press starts the sound but is not decoded.

## Tests that fail at random on a busy machine

The tests that key in the browser with timers (Learn QSOs on the touch key and straight key, "go to Setup mid-lesson", calibrate on the touch key, the Send drill flow on the mic project) misread when the machine is loaded (load average over about 10), because the page's timers and audio clock run late. They pass when run alone. `e2e/qso.spec.ts` and `e2e/qsolearn.spec.ts` retry twice for this reason. Before believing such a failure, run the spec alone with `--workers=1`.

## Housekeeping

- The audit and check files (specs, logs, screenshots) were in a temporary scratch folder and may be gone. The findings that matter are written out above or fixed.

## How to resume

1. Read AGENTS.md and this file.
2. `docker compose run --rm -T dev npm install`, then the checks in AGENTS.md, to see that `main` is green.
3. Work down "What is left". Decoder changes: run `npm test` (it includes the accuracy suites and the `samples/` takes) and `npm run bench`, and give before and after numbers in the commit message, as the decoder commits do.
4. Release as AGENTS.md says (version, CHANGELOG.md, tag, GitHub release). Delete each item from this file when it is done; delete the file when the list is empty.
