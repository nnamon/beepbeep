# BeepBeep

A CW trainer that runs in the browser. It decodes your key through the microphone, so any sidetone works: a transceiver, a practice oscillator, a keyer toy.

**https://nnamon.github.io/beepbeep/**

Desktop and phone browsers (Safari on iOS 16.4+, current Chrome on Android). Installs as an app and works offline. Progress stays in the browser.

## What it does

| Area | Modes |
| --- | --- |
| Send | Live decoder, send drill (received text first, then one note on your timing) |
| Both | Hear it, send it; QSO simulator |
| Receive | Copy drill, familiarity (LICW BC1), TTR drill, sound surfing (IFR), head copy, callsign and word sprint |
| Pocket | Phone quiz rounds by ear: characters, chunks, words, callsigns, phrases, custom sets |
| QSO | Ragchew, LICW QSO protocol, SKCC, K1USN SST, POTA, SOTA, contest, DX pileup |

Two course tracks: the classic Koch order (K M R S U…) and the LICW Beginners Carousel (BC1, BC2). LICW strict mode applies the LICW Method Guide's guardrails: no rhythm visuals, decoded sending after each over, receive answers at the end of a drill.

Input is the microphone, an on-screen touch key for phones and tablets, or the keyboard as a straight key (Space) or iambic paddles (`[`/`]` or `Z`/`X`). The in-app Guide (`#/guide`) shows where to start with or without a key.

## How decoding works

No trained model: signal processing and a small statistical decoder, tuned against synthetic audio, simulated beginner keying and microphone recordings.

### Hearing the tone (`src/lib/dsp/detector.ts`, in an AudioWorklet)

1. **Find it.** A peak-hold FFT (4096 points, every ~43 ms) picks the strongest keyed peak between 300 and 1200 Hz and locks to it, or uses the pitch pinned in Setup. Audio from the 2.5 s before the lock is replayed, so the first characters are not lost.
2. **Listen only there.** A lock-in (I/Q) detector mixes the input down from that pitch and low-passes I and Q (2nd-order, cutoff about 4/dit: 50 Hz at 15 wpm). Its envelope, at 1 kHz, is the tone's level in a window about 100 Hz wide.
3. **Loud enough.** Levels are in dB against the channel's noise floor, which follows the median level of the room in small steps (10 dB/s), so marks, voices and thumps barely move it. A key-down needs the envelope halfway (in dB) between the floor and the level of recent marks, and at least the squelch: 9 dB by default, or half the tone's rise over the room as measured by calibration. A key-up comes at 40% of that span, or 10 dB below the mark's own level, which ends a mark cleanly through room echo.
4. **The room, not the key.** Two more lock-in channels, a few hundred hertz either side, watch the room. A key-down needs the tone to rise above its floor by 8 dB more than the room lifts them (when the room lifts them by 6 dB or more). Typing, a key's thump, a slammed door and a fan rise across the band; a sidetone rises only in its own channel.
5. **Your tone, not a voice.** The tone channel's phase is compared with itself 4 ms earlier. A keyed tone turns at one fixed rate: its pitch offset from the lock, the same every mark. A key-down needs that steadiness, within 20 Hz of the lock until three marks are learned, then within 10 Hz of your pitch.
6. **Each mark, as a whole.** When a mark ends, its pitch is measured over its steady middle (phase against itself 10 ms earlier, across the whole plateau), which pins it to a hertz or two. It must sit within 3 Hz of the pitch learned from your marks (4 Hz around a pinned pitch until three are in), with more allowance for short marks, whose pitch is known less exactly. A mark that fails is withdrawn. If several withdrawn marks agree on another pitch, the pin was off and that pitch is adopted. While a mark lasts, it ends once the pitch has left yours for 0.6 dit, so a voice carrying on after your dah is not added to it.
7. **Your timbre.** A buzzer or square-wave oscillator has a strong third harmonic at exactly three times its pitch. If your accepted marks show one rising with the tone, every mark must carry it; voices and radios near your pitch rarely do. A pure-sine sidetone shows none, and the test stays off.
8. **Edges.** Each edge is timed where the envelope crosses half the mark's own amplitude (6 dB down), found by looking back up to 200 ms, so a mark keeps its length even when a key's thump delays the decision. A change has to hold for a short debounce. Marks shorter than a quarter dit are dropped as clicks.

On recordings from a laptop microphone (`src/lib/decoder/samples.test.ts`): V's and CQs keyed in a quiet or noisy room read correctly, and talking near the laptop, which the earlier detector turned into 24 to 38 letters a take, now leaves one to three. Keying while typing, talking or a radio plays is the hard case: where another sound covers your tone at your pitch, those moments are lost, and those takes still read with errors. On synthetic room sounds (`src/lib/dsp/room.test.ts`), a fan and typing key nothing (a fan keyed 30 letters in 80 s before) and speech 5 letters in 80 s (58 before).

### Reading the marks (`src/lib/decoder/`)

