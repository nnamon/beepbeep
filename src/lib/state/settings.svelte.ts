// User settings, persisted to localStorage (a per-device convenience).

import { DEFAULT_CAROUSEL, migrateLevelId, type Carousel, type TrackId } from '../train/courses';
import type { InputSource } from '../audio/live';
import { areaOf, type Mix } from '../train/world';
import type { ClassId } from '../train/classes';

export interface ExercisePrefs {
  /** Chosen speed, where the exercise offers several. */
  speed?: number;
  /** Your saved text to play instead of lesson material; null for the lesson. */
  text?: string | null;
  /** Show each card once it has played. */
  show?: boolean;
  /** Shuffle your text. */
  shuffle?: boolean;
  /** Start again when the run ends. */
  loop?: boolean;
}

export interface Settings {
  /** System follows the device: Shack when it is dark, Light when it is light. */
  theme: 'system' | 'dark' | 'light' | 'paper';
  track: TrackId;
  /** LICW strict mode: the Method Guide's guardrails. */
  licwStrict: boolean;
  /** Whether we've asked about strict mode since the LICW track was chosen. */
  licwAsked: boolean;
  /** The guide has been opened; hides the pointer to it on Practice. */
  guideSeen: boolean;
  level: Record<TrackId, string>;
  /** LICW: in an LICW class. Off, the carousel runs from REA and KMY and Practice says stage, not class. */
  licwEnrolled: boolean;
  /** LICW: the carousel group you joined BC1 and BC2 at (in a class). */
  carousel: Carousel;
  /** LICW: the class whose exercises Practice lists. */
  licwClass: ClassId;
  /** Per class exercise ('bc1/vet'): your choices of speed and material. */
  exercisePrefs: Record<string, ExercisePrefs>;
  /** On the LICW track, use the lesson's speeds (12/8, 12/10) for receive drills. */
  useCourseSpeeds: boolean;
  /** Receive speeds: character and effective (Farnsworth). */
  charWpm: number;
  effectiveWpm: number;
  /** Expected sending speed, to start the decoder. */
  sendWpm: number;
  pitch: number;
  volume: number;
  input: InputSource;
  micDeviceId: string;
  pinnedHz: number | null;
  /** Squelch from calibration: how far a key-down must rise above the room, dB. */
  squelchDb: number | null;
  /** Band conditions for receive drills and QSOs. */
  noise: number;
  qsb: number;
  qrm: number;
  qrn: number;
  /** Human-sounding fists in generated code. */
  humanFist: boolean;
  you: { call: string; name: string; qth: string; state: string; skcc: string };
  voice: 'builtin' | 'system' | 'recorded' | 'off';
  voiceURI: string;
  /** Pulse a light with the app's tone (noisy rooms, hard of hearing). */
  visualCue: boolean;
  /** Spoken-answer delay for TTR drills, seconds. */
  ttrDelay: number;
  /** Comfort and stretch speeds (WPM). */
  comfortWpm: number;
  stretchWpm: number;
  sessionMinutes: number;
  /** Seconds of silence after which your over is handed to the bot. */
  overTimeout: number;
  /** How strict the timing notes are. */
  sendTolerance: 'tight' | 'normal' | 'loose';
  /** Keep the timing of your last few sends for replay (timing only, no audio). */
  keepSends: boolean;
  /** Vibrate the rhythm while the app sends (Android browsers). */
  vibrate: boolean;
  /** Chirp and slow drift on generated signals. */
  chirp: boolean;
  /** Raise effective speed toward character speed after good sessions. */
  autoTaper: boolean;
  /** App audio goes to headphones: the mic stays open while the app sends, for break-in. */
  headphones: boolean;
  /** Where the stations you hear come from; auto works it out from your callsign or region. */
  stationMix: 'auto' | 'asia' | 'europe' | 'americas' | 'world';
}

const DEFAULTS: Settings = {
  theme: 'system',
  track: 'koch',
  licwStrict: false,
  licwAsked: false,
  guideSeen: false,
  level: { koch: 'koch-1', licw: 'licw-bc1-REA' },
  licwEnrolled: false,
  carousel: { ...DEFAULT_CAROUSEL },
  licwClass: 'bc1',
  exercisePrefs: {},
  useCourseSpeeds: true,
  charWpm: 20,
  effectiveWpm: 12,
  sendWpm: 15,
  pitch: 650,
  volume: 0.7,
  input: 'mic',
  micDeviceId: '',
  pinnedHz: null,
  squelchDb: null,
  noise: 0,
  qsb: 0,
  qrm: 0,
  qrn: 0,
  humanFist: true,
  you: { call: '', name: '', qth: '', state: '', skcc: '' },
  voice: 'builtin',
  voiceURI: '',
  visualCue: false,
  ttrDelay: 1.0,
  comfortWpm: 15,
  stretchWpm: 19,
  sessionMinutes: 15,
  overTimeout: 3,
  sendTolerance: 'normal',
  keepSends: false,
  vibrate: false,
  chirp: false,
  autoTaper: false,
  headphones: false,
  stationMix: 'auto',
};

const KEY = 'beepbeep.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const level = { ...DEFAULTS.level, ...s.level };
      level.licw = migrateLevelId(level.licw);
      return { ...DEFAULTS, ...s, level, carousel: { ...DEFAULTS.carousel, ...s.carousel }, you: { ...DEFAULTS.you, ...s.you } };
    }
  } catch {
    /* storage unavailable: use defaults */
  }
  return structuredClone(DEFAULTS);
}

export const settings: Settings = $state(load());

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* private mode or full: settings stay in memory */
    }
  });
  $effect(() => {
    const t = settings.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    // Browser chrome follows the chosen theme; System keeps index.html's media-matched pair.
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      m.dataset.content ??= m.content;
      m.content = t === 'system' ? m.dataset.content : getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    }
  });
});

export function resetSettings() {
  Object.assign(settings, structuredClone(DEFAULTS));
}

/** Strict mode only applies on the LICW track. */
export function strict(): boolean {
  return settings.track === 'licw' && settings.licwStrict;
}

/** The station mix in effect: your choice, or from your callsign or region (worldwide if neither says). */
export function effectiveMix(): Mix {
  if (settings.stationMix !== 'auto') return settings.stationMix;
  return areaOf(settings.you) ?? 'world';
}
