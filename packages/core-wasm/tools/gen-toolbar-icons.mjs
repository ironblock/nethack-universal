/**
 * Port the Qt window port's toolbar button icons to the browser.
 *
 * Source: the nine small XPMs inlined in vendor/nethack/win/Qt/qt_main.cpp
 * (again/pickup/drop/kick/throw/fire/eat/search/rest — the AddToolButton
 * list), NGPL like the rest of the tree. Unlike the 40x40 status icons these
 * are ~12x13 with 48-bit ("#RRRRGGGGBBBB") color specs and tab separators,
 * so they get their own small parser and one PNG per icon.
 *
 * Output: packages/ui/public/toolbar/{name}.png
 * (The button labels/commands live in the UI's toolbar table, not here —
 * they're behavior, not assets.)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = join(ROOT, "vendor", "nethack", "win", "Qt", "qt_main.cpp");
const OUT = join(ROOT, "packages", "ui", "public", "toolbar");

const ICONS = ["again", "pickup", "drop", "kick", "throw", "fire", "eat", "search", "rest"];

function main() {
  mkdirSync(OUT, { recursive: true });
  const text = readFileSync(SRC, "utf8");
  for (const name of ICONS) {
    const m = text.match(new RegExp(`static const char \\*\\s*${name}_xpm\\[\\] = \\{`));
    if (!m) throw new Error(`${name}_xpm not found in qt_main.cpp`);
    const close = text.indexOf("};", m.index);
    const strings = [...text.slice(m.index, close).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
      (s) => s[1],
    );
    const { w, h, rgba } = decodeXpm(name, strings);
    writeFileSync(join(OUT, `${name}.png`), encodePng(w, h, rgba));
  }
  console.log(`toolbar icons: ${ICONS.length} PNGs -> ${OUT}`);
}

function decodeXpm(name, strings) {
  const [w, h, ncolors, cpp] = strings[0].split(/\s+/).map(Number);
  const colorMap = new Map();
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
      const color = colorMap.get(row.slice(x * cpp, x * cpp + cpp));
      if (!color) throw new Error(`${name}: unknown color key at row ${y}`);
      rgba.set(color, (y * w + x) * 4);
    }
  }
  return { w, h, rgba };
}

/** "#RGB" / "#RRGGBB" / "#RRRRGGGGBBBB" (X11 48-bit) → [r,g,b,255]. */
function hexToRgba(hex) {
  const s = hex.replace("#", "");
  const per = s.length / 3;
  const chan = (i) => Number.parseInt(s.slice(i * per, i * per + 2).padEnd(2, "0"), 16);
  return [chan(0), chan(1), chan(2), 255];
}

/** Minimal PNG encoder (RGBA, filter 0) — same approach as gen-tiles.mjs. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
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
