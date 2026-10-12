// The fixed set of band clips the Radio tab's decoder is scored on: strong
// and weak stations, fading, static, stations on top of each other, a QSO on
// nearly one pitch, a busy band, hand keying, a code-practice broadcast, and
// clips with no station at all for counting false text. Everything is
// seeded, so a scenario sounds the same on every run. The clips pass a
// receiver's SSB audio filter (300 to 2700 Hz), and one QSO a CW filter (400
// to 900 Hz).
//
// The text is the kind heard on the air: CQ calls, QSO exchanges, contest
// exchanges and a broadcast's plain sentences. Callsigns, names and towns
// come from many countries. The callsigns are made up for the tests.

import { keySend, qso, type Band, type Station } from './band';
import { mulberry32 } from '../util/random';

export interface Scenario {
  /** Short name for the scorecard. */
  name: string;
  /** What it is, in a sentence. */
  about: string;
  band: Band;
}

const SSB: [number, number] = [300, 2700];
const CW: [number, number] = [400, 900];

/**
 * One station's transmissions with pauses between them (the stations it
 * works are not heard): each starts 1 to 3 seconds after the last ends.
 */
function turns(s: Omit<Station, 'sends'>, overs: string[], start: number, seed: number): Station {
  const rng = mulberry32(seed);
  const st: Station = { ...s, seed: s.seed ?? seed, sends: [] };
  let t = start;
  for (const text of overs) {
    const marks = keySend(st, text, st.sends.length);
    st.sends.push({ text, at: t });
    t += marks[marks.length - 1].end + 1 + 2 * rng();
  }
  return st;
}

const once = (s: Omit<Station, 'sends'>, text: string, at = 0.6): Station => ({ ...s, sends: [{ text, at }] });

