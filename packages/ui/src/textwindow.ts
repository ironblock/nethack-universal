/**
 * NHW_TEXT window viewer: tombstone, discoveries, conduct, terrain, and other
 * full-screen text displays all go through create_nhwindow(NHW_TEXT) + putstr +
 * display_nhwindow. Render the buffered lines as a dismissable monospace overlay
 * instead of dumping them into the scrolling message log.
 */
export class TextWindowController {
  constructor(private overlay: HTMLElement) {}

  /** Show `lines` and resolve once the player dismisses it (any key). */
  show(lines: string[]): Promise<void> {
    return new Promise((resolve) => {
      const root = document.createElement("div");
      root.className = "menu textwin";

      const pre = document.createElement("pre");
      pre.className = "textwin-body";
      pre.textContent = lines.join("\n");
      root.appendChild(pre);

      const footer = document.createElement("div");
      footer.className = "menu-footer";
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
