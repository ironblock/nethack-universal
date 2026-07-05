/**
 * Generate the browser tile assets from the NetHack source:
 *
 *   vendor/nethack/dat/nhtiles.bmp   (produced by util/tile2bmp)
 *   vendor/nethack/src/tile.c        (produced by util/tilemap)
 *        ↓
 *   packages/ui/public/tiles/tiles.png       — the tilesheet, 40 tiles/row, 16px
 *   packages/ui/public/tiles/glyph2tile.json — glyph index → tile index
 *   packages/ui/public/tiles/meta.json       — { tileSize, cols, tileCount, glyphCount }
 *
 * Both the BMP and tile.c come from the same tilemap ordering, so the tile
 * indices in glyph2tile line up with the tiles in the sheet by construction.
 *
 * No external deps: BMP is decoded by hand (8-bit palettized) and PNG is
 * encoded with Node's built-in zlib.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NH = join(ROOT, "vendor", "nethack");
const OUT = join(ROOT, "packages", "ui", "public", "tiles");
const TILE_SIZE = 16;
const COLS = 40; // tile2bmp lays out 40 tiles per row

function main() {
  mkdirSync(OUT, { recursive: true });

  const { width, height, rgba } = decodeBmp(readFileSync(join(NH, "dat", "nhtiles.bmp")));
  const cols = Math.floor(width / TILE_SIZE);
  if (cols !== COLS) console.warn(`warning: expected ${COLS} tile columns, got ${cols}`);
  writeFileSync(join(OUT, "tiles.png"), encodePng(width, height, rgba));

  const glyph2tile = parseGlyph2Tile(readFileSync(join(NH, "src", "tile.c"), "utf8"));
  writeFileSync(join(OUT, "glyph2tile.json"), JSON.stringify(glyph2tile));

  const tileCount = cols * Math.floor(height / TILE_SIZE);
  const meta = { tileSize: TILE_SIZE, cols, width, height, tileCount, glyphCount: glyph2tile.length };
  writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `tiles.png ${width}x${height} (${cols} cols), glyph2tile[${glyph2tile.length}], ` +
      `max tileidx ${Math.max(...glyph2tile)}`,
  );
}

/** Parse `glyph_map glyphmap[MAX_GLYPH] = { ... };` → array of tileidx by glyph. */
function parseGlyph2Tile(src) {
  const lines = src.split("\n");
  const startIdx = lines.findIndex((l) => l.includes("glyphmap[MAX_GLYPH] = {"));
  if (startIdx < 0) throw new Error("glyphmap[] not found in tile.c");

  const out = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    // Drop any trailing /* ... */ comment (which can contain braces/text).
    const code = lines[i].replace(/\/\*.*$/, "").trim();
    if (code.startsWith("};")) break;
    const open = code.indexOf("{");
    const close = code.lastIndexOf("}");
    if (open < 0 || close < 0) continue;
    out.push(tileidxOf(code.slice(open + 1, close)));
  }
  return out;
}

/** tileidx is the 5th top-level field: glyphflags, sym{}, customcolor, color256idx, tileidx, [u]. */
function tileidxOf(entry) {
  const tokens = splitTopLevel(entry);
  const n = Number.parseInt(tokens[4], 10);
  if (!Number.isFinite(n)) throw new Error(`bad tileidx in entry: ${entry}`);
  return n;
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++, (cur += ch);
    else if (ch === "}") depth--, (cur += ch);
    else if (ch === "," && depth === 0) parts.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Decode an 8-bit palettized BMP to top-down RGBA. */
function decodeBmp(buf) {
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error("not a BMP");
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 8) throw new Error(`expected 8bpp BMP, got ${bpp}`);
  const bottomUp = rawHeight > 0;
  const height = Math.abs(rawHeight);

  // Palette: right after the header (14-byte file header + info header).
  const palOffset = 14 + headerSize;
  const palette = [];
  for (let i = 0; i < 256; i++) {
    const p = palOffset + i * 4;
    palette.push([buf[p + 2], buf[p + 1], buf[p]]); // BGR(A) → RGB
  }

  const rowSize = Math.ceil(width / 4) * 4; // BMP rows padded to 4 bytes
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y; // flip to top-down
    const rowStart = dataOffset + srcRow * rowSize;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = palette[buf[rowStart + x]];
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** Minimal PNG encoder (RGBA, filter 0) using zlib. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0

  // Prefix each scanline with filter byte 0.
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
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
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
