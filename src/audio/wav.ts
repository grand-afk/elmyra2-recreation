// 24-bit PCM WAV encoder. Safari's MediaRecorder cannot produce WAV, so we write it ourselves.

export function encodeWav(chunks: Float32Array[], sampleRate: number, channels = 1): Blob {
  const frames = chunks.reduce((n, c) => n + c.length, 0) / channels;
  const bytesPerSample = 3;
  const dataBytes = frames * channels * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytesPerSample, true);
  v.setUint16(32, channels * bytesPerSample, true);
  v.setUint16(34, 24, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      const q = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
      v.setUint8(o, q & 0xff);
      v.setUint8(o + 1, (q >> 8) & 0xff);
      v.setUint8(o + 2, (q >> 16) & 0xff);
      o += 3;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Hand a file to the user: the iOS share sheet when available, else a download. */
export async function saveFile(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const touchDevice = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (touchDevice && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export const timestampName = (prefix: string, ext: string) => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
};
