"""Generates the built-in spoken answers in public/voice/ with Kokoro-82M.

Run in the container: docker compose run --rm voice
Lines come from scripts/voice-lines.json ({clip name: text to say}). A full
stop after each letter stops the model adding a trailing vowel; prosigns that
spell a word ("AS") are hyphenated so they are read as letters.
--phonemes prints the phonemes for each line instead, for checking letter names.

Voice am_michael was picked by transcribing every clip of nine Kokoro voices
with Whisper small.en: it and af_heart scored 55 of 58, and af_heart's T was
consistently heard as C.
"""

import json
import os
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

# Kokoro-82M weights and voices are Apache-2.0.
RELEASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
FILES = ('kokoro-v1.0.onnx', 'voices-v1.0.bin')
VOICE = 'am_michael'
MODELS = Path('/models/kokoro')
OUT = Path('public/voice')


def fetch() -> Kokoro:
    MODELS.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        if not (MODELS / name).exists():
            print('downloading', name)
            urllib.request.urlretrieve(RELEASE + name, MODELS / name)
    return Kokoro(str(MODELS / FILES[0]), str(MODELS / FILES[1]))


def trim(x: np.ndarray, sr: int) -> np.ndarray:
    """Cuts leading and trailing silence, normalises to -3 dBFS, 10 ms fades."""
    env = np.abs(x)
    on = np.where(env > 0.01 * env.max())[0]
    pad = int(0.03 * sr)
    x = x[max(0, on[0] - pad): on[-1] + pad].copy()
    x = x / np.abs(x).max() * 10 ** (-3 / 20)
    f = int(0.01 * sr)
    ramp = np.linspace(0, 1, f)
    x[:f] *= ramp
    x[-f:] *= ramp[::-1]
    return x


def main() -> None:
    lines: dict[str, str] = json.loads(Path(os.environ.get('LINES', 'scripts/voice-lines.json')).read_text())
    k = fetch()
    if '--phonemes' in sys.argv:
        for clip, text in lines.items():
            print(f'{clip:16} {text!r:24} {k.tokenizer.phonemize(text, "en-us")}')
        return
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path('/tmp/clip.wav')
    for clip, text in lines.items():
        x, sr = k.create(text, voice=VOICE, speed=1.0, lang='en-us')
        x = trim(np.asarray(x, dtype=np.float32), sr)
        with wave.open(str(tmp), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes((x * 32767).astype(np.int16).tobytes())
        subprocess.run(
            ['ffmpeg', '-loglevel', 'error', '-y', '-i', str(tmp), '-ac', '1', '-b:a', '48k', '-map_metadata', '-1',
             str(OUT / f'{clip}.mp3')],
            check=True,
        )
        print(clip, f'{len(x) / sr:.2f}s')


if __name__ == '__main__':
    main()
