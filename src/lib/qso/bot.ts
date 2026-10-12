// Rule-based bot stations for the QSO simulator. A bot reads your decoded
// over, keeps track of where the contact is, and answers the way a real
// operator would, including AGN?, QRS and repairing a busted call.

import { type Rng, mulberry32, pick } from '../util/random';
import { ANTENNAS, JOBS, RIGS, STATES, WEATHER } from '../train/words';
import { station, type Mix } from '../train/world';
import { REGION_SET, callDistance, isCallsign, missingPart, parse, type Parsed } from './parse';

export type Format = 'ragchew' | 'licw' | 'skcc' | 'sst' | 'pota' | 'sota' | 'contest' | 'pileup';
export type Opener = 'bot' | 'you';

export const FORMATS: { id: Format; name: string; exchange: string }[] = [
  { id: 'ragchew', name: 'Ragchew', exchange: 'A relaxed chat. You swap reports, names and QTHs, then talk about your rig, antenna and weather.' },
  { id: 'licw', name: 'LICW QSO Protocol', exchange: 'The contact the Long Island CW Club teaches. You swap callsigns, reports, names and QTHs, then send 73.' },
  { id: 'skcc', name: 'SKCC', exchange: 'A Straight Key Century Club contact. You swap reports, regions (state, province or country), names and member numbers.' },
  { id: 'sst', name: 'K1USN SST', exchange: 'The Slow Speed Test, a short contest at 20 wpm or slower. You swap names and regions.' },
  { id: 'pota', name: 'POTA', exchange: 'Parks on the Air. One station is in a park, making many short contacts. You swap callsigns, 5NN (a 599 report) and regions.' },
  { id: 'sota', name: 'SOTA', exchange: 'Summits on the Air. One station is on a hilltop. You swap callsigns, reports and regions.' },
  { id: 'contest', name: 'Contest', exchange: 'A contest. You swap callsigns, 5NN (a 599 report) and serial numbers.' },
  { id: 'pileup', name: 'DX pileup', exchange: 'Several stations call you at once. You pick one by its callsign, and it sends 5NN and its region.' },
];

/** Formats with short exchanges, where K at the end is optional. */
const NO_K: ReadonlySet<Format> = new Set(['contest', 'sst', 'pota', 'sota', 'pileup']);

/** Everyday words around a bare SST exchange (GE TOM TOM MA TU): none of them is a name or a region. */
const SST_FILLER = new Set([
  'GE', 'GM', 'GA', 'GN', 'TU', 'TNX', 'TKS', 'THANKS', 'R', 'RR', 'OM', 'BK', 'K', 'KN', '73', 'SST', 'FB', 'ES', 'HR', 'NAME',
  'OP', 'IS', 'UR', '5NN', '599', 'CQ', 'TEST', 'PSE', 'AGN', 'AGN?', 'QRS', 'EE', 'AR', 'BT', 'HI', 'GL', 'CUL', 'HW?', '?',
]);

/** The report a station sends you in this format, as digits (5NN is 599), or '' when the exchange has none (SST). */
export function reportSent(format: Format, s: BotIdentity): string {
  if (format === 'sst') return '';
  if (format === 'pota' || format === 'contest' || format === 'pileup') return '599';
  return s.rst;
}

export interface Operator {
  call: string;
  name: string;
  qth: string;
  state: string;
  skcc: string;
}

export interface BotIdentity extends Operator {
  rig: string;
  ant: string;
  pwr: string;
  wx: string;
  age: string;
  job: string;
  rst: string;
  serial: number;
  /** Pitch offset from your sidetone, Hz (pileups spread stations out). */
  pitchOffset: number;
  /** 0..1: how chatty. */
  verbosity: number;
  /** 1 or 2: how often key items are repeated. */
  repeats: number;
  /** Speed offset from the set station speed, wpm (-2..+2). */
  pace: number;
  /** 0..1: low values write words out (THANKS FOR) instead of abbreviating (TNX FER). */
  abbrev: number;
}

/** Abbreviations a plain-spoken operator writes out in a ragchew. */
const PLAIN: Record<string, string> = {
  TNX: 'THANKS', FER: 'FOR', ES: 'AND', HR: 'HERE', ABT: 'ABOUT', HPE: 'HOPE', WX: 'WEATHER', ANT: 'ANTENNA', SRI: 'SORRY',
};

