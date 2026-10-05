/**
 * Tiny PNG encoder for the signature pad: rasterises pen strokes into an 8-bit grayscale
 * image and writes a valid PNG (zlib "stored" blocks, so no compression library is needed).
 * Pure JavaScript, works identically on Android, iOS and the web.
 */

export type Stroke = { x: number; y: number }[];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Draw strokes (in canvas coordinates) into a grayscale buffer, white ground, dark ink. */
export function rasterise(
  strokes: Stroke[],
  srcW: number,
  srcH: number,
  outW = 600,
  outH = 240,
  thickness = 3,
): Uint8Array {
  const img = new Uint8Array(outW * outH).fill(255);
  const sx = outW / Math.max(1, srcW);
  const sy = outH / Math.max(1, srcH);
  const r = thickness;
  const dot = (cx: number, cy: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && y >= 0 && x < outW && y < outH) img[y * outW + x] = 24;
      }
    }
  };
  for (const s of strokes) {
    for (let i = 0; i < s.length; i++) {
      const a = s[i]!;
      const b = s[i + 1] ?? a;
      const ax = a.x * sx;
      const ay = a.y * sy;
      const bx = b.x * sx;
      const by = b.y * sy;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let k = 0; k <= steps; k++) dot(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
    }
  }
  return img;
}

export function encodeGrayPng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  // Raw scanlines: filter byte 0 then the row.
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  // zlib stream of stored (uncompressed) deflate blocks.
  const MAX = 65535;
  const blocks = Math.ceil(raw.length / MAX) || 1;
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let p = 0;
  zlib[p++] = 0x78;
  zlib[p++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * MAX;
    const len = Math.min(MAX, raw.length - start);
    zlib[p++] = i === blocks - 1 ? 1 : 0;
    zlib[p++] = len & 0xff;
    zlib[p++] = (len >>> 8) & 0xff;
    zlib[p++] = ~len & 0xff;
    zlib[p++] = (~len >>> 8) & 0xff;
    zlib.set(raw.subarray(start, start + len), p);
    p += len;
  }
  const ad = adler32(raw);
  zlib[p++] = (ad >>> 24) & 0xff;
  zlib[p++] = (ad >>> 16) & 0xff;
  zlib[p++] = (ad >>> 8) & 0xff;
  zlib[p++] = ad & 0xff;

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, x) => s + x.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const x of parts) {
    png.set(x, o);
    o += x.length;
  }
  return png;
}
