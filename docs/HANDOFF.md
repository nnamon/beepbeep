# Handoff

Where the work stands and what is left. Read [AGENTS.md](../AGENTS.md) first: it has the tooling, the test rules, the release rule and the rules for the app's wording.

## What happened

In October 2026 a skeptical audit of the whole app found 3 critical, 16 high and about 60 medium and low problems, plus a list of wording problems. Two later independent checks (layout and accessibility; drills and storage) and a check of the QSO screens found more. All of those are fixed, each with a test that failed on the old code. What changed in each version is in [CHANGELOG.md](../CHANGELOG.md) (0.2.0 to 0.2.5) and in the app: tap the version number at the top of any screen.

## What is left

### The Radio tab

Released in 0.3.0 (the screen) and 0.4.0 (every signal at once). The code is in `src/lib/radio/`: `detector.ts` finds each signal and keys it, `channel.ts` turns one channel's keying into continuous text, `multi.ts` joins them behind `source.ts`, `radio.worklet.ts` runs the detector in the browser. Scorecards: `RADIO=all` (detector.test.ts), `RADIO_CHANNEL=1` (channel.score.test.ts), `RADIO_APP=all` (multi.score.test.ts; the app's whole pipeline: 0.8% CER on the 26 scenarios, held-out seeds 2.0% and 0.9%, 0 false characters). All on generated audio.

An independent audit of the Radio work (engine, text pipeline, screen and wording) found confirmed bugs, each with a failing test on its branch: worktree-agent-a4d234012f05515f4 (engine), worktree-agent-af9e279bea74e138f (text pipeline), worktree-agent-a417557abad97f93e (screen and wording). Three fix agents are working from those branches; release the fixes as 0.4.1, and correct the 0.4.0 changelog entry and its GitHub release notes, which overstate what Radio does (it reads up to 8 signals, stations less than 25 Hz apart share one signal, and quiet starts at 30 seconds, not 45).

Known and left as they are:

- No real radio audio has been tested. Ask the owner for recordings off their radio (the debug sample recorder in Setup works for this) and add them as fixtures.
- The radio worklet has run only in Chromium, never in Safari or on an iPhone.
- Heavy static before an over's first mark: `fitSpeed` in `channel.ts` can take static clicks for dits, and half the over reads as dahs (heavy QRN, seed 1: 32.7% against 3.7% with a plain decoder).
- A QSO 12 Hz apart: the weaker, faster side reads B as G and 7 as Q (2.6% against 0.6%).
- A voice talking near the station's pitch (10 to 16%) and deep fading (7 to 13%) are the detector's weakest scenarios. Two stations sending at once under 80 Hz apart: at 50 Hz the weaker reads 23.8%.
- Very slow spacing (18 wpm characters at 5 overall) may split letters into separate overs. "TU" after "SK" starts a new line even from the same station.

### Decoder (`src/lib/dsp`, `src/lib/decoder`)

Known and left as they are:

- **Joined short texts against words of one letter.** Whole-over benchmark (fists.ts beginner fists, read as shown, 8 seeds): before the V V V fix 438 of 512 joined texts exact (14.5% letter error), now 425 (13.4%); V V V 0 to 111 of 192, R R and E E 43 to 209 of 384. The lost readings are joined texts read as words of one letter (VVV as V V V, RR as R R, EE as E E or I). Moving the gap thresholds in `breaks.ts` trades them straight back, so there is no cheap win.
- **All-dah practice groups from beginner fists** (T, M and O only) still read badly: about half their letters wrong (53% for groups of T, M and O, 8 beginner fists, 112 sends), against 8% for groups of K and M and 20% for K, M and R. With no dits in the over, only the gaps tell dits from dahs, and a touch key's gaps inside letters (0.6 to 0.75 of a dah) look like heavy weighting's gaps after dits. With textbook timing they read right.
- **II reads as H at the end of the over** (textbook timing at 8, 10, 15 and 20 wpm, the speed setting the same), though the live reading is II; SII reads SH and EEII reads HI. Over four marks there are too few gaps to call the fist regular, and the search pays less for one pause inside a letter than for a second letter. EEE and SS read right.
- **The second ear is placed once, from the pitch of the first marks.** With nothing pinned, the first marks under a radio put the tone 7 Hz off (163935), and the second ear sat 21 Hz from the harmonic and kept none of its marks for the rest of the over; under talking (154331) it sat 6 Hz off and kept none either. Starting it again where later marks put the tone made the radio take read worse (78% to 89%), and moving the learned offset with the lock as it follows drift added stray letters on a talking take (6 to 11), so neither was kept. Pinned, it sits within 3 Hz on every take.
- **The quieter-sidetone take (154117, no label)** has marks at the harmonic about 11 dB over its floor where the fundamental hears almost nothing. The second ear ignores them, since the fundamental hears silence. Whether they are the keying is not known.

## Not checked

- A real iPhone, the installed app, real notch insets (only emulated with the safe-area tokens) and VoiceOver. The reload into a new build after an update is tested in Chromium and Playwright's WebKit (`e2e/newbuild.spec.ts`), not in Safari on an iPhone.
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
