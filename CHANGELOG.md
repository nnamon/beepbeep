# Changelog

What changed in each version of BeepBeep. The version shows at the top of the app, beside the build.

## 0.2.6 (13 October 2026)

- Tap the version number at the top of any screen to see the version history: what changed in each version, newest first. Back returns you to where you were. Settings links to it too.

## 0.2.5 (13 October 2026)

Fixes from an independent check of the drills and storage.

- Space on a Stop or Done button you reached with Tab presses the button. Before, it keyed a dit. After a mouse click, Space still keys as before.
- Pressing Start twice while the browser asks for the microphone opens one microphone stream, not two, and it is let go after you leave.
- The Live decoder saves your session when you leave by a link, not only when you press Stop.
- Imports are checked field by field. A file with damaged rows is refused or repaired instead of breaking Progress and Pocket, and those screens cope with a bad stored value.
- Esc stops a running LICW exercise, as it does in the other drills with a Stop button.
- In LICW strict mode with paddles saved, Setup and the signal bar show the straight key, which is what BC lessons use.
- Learn QSOs says when the microphone is blocked and offers the touch key.
- Settings keep to the allowed choices and slider ranges, so a hand-edited or old settings file can't stop the drills from playing.
- The space between words is never counted as a missed character.
- Learn QSOs no longer throws an error when the browser's storage is unavailable.

## 0.2.4 (13 October 2026)

- The decoder's second ear works as intended. When your tone has a harmonic (a buzzer or a square-wave oscillator) and talking covers the tone itself, BeepBeep listens to the harmonic instead. It was listening at the wrong pitch and could start false letters from the echo after each mark. On your own recordings three takes now read better (wrong letters 17% to 0%, 83% to 67%, 70% to 40%) and none read worse; stray letters in a quiet room are unchanged.

## 0.2.3 (12 October 2026)

- The decoder reads practice groups made from a lesson's few characters, such as KKKMM MKMK KKMM at Koch lesson 1, the way you sent them. Before, the reading at the end of your sending cut them into short words (K K K MM) or ran letters into digits. With textbook timing every test group now reads right (60 of 60, up from 23); from beginner hand keying, wrong letters fell from 56% to 35%.
- Still hard: groups made only of dahs (T, M, O) from beginner hand keying, where about half the letters still read wrong, and II, which still reads as H. Both are noted for later work.

## 0.2.2 (12 October 2026)

- The timing panel beside the Send drill and Live decoder puts each aim on its own line under its name ("Gap between words", then "aim 7 units"), so a narrow panel no longer breaks a label in two.
- The README's preview images show the app as it is now, with captions in plain words.

## 0.2.1 (12 October 2026)

A way to get the latest version on a phone, and fixes from a second, independent check of the layout and accessibility work.

- Settings, Version: **Reload the latest version** loads the app fresh from the internet, skipping the copy saved on your device. Use it when the app on your home screen seems out of date, since you can't force a refresh there. Your progress and settings are kept.
- Pocket: pressing Enter after a miss no longer counts the next question as a miss.
- Practice on a phone: tapping "guide" opens the Guide; it used to hit Dismiss.
- LICW exercises: the button that goes back one item is called Previous, so it isn't confused with Back, which leaves the exercise.
- Bigger tap targets: the header links on a phone on its side, the Today list, and the links in the Guide and Learn QSOs.
- Copy drill: a mix-up you made more than once shows once, with how many times ("E heard as Q (3 times)").
- Screen readers: the signal bar reads as one sentence, and the skip link points at the page's content.

## 0.2.0 (12 October 2026)

An independent audit of the whole app found about 80 problems, from lost progress to confusing wording. This version fixes almost all of them. The few left are listed in [docs/HANDOFF.md](docs/HANDOFF.md).

### Your progress

