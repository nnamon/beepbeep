# Working on BeepBeep

Rules for anyone changing this repo, people and coding agents alike. Read the whole file before you start.

BeepBeep is a CW (Morse code) trainer that runs in the browser. Its users are mostly beginners. Many of them follow the LICW syllabus. Write and build for someone who started learning Morse a few weeks ago.

## Tooling

Everything runs in Docker. Never install or run node, npm, vite, vitest or Playwright on the host.

```sh
docker compose run --rm -T dev npm install
docker compose run --rm -T dev npm run check        # svelte-check: 0 errors, 0 warnings
docker compose run --rm -T dev npm run lint:css     # stylelint: count the ✖ lines; it must be 0
docker compose run --rm -T dev npm test             # vitest, including decoder accuracy
docker compose run --rm -T e2e npx playwright test --project=desktop   # or phone, pixel, small, mic, mic-pixel
docker compose run --rm -T dev npm run bench        # decoder benchmarks, for decoder changes
```

The Playwright projects pick their specs by file name (`testMatch` in `playwright.config.ts`). When you add a spec, add it to the projects it should run in.

## Changes

- Every bug fix comes with a test that fails on the old code and passes on the new. Check that it fails first.
- Run all the checks above before you commit. Say what you ran and what you did not.
- Commit to `main` and push. No pull requests during the initial build.
- `samples/` holds the owner's own recordings. It is gitignored and must never be committed or pushed.
- Ship none of LICW's class texts. Exercises play material we generate or text the user loads. LICW is a trademark: ask them before naming a public feature after them.
- The decoder's job is to read beginner hand keying the way an experienced operator would. Never trade accuracy on beginner keying for accuracy on textbook timing without saying so.

## Writing for the screen

This covers every string a user can see or hear: labels, hints, notes, notices, errors, aria-labels, the README and the docs.

### Write plain, whole sentences

- Say what to do and what will happen. "Type what you hear. Replay it as often as you like; replays don't change your score."
- Use whole sentences with a subject and a verb. No clipped fragments such as "Changes each day." or "The same with words."
- Clear beats short. Two plain sentences are better than one clever one.
- Use the words a beginner would use. If you must use a ham or LICW term, say what it means the first time it appears on a screen: "SKCC (Straight Key Century Club) member number".
- Say what a setting does, not what it is. "Squelch: sounds quieter than this are ignored."
- Only say what the code actually does. If the code changes, change the text. A false claim is a bug.
- British spelling: practise (verb), practice (noun), recognise, colour.
- Numbers as digits. "wpm" in lower case. In sentences write "seconds"; "5 s" is fine in compact readouts.

### Never write these

- Em dashes (—). Use a full stop, colon, comma or brackets.
- Rhetorical questions.
- Slogans and taglines: "keying is the real thing", "Short, fast, and the same shape every time."
- "Not X but Y" and "not just X, Y".
- Meta-narration about the app or the text itself: "This screen shows…", "Here you'll find…".
- Justification tails that add nothing: "…so you can learn faster."
- Encouragement and coaching voice: "Great job!", "You're ready", "Take your time", "at your own pace", "Get it wrong as often as you like."
- Stock phrases: seamless, effortless, journey, unlock, elevate, dive in, let's, whether you're.
- Exclamation marks.
- Triplets used for rhythm.
- Internal words: item, card, slot, verdict, mark (for a dit or dah), "counted, not scored".
- Raw error text from the browser. Catch it and say what happened and what is left: "That export file is damaged. Nothing was changed."
- A dash (– or —) as an empty value. Screen readers read it as "en dash". Write "none" or "no data yet".

### Feedback notes keep their numbers

Notes about the user's sending carry the measurement and the target: "Word gaps short: 4.8 units, aim 7." That format is intended. Keep it. Write "units", not "u".

### Words we use

Use these terms and only these. If you need a new term, add it here first.

| Use | For | Not |
| --- | --- | --- |
| lesson | One step of a course. Koch: "Lesson 14". LICW carousel: named by its characters, "BC1 · REA". | level, group (for this meaning) |
| stage | A part of the LICW syllabus: BC1, BC2, BC3, INT 1 to 3, ADV 1 to 3, TTR+, OverLearn. | class (as a label), course |
| group | Random characters played together to copy: "groups of 5". | |
| exercise | An LICW exercise, played by the exercise player. | card, item |
| drill | One of BeepBeep's own practice screens: Copy drill, Send drill. | |
| round | One run of a Pocket quiz. | stage |
| callsign | One word. | call sign |
| QSO | A contact between two stations. Explain it the first time it appears on a screen. | |
| your turn | The part of a QSO you send. "over" only with an explanation. | over (alone) |
| region | State, province or country. Optional. Never "state" alone. | state |
| character speed, overall speed | How fast each character is sent, and the speed including the extra space between characters. Write "12 wpm characters, 8 wpm overall" in sentences, and "12 wpm, 8 overall" in a one-line subtitle. | effective speed, Farnsworth (without explanation), "12/8" |
| Microphone, Touch key, Straight key, Paddles A, Paddles B | The inputs. The last three are keyboard keys; say "on the keyboard" where it isn't obvious. | Keyboard iambic A |
| Spot the new character | BeepBeep's drill for picking out a new sound. | Familiarity (that is the LICW exercise) |
| Hear it, send it | BeepBeep's drill: copy something, then send it back. The LICW sending exercises open it under this name. | Sending practice |
| Speed Racing | The LICW exercises where a word plays at falling speeds. | Speed Racer |
| TTR | Time to recognise. Spell it out on first use on a screen. | |
| Sound surfing | BeepBeep's continuous-stream drill. | IFR (on screen) |

### Don't assume the USA

Users are worldwide; the owner is in Singapore (9V1NE). Placeholders, examples and generated material use callsigns, towns and regions from several countries. A city-state has no region, and that must look normal, not missing.

## Visual design

- Colours, type sizes and spacing come only from `src/styles/tokens.css`. stylelint rejects raw colour values elsewhere.
- No gradients, emoji, glow, decorative shadows, confetti, badges, streak counters or other game decoration.
- No grids of feature cards and no dashboard tiles that only decorate. Lists, tables and plain headings.
- Both themes must work: look at dark and light before you call a screen done.
- Phones first: 360 px wide is the narrowest supported screen. Tap targets at least 44 px. Text boxes use `--size-field` (16 px on touch screens) so iOS doesn't zoom in.
- Nothing may sit under the tab bar, the on-screen keyboard or the home bar. Use the `--safe-top`, `--safe-bottom` and `--tabbar` tokens.
- Every state needs a way out. No screen may leave the user stuck or with no way back.
