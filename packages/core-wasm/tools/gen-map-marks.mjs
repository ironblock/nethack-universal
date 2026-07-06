/**
 * Port Qt's pet/pile map-cell markers (vendor/nethack/win/Qt/qt_map.cpp,
 * NOT qt_xpms.h — these two XPMs live inline in qt_map.cpp itself) to small
 * PNGs. Same manual XPM decode + PNG encode approach as gen-status-icons.mjs,
 * generalized for non-square/non-40px icons since these are 8x7 and 5x5.
 *
 * Output: packages/ui/public/map-marks/{pet.png, pile.png}
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = join(ROOT, "vendor", "nethack", "win", "Qt", "qt_map.cpp");
const OUT = join(ROOT, "packages", "ui", "public", "map-marks");

function main() {
  mkdirSync(OUT, { recursive: true });
  const text = readFileSync(SRC, "utf8");

  // pet_mark_xpm is the full-size mark (Qt's compact mode uses
  // pet_mark_small_xpm instead; we don't have a compact mode, so always use
  // the full-size ones for both).
  writeIcon(text, "pet_mark", join(OUT, "pet.png"));
  writeIcon(text, "pile_mark", join(OUT, "pile.png"));
}

function writeIcon(text, varName, outPath) {
  const marker = `static const char *${varName}_xpm[] = {`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`${varName}_xpm not found`);
  const close = text.indexOf("};", start);
  const body = text.slice(start, close);
  const strings = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => s[1]);

  const [wStr, hStr, ncolorsStr, cppStr] = strings[0].split(/\s+/);
  const w = Number(wStr), h = Number(hStr), ncolors = Number(ncolorsStr), cpp = Number(cppStr);

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
    if (!row || row.length !== w * cpp) throw new Error(`${varName}: bad row ${y}`);
    for (let x = 0; x < w; x++) {
      const key = row.slice(x * cpp, x * cpp + cpp);
      const color = colorMap.get(key);
      if (!color) throw new Error(`${varName}: unknown color key "${key}" at row ${y}`);
      const o = (y * w + x) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = color[3];
    }
  }

  writeFileSync(outPath, encodePng(w, h, rgba));
  console.log(`${varName}: ${w}x${h} -> ${outPath}`);
}

function hexToRgba(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
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