export interface BotTurn {
  who: string;
  text: string;
  wpm: number;
  pitchOffset: number;
}

export interface Copied {
  call: string | null;
  rst: string | null;
  name: string | null;
  qth: string | null;
  state: string | null;
  serial: string | null;
  skcc: string | null;
}

export interface QsoOptions {
  format: Format;
  opener: Opener;
  /** Your own details; anything blank is accepted as heard. */
  you: Partial<Operator>;
  wpm: number;
  seed?: number;
  /** Stations in a pileup. */
  crowd?: number;
  /** Where stations come from (by your location). */
  mix?: Mix;
}

type Stage = 'cq' | 'wait-cq' | 'answered' | 'exchange' | 'chat' | 'closing' | 'done';

export function makeIdentity(rng: Rng, pitchOffset = 0, mix: Mix = 'world'): BotIdentity {
  // A real-looking station from the areas you hear most: call, local name,
  // city and the region it sends, all from one country.
  const st = station(rng, mix);
  return {
    call: st.call,
    name: st.name,
    qth: st.qth,
    state: st.region,
    skcc: `${1000 + Math.floor(rng() * 38000)}${pick(rng, ['', '', 'C', 'T', 'S'])}`,
    rig: pick(rng, RIGS),
    ant: pick(rng, ANTENNAS),
    pwr: pick(rng, ['5', '10', '50', '100']),
    wx: pick(rng, WEATHER),
    age: String(25 + Math.floor(rng() * 55)),
    job: pick(rng, JOBS),
    rst: pick(rng, ['599', '579', '569', '559', '449']),
    serial: 1 + Math.floor(rng() * 300),
    pitchOffset,
    verbosity: rng(),
    repeats: rng() < 0.6 ? 2 : 1,
    pace: Math.round((rng() - 0.5) * 4),
    abbrev: rng(),
  };
}

export class QsoBot {
  readonly format: Format;
  readonly opener: Opener;
  readonly stations: BotIdentity[];
  /** The station you are working (pileups narrow this down). */
  active: BotIdentity | null = null;
  readonly copied: Copied = { call: null, rst: null, name: null, qth: null, state: null, serial: null, skcc: null };
  readonly transcript: { from: 'bot' | 'you'; who: string; text: string }[] = [];
  readonly completed: BotIdentity[] = [];
  private stage: Stage;
  private rng: Rng;
  private wpm: number;
  private you: Partial<Operator>;
  private regions: ReadonlySet<string>;
  private last: BotTurn[] = [];
  private topics: ('rig' | 'wx' | 'age')[];
  private overs = 0;
  readonly startedAt = Date.now();
  endedAt: number | null = null;

  constructor(opts: QsoOptions) {
    this.format = opts.format;
    this.opener = opts.format === 'pileup' ? 'you' : opts.opener;
    this.rng = mulberry32(opts.seed ?? Date.now() & 0xffff);
    this.wpm = opts.format === 'sst' ? Math.min(opts.wpm, 20) : opts.wpm;
    this.you = opts.you;
    // Your own region counts even when it is not on the list (a small country, a
    // grid square), and so does your QTH when you left the region blank (a city-state).
    const own = ((opts.you.state ?? '').trim() || (opts.you.qth ?? '').trim()).toUpperCase();
    this.regions = own && !own.includes(' ') && !REGION_SET.has(own) ? new Set([...REGION_SET, own]) : REGION_SET;
    const n = opts.format === 'pileup' ? Math.max(2, opts.crowd ?? 3) : 1;
    this.stations = Array.from({ length: n }, (_, i) =>
      makeIdentity(this.rng, n === 1 ? 0 : Math.round((i - (n - 1) / 2) * 140 + (this.rng() - 0.5) * 60), opts.mix ?? 'world'),
    );
    if (n === 1) this.active = this.stations[0];
    const topicPool: ('rig' | 'wx' | 'age')[] = ['rig', 'wx', 'age'];
    const count = 1 + Math.floor(this.stations[0].verbosity * 3);
    this.topics = topicPool.slice(0, count);
    this.stage = this.opener === 'bot' ? 'cq' : 'wait-cq';
  }

