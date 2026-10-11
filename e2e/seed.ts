// A few weeks of practice history in IndexedDB, so Progress shows every section.
export async function seed(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const day = 864e5;
    const now = Date.now();
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('beepbeep', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['sessions', 'items', 'kv', 'confusions', 'qsos'], 'readwrite');
    const fist = { chars: 30, wpm: 17.6, unit: 0.068, dahRatio: 2.6, elemGap: 1.1, charGap: 2.4, wordGap: 6.1, weighting: 1.08, drift: null, ditSpread: 0.12, clean: 27 };
    for (let i = 0; i < 12; i++) {
      const at = now - (12 - i) * day * 1.5;
      tx.objectStore('sessions').add({ at, mode: 'copy', seconds: 600, sending: false, items: 20, accuracy: 0.8 + i * 0.01, wpm: 14 + Math.round(i / 2) });
      tx.objectStore('sessions').add({ at: at + 1000, mode: 'send', seconds: 300, sending: true, items: 10, accuracy: 0.9, wpm: 15, sentWpm: 13 + i * 0.4, fist });
      tx.objectStore('sessions').add({ at: at + 2000, mode: 'ttr', seconds: 300, sending: false, items: 20, accuracy: 0.9, wpm: 18, ttrDelay: 1.2 - i * 0.05 });
      tx.objectStore('sessions').add({ at: at + 3000, mode: 'ifr', seconds: 90, sending: false, items: 60, accuracy: 0.85, wpm: 18, recovery: 3 - i * 0.15 });
    }
    const letters = 'KMRSUAPTLOWI.NJEF0Y,VG5/Q9ZH38B?427C1D6X'.split('');
    letters.forEach((c, i) => {
      const recent = Array.from({ length: 10 }, (_, k) => ((i * 7 + k * 3) % 10 < 7 - (i % 5) ? 1 : 0));
      const log = (vals: number[], v: (k: number) => number) => vals.map((ok, k) => [now - k * day * 2, ok, ok ? v(k) : 0]);
      tx.objectStore('items').put({ key: `rx:${c}`, heat: 1, seen: 10, correct: recent.filter(Boolean).length, avgMs: 900, recent, lastSeen: now, log: log(recent, (k) => 700 + ((i * 13 + k * 7) % 9) * 90) });
      tx.objectStore('items').put({ key: `tx:${c}`, heat: 1, seen: 10, correct: 8, avgMs: 0, recent: recent.slice().reverse(), lastSeen: now, log: log(recent.slice().reverse(), (k) => 60 + ((i * 5 + k * 11) % 7) * 40) });
    });
    tx.objectStore('kv').put({ key: 'sendSlips', value: { 'merged-words': 4, 'merged-letters': 3, 'split-letter': 2, 'split-word': 1, pairs: { 'ET as A': 2, 'R as EN': 1, 'TE as N': 1 } } });
    const dit = 0.067;
    const marks = (pattern: string) => {
      const out: { start: number; end: number }[] = [];
      let t = 0;
      for (const ch of pattern) {
        if (ch === ' ') { t += dit * 2; continue; }
        const len = ch === '.' ? dit : dit * 3;
        out.push({ start: t, end: t + len });
        t += len + dit;
      }
      return out;
    };
    tx.objectStore('kv').put({ key: 'recentSends', value: [
      { at: now - 60_000, text: 'CQ CQ DE K1ABC', marks: marks('-.-. --.-   -.-. --.-   -.. .   -.- .---- .- -... -.-.') },
      { at: now - 3_600_000, text: 'TNX FER CALL', marks: marks('- -. -..-   ..-. . .-.   -.-. .- .-.. .-..') },
    ] });
    tx.objectStore('confusions').put({ pair: 'H>5', want: 'H', got: '5', count: 4, last: now });
    tx.objectStore('confusions').put({ pair: 'B>6', want: 'B', got: '6', count: 2, last: now });
    tx.objectStore('qsos').add({ at: now - day, format: 'ragchew', opener: 'bot', call: 'W4XYZ', name: 'BOB', qth: 'RALEIGH', state: 'NC', rstSent: '579', rstRcvd: '599', seconds: 420, overs: 6, copyScore: 0.83, sendScore: 1, wpm: 18 });
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  });
}
