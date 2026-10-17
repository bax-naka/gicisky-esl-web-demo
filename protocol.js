// Gicisky 2.9-inch BWRY / 4.2-inch BWR codecs and ACK transfer protocol.
// No external dependencies. Verified structurally against the owner's working Python implementation.
export const WIDTH = 296;
export const HEIGHT = 128;
export const CHUNK_SIZE = 240;
export const IMAGE_BYTES = WIDTH * HEIGHT / 4;
export const END_RESPONSE = '050800000000';
export const PROFILES = Object.freeze({
  g29: Object.freeze({ id: 'g29', label: '2.9インチ', width: 296, height: 128, colors: 4, imageBytes: 9472, deviceType: '0x002E' }),
  g42: Object.freeze({ id: 'g42', label: '4.2インチ', width: 400, height: 300, colors: 3, imageBytes: 30000, deviceType: '0x004B' })
});
export function getProfile(id = 'g29') {
  const profile = PROFILES[id];
  if (!profile) throw new Error('Unsupported ESL profile: ' + id);
  return profile;
}

export function toHex(data) {
  return Array.from(data, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function u32le(bytes, offset = 0) {
  return ((bytes[offset] | (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0);
}

function putU32le(buf, value, start = 0) {
  const v = value >>> 0;
  buf[start] = v & 255;
  buf[start + 1] = (v >>> 8) & 255;
  buf[start + 2] = (v >>> 16) & 255;
  buf[start + 3] = (v >>> 24) & 255;
  return buf;
}

export function announceSize(imageLength) {
  // 0x02 + uint32LE image length + three 0x00 flag/reserved bytes.
  return putU32le(new Uint8Array(8).fill(0), imageLength, 1).map((v, i) => i === 0 ? 2 : v);
}

export function dataPacket(imageData, part, chunkSize = CHUNK_SIZE) {
  const offset = part * chunkSize;
  if (offset > imageData.length) throw new Error(`Invalid block index: ${part}`);
  const slice = imageData.subarray(offset, Math.min(offset + chunkSize, imageData.length));
  const packet = new Uint8Array(4 + slice.length);
  putU32le(packet, part);
  packet.set(slice, 4);
  return packet;
}

export function rgbToPaletteCode(r, g, b) {
  // Matches the verified Python renderer threshold and precedence exactly.
  const brightness = ((r * 38) + (g * 75) + (b * 15)) >> 7;
  const isWhite = brightness > 128;
  const isRed = r > 128;
  let isGreen = g > 128;
  const isBlue = b > 128;
  if (isGreen && isRed && isBlue) isGreen = false;
  const isRedFinal = isRed && !isWhite;
  return isGreen ? 2 : isRedFinal ? 3 : isWhite ? 1 : 0;
}

export function encode296x128RGBA(rgba, width = WIDTH, height = HEIGHT) {
  if (width !== WIDTH || height !== HEIGHT || rgba.length !== width * height * 4) {
    throw new Error(`Expected ${WIDTH}x${HEIGHT} RGBA canvas`);
  }
  // Equivalent to Python PIL image.rotate(90, expand=True), then row-major 2bpp.
  // Palette: 00 black, 01 white, 10 yellow, 11 red.
  const out = new Uint8Array(IMAGE_BYTES);
  let byte = 0;
  for (let y = 0; y < WIDTH; y++) {
    for (let x = 0; x < HEIGHT; x++) {
      const srcX = WIDTH - 1 - y;
      const srcY = x;
      const idx = (srcY * WIDTH + srcX) * 4;
      const r = rgba[idx], g = rgba[idx + 1], b = rgba[idx + 2];
      const code = rgbToPaletteCode(r, g, b);
      const shift = 6 - (byte % 4) * 2;
      out[byte >> 2] |= code << shift;
      byte++;
    }
  }
  return out;
}

// 4.2-inch 0x004B BWR: 1-bit monochrome plane, then 1-bit red plane.
 // Per pixel: BW 1=white, 0=black/red; RED 1=red, 0=otherwise.
 // Row-major MSB-first, no rotation (verified against the Raspberry Pi test codec).
export function rgbToBwrColor(r, g, b) {
  if (r > 128 && g > 128 && b > 128) return 1;  // white
  if (r > 128 && g <= 128 && b <= 128) return 2; // red
  return 0;                                      // black
}

export function encode400x300RGBA(rgba, width = 400, height = 300) {
  const profile = PROFILES.g42;
  if (width !== profile.width || height !== profile.height || rgba.length !== width * height * 4) {
    throw new Error('Expected 400x300 RGBA canvas');
  }
  const planeBytes = width * height / 8;
  const out = new Uint8Array(profile.imageBytes);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    const code = rgbToBwrColor(rgba[i], rgba[i + 1], rgba[i + 2]);
    const index = pixel >> 3, bit = 7 - (pixel & 7);
    if (code === 1) out[index] |= 1 << bit;
    if (code === 2) out[planeBytes + index] |= 1 << bit;
  }
  return out;
}

export function encodeForProfile(rgba, profileId) {
  const profile = getProfile(profileId);
  return profile.id === 'g42'
    ? encode400x300RGBA(rgba, profile.width, profile.height)
    : encode296x128RGBA(rgba, profile.width, profile.height);
}

export async function transferImage(link, imageData, onProgress = () => {}, profileId = 'g29') {
  const profile = getProfile(profileId);
  if (!(imageData instanceof Uint8Array) || imageData.length !== profile.imageBytes) {
    throw new Error(`${profile.label} image must be ${profile.imageBytes} bytes`);
  }
  const ackStart = await link.writeControl(Uint8Array.of(0x01));
  if (toHex(ackStart.subarray(0, 3)) !== '01F400') {
    throw new Error(`Unexpected START ACK ${toHex(ackStart)}`);
  }
  const ackSize = await link.writeControl(announceSize(imageData.length));
  if (ackSize[0] !== 0x02) throw new Error(`Unexpected SIZE ACK ${toHex(ackSize)}`);
  const ackBegin = await link.writeControl(Uint8Array.of(0x03));
  if (ackBegin.length < 6 || ackBegin[0] !== 0x05 || ackBegin[1] !== 0) {
    throw new Error(`Unexpected IMAGE START ACK ${toHex(ackBegin)}`);
  }
  let part = u32le(ackBegin, 2);
  let repeatedPart = -1;
  let repeatedCount = 0;
  let writes = 0;
  const totalParts = Math.ceil(imageData.length / CHUNK_SIZE);
  const maxWrites = totalParts + 20;
  let lastChunkSent = false;
  for (; writes < maxWrites; writes++) {
    if (part >= totalParts) throw new Error(`Out of range block ${part} before transfer completed`);
    if (part === totalParts - 1) lastChunkSent = true;
    const ack = await link.writeData(dataPacket(imageData, part));
    onProgress(Math.min(1, ((part + 1) * CHUNK_SIZE) / imageData.length), writes + 1);
    if (ack.length >= 6 && ack[0] === 0x05 && ack[1] === 0) {
      const nextPart = u32le(ack, 2);
      if (nextPart === repeatedPart) repeatedCount++;
      else { repeatedPart = nextPart; repeatedCount = 1; }
      if (repeatedCount >= 5) throw new Error(`Transfer stalled on part ${nextPart}`);
      // On 4.2-inch 0x004B tags the final ACK may be a request for
      // the next (past-the-end) part rather than 050800000000.
      // Accept this ONLY after the final data chunk has been sent.
      if (profile.id === 'g42' && nextPart === totalParts) {
        if (!lastChunkSent) throw new Error('Premature end-of-image ACK');
        onProgress(1, writes + 1);
        return { writes: writes + 1, bytes: imageData.length, terminal: `OFFSET_END(part=${nextPart})` };
      }
      if (nextPart >= totalParts) throw new Error(`Unexpected next block ${nextPart}`);
      part = nextPart;
      continue;
    }
    if (toHex(ack) !== END_RESPONSE) {
      throw new Error(`Unexpected terminal ACK ${toHex(ack)}`);
    }
    onProgress(1, writes + 1);
    return { writes: writes + 1, bytes: imageData.length, terminal: toHex(ack) };
  }
  throw new Error(`Too many writes: ${maxWrites} limit`);
}