  get done(): boolean {
    return this.stage === 'done';
  }

  get stageName(): Stage {
    return this.stage;
  }

  get botWpm(): number {
    return this.wpm;
  }

  /** Bot's opening transmission, if the bot calls CQ. */
  start(): BotTurn[] {
    if (this.opener !== 'bot' || !this.active) return [];
    return this.say(this.active, this.cqText(this.active));
  }

  /**
   * Formats with short exchanges (contest, SST, POTA, SOTA, pileup) need no K
   * at the end: true once what you have sent so far holds what the station
   * needs next. Your callsign when you answer a CQ; CQ and your callsign when
   * you call; then the exchange: a serial number, your name and region, or a
   * report and your region. In a pileup, a callsign to pick, then any reply.
   * Always false in a ragchew, LICW or SKCC contact, which end with K.
   */
  turnComplete(text: string): boolean {
    if (!NO_K.has(this.format)) return false;
    const p = parse(text, this.regions);
    switch (this.stage) {
      case 'cq':
        return p.calls.some((c) => !this.stations.some((s) => s.call === c));
      case 'wait-cq':
        return p.cq && p.calls.length > 0;
      case 'answered':
        if (this.format === 'pileup' && !this.active) return p.calls.length > 0 || p.words.some((w) => w.endsWith('?'));
        return this.hasExchange(p);
      case 'exchange':
        return this.format === 'pileup' ? p.words.length > 0 : this.hasExchange(p);
      default:
        return false;
    }
  }

  private hasExchange(p: Parsed): boolean {
    switch (this.format) {
      case 'contest':
        return !!p.serial;
      case 'sst': {
        const x = this.sstExchange(p);
        return !!(x.name && x.region);
      }
      case 'pota':
      case 'sota':
        return !!p.rst && !!p.state;
      default:
        return false;
    }
  }

  /**
   * The bare SST exchange in an over: your name, then your region. The region
   * may be any word (a state, a country, DX), so it is read by position, after
   * calls, DE, greetings and the station's own name are set aside.
   */
  private sstExchange(p: Parsed): { name: string | null; region: string | null } {
    const w = p.words;
    let theirName = this.active?.name;
    const rest: string[] = [];
    for (let i = 0; i < w.length; i++) {
      const x = w[i];
      if (p.calls.includes(x) || SST_FILLER.has(x) || !/^[A-Z0-9]{2,12}$/.test(x)) continue;
      if (x === 'DE' && (isCallsign(w[i + 1] ?? '') || isCallsign(w[i - 1] ?? ''))) continue;
      // Their own name, sent back in a greeting (GE UWE), once.
      if (x === theirName) {
        theirName = undefined;
        continue;
      }
      rest.push(x);
    }
    if (rest.length >= 2) return { name: rest[0], region: rest[1] };
    if (rest.length === 1) return this.regions.has(rest[0]) ? { name: null, region: rest[0] } : { name: rest[0], region: null };
    return { name: null, region: null };
  }

  /**
   * Your callsign in an over to station `b`: your own call if it is there, the
   * call after DE, a lone call that isn't theirs, or a call not close to
   * theirs. A call close to theirs may be theirs copied wrong.
   */
  private yourCall(p: Parsed, b: BotIdentity): string | null {
    const own = (this.you.call ?? '').trim().toUpperCase();
    if (own && p.calls.includes(own)) return own;
    const w = p.words;
    const afterDe = w.find((x, i) => i > 0 && w[i - 1] === 'DE' && isCallsign(x) && x !== b.call);
    if (afterDe) return afterDe;
    const notTheirs = p.calls.filter((c) => c !== b.call);
    if (p.calls.length === 1 && notTheirs.length === 1) return notTheirs[0];
    return notTheirs.find((c) => callDistance(c, b.call) === Infinity) ?? null;
  }

  /** A call in the over that looks like theirs copied wrong (not yours). */
  private bustOf(p: Parsed, b: BotIdentity, yours: string | null): string | undefined {
    return p.calls.find((c) => c !== b.call && c !== yours && callDistance(c, b.call) > 0 && callDistance(c, b.call) < Infinity);
  }

