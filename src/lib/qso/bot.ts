// Rule-based bot stations for the QSO simulator. A bot reads your decoded
// over, keeps track of where the contact is, and answers the way a real
// operator would, including AGN?, QRS and repairing a busted call.

import { type Rng, mulberry32, pick } from '../util/random';
import { callsign } from '../train/generate';
import { ANTENNAS, JOBS, NAMES, RIGS, STATES, STATE_CITIES, WEATHER } from '../train/words';
import { callDistance, missingPart, parse, type Parsed } from './parse';

export type Format = 'ragchew' | 'licw' | 'skcc' | 'sst' | 'pota' | 'sota' | 'contest' | 'pileup';
export type Opener = 'bot' | 'you';

export const FORMATS: { id: Format; name: string; exchange: string }[] = [
  { id: 'ragchew', name: 'Ragchew', exchange: 'RST, name, QTH, then rig, antenna, weather' },
  { id: 'licw', name: 'LICW QSO Protocol', exchange: 'Calls, RST, name and QTH repeated, a cordial close' },
  { id: 'skcc', name: 'SKCC', exchange: 'RST, QTH, name, SKCC number' },
  { id: 'sst', name: 'K1USN SST', exchange: 'Name and state, 20 WPM or slower' },
  { id: 'pota', name: 'POTA', exchange: 'Call, 5NN, state' },
  { id: 'sota', name: 'SOTA', exchange: 'Call, RST, state' },
  { id: 'contest', name: 'Contest', exchange: 'Call, 5NN, serial number' },
  { id: 'pileup', name: 'DX pileup', exchange: 'Several stations call; pick one, 5NN and state' },
];

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
}

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
}

type Stage = 'cq' | 'wait-cq' | 'answered' | 'exchange' | 'chat' | 'closing' | 'done';

export function makeIdentity(rng: Rng, pitchOffset = 0): BotIdentity {
  const state = pick(rng, Object.keys(STATE_CITIES));
  return {
    call: callsign(rng, { dx: 0.15 }),
    name: pick(rng, NAMES),
    qth: pick(rng, STATE_CITIES[state]),
    state,
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
    const n = opts.format === 'pileup' ? Math.max(2, opts.crowd ?? 3) : 1;
    this.stations = Array.from({ length: n }, (_, i) =>
      makeIdentity(this.rng, n === 1 ? 0 : Math.round((i - (n - 1) / 2) * 140 + (this.rng() - 0.5) * 60)),
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

  /** Feed one decoded over from you; returns what the bot sends back. */
  hear(text: string): BotTurn[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    this.transcript.push({ from: 'you', who: this.you.call || 'you', text: trimmed });
    this.overs++;
    const p = parse(trimmed);

    // Requests that apply at any stage.
    if (p.qrs || p.qrq) {
      this.wpm = Math.max(5, Math.min(45, this.wpm + (p.qrs ? -4 : 4)));
      if (this.last.length && p.words.length <= 3) return this.repeatLast();
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
    const theirs = this.otherCall(p, b);
    if (!theirs) return this.say(b, `QRZ? DE ${b.call} K`);
    this.copied.call = theirs;
    const busted = p.calls.find((c) => c !== b.call && callDistance(c, b.call) < Infinity && callDistance(c, b.call) > 0);
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
    if (!p.cq && !this.isPileupPick(p)) {
      if (this.format === 'pileup' && this.active === null) return this.pileupCall();
      return [];
    }
    const theirs = p.calls[0] ?? this.you.call ?? null;
    if (!theirs && this.format !== 'pileup') return this.say(this.stations[0], 'QRZ?');
    this.copied.call = theirs;
    if (this.format === 'pileup') return this.pileupCall();
    const b = this.active!;
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
    const mine = p.calls.find((c) => callDistance(c, b.call) < Infinity);
    if (mine && mine !== b.call) {
      return this.say(b, `${b.call} ${this.rep(missingPart(mine, b.call), 3)} ${b.call} K`);
    }
    this.take(p);
    switch (this.format) {
      case 'contest':
        if (!p.serial && !p.rst) return this.say(b, 'NR?');
        this.finish();
        return this.say(b, `TU 5NN ${pad(b.serial)}`);
      case 'sst':
        if (!p.name && !p.state) return this.say(b, 'AGN?');
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
    if (this.format === 'sst' && !p.name) {
      // SST exchange is bare: NAME STATE.
      const w = p.words.filter((x) => !['GE', 'GM', 'GA', 'TU', '73', 'SST', 'R'].includes(x) && !p.calls.includes(x));
      const st = w.find((x) => STATES.includes(x));
      const nm = w.find((x) => /^[A-Z]{2,8}$/.test(x) && !STATES.includes(x) && x !== this.active?.name);
      c.state = st ?? c.state;
      c.name = nm ?? c.name;
    }
    if (!c.call) c.call = p.calls.find((x) => !this.stations.some((s) => s.call === x)) ?? c.call;
  }

  private otherCall(p: Parsed, b: BotIdentity): string | null {
    const others = p.calls.filter((c) => callDistance(c, b.call) === Infinity);
    if (this.you.call && others.includes(this.you.call)) return this.you.call;
    return others[0] ?? null;
  }

  private finish() {
    this.stage = this.format === 'pileup' ? 'answered' : 'done';
    if (this.active) this.completed.push(this.active);
    if (this.format === 'pileup') this.active = null;
    if (this.stage === 'done') this.endedAt = Date.now();
  }

  private repeatLast(): BotTurn[] {
    const again = this.last.map((t) => ({ ...t, wpm: this.wpm }));
    for (const t of again) this.transcript.push({ from: 'bot', who: t.who, text: t.text });
    return again;
  }

  private say(b: BotIdentity, text: string): BotTurn[] {
    return this.sayMany([{ s: b, text }]);
  }

  private sayMany(list: { s: BotIdentity; text: string }[]): BotTurn[] {
    const turns = list.map(({ s, text }) => ({
      who: s.call,
      text: text.replace(/\s+/g, ' ').trim(),
      wpm: this.format === 'pileup' ? Math.max(8, this.wpm + Math.round((this.rng() - 0.5) * 6)) : this.wpm,
      pitchOffset: s.pitchOffset,
    }));
    this.last = turns;
    for (const t of turns) this.transcript.push({ from: 'bot', who: t.who, text: t.text });
    return turns;
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
