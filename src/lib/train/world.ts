// Stations around the world: who you hear depends on where you are. A
// station is a call with a real prefix, a local name, a city and the region
// it sends (US state, Canadian province, otherwise the country), all from one
// country. The mix of areas follows your own location.

import { type Rng, pick } from '../util/random';
import { NAMES, PROVINCES, STATES, STATE_CITIES } from './words';

export type Area = 'asia' | 'europe' | 'americas';
export type Mix = Area | 'world';

export interface Country {
  area: Area;
  /** Callsign prefixes; a call-area digit is added when a prefix ends in a letter. */
  prefixes: string[];
  /** Cities and the region sent with them on the air. */
  places: { city: string; region: string }[];
  names: string[];
  /** Relative share within its area (how often you hear it). */
  weight: number;
}

const usPlaces = Object.entries(STATE_CITIES).flatMap(([region, cities]) => cities.filter((c) => !c.includes(' ')).map((city) => ({ city, region })));
const at = (region: string, ...cities: string[]) => cities.map((city) => ({ city, region }));

export const COUNTRIES: Country[] = [
  // Asia-Pacific
  { area: 'asia', prefixes: ['JA', 'JH', 'JR', 'JE', 'JF'], places: at('JAPAN', 'TOKYO', 'OSAKA', 'SAPPORO', 'NAGOYA', 'KOBE', 'SENDAI'), names: ['TARO', 'KENJI', 'HIRO', 'YUKI', 'AKI', 'KAZU', 'TAKA', 'MASA'], weight: 5 },
  { area: 'asia', prefixes: ['HL', 'DS'], places: at('KOREA', 'SEOUL', 'BUSAN', 'DAEGU', 'INCHEON'), names: ['MIN', 'JUN', 'KIM', 'PARK', 'LEE', 'SEO'], weight: 2 },
  { area: 'asia', prefixes: ['BV', 'BX'], places: at('TAIWAN', 'TAIPEI', 'TAICHUNG', 'TAINAN'), names: ['WEI', 'MING', 'CHEN', 'TONY', 'JACK'], weight: 1.5 },
  { area: 'asia', prefixes: ['BA', 'BD', 'BG', 'BH'], places: at('CHINA', 'BEIJING', 'SHANGHAI', 'CHENGDU', 'WUHAN'), names: ['WEI', 'LI', 'CHEN', 'MING', 'WANG'], weight: 2 },
  { area: 'asia', prefixes: ['VR2'], places: at('HK', 'KOWLOON'), names: ['KEN', 'TONY', 'JACK', 'WING'], weight: 0.7 },
  { area: 'asia', prefixes: ['DU'], places: at('PHILIPPINES', 'MANILA', 'CEBU', 'DAVAO'), names: ['JOSE', 'BOY', 'RAMON', 'JUN'], weight: 1.5 },
  { area: 'asia', prefixes: ['YB', 'YC', 'YD'], places: at('INDONESIA', 'JAKARTA', 'BANDUNG', 'SURABAYA'), names: ['BUDI', 'ANDI', 'AGUS', 'EKO'], weight: 2 },
  { area: 'asia', prefixes: ['9M2', '9M6'], places: at('MALAYSIA', 'PENANG', 'IPOH', 'MELAKA', 'KUCHING'), names: ['ALI', 'TAN', 'RAJ', 'AZMI', 'LIM'], weight: 1.5 },
  { area: 'asia', prefixes: ['9V1'], places: at('SINGAPORE', 'SINGAPORE'), names: ['TAN', 'LIM', 'RAJ', 'ALI', 'KEN'], weight: 1 },
  { area: 'asia', prefixes: ['HS', 'E2'], places: at('THAILAND', 'BANGKOK', 'PHUKET', 'KORAT'), names: ['SOM', 'NOK', 'CHAI', 'TOM'], weight: 1.5 },
  { area: 'asia', prefixes: ['VU2', 'VU3'], places: at('INDIA', 'MUMBAI', 'PUNE', 'CHENNAI', 'DELHI'), names: ['RAJ', 'ARUN', 'VIJAY', 'RAVI', 'ANIL'], weight: 1.5 },
  { area: 'asia', prefixes: ['VK'], places: at('AUSTRALIA', 'SYDNEY', 'PERTH', 'BRISBANE', 'ADELAIDE', 'DARWIN'), names: ['BRUCE', 'MICK', 'JOHN', 'PETE', 'ROSS', 'IAN'], weight: 3 },
  { area: 'asia', prefixes: ['ZL'], places: at('NZ', 'AUCKLAND', 'NELSON', 'DUNEDIN'), names: ['IAN', 'ROSS', 'DAVE', 'KIWI'], weight: 1.2 },
  // Europe
  { area: 'europe', prefixes: ['DL', 'DK', 'DJ', 'DO'], places: at('GERMANY', 'BERLIN', 'MUNICH', 'HAMBURG', 'BONN', 'DRESDEN'), names: ['HANS', 'KLAUS', 'PETER', 'JENS', 'UWE', 'KARL'], weight: 5 },
  { area: 'europe', prefixes: ['G', 'M', 'M0'], places: at('ENGLAND', 'LONDON', 'LEEDS', 'BRISTOL', 'YORK'), names: ['IAN', 'NIGEL', 'DAVE', 'JOHN', 'STEVE'], weight: 3.5 },
  { area: 'europe', prefixes: ['GM'], places: at('SCOTLAND', 'GLASGOW', 'EDINBURGH'), names: ['IAN', 'ANGUS', 'JIM'], weight: 0.8 },
  { area: 'europe', prefixes: ['EI'], places: at('IRELAND', 'DUBLIN', 'CORK'), names: ['SEAN', 'PAT', 'LIAM'], weight: 0.8 },
  { area: 'europe', prefixes: ['F'], places: at('FRANCE', 'PARIS', 'LYON', 'NANTES', 'LILLE'), names: ['PIERRE', 'JEAN', 'LUC', 'MARC'], weight: 2.5 },
  { area: 'europe', prefixes: ['I', 'IK', 'IZ'], places: at('ITALY', 'ROME', 'MILAN', 'TURIN', 'GENOA'), names: ['LUCA', 'MARCO', 'GINO', 'PAOLO'], weight: 3 },
  { area: 'europe', prefixes: ['EA'], places: at('SPAIN', 'MADRID', 'SEVILLE', 'VALENCIA'), names: ['JUAN', 'JOSE', 'PACO', 'LUIS'], weight: 2.5 },
  { area: 'europe', prefixes: ['CT'], places: at('PORTUGAL', 'LISBON', 'PORTO'), names: ['RUI', 'JOAO', 'NUNO'], weight: 0.8 },
  { area: 'europe', prefixes: ['PA', 'PD'], places: at('NETHERLANDS', 'UTRECHT', 'LEIDEN', 'DELFT'), names: ['JAN', 'PIET', 'KEES', 'WIM'], weight: 1.5 },
  { area: 'europe', prefixes: ['ON'], places: at('BELGIUM', 'GHENT', 'ANTWERP', 'LIEGE'), names: ['JAN', 'LUC', 'DIRK'], weight: 1 },
  { area: 'europe', prefixes: ['SM', 'SA'], places: at('SWEDEN', 'STOCKHOLM', 'UPPSALA', 'MALMO'), names: ['LARS', 'ERIK', 'NILS', 'OLA'], weight: 1.5 },
  { area: 'europe', prefixes: ['LA'], places: at('NORWAY', 'OSLO', 'BERGEN'), names: ['OLE', 'LARS', 'KNUT'], weight: 1 },
  { area: 'europe', prefixes: ['OZ'], places: at('DENMARK', 'AARHUS', 'ODENSE'), names: ['JENS', 'OLE', 'SOREN'], weight: 1 },
  { area: 'europe', prefixes: ['OH'], places: at('FINLAND', 'HELSINKI', 'TAMPERE', 'OULU'), names: ['MIKKO', 'JUHA', 'PEKKA'], weight: 1.2 },
  { area: 'europe', prefixes: ['SP', 'SQ'], places: at('POLAND', 'WARSAW', 'KRAKOW', 'GDANSK'), names: ['PIOTR', 'JAN', 'MAREK'], weight: 2 },
  { area: 'europe', prefixes: ['OK', 'OL'], places: at('CZECH', 'PRAGUE', 'BRNO'), names: ['TOMAS', 'JIRI', 'PAVEL'], weight: 1.5 },
  { area: 'europe', prefixes: ['OE'], places: at('AUSTRIA', 'VIENNA', 'GRAZ'), names: ['FRANZ', 'KARL', 'HANS'], weight: 1 },
  { area: 'europe', prefixes: ['HB9'], places: at('SWITZERLAND', 'ZURICH', 'BERN', 'BASEL'), names: ['URS', 'BEAT', 'HANS'], weight: 1 },
  { area: 'europe', prefixes: ['HA', 'HG'], places: at('HUNGARY', 'BUDAPEST', 'PECS'), names: ['LASZLO', 'ZOLI', 'GABOR'], weight: 1 },
  { area: 'europe', prefixes: ['UR', 'UT'], places: at('UKRAINE', 'KYIV', 'LVIV', 'ODESA'), names: ['OLEG', 'SERGEY', 'IVAN'], weight: 1.5 },
  { area: 'europe', prefixes: ['YO'], places: at('ROMANIA', 'BUCHAREST', 'CLUJ'), names: ['ION', 'MIHAI', 'DAN'], weight: 0.8 },
  { area: 'europe', prefixes: ['9A'], places: at('CROATIA', 'ZAGREB', 'SPLIT'), names: ['MARKO', 'IVO', 'ANTE'], weight: 0.7 },
  // Americas
  { area: 'americas', prefixes: [], places: usPlaces, names: NAMES, weight: 10 },
  { area: 'americas', prefixes: ['VE3', 'VA3'], places: at('ON', 'TORONTO', 'OTTAWA', 'KINGSTON'), names: NAMES, weight: 1 },
  { area: 'americas', prefixes: ['VE2'], places: at('QC', 'MONTREAL', 'QUEBEC'), names: ['LUC', 'MARC', 'PIERRE'], weight: 0.5 },
  { area: 'americas', prefixes: ['VE7'], places: at('BC', 'VANCOUVER', 'VICTORIA'), names: NAMES, weight: 0.5 },
  { area: 'americas', prefixes: ['PY'], places: at('BRAZIL', 'RECIFE', 'CURITIBA', 'SANTOS'), names: ['JOAO', 'PAULO', 'MARCOS'], weight: 1 },
  { area: 'americas', prefixes: ['LU'], places: at('ARGENTINA', 'CORDOBA', 'ROSARIO'), names: ['JUAN', 'CARLOS', 'DIEGO'], weight: 0.6 },
  { area: 'americas', prefixes: ['XE'], places: at('MEXICO', 'PUEBLA', 'MERIDA'), names: ['JUAN', 'LUIS', 'PACO'], weight: 0.6 },
];

