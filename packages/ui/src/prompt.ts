/**
 * Text-entry modal for getlin (naming items, wishing, etc.). Resolves with the
 * typed line, or "\x1b" (ESC) if the player aborts — NetHack treats a leading
 * ESC in the buffer as "cancelled".
 */
export class PromptController {
  constructor(private overlay: HTMLElement) {}

  getLine(query: string, maxLen = 255): Promise<string> {
    return new Promise((resolve) => {
      const root = document.createElement("div");
      root.className = "menu prompt";

      const label = document.createElement("label");
      label.className = "menu-title";
      label.textContent = query;
      root.appendChild(label);

      const input = document.createElement("input");
      input.className = "prompt-input";
      input.maxLength = maxLen;
      input.autocomplete = "off";
      root.appendChild(input);

      const finish = (value: string) => {
        this.overlay.replaceChildren();
        this.overlay.style.display = "none";
        resolve(value);
      };

      // stopPropagation keeps typed keys out of the game input queue; the input's
      // default action (text insertion) still runs.
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(input.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish("\x1b");
        }
      });

      this.overlay.replaceChildren(root);
      this.overlay.style.display = "flex";
      input.focus();
    });
  }
}
