/**
 * Canvas2d tile renderer. Reads the tilesheet + glyph→tile mapping produced by
 * packages/core-wasm/tools/gen-tiles.mjs and blits one 16×16 tile per map cell.
 *
 * The core hands us a glyph number in print_glyph; glyph2tile[glyph] is the tile
 * index, and tiles are laid out `cols` per row in the sheet.
 */
import { BASE_URL } from "./base";

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

export const MIN_RENDER_SIZE = 16;
export const MAX_RENDER_SIZE = 64;

// How long after the window regains focus a map click is still assumed to be
// "just refocusing" rather than a deliberate travel/look click.
const FOCUS_CLICK_GUARD_MS = 500;

/** Map-cell marker overlays (ported from Qt's pet_mark_xpm/pile_mark_xpm). */
export type CellMark = "pet" | "pile" | undefined;
const MARK_CODE: Record<Exclude<CellMark, undefined>, number> = { pet: 1, pile: 2 };

export class TileRenderer {
  private meta!: TileMeta;
  private glyph2tile!: number[];
  private sheet!: CanvasImageSource;
  private ctx!: CanvasRenderingContext2D;
  private canvas!: HTMLCanvasElement;
  private tile = 16;
  private petMark!: HTMLImageElement;
  private pileMark!: HTMLImageElement;

  // Last-drawn glyph/mark per map cell (-1 glyph = never drawn), so changing
  // tile size can redraw locally instead of asking the core to repaint (no
  // redraw command needed — matches Qt/tty's "adjustable tile size" without
  // core involvement).
  private cells = new Int32Array(COLNO * ROWNO).fill(-1);
  private cellMarks = new Uint8Array(COLNO * ROWNO); // 0=none, see MARK_CODE
  private lastCenter = { x: 0, y: 0 };

  /** Pixel size of one rendered tile (backing store). 2× source for readability. */
  renderSize = 32;

  async load(base = `${BASE_URL}tiles`): Promise<void> {
    const [meta, glyph2tile, sheet, petMark, pileMark] = await Promise.all([
      fetch(`${base}/meta.json`).then((r) => r.json() as Promise<TileMeta>),
      fetch(`${base}/glyph2tile.json`).then((r) => r.json() as Promise<number[]>),
      loadImage(`${base}/tiles.png`),
      loadImage(`${BASE_URL}map-marks/pet.png`),
      loadImage(`${BASE_URL}map-marks/pile.png`),
    ]);
    this.meta = meta;
    this.glyph2tile = glyph2tile;
    this.sheet = sheet;
    this.tile = meta.tileSize;
    this.petMark = petMark;
    this.pileMark = pileMark;
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

  /**
   * Report map cell clicks. Left button → CLICK_1 (1), right → CLICK_2 (2).
   * Accounts for any CSS scaling of the canvas.
   *
   * The click that merely refocuses the browser tab/window (alt-tab back,
   * dismissing devtools, clicking from the OS taskbar, ...) is swallowed
   * rather than forwarded — otherwise it reads as "travel to this cell",
   * which can silently burn many turns (and several free monster attacks)
   * before the player notices. Standard fix: track window focus/blur and
   * ignore the first click that lands within a short window after refocus.
   */
  onCellClick(handler: (x: number, y: number, button: number) => void): void {
    const toCell = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) * this.canvas.width) / rect.width;
      const py = ((e.clientY - rect.top) * this.canvas.height) / rect.height;
      return { x: Math.floor(px / this.renderSize), y: Math.floor(py / this.renderSize) };
    };

    let suppressClick = false;
    window.addEventListener("focus", () => {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), FOCUS_CLICK_GUARD_MS);
    });

    this.canvas.addEventListener("click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const { x, y } = toCell(e);
      handler(x, y, 1); // CLICK_1
    });
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const { x, y } = toCell(e);
      handler(x, y, 2); // CLICK_2
    });
  }

  /** Scroll the map's scroll container so cell (x, y) is centred (follow the hero). */
  centerOn(x: number, y: number): void {
    this.lastCenter = { x, y };
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

  /** Draw the tile for `glyph` at map cell (x, y), with an optional pet/pile marker overlay. */
  drawGlyph(x: number, y: number, glyph: number, mark?: CellMark): void {
    if (x < 0 || x >= COLNO || y < 0 || y >= ROWNO) return;
    const idx = y * COLNO + x;
    this.cells[idx] = glyph;
    this.cellMarks[idx] = mark ? MARK_CODE[mark] : 0;
    const dx = x * this.renderSize;
    const dy = y * this.renderSize;
    this.blit(this.ctx, glyph, dx, dy, this.renderSize);
    this.drawMark(dx, dy, this.renderSize, mark);
  }

  /** Change the on-screen tile size and redraw from the local glyph cache (no core involvement). */
  setSize(px: number): void {
    this.renderSize = Math.max(MIN_RENDER_SIZE, Math.min(MAX_RENDER_SIZE, px));
    this.canvas.width = COLNO * this.renderSize;
    this.canvas.height = ROWNO * this.renderSize;
    this.clear();
    for (let y = 0; y < ROWNO; y++) {
      for (let x = 0; x < COLNO; x++) {
        const idx = y * COLNO + x;
        const glyph = this.cells[idx] ?? -1;
        if (glyph < 0) continue;
        const dx = x * this.renderSize;
        const dy = y * this.renderSize;
        this.blit(this.ctx, glyph, dx, dy, this.renderSize);
        const markCode = this.cellMarks[idx] ?? 0;
        this.drawMark(dx, dy, this.renderSize, markCode === 1 ? "pet" : markCode === 2 ? "pile" : undefined);
      }
    }
    this.centerOn(this.lastCenter.x, this.lastCenter.y);
  }

  /** Top-right badge overlay for pets (heart) / object piles (cross) — ported from Qt. */
  private drawMark(dx: number, dy: number, size: number, mark: CellMark): void {
    if (!mark) return;
    const img = mark === "pet" ? this.petMark : this.pileMark;
    const badge = Math.max(6, Math.round(size * 0.4));
    this.ctx.drawImage(img, dx + size - badge, dy, badge, badge);
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
