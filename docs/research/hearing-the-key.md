# Hearing the key in a noisy room

Research notes for BeepBeep's microphone decoder. The goal is to copy a beginner's sidetone through a phone or laptop microphone in ordinary surroundings (people talking, a radio or TV, typing, traffic, wind) about as well as an experienced operator in the same place, without cables or a special microphone.

Started 11 Oct 2026; updated as experiments finish.

## 1. The problem

Input: one microphone channel at 44.1 or 48 kHz from a consumer device, possibly with processing that cannot be fully turned off (section 7). The target is a keyed sidetone at one pitch between 300 and 1200 Hz, stable to 1–2 Hz, either with harmonics (buzzers, square-wave oscillators) or a pure sine (most radios). A beginner keys it, so marks and gaps are uneven. Everything else in the room is interference, and some of it is louder than the tone at the tone's frequency.

Output: the text, live. Earlier words are fixed once enough has followed them.

Target: an experienced operator in the same room. They copy through talking, a radio or passing traffic, lose what is completely masked, and fill in part of it from context.

## 2. How listeners separate a tone from other sounds

Human frequency resolution is not much finer than the detector's, so most of a listener's advantage comes from how sounds are grouped and from inference.

**Frequency selectivity.** The auditory filter at 600 Hz is about 90 Hz wide (equivalent rectangular bandwidth, ERB = 24.7 (4.37 f/kHz + 1) Hz, Glasberg & Moore 1990), about the same as the detector's band (cutoff about 4/dit, 50 Hz either side at 15 wpm). Listeners still separate a tone from a voice that overlaps it, so the separation comes mainly from grouping and inference. The measurements in section 6 agree: steeper and narrower filters made the recordings worse.

**Glimpsing.** Speech and most everyday noise are sparse in time and frequency. At any moment much of the spectrum is quiet, and the target dominates many small regions even at poor overall SNR. Cooke's glimpsing model predicts intelligibility in noise from the share of the time-frequency plane where the target leads by a few dB (Cooke 2006). For a keyed tone, the glimpses are the moments when the tone's own frequencies (pitch and harmonics) are above the room.

**Harmonicity.** Components at exact multiples of one fundamental are heard as one sound; a component mistuned by a few percent is heard separately (Moore, Glasberg & Peters 1986). A sidetone with harmonics is an exact harmonic series at a fixed pitch. A voice is also a harmonic series, at its own fundamental, which glides.

**Common onset and temporal coherence.** Components that start, stop and change together are heard as one source (Bregman 1990). Shamma, Elhilali & Micheyl (2011) propose that temporal coherence across feature channels is the main basis of stream formation, with attention to one feature (here, the known pitch) binding everything coherent with it. A keyed tone's fundamental and harmonics switch on and off within the same millisecond, in Morse rhythm; speech and noise do not.

**Comodulation.** A tone is easier to detect in fluctuating noise when the same fluctuation appears in other frequency bands (comodulation masking release, Hall, Haggard & Fernandes 1984). The auditory system uses bands away from the signal to estimate the masker at the signal. A machine version estimates the masker in the tone's band from its flanking bands and looks at the remainder.

**Continuity and restoration.** When a louder sound covers a tone, listeners hear the tone continue through it, provided the louder sound could have masked it (auditory induction, Warren). A masked stretch is treated as unknown rather than as silence and is filled from what came before and after. The machine counterpart is missing-data inference: masked time-frequency regions are treated as unreliable, bounded by the energy observed there, and the source model decides (Cooke, Green, Josifovski & Vizinho 2001; bounded marginalisation).

**Knowledge of the source.** Listeners use what they know about the source: the pitch and timbre of this sidetone, Morse rhythm, likely next letters and words. An operator copying behind knows that "CQ CQ D" is followed by E. The decoder's whole-over search and language model already cover part of this.

**Stream build-up and attention.** A stream takes seconds to form and is then followed through interruptions. Locking to the operator's tone at calibration (pitch, harmonics, level) is the closest equivalent in the detector.

**Two ears.** Listeners also separate sounds by direction. A phone or laptop gives one microphone channel, so this cue is not available.

## 3. The detector against these cues

