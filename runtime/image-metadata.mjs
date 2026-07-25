/**
 * Dream Skin — Image Metadata Validator
 *
 * Reads image file headers without any external dependencies.
 * Validates dimensions and pixel count against safety limits.
 * Supports PNG, JPEG, and WebP formats.
 *
 * @param {Buffer} buffer - Raw image file bytes
 * @param {string} extension - File extension (png, jpg, jpeg, webp)
 * @returns {{ width: number, height: number, pixels: number, wide: boolean, aspect: number } | null}
 */
export function readImageMetadata(buffer, extension) {
  const ext = (extension || '').toLowerCase().replace('.', '');
  const limits = { maxDimension: 16384, maxPixels: 52428800 };

  switch (ext) {
    case 'png':
      return readPngMetadata(buffer, limits);
    case 'jpg':
    case 'jpeg':
      return readJpegMetadata(buffer, limits);
    case 'webp':
      return readWebpMetadata(buffer, limits);
    default:
      return null;
  }
}

// ── PNG ─────────────────────────────────────────────────────────────────────

function readPngMetadata(buffer, limits) {
  // PNG signature: \x89PNG\r\n\x1a\n
  if (buffer.length < 24) return null;
  const sig = buffer.subarray(0, 8);
  if (sig[0] !== 0x89 || sig[1] !== 0x50 || sig[2] !== 0x4E || sig[3] !== 0x47 ||
      sig[4] !== 0x0D || sig[5] !== 0x0A || sig[6] !== 0x1A || sig[7] !== 0x0A) {
    return null;
  }

  // First chunk must be IHDR at offset 8
  if (buffer.length < 33) return null;
  const chunkType = readUint32(buffer, 8);
  if (chunkType !== 0x49484452) return null; // 'IHDR'

  const width = readUint32(buffer, 16);
  const height = readUint32(buffer, 20);

  return validateDimensions(width, height, limits);
}

// ── JPEG ────────────────────────────────────────────────────────────────────

function readJpegMetadata(buffer, limits) {
  if (buffer.length < 4) return null;
  // Must start with 0xFF 0xD8 (SOI)
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

  let offset = 2;
  while (offset < buffer.length - 1) {
    // Find next marker (0xFF followed by non-0xFF byte)
    if (buffer[offset] !== 0xFF) { offset++; continue; }
    let marker = buffer[offset + 1];
    // Skip padding 0xFF bytes
    while (marker === 0xFF && offset + 2 < buffer.length) {
      offset++;
      marker = buffer[offset + 1];
    }

    // SOF0 (baseline) or SOF2 (progressive)
    if (marker === 0xC0 || marker === 0xC2) {
      if (offset + 9 >= buffer.length) return null;
      const height = readUint16(buffer, offset + 3);
      const width = readUint16(buffer, offset + 5);
      return validateDimensions(width, height, limits);
    }

    // DNL, DHT, DAC, DRI, or other markers with no data → skip
    // Markers with no payload: RSTn(0xD0-0xD7), SOI(0xD8), EOI(0xD9), TEM(0x01)
    const noDataMarkers = new Set([0x00, 0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9]);
    if (noDataMarkers.has(marker)) {
      offset += 2;
      continue;
    }

    // Read segment length (includes the 2-byte length field itself)
    if (offset + 3 >= buffer.length) return null;
    const segLen = readUint16(buffer, offset + 2);
    if (segLen < 2) return null; // corrupt
    offset += 2 + segLen;
  }

  return null; // No SOF found
}

// ── WebP ────────────────────────────────────────────────────────────────────

function readWebpMetadata(buffer, limits) {
  if (buffer.length < 12) return null;

  // RIFF header
  const riff = readAscii(buffer, 0, 4);
  const webp = readAscii(buffer, 8, 4);
  if (riff !== 'RIFF' || webp !== 'WEBP') return null;

  const chunk = readAscii(buffer, 12, 4);

  switch (chunk) {
    case 'VP8 ':  return readWebpLossy(buffer, limits);
    case 'VP8L':  return readWebpLossless(buffer, limits);
    case 'VP8X':  return readWebpExtended(buffer, limits);
    default:      return null;
  }
}

function readWebpLossy(buffer, limits) {
  // VP8 frame tag at offset 20
  if (buffer.length < 30) return null;

  // Frame tag: 3 bytes, then 3 bytes for width/height bits, then 7 bytes to skip
  const width = readUint16(buffer, 26) & 0x3FFF;
  const height = readUint16(buffer, 28) & 0x3FFF;

  if (width === 0 || height === 0) return null;
  return validateDimensions(width, height, limits);
}

function readWebpLossless(buffer, limits) {
  // VP8L at offset 12
  if (buffer.length < 25) return null;

  // 4 bytes: bits 0-13 = width-1, bits 14-27 = height-1
  const bits = readUint32(buffer, 21);
  const width = (bits & 0x3FFF) + 1;
  const height = ((bits >> 14) & 0x3FFF) + 1;

  return validateDimensions(width, height, limits);
}

function readWebpExtended(buffer, limits) {
  // VP8X at offset 12
  if (buffer.length < 30) return null;

  // Flags at 20, width at 21-23 (24-bit little-endian + 1), height at 24-26
  const width = readUint24(buffer, 21) + 1;
  const height = readUint24(buffer, 24) + 1;

  if (width === 0 || height === 0) return null;
  return validateDimensions(width, height, limits);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readUint16(buffer, offset) {
  return (buffer[offset] << 8) | buffer[offset + 1];
}

function readUint32(buffer, offset) {
  return (buffer[offset] << 24) | (buffer[offset + 1] << 16) |
         (buffer[offset + 2] << 8) | buffer[offset + 3];
}

function readUint24(buffer, offset) {
  return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16));
}

function readAscii(buffer, offset, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(buffer[offset + i]);
  }
  return str;
}

function validateDimensions(width, height, limits) {
  if (width <= 0 || height <= 0 || width > limits.maxDimension || height > limits.maxDimension) {
    return null;
  }
  const pixels = width * height;
  if (pixels > limits.maxPixels) return null;

  const aspect = width / height;
  return { width, height, pixels, wide: aspect > 1.2, aspect };
}
