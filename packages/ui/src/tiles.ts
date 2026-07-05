/**
 * Canvas2d tile renderer. Reads the tilesheet + glyph→tile mapping produced by
 * packages/core-wasm/tools/gen-tiles.mjs and blits one 16×16 tile per map cell.
 *
 * The core hands us a glyph number in print_glyph; glyph2tile[glyph] is the tile
 * index, and tiles are laid out `cols` per row in the sheet.
 */

// NetHack map dimensions (include/config.h): COLNO=80 (col 0 unused), ROWNO=21.
const COLNO = 80;
const ROWNO = 21;

interface TileMeta {
  tileSize: number;
  cols: number;
  width: number;
  height: number;
  tileCount: number;
  glyphCount: number;
}

export class TileRenderer {
  private meta!: TileMeta;
  private glyph2tile!: number[];
  private sheet!: CanvasImageSource;
  private ctx!: CanvasRenderingContext2D;
  private canvas!: HTMLCanvasElement;
  private tile = 16;

  /** Pixel size of one rendered tile (backing store). 2× source for readability. */
  readonly renderSize = 32;

  async load(base = "/tiles"): Promise<void> {
    const [meta, glyph2tile, sheet] = await Promise.all([
      fetch(`${base}/meta.json`).then((r) => r.json() as Promise<TileMeta>),
      fetch(`${base}/glyph2tile.json`).then((r) => r.json() as Promise<number[]>),
      loadImage(`${base}/tiles.png`),
    ]);
    this.meta = meta;
    this.glyph2tile = glyph2tile;
    this.sheet = sheet;
    this.tile = meta.tileSize;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.width = COLNO * this.renderSize;
    canvas.height = ROWNO * this.renderSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.clear();
  }

  /** Scroll the map's scroll container so cell (x, y) is centred (follow the hero). */
  centerOn(x: number, y: number): void {
    const box = this.canvas.parentElement;
    if (!box) return;
    const d = this.renderSize;
    box.scrollTo({
      left: x * d + d / 2 - box.clientWidth / 2,
      top: y * d + d / 2 - box.clientHeight / 2,
      behavior: "auto",
    });
  }

  clear(): void {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, COLNO * this.renderSize, ROWNO * this.renderSize);
  }

  /** Draw the tile for `glyph` at map cell (x, y). */
  drawGlyph(x: number, y: number, glyph: number): void {
    if (x < 0 || x >= COLNO || y < 0 || y >= ROWNO) return;
    this.blit(this.ctx, glyph, x * this.renderSize, y * this.renderSize, this.renderSize);
  }

  /** Blit the tile for `glyph` into any 2d context at (dx, dy), scaled to `size`. */
  blit(ctx: CanvasRenderingContext2D, glyph: number, dx: number, dy: number, size: number): boolean {
    const tile = this.glyph2tile[glyph];
    if (tile === undefined) return false;
    const sx = (tile % this.meta.cols) * this.tile;
    const sy = Math.floor(tile / this.meta.cols) * this.tile;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sheet, sx, sy, this.tile, this.tile, dx, dy, size, size);
    return true;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}
