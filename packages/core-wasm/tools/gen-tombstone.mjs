/**
 * Port the classic tombstone image (vendor/nethack/win/X11/rip.xpm — shared
 * between the X11 and Qt ports; Qt just loads the same file from HACKDIR at
 * runtime) to a PNG. Same manual XPM decode as gen-map-marks.mjs/
 * gen-status-icons.mjs, this one's just bigger (400x200, 90 colors).
 *
 * Output: packages/ui/public/tombstone.png
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = join(ROOT, "vendor", "nethack", "win", "X11", "rip.xpm");
const OUT = join(ROOT, "packages", "ui", "public", "tombstone.png");

function main() {
  const text = readFileSync(SRC, "utf8");
  const marker = "static char *rip_xpm[] = {";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error("rip_xpm not found");
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
    if (!row || row.length !== w * cpp) throw new Error(`bad row ${y} (got ${row?.length}, want ${w * cpp})`);
    for (let x = 0; x < w; x++) {
      const key = row.slice(x * cpp, x * cpp + cpp);
      const color = colorMap.get(key);
      if (!color) throw new Error(`unknown color key "${key}" at row ${y}`);
      const o = (y * w + x) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = color[3];
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, encodePng(w, h, rgba));
  console.log(`tombstone: ${w}x${h} -> ${OUT}`);
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