const US = COUNTRIES.find((c) => c.prefixes.length === 0)!;
const US_PREFIX_1 = ['K', 'W', 'N'];
const US_PREFIX_2 = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AJ', 'AK', 'KA', 'KB', 'KC', 'KD', 'KE', 'KF', 'KG', 'KI', 'KJ', 'KK', 'KM', 'KN', 'KO', 'KQ', 'KR', 'KS', 'KT', 'KU', 'KV', 'KW', 'KX', 'KY', 'KZ', 'NA', 'NB', 'NC', 'ND', 'NE', 'NF', 'NG', 'NI', 'NJ', 'NK', 'NM', 'NN', 'NO', 'NQ', 'NR', 'NS', 'NT', 'NU', 'NV', 'NW', 'NX', 'NY', 'NZ', 'WA', 'WB', 'WD', 'WG', 'WJ', 'WK', 'WN', 'WO', 'WQ', 'WR', 'WS', 'WT', 'WU', 'WV', 'WW', 'WX', 'WY', 'WZ'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Share of each area you hear, by where you are. */
export const MIXES: Record<Mix, Record<Area, number>> = {
  asia: { asia: 0.5, europe: 0.32, americas: 0.18 },
  europe: { europe: 0.6, americas: 0.22, asia: 0.18 },
  americas: { americas: 0.72, europe: 0.18, asia: 0.1 },
  world: { asia: 1 / 3, europe: 1 / 3, americas: 1 / 3 },
};