| Cue | Today (detector.ts) | Gap |
|---|---|---|
| Frequency selectivity | lock-in at the pitch, 2nd-order low-pass ~4/dit | adequate; narrower is worse (6) |
| Glimpsing | none explicit; one band's level against its floor | no time–frequency view of where the tone leads |
| Harmonicity | learned 3rd-harmonic level; a second detector at 3f | only the 3rd harmonic; no harmonic sieve; no use of 2f, 5f |
| Common onset / coherence | none across bands | fundamental and harmonics are judged separately, then OR-ed |
| Comodulation | two flanking channels; key-down needs contrast | flanks only veto; the masker at the tone is not estimated from them |
| Continuity | none | masked stretches become silence; marks are withdrawn or split |
| Source knowledge | learned pitch (±3 Hz), harmonic level; whole-over decoder with language model | the decoder sees hard marks only, never "unknown here" |
| Evaluation | 16 real takes, synthetic suite | no SNR curves, few labelled takes, no mark-level ground truth |

The largest gap is that every decision (mark or no mark, where it starts and ends) is made early and as a hard decision, from one band at a time, and the decoder, which models Morse and language, is never told that a stretch was masked.

## 4. Hypotheses

- **H1 (where the errors are).** In noisy takes, most remaining character errors come from stretches where the tone is masked at the fundamental, and a decoder told which stretches were masked can recover much of the text from context.
- **H2 (grouping).** Requiring the fundamental and its harmonics to switch together (common onset, harmonic sieve at the learned pitch), and estimating the masker at the tone from the flanking bands, separates a keyed sidetone from speech and radio better than any single-band test.
- **H3 (soft decisions).** Passing the decoder per-frame evidence (likelihood that the tone is on, and whether the frame was masked) and decoding with a Morse timing model and the language model beats hard marks.
- **H4 (learning).** A small network trained on semi-synthetic mixtures to estimate per-frame tone presence beats hand-built features, and carries over to real recordings.

## 5. Method

**Corpus.**

1. *Real takes*, recorded with the debug server's sample recorder (raw microphone, detector events, what was keyed). Labels are the text; mark timing is not known exactly.
2. *Playback takes*: the app plays a known text, rendered with a simulated hand fist, through a speaker in the real environment while a microphone records. Exact text and mark timing, in any place, without the operator keying. Same device (offset known) or a second device (aligned afterwards by cross-correlating the known keying with the recording).
3. *Semi-synthetic mixtures*: real noise beds (room-only takes; public corpora) mixed with synthetic sidetones (sine, square, buzzer spectra; speaker colouring; room reverberation) at controlled SNRs and simulated fists. Exact ground truth for any number of conditions.

Public noise and speech, by licence: MUSAN (music, speech, noise; CC BY 4.0, per-file licences listed; Snyder, Chen & Povey 2015); DEMAND (18 indoor and outdoor environments, 16 kHz and 48 kHz; CC BY 4.0 per its Zenodo record; Thiemann, Ito & Vincent 2013). In use: DEMAND, channel 1 of each environment (`data/demand/`, not committed). FSD50K clips carry per-clip licences (CC0, CC BY, CC BY-NC, Sampling+); ESC-50 is CC BY-NC. Anything trained into the shipped app uses CC0, CC BY or CC BY-SA material only; NC material is for evaluation at most.

**Metrics.** Character error rate on text; per-mark precision, recall and timing error where timing is known; stray letters per minute on noise alone; per-frame presence ROC (area and the operating point); and, per noise type, the SNR at which character error falls below 5% and below 20% (psychometric-style curves, as in detection studies). Live latency must not exceed the current figures.

**Protocol.** Development and test sets fixed before tuning; tuning on development data only; results reported on test data; every change replayed against all real takes (the ratchet in `samples.test.ts`).

