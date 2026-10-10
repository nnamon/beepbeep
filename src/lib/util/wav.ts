// Minimal WAV reading and writing for test fixtures: PCM 8/16/24/32-bit and
// 32-bit float, any channel count (mixed to mono on read).

export function readWav(buf: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let format = 0;
  let channels = 1;
  let sampleRate = 0;
  let bits = 16;
  let data: [number, number] | null = null;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      format = v.getUint16(o + 8, true);
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the subformat GUID.
      if (format === 0xfffe && size >= 26) format = v.getUint16(o + 32, true);
    } else if (id === 'data') {
      data = [o + 8, Math.min(size, buf.length - o - 8)];
    }
    o += 8 + size + (size & 1);
  }
  if (!data || !sampleRate) throw new Error('WAV has no fmt or data chunk');
  if (format !== 1 && format !== 3) throw new Error(`unsupported WAV format ${format}`);
  const bytes = bits / 8;
  const frames = Math.floor(data[1] / (bytes * channels));
  const out = new Float32Array(frames);
  const read = (p: number): number => {
    if (format === 3) return bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true);
    if (bits === 8) return (buf[p] - 128) / 128;
    if (bits === 16) return v.getInt16(p, true) / 32768;
    if (bits === 24) return (((buf[p + 2] << 24) | (buf[p + 1] << 16) | (buf[p] << 8)) >> 8) / 8388608;
    return v.getInt32(p, true) / 2147483648;
  };
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read(data[0] + (i * channels + c) * bytes);
    out[i] = s / channels;
  }
  return { samples: out, sampleRate };
}

/** 16-bit mono PCM. */
export function writeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => [...s].forEach((ch, i) => (out[o + i] = ch.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return out;
}
