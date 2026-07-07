/**
 * NHW_TEXT window viewer: tombstone, discoveries, conduct, terrain, and other
 * full-screen text displays all go through create_nhwindow(NHW_TEXT) + putstr +
 * display_nhwindow. Render the buffered lines as a dismissable monospace overlay.
 *
 * Qt's text windows (qt_menu.cpp NetHackQtTextWindow) carry Dismiss and Search
 * buttons — Search highlights case-insensitive matches and scrolls to the
 * first one, wrapping on repeat. Same here, plus click-anywhere/any-key
 * dismissal.
 */
export class TextWindowController {
  constructor(private overlay: HTMLElement) {}

  /** Show `lines` and resolve once the player dismisses it. */
  show(lines: string[]): Promise<void> {
    return new Promise((resolve) => {
      const root = document.createElement("div");
      root.className = "menu textwin";

      const buttons = document.createElement("div");
      buttons.className = "menu-buttons";
      const dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.textContent = "Dismiss";
      const searchBtn = document.createElement("button");
      searchBtn.type = "button";
      searchBtn.textContent = "Search";
      buttons.append(dismissBtn, searchBtn);
      root.appendChild(buttons);

      const pre = document.createElement("pre");
      pre.className = "textwin-body";
      for (const line of lines) {
        const div = document.createElement("div");
        div.textContent = line || " ";
        pre.appendChild(div);
      }
      root.appendChild(pre);

      const footer = document.createElement("div");
      footer.className = "menu-footer";
      footer.textContent = "(press any key to continue)";
      root.appendChild(footer);

      let searchBox: HTMLInputElement | null = null;
      let lastMatch = -1;
      const rows = [...pre.children] as HTMLElement[];

      const finish = () => {
        window.removeEventListener("keydown", onKey, true);
        this.overlay.replaceChildren();
        this.overlay.style.display = "none";
        resolve();
      };

      const runSearch = (q: string) => {
        const needle = q.toLowerCase();
        rows.forEach((r) => r.classList.remove("textwin-hit"));
        if (!needle) return;
        const hits = rows.flatMap((r, i) => (r.textContent!.toLowerCase().includes(needle) ? [i] : []));
        if (!hits.length) return;
        hits.forEach((i) => rows[i]!.classList.add("textwin-hit"));
        // wraparound: next hit strictly after the last one we jumped to
        const next = hits.find((i) => i > lastMatch) ?? hits[0]!;
        lastMatch = next;
        rows[next]!.scrollIntoView({ block: "center" });
      };

      const openSearch = () => {
        if (searchBox) {
          searchBox.focus();
          return;
        }
        searchBox = document.createElement("input");
        searchBox.type = "text";
        searchBox.placeholder = "Search for…";
        searchBox.className = "menu-search";
        searchBox.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if (ev.key === "Escape") {
            searchBox?.remove();
            searchBox = null;
          } else if (ev.key === "Enter") {
            runSearch(searchBox!.value);
          }
        });
        root.insertBefore(searchBox, footer);
        searchBox.focus();
      };

      dismissBtn.addEventListener("click", finish);
      searchBtn.addEventListener("click", openSearch);

      const onKey = (e: KeyboardEvent) => {
        if (e.target === searchBox) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts stay native
        e.preventDefault();
        e.stopPropagation();
        // A bare Shift keydown must not dismiss the window — it precedes the
        // ':' (Shift+;) that opens search. Only real keys act.
        if (e.key.length !== 1 && !["Escape", "Enter"].includes(e.key)) return;
        if (e.key === ":") return openSearch(); // MENU_SEARCH
        finish();
      };

      window.addEventListener("keydown", onKey, true);
      this.overlay.replaceChildren(root);
      this.overlay.style.display = "flex";
    });
  }
}
