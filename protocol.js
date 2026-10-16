// Gicisky 2.9-inch 0x002E 296x128 BWRY codec and transfer protocol.
// No external dependencies. Verified structurally against the owner's working Python implementation.
export const WIDTH = 296;
export const HEIGHT = 128;
export const CHUNK_SIZE = 240;
export const IMAGE_BYTES = WIDTH * HEIGHT / 4;
export const END_RESPONSE = '050800000000';

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

export async function transferImage(link, imageData, onProgress = () => {}) {
  if (!(imageData instanceof Uint8Array) || imageData.length !== IMAGE_BYTES) {
    throw new Error(`2.9-inch 4-color image must be ${IMAGE_BYTES} bytes`);
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
  const maxWrites = Math.ceil(imageData.length / CHUNK_SIZE) + 20;
  for (; writes < maxWrites; writes++) {
    const ack = await link.writeData(dataPacket(imageData, part));
    onProgress(Math.min(1, ((part + 1) * CHUNK_SIZE) / imageData.length), writes + 1);
    if (ack.length >= 6 && ack[0] === 0x05 && ack[1] === 0) {
      const nextPart = u32le(ack, 2);
      if (nextPart === repeatedPart) repeatedCount++;
      else { repeatedPart = nextPart; repeatedCount = 1; }
      if (repeatedCount >= 5) throw new Error(`Transfer stalled on part ${nextPart}`);
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