  /** Feed one decoded over from you; returns what the bot sends back. */
  hear(text: string): BotTurn[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    this.transcript.push({ from: 'you', who: this.you.call || 'you', text: trimmed });
    this.overs++;
    const p = parse(trimmed, this.regions);

    // Mostly unreadable: ask for it again, slower, as a real operator would.
    const unknown = (trimmed.match(/\u2047/g) ?? []).length;
    const readable = p.calls.length || p.rst || p.name || p.qth || p.cq || p.signoff || p.agn || p.qrs;
    if (unknown >= 2 && unknown / trimmed.replace(/\s/g, '').length > 0.25 && !readable) {
      const who = this.active ?? this.stations[0];
      return this.say(who, 'QRS PSE AGN?');
    }

    // Requests that apply at any stage.
    if (p.qrs || p.qrq) {
      const before = this.wpm;
      this.wpm = Math.max(5, Math.min(45, this.wpm + (p.qrs ? -4 : 4)));
      if (this.last.length && p.words.length <= 3) return this.repeatLast(this.wpm - before);
    }
    if (this.stage === 'done') return [];

    switch (this.stage) {
      case 'cq':
        return this.onAnswerToCq(p);
      case 'wait-cq':
        return this.onYourCq(p);
      case 'answered':
        return this.onAfterAnswer(p);
      case 'exchange':
        return this.onExchange(p);
      case 'chat':
        return this.onChat(p);
      case 'closing':
        return this.onClosing(p);
    }
    return [];
  }

  // ----- stage handlers --------------------------------------------------

  private onAnswerToCq(p: Parsed): BotTurn[] {
    const b = this.active!;
    if (p.agn || p.qrz) return this.repeatLast();
    const theirs = this.yourCall(p, b);
    if (!theirs) return this.say(b, `QRZ? DE ${b.call} K`);
    this.copied.call = theirs;
    const busted = this.bustOf(p, b, theirs);
    const repair = busted ? `${b.call} ${this.rep(missingPart(busted, b.call), 3)} ${b.call} ` : '';
    switch (this.format) {
      case 'contest':
        this.stage = 'exchange';
        return this.say(b, `${theirs} 5NN ${pad(b.serial)}`);
      case 'sst':
        this.stage = 'exchange';
        return this.say(b, `${theirs} ${greeting(this.rng)} ${b.name} ${b.state}`);
      case 'pota':
      case 'sota':
        this.stage = 'exchange';
        return this.say(b, `${theirs} ${this.format === 'pota' ? 'TU UR 5NN 5NN' : `GM UR ${b.rst} ${b.rst}`} ${b.state} ${b.state} BK`);
      case 'skcc':
        this.stage = 'exchange';
        return this.say(b, `${theirs} DE ${b.call} ${repair}${greeting(this.rng)} TNX FER CALL UR ${b.rst} ${b.rst} ${b.state} ${b.state} NAME ${b.name} ${b.name} NR ${b.skcc} ${b.skcc} BK`);
      default:
        this.stage = 'chat';
        return this.say(b, `${theirs} DE ${b.call} ${repair}${this.firstOver(b, theirs)}`);
    }
  }

  private onYourCq(p: Parsed): BotTurn[] {
    if (this.format === 'pileup') {
      if (!p.cq && !this.isPileupPick(p) && this.active !== null) return [];
      this.copied.call = p.calls[0] ?? this.you.call ?? null;
      return this.pileupCall();
    }
    const b = this.active!;
    // Your call as they heard it. A CQ they could not read (KQ KQ DE ...) is
    // still answered when your call came through; with no call at all they
    // can only ask who is calling.
    const theirs = p.calls.find((c) => c !== b.call) ?? null;
    if (!theirs) return this.say(b, 'QRZ?');
    this.copied.call = theirs;
    this.stage = 'answered';
    if (this.format === 'contest' || this.format === 'sst' || this.format === 'pota' || this.format === 'sota') {
      return this.say(b, b.call);
    }
    return this.say(b, `${theirs} DE ${this.rep(b.call, b.repeats)} K`);
  }

