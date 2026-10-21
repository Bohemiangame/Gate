// Generates the PWA icons (pixel-art cowboy hat on a sunset) as PNG without dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ART = [
  '................',
  '................',
  '................',
  '.....######.....',
  '....########....',
  '....########....',
  '....########....',
  '....oooooooo....',
  '.#..########..#.',
  '.##############.',
  '..############..',
  '................',
  '...s.s....s.s...',
  '................',
  '................',
  '................',
];
const COLORS = { '#': [92, 58, 32], o: [216, 38, 46], s: [255, 216, 74] };

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cell = size / 16;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const t = y / size;
      // sunset gradient background
      let c = [Math.round(74 + (240 - 74) * t), Math.round(106 + (200 - 106) * t), Math.round(168 + (144 - 168) * t)];
      const ch = ART[Math.floor(y / cell)][Math.floor(x / cell)];
      if (COLORS[ch]) c = COLORS[ch];
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s));
console.log('icons written');
