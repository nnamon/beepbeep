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

Input is the microphone, or the keyboard as a straight key (Space) or iambic paddles (`[`/`]` or `Z`/`X`).

## How decoding works

1. A peak-hold FFT finds the strongest keyed tone between 300 and 1200 Hz and locks to it.
2. An I/Q detector at that pitch, with a low-pass sized to the sending speed, produces the tone envelope.
3. An adaptive threshold between the noise floor and the signal peak, with hysteresis and a debounce, gives key-down and key-up times.
4. Dit/dah and gap classes come from k-means on recent durations, so speed changes, weighting and Farnsworth spacing are tracked rather than assumed.

Steps 1 to 3 run in an AudioWorklet. The same code runs in the tests, which decode synthetic audio with noise, fading, interference, static, chirp, drift, room echo and hand-sent timing. See `src/lib/decoder/accuracy.test.ts` for the conditions and limits.

## Development

All tooling runs in containers. Nothing is installed on the host.

```sh
docker compose run --rm dev npm install
docker compose run --rm dev npm test                          # unit and decoder accuracy tests
docker compose run --rm dev npm run check                     # svelte-check
docker compose run --rm dev npm run lint:css                  # colour values only in tokens.css
docker compose run --rm --service-ports dev npm run dev       # http://localhost:7373
docker compose run --rm e2e                                   # Playwright: screens, fake-mic decode, flows
```

Screenshots from the e2e run land in `test-results/screens/`.

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`, built inside a `node:24-slim` container).

## Layout

```
src/lib/morse     code table, timing, keying schedules, audio renderer
src/lib/dsp       FFT, filters, tone detector
src/lib/decoder   decoder and pipeline
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