  private onAfterAnswer(p: Parsed): BotTurn[] {
    if (this.format === 'pileup' && !this.active) return this.pileupPick(p);
    const b = this.active!;
    if (p.agn || (p.words.length <= 2 && p.calls.length === 0)) return this.repeatLast();
    // Did you copy my call? Repair it the LICW way if not.
    const yours = this.yourCall(p, b);
    const mine = this.bustOf(p, b, yours);
    if (mine && !p.calls.includes(b.call)) {
      return this.say(b, `${b.call} ${this.rep(missingPart(mine, b.call), 3)} ${b.call} K`);
    }
    this.take(p);
    switch (this.format) {
      case 'contest':
        if (!p.serial && !p.rst) return this.say(b, 'NR?');
        this.finish();
        return this.say(b, `TU 5NN ${pad(b.serial)}`);
      case 'sst':
        if (!this.copied.name && !this.copied.state) return this.say(b, 'AGN?');
        this.finish();
        return this.say(b, `${greeting(this.rng)} ${this.copied.name ?? ''} ${b.name} ${b.state} TU 73`.replace(/\s+/g, ' '));
      case 'pota':
      case 'sota':
        this.finish();
        return this.say(b, `BK TU ${this.format === 'pota' ? '5NN 5NN' : `${b.rst} ${b.rst}`} ${b.state} ${b.state} 73 BK`);
      case 'skcc':
        this.stage = 'closing';
        return this.say(b, `${this.copied.call ?? ''} DE ${b.call} R R TNX ${this.copied.name ?? ''} UR ${b.rst} ${b.rst} ${b.state} ${b.state} NAME ${b.name} ${b.name} NR ${b.skcc} ${b.skcc} BK`.replace(/\s+/g, ' '));
      default:
        this.stage = 'chat';
        return this.say(b, `${this.copied.call ?? ''} DE ${b.call} R R ${this.firstOver(b, this.copied.call ?? '')}`.replace(/\s+/g, ' '));
    }
  }

  private onExchange(p: Parsed): BotTurn[] {
    const b = this.active!;
    if (p.agn || p.asks.length) return this.repeatLast();
    this.take(p);
    switch (this.format) {
      case 'contest':
        if (!p.serial && !p.rst && !p.words.includes('TU') && !p.words.includes('R')) return this.say(b, 'NR?');
        this.finish();
        return this.say(b, `TU ${b.call} TEST`);
      case 'sst':
        this.finish();
        return this.say(b, `TU ${this.copied.name ?? ''} 73 ${b.call} SST`.replace(/\s+/g, ' '));
      case 'pota':
      case 'sota':
        this.finish();
        return this.say(b, 'BK TU 73 EE');
      case 'pileup':
        // Any acknowledgement ends this contact; the rest of the pileup calls again.
        this.finish();
        return this.pileupCall();
      case 'skcc':
        if (p.signoff || p.handover) {
          this.finish();
          return this.say(b, `BK TU ${this.copied.name ?? 'OM'} 73 GL <SK> ${this.copied.call ?? ''} DE ${b.call} EE`.replace(/\s+/g, ' '));
        }
        return this.repeatLast();
    }
    return this.onChat(p);
  }

  private onChat(p: Parsed): BotTurn[] {
    const b = this.active!;
    if (p.agn) return this.answerAsks(b, p.asks.length ? p.asks : []);
    this.take(p);
    if (p.signoff) {
      this.finish();
      return this.say(b, `R R TNX ${this.copied.name ?? 'OM'} FER FB QSO ES 73 HPE CUL ${this.copied.call ?? ''} DE ${b.call} <SK> EE`.replace(/\s+/g, ' '));
    }
    if (p.asks.length) return this.answerAsks(b, p.asks);
    // Ask for anything we still miss before chatting further.
    const missing: string[] = [];
    if (!this.copied.name) missing.push('NAME?');
    if (!this.copied.qth) missing.push('QTH?');
    const ack = this.ackTopics(p);
    if (this.format === 'licw' || !this.topics.length) {
      this.stage = 'closing';
      const ask = missing.length ? `PSE UR ${missing.join(' ')} ` : '';
      return this.say(b, `R R ${ack}${ask}TNX FER FB QSO ${this.copied.name ?? 'OM'} = 73 ES GL HPE CUL ${this.copied.call ?? ''} DE ${b.call} <SK>`.replace(/\s+/g, ' '));
    }
    const topic = this.topics.shift()!;
    const body = this.topicText(b, topic);
    const ask = missing.length ? `PSE UR ${missing.join(' ')} = ` : '';
    return this.say(b, `R R ${ack}${ask}${body} = HW? ${this.copied.call ?? ''} DE ${b.call} KN`.replace(/\s+/g, ' '));
  }

