/**
 * Port the Qt window port's status icons (attributes, alignment, hunger,
 * encumbrance, conditions) to a browser spritesheet.
 *
 * Source: vendor/nethack/win/Qt/qt_xpms.h — plain XPM (X PixMap) C string
 * arrays, same NGPL license as the rest of the tree. Decoded by hand (no XPM
 * parsing library needed: every icon here is "40 40 N 1" — 40x40, 1 char per
 * pixel, colors are `#RRGGBB` or `None`, no extensions) and packed into one
 * PNG using the same manual encoder as gen-tiles.mjs.
 *
 * Output: packages/ui/public/status-icons/{sheet.png, manifest.json}
 *   manifest: { size: 40, cols, icons: { name: index } }
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = join(ROOT, "vendor", "nethack", "win", "Qt", "qt_xpms.h");
const OUT = join(ROOT, "packages", "ui", "public", "status-icons");
const ICON_SIZE = 40;
const COLS = 6;

function main() {
  mkdirSync(OUT, { recursive: true });
  const text = readFileSync(SRC, "utf8");

  const icons = parseXpms(text);
  const names = Object.keys(icons);
  const rows = Math.ceil(names.length / COLS);
  const sheetW = COLS * ICON_SIZE;
  const sheetH = rows * ICON_SIZE;
  const rgba = Buffer.alloc(sheetW * sheetH * 4); // transparent by default

  const manifestIcons = {};
  names.forEach((name, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    blit(rgba, sheetW, col * ICON_SIZE, row * ICON_SIZE, icons[name]);
    manifestIcons[name] = i;
  });

  writeFileSync(join(OUT, "sheet.png"), encodePng(sheetW, sheetH, rgba));
  writeFileSync(
    join(OUT, "manifest.json"),
    JSON.stringify({ size: ICON_SIZE, cols: COLS, icons: manifestIcons }),
  );
  console.log(`status-icons: ${names.length} icons -> sheet.png ${sheetW}x${sheetH}`);
}

/** Parse every `static const char *NAME_xpm[] = { ... };` block into { name: rgbaBuffer(40x40) }. */
function parseXpms(text) {
  const icons = {};
  const blockRe = /static const char \*(\w+)_xpm\[\] = \{/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const name = m[1];
    const close = text.indexOf("};", m.index);
    if (close < 0) throw new Error(`unterminated ${name}_xpm`);
    const body = text.slice(m.index, close);
    const strings = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => s[1]);
    icons[name] = decodeXpm(name, strings);
  }
  if (Object.keys(icons).length === 0) throw new Error("no *_xpm arrays found");
  return icons;
}

function decodeXpm(name, strings) {
  const [wStr, hStr, ncolorsStr, cppStr] = strings[0].split(/\s+/);
  const w = Number(wStr), h = Number(hStr), ncolors = Number(ncolorsStr), cpp = Number(cppStr);
  if (w !== ICON_SIZE || h !== ICON_SIZE) {
    throw new Error(`${name}: expected ${ICON_SIZE}x${ICON_SIZE}, got ${w}x${h}`);
  }

  const colorMap = new Map(); // key chars -> [r,g,b,a]
  for (let i = 0; i < ncolors; i++) {
    const entry = strings[1 + i];
    const key = entry.slice(0, cpp);
    const spec = entry.slice(cpp).trim().replace(/^c\s+/, "");
    colorMap.set(key, spec === "None" ? [0, 0, 0, 0] : hexToRgba(spec));
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = strings[1 + ncolors + y];
    if (!row || row.length !== w * cpp) throw new Error(`${name}: bad row ${y}`);
    for (let x = 0; x < w; x++) {
      const key = row.slice(x * cpp, x * cpp + cpp);
      const color = colorMap.get(key);
      if (!color) throw new Error(`${name}: unknown color key "${key}" at row ${y}`);
      const o = (y * w + x) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = color[3];
    }
  }
  return rgba;
}

function hexToRgba(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
}

function blit(destRgba, destW, dx, dy, srcRgba) {
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const s = (y * ICON_SIZE + x) * 4;
      const d = ((dy + y) * destW + (dx + x)) * 4;
      destRgba[d] = srcRgba[s];
      destRgba[d + 1] = srcRgba[s + 1];
      destRgba[d + 2] = srcRgba[s + 2];
      destRgba[d + 3] = srcRgba[s + 3];
    }
  }
}

/** Minimal PNG encoder (RGBA, filter 0) using zlib — same approach as gen-tiles.mjs. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

main();