**Baselines.** The detector before 11 Oct 2026, the current detector, a plain band-energy detector, and an external decoder for reference (fldigi's CW decoder, run in a container) if practical.

## 6. Results so far (11 Oct 2026, 16 real laptop takes, one operator, one oscillator with a strong 3rd harmonic)

- Thresholds in dB against a median-tracked floor, and edge timing relative to the mark's level: V's keyed in a noisy room decode correctly (they were garbled).
- Contrast against two flanking bands: a fan and typing alone key nothing (synthetic: fan 30 letters in 80 s before).
- Pitch steadiness and whole-mark pitch (±3 Hz of the learned pitch): talking alone fell from 24 and 38 letters per take to 3 and 3; synthetic speech from 58 letters in 80 s to 5.
- Second detector at the 3rd harmonic, used where the fundamental hears sound that is not the tone: keying under typing 50% → 17% and 57% → 14% character error; keying under talking 100% → 83%; radio in the background unchanged at 111%.
- Negative: 4th-order and narrower lock-in filters (cutoff 2/dit to 4/dit) made the real takes worse on every count. This agrees with section 2: frequency selectivity is not the limit.

## 6a. Benchmark results

Tooling: `bench/` (run with `docker compose run --rm dev npm run bench -- <name>`). Scenes are synthetic keyed sidetones (600 Hz unless stated; sine or square-wave spectrum; simulated fists) mixed into DEMAND environments, three laptop room takes and synthetic speech; SNR is the fundamental against the noise within one ERB. Results in `bench/results/`.

**Ceilings** (`ceiling`). On clean scenes both the detector before 11 Oct and the 11 Oct detector reproduce the true marks exactly (recall 1.00). Decoding the true marks of the four benchmark keyings gives 0, 17, 17 and 33% letter error. This is the decoder's own error on these fists, separate from detection. All benchmark error figures below are against the decoding of the true marks, so they count only what noise adds.

**E2, front-end evidence** (11 Oct, 21 beds, 10 held out for testing). Per-frame ROC area, tone on vs off:

| | f0 level | f0 vs flanks | f0 + pitch steadiness | best of harmonics 1–5 | logistic, all features |
|---|---|---|---|---|---|
| sine 0 dB | 0.704 | 0.709 | **0.782** | 0.579 | 0.768 |
| sine +6 dB | 0.846 | 0.851 | **0.913** | 0.680 | 0.896 |
| square 0 dB | 0.704 | 0.709 | 0.782 | 0.792 | **0.858** |
| square +6 dB | 0.846 | 0.851 | 0.913 | 0.903 | **0.967** |
| square +12 dB | 0.936 | 0.945 | 0.977 | 0.967 | **0.996** |

- Pitch steadiness (phase at the pitch, against itself 4 ms earlier) is the strongest single cue; the logistic model puts most weight on steadiness at harmonics 1, 3 and 5.
- Harmonics help when the tone has them and hurt when it does not, so the front end needs to know the operator's timbre (H2 holds for harmonic tones).
- Two flanking bands as a masker estimate add almost nothing (0.704 → 0.709). This does not rule out comodulation; the estimator is crude.

**E1, oracles** (11 Oct, 21 beds: 17 DEMAND environments, 3 laptop takes, synthetic speech; four keyings). Letter error added by noise, averaged over beds:

| band SNR (dB) | −6 | −3 | 0 | +3 | +6 | +10 | +15 |
|---|---|---|---|---|---|---|---|
| ideal listener, fundamental only (sine) | 83 | 70 | 56 | 31 | 16 | 5 | 0 |
| ideal listener, with harmonics (square) | 74 | 57 | 30 | 7 | 3 | 1 | 0 |
| detector, 11 Oct (sine) | 95 | 94 | 92 | 89 | 83 | 61 | 28 |
| detector, 11 Oct (square) | 96 | 95 | 93 | 92 | 83 | 59 | 25 |

"Ideal listener": each true mark kept whole, with its true timing, if at least half of it is glimpsed (tone ahead of the noise in one ERB at the fundamental, or at harmonics 1, 3, 5), else lost; no inference across lost marks.

- Detection limits the results more than masking does. At +6 to +10 dB an ideal listener loses 1–16% of letters; the detector loses about 60–83%. The 11 Oct detector was tuned on 16 laptop takes and does not generalize to other rooms; in the car (TCAR) it fails even at +15 dB.
- H1 in its strong form is not supported at these SNRs: masking itself costs little above +3 dB with harmonics, +6 dB without. Inference across masked stretches matters below that.
- Harmonics are worth about 3–6 dB at the same error (square vs sine rows), in line with E2.

**E3, soft decisions** (11 Oct, `bench/results/e3-2026-10-111046.json`; 11 test beds, two keyings, logistic evidence per timbre trained on the other 11 beds, on/off HMM with minimum durations at 5 ms frames, offline Viterbi):

| | detector, added error | HMM, added error | recall, detector → HMM | precision, detector → HMM |
|---|---|---|---|---|
| sine 0 dB | 92 | 88 | 13 → 42 | 86 → 97 |
| sine +6 dB | 81 | 70 | 35 → 77 | 97 → 98 |
| sine +15 dB | 17 | 36 | 96 → 90 | 99 → 98 |
| square 0 dB | 92 | 68 | 14 → 71 | 86 → 98 |
| square +3 dB | 90 | 48 | 18 → 85 | 90 → 99 |
| square +6 dB | 77 | 29 | 37 → 92 | 98 → 99 |
| square +15 dB | 14 | 20 | 97 → 93 | 99 → 99 |

- H3 is supported at 0 to +10 dB: decoding whole stretches from soft evidence recovers most of the marks the rule-based detector discards, without losing precision.
- Above about +12 dB the prototype is worse than the detector. Timing is not the cause: in the scenes examined, HMM edges are within 5–10 ms, and moving them to envelope crossings does not change the result. The errors are concentrated at the start of the over and in synthetic speech, a masker type absent from training. The prototype's features also lack the detector's floor freezing and warm-up.
- Next: build the soft-evidence segmenter into the detector itself (causal, fixed lag), with the detector's floor handling, timbre-specific evidence (harmonics only when the tone has them), and edges from envelope crossings; then compare on E0 and on the real takes.

**E4, a real-time soft-evidence detector** (`src/lib/dsp/listener.ts`, research code, not used by the app yet). Lock-in channels at harmonics 1–5 (`evidence.ts`); per harmonic and millisecond: rise over a 20th-percentile floor, phase steadiness at the sender's pitch, and fall below the channel's maximum over the last 40 ms; a small network (12 tanh units; one model on the fundamental alone, one on harmonics 1–5) gives the log-odds of tone (`evidence-weights.json`, trained by `bench/train.bench.ts`); an on/off HMM with fixed 200 ms lag (`segmenter.ts`); edges at the fundamental's half-level crossings.

Problems found by the clean-scene checks (`bench/listener.bench.ts`), all fixed:
- A mark's decaying tail (the lock-in filter's response, 30–40 ms on clean audio) is perfectly steady, so a model that treats steadiness as tone merges marks. The training labels must include the tail as off, and a linear model cannot represent a steady but falling level; a small network given the fall below the recent maximum can.
- A long-memory reference level (the tone's recent peak) is raised by any loud steady sound, and the detector then misses marks for seconds. A 40 ms local maximum does not have this problem.
- A pure tone leaks into the 3rd-harmonic channel about 55 dB down, which on a quiet floor looks like a harmonic. Timbre has to be judged against the fundamental's level instead of the channel's own floor.
- Requiring the harmonics a model was trained on rejects a real tone with different harmonics. Harmonics are now only allowed to add evidence.

Synthetic benchmark (E0, 22 beds, letter error added by noise, averaged; network trained before key thumps were added):

| band SNR (dB) | +3 | +6 | +10 | +15 | +20 |
|---|---|---|---|---|---|
| detector before 11 Oct | 127 | 113 | 80 | 44 | 26 |
| detector, 11 Oct | 90 | 84 | 60 | 26 | 13 |
| soft-evidence detector | **77** | **66** | **39** | **23** | 14 |
| mark recall, 11 Oct → soft | 17 → 46 | 29 → 67 | 65 → 87 | 91 → 95 | 97 → 98 |

Stray letters per minute on the beds alone: 68.7, 2.4 and 4.8.

Real laptop takes (16, `bench/real.bench.ts`), summed letter error over the labelled keying takes, and stray letters on the room and talking takes:

| | summed letter error | stray letters |
|---|---|---|
| detector before 11 Oct | 700% | 50 |
| detector, 11 Oct | **242%** | **7** |
| soft-evidence, fundamental only, gaps expected 2.5 dits | 284% | 10 |
| soft-evidence, fundamental only, gaps expected 1.2 dits | 243% | 19 |

- The soft-evidence detector does better on the hard real takes (keying while typing 0% vs 14% and 17%; under talking 50% vs 83%; a quiet take 0% vs 17%) and worse on fast V's, where short dits (45–85 ms) with a key thump at the start give too little clean evidence to switch the HMM on. Shorter expected gaps recover them but let room sounds through (19 stray letters vs 7).
- The synthetic scenes lacked the key's mechanical thump at each edge and room reverberation; both are now in the training scenes (`Tone.thump`, `Tone.reverb`). The real takes decide, and 16 takes from one room are too few to train on.
- Not used in the app: on real recordings it is not yet better than the 11 Oct detector.

Next:
- More labelled real recordings: playback takes (a known text keyed through the speaker) in noisy places, and iPhone takes.
- Onsets that tolerate a key thump: the evidence at a mark's start should not depend on its first 10–20 ms.
- A decision layer combining both detectors, tested on real takes only after it improves the synthetic benchmark.

## 6b. Generalization: pitch, keys, and the paddle takes (11 Oct, evening)

Sections 6 and 6a were measured at 600 Hz, the pitch of all real takes so far. To cover other pitches and keys, E0 now runs every scene at 400, 600, 800 and 1000 Hz with four keyings: a fair straight key, a rushed beginner, a slow touch-key beginner, and paddles through an electronic keyer (elements and the gaps inside a letter machine-timed to 1%, letter and word spacing by hand). 22 beds, sine and square tones, band SNR 0 to +20 dB; split over processes with `PART` and joined by `e0merge`. Results: `bench/results/e0-wide-merged.json` (11 Oct detector, used in the app), `e0-first-merged.json` (soft-evidence detector with the kept evidence model), `e0-flank-merged.json`.

Letter error added by noise, averaged over beds, timbres and keyings:

| pitch | 11 Oct detector, +6 / +10 / +15 / +20 dB | soft-evidence, +6 / +10 / +15 / +20 dB |
|---|---|---|
| 400 Hz | 88 / 70 / 33 / 11 | 75 / 59 / 38 / 23 |
| 600 Hz | 81 / 54 / 21 / 11 | 67 / 50 / 32 / 23 |
| 800 Hz | 74 / 43 / 16 / 7 | 65 / 45 / 28 / 20 |
| 1000 Hz | 72 / 33 / 11 / 5 | 56 / 40 / 23 / 19 |

- Neither detector does best at 600 Hz; both improve steadily with pitch. Part of this comes from the measure: band SNR is taken over one ERB, which widens with pitch (68 Hz at 400 Hz, 133 Hz at 1000 Hz), while the lock-in bandwidth depends on speed only, so at higher pitches less of the band's noise reaches the detector. The 11 Oct detector's error falls faster with pitch (+10 dB: 70 to 33, against 59 to 40).
- The room gate's flanks are not the cause. For a 400 Hz tone the lower flank is at 200 Hz, where room rumble is strongest; moving both flanks above the tone made no difference (400 Hz, +10 dB: 70 against 73; 500 Hz: 63 and 63).
- Paddles do as well as a fair straight key above +10 dB (11 Oct detector, +15 dB: 20 against 19; +20 dB: 7 against 5) and worse at +6 to +10 dB (+10: 59 against 51). A keyer's 1-dit gaps inside letters are the shortest of any fist, and short noise bursts fill them.
- The slow touch-key fist (9 wpm, word gaps of 1.7 s) stays at 44% under the soft-evidence detector at +15 and +20 dB, precision 90%, from false marks in its long gaps. The 11 Oct detector: 18% and 14%.
- The soft-evidence detector is better at 0 to +6 dB at every pitch and worse from +15 dB, with 6–7 stray letters a minute on the beds alone against 1–2. It fails on synthetic speech (100–105% added error at every SNR, 44 stray letters a minute). It has none of the 11 Oct detector's checks against voices (flank contrast, whole-mark pitch, timbre).

**How wide to train the evidence model.** Trained on scenes at 450–850 Hz and 10–24 wpm (the first model), then with each range widened. Real takes (listener with gaps expected at 1.2 dits; 16 scored takes, all at 600 Hz), and E0:

| evidence model, training scenes | real takes, summed letter error | stray letters | E0 +10 dB, 400 / 1000 Hz |
|---|---|---|---|
| A: 450–850 Hz, 10–24 wpm, no keyer (kept) | **308%** | 19 | **59 / 40** |
| B: 300–1200 Hz | 470% | 18 | |
| C: 450–850 Hz, 8–35 wpm, with keyer | 342% | 22 | |
| 300–1200 Hz, 8–35 wpm, with keyer | 420% | 26 | 62 / 43 |
| the same, another seed | 394% | 16 | |

- Changing only the training seed moves the real-take total by 26 points, so differences below about 30 points are not meaningful.
- Widening the pitch range is the change that clearly makes results worse. Model A is as good or better at every pitch and SNR on E0, including 400 and 1000 Hz, which are outside its training range. Its features (rise over a floor, steadiness as phase drift in hertz, fall below the last 40 ms) do not depend on pitch, and the wider training set made the model worse. A is kept; the others are in `bench/models/`.

**New real takes.** A quiet paddle take (dits 70 ms, dahs 210 ms): 0% for both detectors. Playback through the laptop's speaker: 0%; with a video playing: 5% ("K1A QC" for K1ABC). Paddles while talking: the operator keyed CQ CQ CQ CQ DE (worked out from the keyer's 70 ms timing grid; the text entered at recording was CQ CQ DE); 70% for the 11 Oct detector, 60–70% for the soft-evidence detector.