/** Every region a station may send: US states, Canadian provinces and countries. */
export const WORLD_REGIONS = [...new Set([...STATES, ...PROVINCES, ...COUNTRIES.flatMap((c) => c.places.map((p) => p.region))])];

function weighted<T>(rng: Rng, items: { item: T; w: number }[]): T {
  let r = rng() * items.reduce((a, x) => a + x.w, 0);
  for (const x of items) {
    r -= x.w;
    if (r <= 0) return x.item;
  }
  return items[items.length - 1].item;
}

export function pickCountry(rng: Rng, mix: Mix): Country {
  const area = weighted(rng, (Object.entries(MIXES[mix]) as [Area, number][]).map(([item, w]) => ({ item, w })));
  return weighted(rng, COUNTRIES.filter((c) => c.area === area).map((c) => ({ item: c, w: c.weight })));
}

const suffix = (rng: Rng, n: number) => Array.from({ length: n }, () => pick(rng, LETTERS)).join('');

/** A callsign from this country: real prefix, call-area digit, 1-3 letter suffix (US: the usual formats). */
export function callFrom(rng: Rng, c: Country): string {
  if (c === US) {
    const digit = String(Math.floor(rng() * 10));
    const r = rng();
    if (r < 0.35) return `${pick(rng, US_PREFIX_1)}${digit}${suffix(rng, 3)}`;
    if (r < 0.6) return `${pick(rng, US_PREFIX_2)}${digit}${suffix(rng, 3)}`;
    if (r < 0.8) return `${pick(rng, US_PREFIX_1)}${digit}${suffix(rng, 2)}`;
    if (r < 0.95) return `${pick(rng, US_PREFIX_2)}${digit}${suffix(rng, 2)}`;
    return `${pick(rng, US_PREFIX_1)}${digit}${suffix(rng, 1)}`;
  }
  const prefix = pick(rng, c.prefixes);
  const digit = /\d$/.test(prefix) ? '' : String(Math.floor(rng() * 10));
  return `${prefix}${digit}${suffix(rng, 1 + Math.floor(rng() * 3))}`;
}