  private onClosing(p: Parsed): BotTurn[] {
    const b = this.active!;
    if (p.agn) return this.repeatLast();
    this.take(p);
    this.finish();
    if (this.format === 'skcc') return this.say(b, `TU ${this.copied.name ?? 'OM'} 73 <SK> EE`);
    return this.say(b, p.signoff || p.words.includes('73') ? 'EE' : `TU 73 <SK> EE`);
  }

  // ----- pileup ------------------------------------------------------------

  private isPileupPick(p: Parsed): boolean {
    return this.format === 'pileup' && (p.calls.length > 0 || p.words.some((w) => w.endsWith('?')));
  }

  private pileupCall(): BotTurn[] {
    this.stage = 'answered';
    this.active = null;
    const left = this.stations.filter((s) => !this.completed.includes(s));
    if (!left.length) {
      this.stage = 'done';
      this.endedAt = Date.now();
      return [];
    }
    return this.sayMany(left.map((s) => ({ s, text: this.rep(s.call, this.rng() < 0.5 ? 1 : 2) })));
  }

  private pileupPick(p: Parsed): BotTurn[] {
    const left = this.stations.filter((s) => !this.completed.includes(s));
    if (p.cq) return this.pileupCall();
    const frag = p.words.map((w) => w.replace(/\?$/, '')).find((w) => /[A-Z0-9]{2,}/.test(w) && w !== 'DE' && w !== 'QRZ');
    if (!frag) return this.sayMany(left.map((s) => ({ s, text: s.call })));
    const exact = left.find((s) => s.call === frag);
    const partial = left.filter((s) => s.call.includes(frag) || callDistance(frag, s.call) <= 1);
    if (exact && !p.words.some((w) => w.endsWith('?'))) {
      this.active = exact;
      this.stage = 'exchange';
      return this.say(exact, `R TU 5NN ${exact.state} ${exact.state}`);
    }
    if (partial.length) return this.sayMany(partial.map((s) => ({ s, text: `${s.call} ${s.call}` })));
    return this.sayMany(left.map((s) => ({ s, text: s.call })));
  }

  // ----- composition ----------------------------------------------------------

  private cqText(b: BotIdentity): string {
    switch (this.format) {
      case 'contest':
        return `CQ TEST ${b.call} ${b.call}`;
      case 'sst':
        return `CQ SST ${b.call} ${b.call}`;
      case 'pota':
        return `CQ POTA CQ POTA DE ${b.call} ${b.call} K`;
      case 'sota':
        return `CQ SOTA CQ SOTA DE ${b.call} ${b.call} K`;
      case 'skcc':
        return `CQ SKCC CQ SKCC DE ${b.call} ${b.call} K`;
      default:
        return `CQ CQ CQ DE ${b.call} ${b.call} K`;
    }
  }

  private firstOver(b: BotIdentity, theirs: string): string {
    const r = (x: string) => this.rep(x, b.repeats);
    const parts = [
      `${greeting(this.rng)} ES TNX FER CALL`,
      `UR RST ${r(b.rst)}`,
      `NAME ${r(b.name)}`,
      `QTH ${r(b.qth)} ${b.state}`,
      'HW CPY?',
    ];
    return `${parts.join(' = ')} ${theirs} DE ${b.call} KN`;
  }

  private topicText(b: BotIdentity, topic: 'rig' | 'wx' | 'age'): string {
    switch (topic) {
      case 'rig':
        return `RIG HR IS ${b.rig} AT ${b.pwr} WATTS = ANT IS ${b.ant}`;
      case 'wx':
        return `WX HR IS ${b.wx}`;
      case 'age':
        return `AGE HR IS ${b.age} = RETIRED ${b.job}`;
    }
  }