Errors in that take:
- Speech fills the 1-dit gaps inside letters. In one gap (7.13–7.18 s) the level at the tone drops only 6–14 dB, to 11 dB above the floor, while steadiness drops to zero (pitch offset 9 to 65 Hz) and the tone channel is no higher than its flanks. The evidence model gives about -0.9 per millisecond there (+3 to +5 in the marks), which is not enough, and the segmenter merges the two elements. Both merged marks last 350 ms, or 5 dits: a dah, a gap and a dit.
- One dit (6.31 s) is covered by speech that is louder at the tone's frequency (27 dB above the floor against the tone's 19), and its measured pitch is pulled 25–48 Hz away. It can only be restored from context (CQ rather than KQ).

Hypotheses from this take:
- **H5 (ends under speech).** At the end of a tone, steadiness and contrast with the flanks drop together, even when the level stays high. Adding the flank contrast and the level relative to the current mark's plateau to the evidence keeps elements separate across speech-filled gaps.
- **H6 (rhythm).** A keyer sends elements of exactly 1 and 3 dits with 1-dit gaps. Once the sender is known to be this regular, a mark of about 5 or 7 dits is two elements with a lost gap, and the decoder can score both splits with the language model (the timing equivalent of auditory induction).

## 7. Open risks

- iOS Safari: older WebKit bugs (2017, 2018) on processing that stayed on with the getUserMedia constraints set to false are resolved; per a WebKit engineer in 2023, Safari no longer uses voice processing when echoCancellation is false. An open 2026 report describes degraded playback (lower sample rate, mono) on iPhone and iPad while the microphone is open, with or without echo cancellation, which matters when the app plays audio during capture. iPhone recordings are needed before drawing conclusions.
- Real time: everything must run in an AudioWorklet on a phone.
- Labels for hand keying: real takes give the text, not mark timing. Playback and semi-synthetic takes give timing, but their fists are simulated.

