// User settings, persisted to localStorage (a per-device convenience).

import { DEFAULT_CAROUSEL, migrateLevelId, type Carousel, type TrackId } from '../train/courses';
import type { InputSource } from '../audio/live';
import { areaOf, type Mix } from '../train/world';
import type { ClassId } from '../train/classes';

export interface ExercisePrefs {
  /** Chosen speed, where the exercise offers several. */
  speed?: number;
  /** Play lesson material or your own text. Older saves only have `text`. */
  source?: 'lesson' | 'text';
  /** Which of your saved texts to play. */
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
  /** Learn QSOs: how much of what to send is shown, and whether you key or type it. */
  qsoHelp: 'text' | 'outline' | 'none';
  qsoInput: 'key' | 'type';
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
  qsoHelp: 'text',
  qsoInput: 'key',
};

const KEY = 'beepbeep.settings.v1';

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The words each choice can take: what the Settings and Setup screens offer. */
const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
  theme: ['system', 'dark', 'light', 'paper'],
  track: ['koch', 'licw'],
  input: ['mic', 'touch', 'straight', 'iambicA', 'iambicB'],
  voice: ['builtin', 'system', 'recorded', 'off'],
  sendTolerance: ['tight', 'normal', 'loose'],
  qsoHelp: ['text', 'outline', 'none'],
  qsoInput: ['key', 'type'],
  stationMix: ['auto', 'asia', 'europe', 'americas', 'world'],
  licwClass: ['bc1', 'bc2', 'bc3', 'int1', 'int2', 'int3', 'adv1', 'adv2', 'adv3', 'ttrplus', 'overlearn'] satisfies ClassId[],
};

/**
 * The range of each number: the Settings sliders' (the TTR drill's for its
 * delay, calibration's for the squelch, Setup's for a pinned pitch). With a
 * step, the number is rounded to it.
 */
const RANGES: Partial<Record<keyof Settings, [min: number, max: number, step?: number]>> = {
  charWpm: [5, 45, 1],
  effectiveWpm: [3, 45, 1],
  sendWpm: [5, 45, 1],
  sessionMinutes: [5, 45, 5],
  comfortWpm: [5, 45, 1],
  stretchWpm: [5, 50, 1],
  pitch: [400, 1000, 10],
  volume: [0, 1],
  noise: [0, 3, 1],
  qsb: [0, 3, 1],
  qrm: [0, 2, 1],
  qrn: [0, 3, 1],
  overTimeout: [1.5, 6, 0.5],
  ttrDelay: [0.3, 3],
  pinnedHz: [300, 1200, 1],
  squelchDb: [9, 20, 1],
};

/** A number brought into its range and onto its step; anything that isn't a number gets the default. */
function inRange(v: unknown, [min, max, step]: [number, number, number?], fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const n = step ? Math.round(v / step) * step : v;
  return Math.min(max, Math.max(min, n));
}

/**
 * Saved or imported settings made whole: defaults for anything missing, nested
 * parts merged, wrong types dropped, choices kept to the ones the app offers,
 * numbers kept to the ranges Settings allows, old lesson ids moved to the new
 * ones. Hand-edited values out of range made drills throw when they played.
 */
function normalize(raw: unknown): Settings {
  const s = obj(raw);
  const out: Settings = { ...structuredClone(DEFAULTS) };
  const set = out as unknown as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = s[k];
    const d = DEFAULTS[k];
    if (v === undefined || v === null) continue;
    if (typeof d === 'object' && d !== null) continue; // nested parts below
    const range = RANGES[k];
    if (range) set[k] = inRange(v, range, (d as number | null) ?? NaN);
    else if (CHOICES[k]) set[k] = CHOICES[k].includes(v as string) ? v : d;
    else if (typeof v === typeof d) set[k] = v;
  }
  // A number with no default (pinned pitch, squelch) that wasn't one stays off.
  if (Number.isNaN(out.pinnedHz)) out.pinnedHz = null;
  if (Number.isNaN(out.squelchDb)) out.squelchDb = null;
  // The overall speed is never above the character speed (its slider stops there).
  out.effectiveWpm = Math.min(out.effectiveWpm, out.charWpm);
  const level = { ...DEFAULTS.level, ...obj(s.level) } as Settings['level'];
  level.koch = str(level.koch) || DEFAULTS.level.koch;
  level.licw = migrateLevelId(str(level.licw) || DEFAULTS.level.licw);
  out.level = level;
  out.carousel = { bc1: str(obj(s.carousel).bc1) || DEFAULT_CAROUSEL.bc1, bc2: str(obj(s.carousel).bc2) || DEFAULT_CAROUSEL.bc2 };
  const you = obj(s.you);
  out.you = { call: str(you.call), name: str(you.name), qth: str(you.qth), state: str(you.state), skcc: str(you.skcc) };
  out.exercisePrefs = Object.fromEntries(
    Object.entries(obj(s.exercisePrefs)).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)),
  ) as Settings['exercisePrefs'];
  return out;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* storage unavailable or unreadable: use defaults */
  }
  return structuredClone(DEFAULTS);
}

/** Settings from an export file, made whole first. */
export function applySettings(raw: unknown) {
  Object.assign(settings, normalize(raw));
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