1. Dit and dah come from k-means on recent mark lengths. Gaps are learned on their own: the deepest valleys in the density of recent gaps (log time) separate gaps inside a letter, between letters and between words. Hand keying needs this, since its gaps do not follow its marks: on a touch key, short taps with long pauses between them.
2. A pattern that is not a character is split at the gap inside it that stands out, as a listener would split two run-together letters.
3. The whole over is decoded again the way an experienced operator copies a beginner (`settle.ts`). Every reading is scored on timing judged per letter (each letter gets its own tempo, drawn from a tempo curve across the over, with an allowance for hesitations that only ever lengthens a gap), plus a light language model: character trigrams over operating text, callsigns and English, and word-level evidence (real words, callsign shapes, numbers, repeats like CQ CQ). A beam search keeps the best readings; the fist is re-estimated from the best one and the over decoded again. Language only breaks ties the timing leaves open: cleanly sent wrong text decodes as sent. The search runs in a worker, and key events are timed by their own timestamps, so neither can disturb the timing being measured.
4. While you key, the over is read again on every letter, but a word is written down once about 20 marks (five or six letters) follow it, read with the full search, and never changes after that (`stable.ts`); later readings must begin with it. Keying faster or slower later does not rewrite what you already saw. On the beginner scorecard this costs about 0.6 points of character error against reading the whole over again.

The same code runs in the tests, which decode synthetic audio with noise, fading, interference, static, chirp, drift, room echo and hand-sent timing (`src/lib/decoder/accuracy.test.ts`), synthetic room sounds (`src/lib/dsp/room.test.ts`), and simulated beginner keying: short dahs, rushed letters, hesitations, speeding up, touch-key pauses (`src/lib/decoder/newbie.test.ts`, which prints a scorecard for the end of the over and for what is shown while keying).

A character shows once the silence after it is longer than a gap inside a character, about 1.7 dits. Measured from key-up (90th percentile, `src/lib/decoder/latency.test.ts`): 184 ms at 12 wpm, 153 ms at 15, 115 ms at 20, 81 ms at 30.

## Development

All tooling runs in containers. Nothing is installed on the host.

```sh
docker compose run --rm dev npm install
docker compose run --rm dev npm test                          # unit and decoder accuracy tests
docker compose run --rm dev npm run check                     # svelte-check
docker compose run --rm dev npm run lint:css                  # colour values only in tokens.css
docker compose run --rm --service-ports dev npm run dev       # http://localhost:7373
docker compose run --rm e2e                                   # Playwright: screens, axe, fake-mic decode, flows, visual
docker compose run --rm voice                                 # regenerate public/voice/ (Kokoro TTS)
```

Screenshots from the e2e run land in `test-results/screens/`, for desktop, iPhone 13, Pixel 7 and a 360 px phone. The specimen page has visual baselines in `e2e/__screenshots__/`; refresh them with `docker compose run --rm e2e npx playwright test e2e/visual.spec.ts --update-snapshots` after a deliberate change.

Real recordings for the decoder go in `fixtures/recordings/` (see the README there). The test is skipped while it is empty.

Microphone samples: a debug server records what the detector hears from a phone or laptop on the local network and saves it on the machine serving it.

```sh
# once: a self-signed certificate (browsers only allow the microphone over https)
docker run --rm -v "$PWD/certs:/c" -w /c mcr.microsoft.com/playwright:v1.63.0-noble \
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout key.pem -out cert.pem \
  -subj "/CN=BeepBeep debug" -addext "subjectAltName=IP:<your LAN address>"
docker compose run -d --name beepbeep-debug --service-ports -e BEEPBEEP_DEBUG=1 dev npx vite --host 0.0.0.0 --port 7373
```

Open `https://<your LAN address>:7373/#/setup`, choose Microphone and use the Record a sample panel. Takes land in `samples/` (not committed) as a WAV with the detector's events and what it decoded; `src/lib/decoder/samples.test.ts` replays them and fails if any take reads worse than `samples/best.json` (`BEST=1` rewrites it).

Spoken answers default to built-in clips for every character and prosign, generated by `scripts/voice_clips.py` with Kokoro-82M (Apache-2.0), voice `am_michael`. Words fall back to the device voice.

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`, built inside a `node:24-slim` container).

## Layout

```
src/lib/morse     code table, timing, keying schedules, audio renderer
src/lib/dsp       FFT, filters, tone detector, synthetic room sounds
src/lib/decoder   decoder, whole-over search, stable live reading, pipeline
src/lib/audio     AudioContext engine, worklet, keyboard keyer, live decoding, speech
src/lib/train     courses, material, spaced repetition, scoring, fist analysis
src/lib/qso       QSO parser and bot stations
src/lib/state     settings, IndexedDB store, router, signal state
src/ui            components
src/views         screens
src/styles        design tokens and base styles
```

## Notes

LICW is a trademark of the Long Island CW Club. BeepBeep is not affiliated with LICW and uses its own generated practice material. Don't run the decoder during LICW classes; LICW treats automated transcription of a class as recording.