- Send drill and Live decoder sessions are saved again, so they show in Progress and tick Today.
- Importing a damaged file no longer wipes your progress, and a good file asks before it replaces anything.
- Delete progress says what it deletes, and keeps your saved texts and Pocket custom set. Reset settings asks first.

### Practice and Today

- Today ticks a step as soon as you come back from it, and starts a new list after midnight.
- "Work down the list from the top" replaces an order sentence that didn't match the list.
- Choosing Stage BC3 or later shows that stage and its speed. Your carousel lesson is kept for when you go back.
- Back from a drill returns to where you were on Practice.
- Koch lessons are called Lesson 1, Lesson 2 and so on.

### Drills

- Copy drill: extra typed characters count against you; a round is scored answer by answer; Next lesson really moves on; Replay after the answer doesn't take a second answer; a stray Enter doesn't submit an empty one.
- Quiz order with only 2 to 4 characters is no longer a fixed cycle, and weak characters come up more often.
- Sound stops when you leave or pause: Pocket, Spot the new character, TTR, Learn QSOs and spelled answers.
- Sound surfing scores only what had played when you stop.
- Head copy no longer counts one letter as a copy of a longer answer.
- Hear it, send it plays at the lesson's speed on the LICW track.
- Callsigns, words and phrases use only your lesson's characters, and drills say when the lesson can't make them yet.
- Enter and Space on a button or link you reached with Tab press that control instead of starting a drill.

### LICW strict mode

- It now does what it says: no rhythm bars, answers only at the end (including Pocket and TTR), and the straight key only in BC lessons.

### LICW exercises

- "Your text" shows the paste and file controls even before you have saved a text.
- A text deleted in one exercise no longer breaks another.
- Early BC1 lessons no longer play the same phrase or word over and over.
- Exercise descriptions match what plays (OverLearn sending, TTR+, Speed Racing speeds).
- An exercise you leave part-way, timed ones included, offers to carry on.

### Learn QSOs and the QSO simulator

- Your turn ends only when it really ends: not at HW?, 73 or a leading BK, and not at a region such as VA.
- Typing in a copy box no longer cuts the station off, and the station's last transmission is scored.
- The Learn QSOs checker gives one note per slip, names spacing slips as spacing, and accepts natural orders (QTH before name, 73 after SK) and AR in place of K.
- Stations outside the USA, regions instead of states, and a city-state like Singapore sent once, not repeated.
- A QSO you leave pauses and can carry on. QSOs count in Progress.
- Learn QSOs works on an iPhone after a reload: tap the key to start.

### The decoder

- One-letter words keep their spaces: V V V no longer reads as VVV.
- With no pitch pinned, it finds your keyed tone instead of locking onto room rumble.
- Fewer stray letters from talking near the microphone, and better copy under it.
- A pinned pitch slightly off your tone moves to the tone instead of going silent.
- EE sent slowly no longer reads as T T; holding the key down reads nothing instead of T.
- Keyboard and touch key timing stays right when the phone is busy.
- The microphone is released about 10 seconds after you leave the screens that use it.

### Phones and accessibility

- Words no longer break in the middle on phones.
- The Pocket answer stays in view after a miss on smaller iPhones.
- Phones on their side get a layout that fits, clear of the notch.
- Tap targets of at least 44 px, arrow keys in choice rows, a skip link, a window title and focus for each screen, and screen reader announcements for results and notices.

### Wording

- All the text in the app was rewritten in plain whole sentences, following the rules in [AGENTS.md](AGENTS.md): no fragments, jargon explained where you first meet it, one name for each thing, no dashes as empty values.
- Timing notes show only what was measured and say where a spacing slip happened.

### Updates

- After an update the app reloads into the new version at a safe moment, never in the middle of a drill or a QSO.

## 0.1.0 (11 October 2026)

The first version: the microphone decoder, the touch key and keyboard keys, Practice with the Koch and LICW tracks, the Copy, Send and other drills, Pocket rounds, the QSO simulator, Learn QSOs, the LICW exercises, Progress and Settings.