export interface Station {
  call: string;
  name: string;
  qth: string;
  region: string;
}

export function station(rng: Rng, mix: Mix): Station {
  const c = pickCountry(rng, mix);
  const place = pick(rng, c.places);
  return { call: callFrom(rng, c), name: pick(rng, c.names), qth: place.city, region: place.region };
}

/** The country a callsign belongs to, by its longest matching prefix (US calls by shape). */
export function countryOf(call: string): Country | null {
  const c = call.trim().toUpperCase();
  if (!c) return null;
  let best: Country | null = null;
  let len = 0;
  for (const k of COUNTRIES) {
    for (const p of k.prefixes) {
      if (c.startsWith(p) && p.length > len) {
        best = k;
        len = p.length;
      }
    }
  }
  if (best) return best;
  return /^[KNW][A-Z]?\d|^A[A-L]\d/.test(c) ? US : null;
}

/** Your area from your callsign, else your region; null when neither tells. */
export function areaOf(you: { call: string; state: string }): Area | null {
  const fromCall = countryOf(you.call);
  if (fromCall) return fromCall.area;
  const region = you.state.trim().toUpperCase();
  if (!region) return null;
  const k = COUNTRIES.find((c) => c.places.some((p) => p.region === region));
  return k?.area ?? null;
}

// The mix practice material uses; the app sets it from Settings.
let current: Mix = 'world';

export function setMix(mix: Mix) {
  current = mix;
}

export function currentMix(): Mix {
  return current;
}