export const SCENARIOS: Scenario[] = [
  {
    name: 'strong 15 wpm',
    about: 'One strong station sending by machine at 15 wpm.',
    band: {
      stations: [once({ name: 'VK2BHF', pitch: 620, wpm: 15 }, 'JA1QRT DE VK2BHF = GM KENJI UR RST 579 579 = NAME BRUCE = QTH SYDNEY = HW? KN')],
      noise: { snrDb: 20 },
      passband: SSB,
      seed: 1,
    },
  },
  {
    name: 'strong 20 wpm',
    about: 'One strong station sending by machine at 20 wpm.',
    band: {
      stations: [once({ name: 'DL4MKX', pitch: 700, wpm: 20 }, 'G3VTQ DE DL4MKX = R R GE PETER = UR RST 599 5NN = NAME KLAUS = QTH MUNICH = RIG IC7300 ES DIPOLE = HW? G3VTQ DE DL4MKX KN')],
      noise: { snrDb: 20 },
      passband: SSB,
      seed: 2,
    },
  },
  {
    name: 'strong 25 wpm',
    about: 'One strong station sending by machine at 25 wpm.',
    band: {
      stations: [once({ name: 'PY2WQS', pitch: 560, wpm: 25 }, 'LU5DXK DE PY2WQS = R TNX DIEGO FB QSO = RIG HR K3 ES 3 EL YAGI = WX SUNNY ES WARM 31C = QSL VIA BURO = TNX FER QSO ES HPE CU AGN 73 = LU5DXK DE PY2WQS <SK>')],
      noise: { snrDb: 20 },
      passband: SSB,
      seed: 3,
    },
  },
  {
    name: 'strong 30 wpm',
    about: 'A strong contest station at 30 wpm: calls, exchanges and pauses while others answer.',
    band: {
      stations: [
        turns({ name: 'OH6BVK', pitch: 760, wpm: 30 }, ['CQ TEST OH6BVK OH6BVK TEST', 'JA7KUD 5NN 15', 'TU OH6BVK TEST', 'EA4GHT 5NN 15', 'TU OH6BVK', 'CQ TEST OH6BVK OH6BVK', 'K4SWZ 5NN 15', 'TU OH6BVK TEST', 'HL5FUA 5NN 15', 'TU OH6BVK'], 0.6, 41),
      ],
      noise: { snrDb: 20 },
      passband: SSB,
      seed: 4,
    },
  },
  {
    name: 'strong 35 wpm',
    about: 'One strong station sending by machine at 35 wpm.',
    band: {
      stations: [
        once(
          { name: 'ZS6WBK', pitch: 640, wpm: 35 },
          'SM5RYC DE ZS6WBK = R R FB ANNA SOLID CPY = UR SIG 599 IN PRETORIA BUT QSB AT TIMES = RIG IS A HOMEBREW 50W ES 3 EL YAGI = WX CLEAR ES COOL 9C = TNX FER NICE QSO ES HPE CU AGN ON 20M = 73 SM5RYC DE ZS6WBK <SK> TU',
        ),
      ],
      noise: { snrDb: 20 },
      passband: SSB,
      seed: 5,
    },
  },
  {
    name: 'weak 10 dB',
    about: 'One station at 18 wpm, 10 dB over the noise in 500 Hz.',
    band: {
      stations: [once({ name: '9M2SKA', pitch: 680, wpm: 18 }, 'CQ CQ DE 9M2SKA 9M2SKA K = YB1QRX DE 9M2SKA GM UR RST 449 449 = NAME AZMAN = QTH KUCHING = HW? KN')],
      noise: { snrDb: 10 },
      passband: SSB,
      seed: 6,
    },
  },
  {
    name: 'weak 6 dB',
    about: 'One station at 18 wpm, 6 dB over the noise in 500 Hz.',
    band: {
      stations: [once({ name: 'HL5FUA', pitch: 590, wpm: 18 }, 'BV2KD DE HL5FUA = R GA WEI = UR RST 339 339 = NAME MINHO = QTH BUSAN = WX RAIN = HW? KN')],
      noise: { snrDb: 6 },
      passband: SSB,
      seed: 7,
    },
  },
  {
    name: 'weak 3 dB',
    about: 'One station at 18 wpm, 3 dB over the noise in 500 Hz.',
    band: {
      stations: [once({ name: 'ZL1RTE', pitch: 640, wpm: 18 }, 'CQ DX CQ DX DE ZL1RTE ZL1RTE K = 9V1XX DE ZL1RTE UR 229 229 = NAME AROHA = QTH AUCKLAND = KN')],
      noise: { snrDb: 3 },
      passband: SSB,
      seed: 8,
    },
  },
  {
    name: 'weak 0 dB',
    about: 'One station at 18 wpm, as strong as the noise in 500 Hz.',
    band: {
      stations: [once({ name: '5Z4LGT', pitch: 720, wpm: 18 }, 'CQ CQ DE 5Z4LGT 5Z4LGT K = G3VTQ DE 5Z4LGT UR RST 319 319 = OP OTIENO = QTH NAIROBI = KN')],
      noise: { snrDb: 0 },
      passband: SSB,
      seed: 9,
    },
  },
  {
    name: 'deep QSB',
    about: 'One station at 22 wpm fading by up to 26 dB, in slow swells about 7 and 18 seconds long.',
    band: {
      stations: [
        once(
          { name: 'YB1QRX', pitch: 610, wpm: 22, qsb: { depth: 0.95, rateHz: 0.15 } },
          '9M2SKA DE YB1QRX = R R TNX AZMAN = UR RST 459 QSB = NAME BUDI BUDI = QTH BANDUNG BANDUNG = WX HOT 33C = HW? 9M2SKA DE YB1QRX KN',
        ),
      ],
      noise: { snrDb: 12 },
      passband: SSB,
      seed: 10,
    },
  },
  {
    name: 'heavy QRN',
    about: 'One station at 18 wpm under static crashes, about 2 a second, the loudest 12 dB over it in 500 Hz.',
    band: {
      stations: [once({ name: 'VU2PTK', pitch: 660, wpm: 18 }, 'HS0ZDY DE VU2PTK = GE SOMCHAI = UR RST 559 559 QRN = NAME RAJ RAJ = QTH PUNE PUNE = HW? HS0ZDY DE VU2PTK KN')],
      noise: { snrDb: 15 },
      qrn: { ratePerSec: 2, db: 12 },
      passband: SSB,
      seed: 11,
    },
  },
  {
    name: 'two at 80 Hz',
    about: 'Two stations sending at the same time 80 Hz apart, at 22 and 18 wpm, 6 dB apart.',
    band: {
      stations: [
        once({ name: 'F5NLJ', pitch: 600, wpm: 22 }, 'I2XQW DE F5NLJ = GM MARCO TNX FER CALL = UR RST 579 = NAME LUC = QTH LYON = RIG IC7610 ES DELTA LOOP = HW? I2XQW DE F5NLJ KN'),
        once({ name: 'EA4GHT', pitch: 680, wpm: 18, levelDb: -6 }, 'CQ CQ CQ DE EA4GHT EA4GHT K = OK1KDP DE EA4GHT UR RST 569 = NAME JAVI = QTH MADRID = HW? KN', 2.1),
      ],
      noise: { snrDb: 18 },
      passband: SSB,
      seed: 12,
    },
  },
  {
    name: 'two at 150 Hz',
    about: 'Two stations sending at the same time 150 Hz apart, at 25 and 20 wpm, 3 dB apart.',
    band: {
      stations: [
        once({ name: 'I2XQW', pitch: 550, wpm: 25 }, 'F5NLJ DE I2XQW = R R TNX LUC = UR RST 589 589 = NAME MARCO = QTH MILAN = WX FOGGY 8C = TNX QSO 73 = F5NLJ DE I2XQW <SK>'),
        once({ name: 'SP9LKV', pitch: 700, wpm: 20, levelDb: -3 }, 'CQ CQ DE SP9LKV SP9LKV K = OZ1JHM DE SP9LKV = GM UR 579 = NAME TOMEK = QTH KRAKOW = HW? KN', 1.4),
      ],
      noise: { snrDb: 18 },
      passband: SSB,
      seed: 13,
    },
  },
  {
    name: 'two at 300 Hz',
    about: 'Two stations sending at the same time 300 Hz apart, at 16 and 24 wpm, the faster 3 dB louder.',
    band: {
      stations: [
        once({ name: 'CE3FNP', pitch: 500, wpm: 16 }, 'PY2WQS DE CE3FNP = GD MARCOS = UR RST 579 = NAME PILAR = QTH VALPARAISO = HW? PY2WQS DE CE3FNP KN'),
        once({ name: 'XE1ROJ', pitch: 800, wpm: 24, levelDb: 3 }, 'CQ CQ CQ DE XE1ROJ XE1ROJ K = LU5DXK DE XE1ROJ = GD DIEGO UR RST 599 = NAME LUIS = QTH PUEBLA = RIG FTDX10 ES DIPOLE = HW? LU5DXK DE XE1ROJ KN', 1.2),
      ],
      noise: { snrDb: 18 },
      passband: SSB,
      seed: 14,
    },
  },
  {
    name: 'QSO 12 Hz apart',
    about: 'A QSO on nearly one pitch, 12 Hz apart: 18 wpm, and 26 wpm 12 dB weaker (8 dB over the noise in 500 Hz), through a CW filter.',
    band: {
      stations: qso(
        { name: 'JA1QRT', pitch: 650, wpm: 18 },
        { name: 'BV2KD', pitch: 662, wpm: 26, levelDb: -12 },
        [
          'CQ CQ DE JA1QRT K',
          'JA1QRT DE BV2KD K',
          'BV2KD DE JA1QRT GM UR RST 579 579 NAME KENJI HW? KN',
          'R TNX KENJI UR 599 NAME WEI QTH TAIPEI 73 KN',
          'TNX WEI 73 <SK>',
          '73 TU EE',
        ],
        0.6,
        15,
      ),
      noise: { snrDb: 20 },
      passband: CW,
      seed: 15,
    },
  },
  {
    name: 'QSO 35 Hz apart',
    about: 'A QSO 35 Hz apart: 18 wpm, and 24 wpm 18 dB weaker (15 dB over the noise in 500 Hz).',
    band: {
      stations: qso(
        { name: 'HS0ZDY', pitch: 700, wpm: 18 },
        { name: '9V1XX', pitch: 735, wpm: 24, levelDb: -18 },
        [
          'CQ CQ DE HS0ZDY K',
          'HS0ZDY DE 9V1XX K',
          'UR 559 NAME SOMCHAI QTH BANGKOK KN',
          'R TNX SOMCHAI UR 579 NAME JUN QTH SINGAPORE 73 KN',
          'TNX JUN 73 <SK>',
        ],
        0.6,
        16,
      ),
      noise: { snrDb: 15, bandwidthHz: 500 },
      ref: '9V1XX',
      passband: SSB,
      seed: 16,
    },
  },
  {
    name: 'busy band',
    about: 'Five stations across 380 to 1120 Hz at 15 to 32 wpm, 14 dB apart from weakest to strongest, starting at different times.',
    band: {
      stations: [
        turns({ name: 'UA9CDT', pitch: 380, wpm: 28, levelDb: -6 }, ['CQ CQ CQ DE UA9CDT UA9CDT K', 'CQ CQ DE UA9CDT UA9CDT K', 'CQ DE UA9CDT K'], 0.4, 171),
        once({ name: 'OZ1JHM', pitch: 540, wpm: 20, qsb: { depth: 0.5, rateHz: 0.2 } }, 'SP9LKV DE OZ1JHM = R TNX TOMEK = UR RST 569 = NAME OLE = QTH AARHUS = RIG IC7300 ES WIRE = WX WINDY 10C = HW? SP9LKV DE OZ1JHM KN', 1.5),
        turns({ name: 'SM5RYC', pitch: 730, wpm: 32, levelDb: 4 }, ['CQ TEST SM5RYC', 'DL4MKX 5NN 14', 'TU SM5RYC', 'G3VTQ 5NN 14', 'TU SM5RYC TEST', 'F5NLJ 5NN 14', 'TU SM5RYC'], 3.2, 172),
        once({ name: 'W2ZUV', pitch: 900, wpm: 15, levelDb: -10 }, 'JA7KUD DE W2ZUV = TNX RPT = NAME MIKE = QTH ALBANY = 73 JA7KUD DE W2ZUV KN', 6.5),
        once({ name: 'VE3KQR', pitch: 1120, wpm: 22, keying: 'bug', levelDb: -3 }, 'CQ CQ DE VE3KQR VE3KQR K = OK1KDP DE VE3KQR R UR 579 = NAME DAVE = QTH TORONTO = HW? KN', 2.4),
      ],
      noise: { snrDb: 16 },
      ref: 'OZ1JHM',
      passband: SSB,
      seed: 17,
    },
  },
  {
    name: 'straight key 13 wpm',
    about: 'One station hand keying a straight key at 13 wpm.',
    band: {
      stations: [once({ name: 'LU5DXK', pitch: 610, wpm: 13, keying: 'straight' }, 'CQ CQ DE LU5DXK K = PY2WQS DE LU5DXK UR RST 579 = NAME DIEGO = QTH CORDOBA = KN')],
      noise: { snrDb: 18 },
      passband: SSB,
      seed: 18,
    },
  },
  {
    name: 'bug 22 wpm',
    about: 'One station on a bug at 22 wpm: machine dits, hand-timed dahs and gaps.',
    band: {
      stations: [
        once({ name: 'VE3KQR', pitch: 690, wpm: 22, keying: 'bug' }, 'W2ZUV DE VE3KQR = R R GE MIKE = UR RST 589 589 = NAME DAVE = QTH TORONTO = RIG IS A VIBROPLEX BUG = WX SNOW -4C = HW? KN'),
      ],
      noise: { snrDb: 18 },
      passband: SSB,
      seed: 19,
    },
  },
  {
    name: 'broadcast 18/10',
    about: 'A code-practice broadcast: 18 wpm characters, 10 wpm overall, plain sentences.',
    band: {
      stations: [
        once(
          { name: 'G4PRC', pitch: 750, wpm: 18, overallWpm: 10 },
          'QST DE G4PRC = THE NIGHT TRAIN LEAVES AT NINE AND REACHES THE SEA BY DAWN. =',
        ),
      ],
      noise: { snrDb: 20 },
      passband: SSB,
      seed: 20,
    },
  },
  {
    name: 'drift',
    about: 'One station at 20 wpm whose pitch drifts down 6 Hz a minute.',
    band: {
      stations: [
        once({ name: 'EI7HDK', pitch: 680, wpm: 20, driftHzPerMin: -6 }, 'CQ CQ CQ DE EI7HDK EI7HDK K = CT1EHK DE EI7HDK = GM UR RST 569 = NAME SEAN = QTH GALWAY = RIG OLD VALVE TX = WX RAIN 11C = HW? CT1EHK DE EI7HDK KN'),
      ],
      noise: { snrDb: 16 },
      passband: SSB,
      seed: 21,
    },
  },
  {
    name: 'chirp',
    about: 'One station at 16 wpm whose pitch jumps 25 Hz at each key-down and settles in about 30 ms.',
    band: {
      stations: [once({ name: 'LZ1KDP', pitch: 630, wpm: 16, chirp: { hz: 25, tau: 0.03 } }, 'CQ CQ DE LZ1KDP LZ1KDP K = OH6BVK DE LZ1KDP = UR RST 579C = NAME IVAN = QTH SOFIA = KN')],
      noise: { snrDb: 18 },
      passband: SSB,
      seed: 22,
    },
  },
  {
    name: 'voice nearby',
    about: 'One station at 20 wpm with someone talking nearby: 3 dB louder than the station while talking (before the receiver filter), 3 dB weaker in the 500 Hz around it.',
    band: {
      stations: [once({ name: 'CT1EHK', pitch: 700, wpm: 20 }, 'EI7HDK DE CT1EHK = R TNX SEAN = UR RST 579 = NAME RUI = QTH LISBON = WX SUNNY 22C = HW? EI7HDK DE CT1EHK KN')],
      noise: { snrDb: 18 },
      voice: { db: 3 },
      passband: SSB,
      seed: 23,
    },
  },
  {
    name: 'noise only',
    about: 'Receiver noise as loud as in the 10 dB weak-signal clip, and no station, 30 seconds.',
    band: { stations: [], seconds: 30, noise: { snrDb: 10 }, passband: SSB, seed: 24 },
  },
  {
    name: 'noise and QRN only',
    about: 'Receiver noise and static crashes as in the heavy QRN clip, and no station, 30 seconds.',
    band: { stations: [], seconds: 30, noise: { snrDb: 15 }, qrn: { ratePerSec: 2, db: 12 }, passband: SSB, seed: 25 },
  },
  {
    name: 'noise and voice only',
    about: 'Receiver noise and someone talking, as in the voice nearby clip, and no station, 25 seconds.',
    band: { stations: [], seconds: 25, noise: { snrDb: 18 }, voice: { db: 3 }, passband: SSB, seed: 26 },
  },
];