## 8. Plan

- **E0, corpus and benchmark.** Semi-synthetic mixer with SNR sweeps per noise type; playback recording in the sample recorder; a benchmark that prints SNR curves, stray letters per minute and mark-level scores for any detector.
- **E1, oracles (tests H1).** Decode (a) perfect marks; (b) marks from an oracle mask (tone leads the room at the fundamental or a harmonic); (c) the same with masked stretches marked unknown. The differences between them bound what better detection and better inference can each gain.
- **E2, grouping front end (H2).** Short-time spectrum (1–2 ms hop); per-frame evidence from a harmonic sieve at the learned pitch, onset coherence across harmonics, and the masker at the tone predicted from flanking bands. Scored by per-frame ROC on E0 data.
- **E3, soft-evidence decoding (H3).** Per-frame likelihood ratio and mask flag into a Morse timing model (hidden Markov or beam), joined with the existing language model; masked frames marginalised.
- **E4, learned front end (H4).** Small convolutional-recurrent network for per-frame presence, trained on semi-synthetic data, evaluated on real and playback takes against E2.
- **E5, devices.** iPhone, Android, laptops; the effect of each platform's forced processing.
- **E6, ends under speech (H5).** Add contrast with the flanks and the level against the current mark's plateau to the evidence; train on speech beds with the short gaps of keyer timing; score merges on E0's keyer keying in the speech beds and on the paddle takes.
- **E7, rhythm (H6).** Learn how regular the sender is; where marks of about 5 or 7 dits break that regularity, decode both splits and let the language model choose. Score on the keyer keying and the paddle takes; check that straight-key fists, whose long dahs are real, do not get worse.

