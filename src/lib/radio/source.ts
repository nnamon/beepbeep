// What the Radio screen reads: the CW signals a radio's audio carries, each
// with its own decoded text. The screen knows nothing of detectors or
// decoders; a source behind this interface does the listening.
//
// This file imports nothing, so tests and engines can take the types from it
// without loading the app's audio code. The source the screen uses is made in
// create.ts.

export interface RadioSignal {
  /** Stable while the signal is tracked. */
  id: number;
  /** Hz, as heard now. */
  pitch: number;
  /** Measured character speed; null until known. */
  wpm: number | null;
  /** dB above the noise in its channel. */
  snr: number;
  /** Key down right now. */
  keying: boolean;
  /** performance.now() of its last mark. */
  lastHeard: number;
  /**
   * Words fixed so far. Kept to the last 20,000 characters. Characters as the
   * decoder writes them: prosigns in angle brackets (<AR>), and ⁇ for a sound
   * that is no character. A space between words; a new line for each over,
   * and after a word that hands over (K, KN, SK, BK). It only grows at the
   * end, except that the oldest text is dropped and Clear empties it.
   */
  text: string;
  /**
   * The words still being read (they may change), starting with the space or
   * line break that puts them after `text`: show `text + pending`.
   */
  pending: string;
}

export interface RadioSource {
  /**
   * Opens the microphone and starts listening. Rejects with the same errors the
   * Live decoder handles: the browser's (NotAllowedError, NotFoundError,
   * NotReadableError) or the app's own when the page is not secure (https).
   * `micError()` in state/signal.svelte.ts words them for the screen.
   *
   * The microphone is the app's shared one (`startMic`), so the app's rules for
   * letting it go apply: at once on Stop (the screen calls `stopMic`), and
   * about 10 seconds after leaving a screen that listens.
   */
  start(): Promise<void>;
  /** Stops listening. Text already heard is kept. */
  stop(): void;
  /** Forgets every signal's text; keeps listening. */
  clear(): void;
  /**
   * Called with every signal heard since the start or the last Clear, newest
   * activity first, a few times a second. Signals no longer tracked (silent
   * for 45 seconds, or listening stopped) stay with their text until Clear:
   * the 20 most recently heard.
   */
  subscribe(fn: (signals: RadioSignal[]) => void): () => void;
}