  private ackTopics(p: Parsed): string {
    const t = p.topics;
    if (t.ant) return `FB ON UR ${t.ant} = `;
    if (t.rig) return `FB ON THE ${t.rig} = `;
    if (t.wx) return `SRI ABT UR WX = `.replace('SRI', /SUN|CLEAR|WARM/.test(t.wx) ? 'FB' : 'SRI');
    if (p.name || this.copied.name) return `FB ${this.copied.name ?? p.name} = `;
    return '';
  }

  private answerAsks(b: BotIdentity, asks: Parsed['asks']): BotTurn[] {
    if (!asks.length) return this.repeatLast();
    const parts = asks.map((a) => {
      switch (a) {
        case 'name':
          return `NAME ${this.rep(b.name, 3)}`;
        case 'qth':
          return `QTH ${this.rep(b.qth, 2)} ${b.state}`;
        case 'rst':
          return `UR RST ${this.rep(b.rst, 3)}`;
        case 'rig':
          return `RIG ${b.rig}`;
        case 'wx':
          return `WX ${b.wx}`;
        case 'call':
          return this.rep(b.call, 3);
      }
    });
    return this.say(b, `${parts.join(' = ')} ${this.copied.call ?? ''} DE ${b.call} KN`.replace(/\s+/g, ' '));
  }

  private take(p: Parsed) {
    const c = this.copied;
    c.rst = p.rst ?? c.rst;
    c.name = p.name ?? c.name;
    c.qth = p.qth ?? c.qth;
    c.state = p.state ?? c.state;
    c.serial = p.serial ?? c.serial;
    c.skcc = p.skcc ?? c.skcc;
    if (this.format === 'sst') {
      // The SST exchange is bare: your name, then your region.
      const x = this.sstExchange(p);
      if (!p.name && x.name) c.name = x.name;
      if (x.region) c.state = x.region;
    }
    if (!c.call && this.active) c.call = this.yourCall(p, this.active) ?? c.call;
  }

  private finish() {
    this.stage = this.format === 'pileup' ? 'answered' : 'done';
    if (this.active) this.completed.push(this.active);
    if (this.format === 'pileup') this.active = null;
    if (this.stage === 'done') this.endedAt = Date.now();
  }

  /** Sends the last transmission again, each turn at its own speed plus `delta` (QRS/QRQ). */
  private repeatLast(delta = 0): BotTurn[] {
    const again = this.last.map((t) => ({ ...t, wpm: Math.max(5, t.wpm + delta) }));
    for (const t of again) this.transcript.push({ from: 'bot', who: t.who, text: t.text });
    return again;
  }

  private say(b: BotIdentity, text: string): BotTurn[] {
    return this.sayMany([{ s: b, text }]);
  }

  private sayMany(list: { s: BotIdentity; text: string }[]): BotTurn[] {
    const cap = this.format === 'sst' ? 20 : 45;
    const turns = list.map(({ s, text }) => ({
      who: s.call,
      text: this.style(s, text.replace(/\s+/g, ' ').trim()),
      wpm:
        this.format === 'pileup'
          ? Math.max(8, this.wpm + Math.round((this.rng() - 0.5) * 6))
          : Math.max(5, Math.min(cap, this.wpm + s.pace)),
      pitchOffset: s.pitchOffset,
    }));
    this.last = turns;
    for (const t of turns) this.transcript.push({ from: 'bot', who: t.who, text: t.text });
    return turns;
  }

  /** Ragchew stations that rarely abbreviate write some words out. */
  private style(s: BotIdentity, text: string): string {
    if ((this.format !== 'ragchew' && this.format !== 'licw') || s.abbrev >= 0.35) return text;
    return text
      .split(' ')
      .map((w) => (PLAIN[w] && this.rng() < 0.7 ? PLAIN[w] : w))
      .join(' ');
  }

  private rep(x: string, n: number): string {
    return Array.from({ length: n }, () => x).join(' ');
  }
}

function greeting(rng: Rng): string {
  return pick(rng, ['GM', 'GA', 'GE']);
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

export { STATES };