## References

- Bregman, A. S. (1990). *Auditory Scene Analysis: The Perceptual Organization of Sound.* MIT Press.
- Cooke, M. (2006). A glimpsing model of speech perception in noise. *JASA* 119(3), 1562–1573. doi:10.1121/1.2166600. https://laslab.org/journal_paper/a-glimpsing-model-of-speech-perception-in-noise
- Cooke, M., Green, P., Josifovski, L., Vizinho, A. (2001). Robust automatic speech recognition with missing and unreliable acoustic data. *Speech Communication* 34(3). https://laslab.org/journal_paper/robust-automatic-speech-recognition-with-missing-and-uncertain-acoustic-data
- Glasberg, B. R., Moore, B. C. J. (1990). Derivation of auditory filter shapes from notched-noise data. *Hearing Research* 47, 103–138.
- Hall, J. W., Haggard, M. P., Fernandes, M. A. (1984). Detection in noise by spectro-temporal pattern analysis. *JASA* 76(1), 50–56.
- Moore, B. C. J., Glasberg, B. R., Peters, R. W. (1986). Thresholds for hearing mistuned partials as separate tones in harmonic complexes. *JASA* 80, 479. https://web.mit.edu/9.35/www/archives/2020/auditory/papers/MooreGlasbergPeters1986.pdf
- Shamma, S. A., Elhilali, M., Micheyl, C. (2011). Temporal coherence and attention in auditory scene analysis. *Trends in Neurosciences* 34(3), 114–123. doi:10.1016/j.tins.2010.11.002. https://pmc.ncbi.nlm.nih.gov/articles/PMC3073558
- Wang, D. (2005). On ideal binary mask as the computational goal of auditory scene analysis. In Divenyi (ed.), *Speech Separation by Humans and Machines*, 181–197.
- Warren, R. M. (1999). *Auditory Perception: A New Analysis and Synthesis.* Cambridge University Press (chapter on perceptual restoration). Summary by Warren: https://auditory.org/postings/2005/905.html
- Snyder, D., Chen, G., Povey, D. (2015). MUSAN: A Music, Speech, and Noise Corpus. arXiv:1510.08484. https://openslr.org/17/
- Thiemann, J., Ito, N., Vincent, E. (2013). DEMAND: a collection of multi-channel recordings of acoustic noise in diverse environments. https://zenodo.org/records/1227121
- Fonseca, E. et al. (2020). FSD50K: An Open Dataset of Human-Labeled Sound Events. https://zenodo.org/records/4060432
- Machine CW decoders for context: CW Skimmer (VE3NEA), a Bayesian decoder running many 50 Hz-wide decoders (https://dxatlas.com/CwSkimmer/); DeepFist, a CNN with CTC trained on synthetic CW, about 7% character error on ARRL code-practice audio, hand-sent fists noted as unsolved (https://github.com/n9bc/DeepFist); a Bayesian estimator of the Morse process as Kalman filters on a trellis (DTIC report ADA046503).
- WebKit bugs on microphone processing: 179411 (2017, constraints had no effect; fixed 2019), 192932 (2018, low-pass; resolved, Safari no longer uses voice processing with echoCancellation false), 311451 (2026, degraded playback while the microphone is open on iOS; open). https://bugs.webkit.org/show_bug.cgi?id=179411, https://bugs.webkit.org/show_bug.cgi?id=192932, https://bugs.webkit.org/show_bug.cgi?id=311451
