// Debug builds only: microphone samples sent to the dev server, which saves
// them under samples/ for replaying through the detector in tests.

/** 16-bit mono WAV. */
export function wav(pcm: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  return new Blob([buf], { type: 'audio/wav' });
}

export async function upload(name: string, body: Blob | string): Promise<void> {
  const r = await fetch(`${import.meta.env.BASE_URL}__samples?name=${encodeURIComponent(name)}`, { method: 'POST', body });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

export async function saved(): Promise<string[]> {
  const r = await fetch(`${import.meta.env.BASE_URL}__samples`);
  return r.ok ? r.json() : [];
}
