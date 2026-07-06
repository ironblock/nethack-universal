/**
 * Status HUD icons, ported from the Qt window port's XPM assets
 * (vendor/nethack/win/Qt/qt_xpms.h) into a spritesheet at build time
 * (packages/core-wasm/gen-status-icons.mjs). Covers the six attributes,
 * alignment, hunger, encumbrance, and status conditions — the icon set Qt
 * shows above each status label.
 */
interface Manifest {
  size: number;
  cols: number;
  icons: Record<string, number>;
}

export class StatusIcons {
  private manifest!: Manifest;
  private sheet!: HTMLImageElement;

  async load(): Promise<void> {
    const [manifest, sheet] = await Promise.all([
      fetch("/status-icons/manifest.json").then((r) => r.json()) as Promise<Manifest>,
      loadImage("/status-icons/sheet.png"),
    ]);
    this.manifest = manifest;
    this.sheet = sheet;
  }

  has(name: string): boolean {
    return name in this.manifest.icons;
  }

  /** A small <canvas> showing the named icon at `size` px (defaults to native 40px). */
  render(name: string, size = 20): HTMLCanvasElement | null {
    const idx = this.manifest.icons[name];
    if (idx === undefined) return null;
    const { size: srcSize, cols } = this.manifest;
    const sx = (idx % cols) * srcSize;
    const sy = Math.floor(idx / cols) * srcSize;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.className = "status-icon";
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.sheet, sx, sy, srcSize, srcSize, 0, 0, size, size);
    }
    return canvas;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
