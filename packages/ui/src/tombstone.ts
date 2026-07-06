/**
 * The graphical tombstone (Qt/X11's rip.xpm, ported to PNG by
 * packages/core-wasm/tools/gen-tombstone.mjs). genl_outrip (src/rip.c) feeds
 * us the classic ASCII rip_txt template — always containing "REST"/"PEACE"
 * lines — as an ordinary NHW_TEXT window; nethack.ts detects that content and
 * routes here instead of the plain-text TextWindowController.
 */
const IMG_W = 400;
const IMG_H = 200;
// Qt's qt_rip.cpp: rip_text_x=156, rip_text_y=67, rip_text_h=94/riplines,
// all relative to the 400x200 image — text is centered in that column.
const TEXT_X_FRAC = 156 / IMG_W;
const TEXT_Y_FRAC = 67 / IMG_H;
const TEXT_H_FRAC = 94 / IMG_H;

export class TombstoneController {
  constructor(private overlay: HTMLElement) {}

  /** Detect genl_outrip's classic tombstone template among arbitrary NHW_TEXT content. */
  static isTombstone(lines: string[]): boolean {
    const text = lines.join("\n");
    return text.includes("REST") && text.includes("PEACE");
  }

  show(lines: string[]): Promise<void> {
    return new Promise((resolve) => {
      const root = document.createElement("div");
      root.className = "tombstone";

      const stage = document.createElement("div");
      stage.className = "tombstone-stage";
      root.appendChild(stage);

      const img = document.createElement("img");
      img.className = "tombstone-img";
      img.src = "/tombstone.png";
      stage.appendChild(img);

      const textBox = document.createElement("div");
      textBox.className = "tombstone-text";
      textBox.style.left = `${TEXT_X_FRAC * 100}%`;
      textBox.style.top = `${TEXT_Y_FRAC * 100}%`;
      textBox.style.height = `${TEXT_H_FRAC * 100}%`;
      const lineH = 100 / Math.max(lines.length, 1);
      for (const line of lines) {
        const div = document.createElement("div");
        div.textContent = line.trim();
        div.style.height = `${lineH}%`;
        textBox.appendChild(div);
      }
      stage.appendChild(textBox);

      const footer = document.createElement("div");
      footer.className = "menu-footer tombstone-footer";
      footer.textContent = "(press any key to continue)";
      root.appendChild(footer);

      const finish = () => {
        window.removeEventListener("keydown", onKey, true);
        this.overlay.replaceChildren();
        this.overlay.style.display = "none";
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        finish();
      };

      window.addEventListener("keydown", onKey, true);
      this.overlay.replaceChildren(root);
      this.overlay.style.display = "flex";
    });
  }
}
