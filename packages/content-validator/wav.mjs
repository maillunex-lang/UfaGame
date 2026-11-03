/**
 * Bounded PCM WAV inspector (S11). Accepts only RIFF/WAVE with one fmt chunk
 * (PCM format 1, 1-2 channels, 8000-48000 Hz, 8/16 bit) and one data chunk.
 * Type is decided by content, never by file extension.
 */
export const WAV_LIMITS = Object.freeze({maxBytes: 8 * 1024 * 1024, maxDurationMs: 120000, maxChunks: 64});
const fail = code => {
  throw new Error(code);
};
export function inspectWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > WAV_LIMITS.maxBytes) fail('WAV_SIZE');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') fail('WAV_SIGNATURE');
  if (bytes.readUInt32LE(4) !== bytes.length - 8) fail('WAV_RIFF_SIZE');
  let offset = 12, fmt = null, data = null, chunks = 0;
  while (offset < bytes.length) {
    if (++chunks > WAV_LIMITS.maxChunks) fail('WAV_CHUNKS');
    if (offset + 8 > bytes.length) fail('WAV_TRUNCATED');
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    const end = start + size + (size % 2);
    if (start + size > bytes.length || end > bytes.length) fail('WAV_TRUNCATED');
    if (id === 'fmt ') {
      if (fmt || size < 16) fail('WAV_FMT');
      fmt = {
        format: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      if (data || !fmt) fail('WAV_DATA_ORDER');
      data = {size};
    } else if (!/^[\x20-\x7e]{4}$/.test(id)) fail('WAV_CHUNK_ID');
    offset = end;
  }
  if (!fmt || !data) fail('WAV_MISSING_CHUNK');
  const {format, channels, sampleRate, byteRate, blockAlign, bits} = fmt;
  if (format !== 1) fail('WAV_NOT_PCM');
  if (channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 48000 || (bits !== 8 && bits !== 16)) fail('WAV_FORMAT_LIMIT');
  if (blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign) fail('WAV_FMT_INCONSISTENT');
  if (data.size === 0 || data.size % blockAlign) fail('WAV_DATA_SIZE');
  const durationMs = Math.ceil(data.size / blockAlign * 1000 / sampleRate);
  if (durationMs > WAV_LIMITS.maxDurationMs) fail('WAV_DURATION');
  return {media_type: 'audio/wav', duration_ms: durationMs, sample_rate: sampleRate, channels, bits_per_sample: bits};
}
