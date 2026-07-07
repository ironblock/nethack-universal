/**
 * Menu overlay: renders NetHack menus (start_menu / add_menu / end_menu /
 * select_menu) as clickable HTML popups with tile-annotated rows, and resolves
 * a promise with the user's selection.
 *
 * Interaction model ported from Qt's NetHackQtMenuWindow (qt_menu.cpp):
 *  - Ok / Cancel / All / None / Invert / Search button row with the same
 *    per-mode enabling rules (SelectMenu, qt_menu.cpp:315-325)
 *  - digit keys type a count ("Count: N") applied to the next toggled item,
 *    with '#' starting a zero count and Backspace editing (InputCount)
 *  - a digit first checks group accelerators before starting a count, and
 *    any other key toggles every row sharing that group accelerator (gch)
 *  - the core's menu command keys (wintype.h): '.' all, '-' none, '@' invert,
 *    page variants aliased to the whole menu, ':' search
 *  - Esc clears a pending count, then a pending search, then cancels
 *  - items arriving flagged MENU_ITEMFLAGS_SELECTED start selected; a
 *    PICK_ONE menu with exactly one preselected item accepts it on Enter
 *
 * how: PICK_NONE (0) display-only, PICK_ONE (1) single pick, PICK_ANY (2) multi.
 */
import type { TileRenderer } from "./tiles";

export const PICK_NONE = 0;
export const PICK_ONE = 1;
export const PICK_ANY = 2;

// include/wintype.h
const MENU_ITEMFLAGS_SELECTED = 0x1;
const KEY_ALL = [".", ","]; // MENU_SELECT_ALL / _PAGE ("page" = whole menu here)
const KEY_NONE = ["-", "\\"]; // MENU_UNSELECT_ALL / _PAGE
const KEY_INVERT = ["@", "~"]; // MENU_INVERT_ALL / _PAGE
const KEY_SEARCH = [":"]; // MENU_SEARCH

// include/wintype.h ATR_* → CSS class; include/color.h CLR_* → CSS color.
const ATTR_CLASS: Record<number, string> = {
  1: "atr-bold",
  2: "atr-dim",
  3: "atr-italic",
  4: "atr-uline",
  5: "atr-blink",
  7: "atr-inverse",
};
// Dark-theme readable takes on the 16 tty colors. CLR_BLACK (0) and NO_COLOR
// (8) fall through to the default text color.
const CLR_CSS: Record<number, string> = {
  1: "#d96459", // red
  2: "#6fbf73", // green
  3: "#b08d57", // brown
  4: "#6a8ad8", // blue
  5: "#b678c9", // magenta
  6: "#5fb8b8", // cyan
  7: "#9aa0a6", // gray
  9: "#e69a4c", // orange
  10: "#8fe08f", // bright green
  11: "#e0d060", // yellow
  12: "#8fb8ff", // bright blue
  13: "#e08fe0", // bright magenta
  14: "#8fe0e0", // bright cyan
  15: "#f0f2f5", // white
};

/**
 * The menu identifier. The shim marshals the `anything` union as fmt 'i', i.e.
 * its low 32 bits (a_int, or a 32-bit wasm pointer), so a single number round-trips
 * it: on the way back we write [id, 0] into the 8-byte union.
 */
export type Identifier = number;

export interface MenuItem {
  identifier: Identifier;
  accel: number; // accelerator char code; 0 = not selectable (header/text)
  groupAccel: number; // group accelerator char code (gch); 0 = none
  glyph: number; // -1 if none
  text: string;
  attr: number; // ATR_* text attribute
  color: number; // CLR_* text color (8 = NO_COLOR)
  selectable: boolean;
  preselected: boolean; // MENU_ITEMFLAGS_SELECTED
}

export interface MenuPick {
  identifier: Identifier;
  count: number; // -1 = whole stack
}

const ACCEL_POOL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class MenuController {
  constructor(
    private overlay: HTMLElement,
    private renderer: TileRenderer,
  ) {}

  show(prompt: string, items: MenuItem[], how: number): Promise<MenuPick[]> {
    assignAccelerators(items);
    padTabColumns(items);
    // Preselected rows start selected for PICK_ONE too — Qt's accept()
    // harvests the checked row, so Ok on a preselected PICK_ONE menu must
    // return it (not resolve as a cancel), and None must be able to clear it.
    const selected = new Set<MenuItem>(
      how !== PICK_NONE ? items.filter((i) => i.selectable && i.preselected) : [],
    );
    const counts = new Map<MenuItem, number>(); // explicit partial-stack counts
    const preselCt = items.filter((i) => i.selectable && i.preselected).length;

    return new Promise<MenuPick[]>((resolve) => {
      const root = document.createElement("div");
      root.className = "menu";

      // Qt's button row sits above the prompt (qt_menu.cpp:207-213).
      let searchBox: HTMLInputElement | null = null;
      const buttons = document.createElement("div");
      buttons.className = "menu-buttons";
      const btn = (label: string, enabled: boolean, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.disabled = !enabled;
        b.addEventListener("click", onClick);
        buttons.appendChild(b);
        return b;
      };
      const okOk = how !== PICK_ONE || preselCt === 1;
      btn("Ok", okOk, () => accept());
      btn("Cancel", true, () => finish([]));
      const single = items.filter((i) => i.selectable).length === 1;
      btn("All", how === PICK_ANY || (how === PICK_ONE && single), () => bulk("all"));
      btn("None", how === PICK_ANY || (how === PICK_ONE && preselCt === 1), () => bulk("none"));
      btn("Invert", how === PICK_ANY || (how === PICK_ONE && single), () => bulk("invert"));
      btn("Search", how !== PICK_NONE, () => openSearch());
      root.appendChild(buttons);

      if (prompt) {
        const title = document.createElement("div");
        title.className = "menu-title";
        title.textContent = prompt;
        root.appendChild(title);
      }

      const list = document.createElement("div");
      list.className = "menu-list";
      root.appendChild(list);

      const rowEls = new Map<MenuItem, HTMLElement>();
      const countEls = new Map<MenuItem, HTMLElement>();
      for (const item of items) {
        const row = this.renderRow(item, how, countEls);
        rowEls.set(item, row);
        list.appendChild(row);
        if (selected.has(item)) row.classList.add("selected");
        if (item.selectable && how !== PICK_NONE) {
          row.addEventListener("click", () => onPick(item));
        }
      }

      const footer = document.createElement("div");
      footer.className = "menu-footer";
      const footerDefault =
        how === PICK_NONE
          ? "(press any key)"
          : how === PICK_ONE
            ? "click an item, or press its letter · Esc to cancel"
            : "toggle items · type digits for a count · Enter to accept · Esc to cancel";
      footer.textContent = footerDefault;
      root.appendChild(footer);

      const finish = (picks: MenuPick[]) => {
        window.removeEventListener("keydown", onKey, true);
        this.overlay.replaceChildren();
        this.overlay.style.display = "none";
        resolve(picks);
      };

      // ---- count entry (qt_menu.cpp InputCount/ClearCount) ----
      let countStr = "";
      const counting = () => countStr !== "";
      const showCount = () => {
        footer.textContent = counting() ? `Count: ${countStr}` : footerDefault;
      };
      const inputCount = (ch: string) => {
        if (ch === "\b") {
          countStr = countStr.slice(0, -1);
        } else {
          if (ch === "#") ch = "0";
          else if (ch > "0" && countStr === "0") countStr = "";
          countStr += ch;
        }
        showCount();
      };
      const clearCount = () => {
        countStr = "";
        showCount();
      };

      const setSelected = (item: MenuItem, on: boolean) => {
        if (on) selected.add(item);
        else selected.delete(item);
        rowEls.get(item)?.classList.toggle("selected", on);
        if (!on || !counts.has(item)) {
          counts.delete(item);
          const el = countEls.get(item);
          if (el) el.textContent = "";
        }
      };

      const onPick = (item: MenuItem) => {
        if (how === PICK_ONE) {
          const n = counting() ? parseInt(countStr, 10) : -1;
          finish([{ identifier: item.identifier, count: n }]);
          return;
        }
        // PICK_ANY: an explicit count selects with that count (0 deselects);
        // otherwise toggle (qt_menu.cpp ToggleSelect).
        if (counting()) {
          const n = parseInt(countStr, 10);
          clearCount();
          if (n > 0) {
            counts.set(item, n);
            setSelected(item, true);
            const el = countEls.get(item);
            if (el) el.textContent = String(n);
          } else {
            setSelected(item, false);
          }
        } else {
          counts.delete(item);
          setSelected(item, !selected.has(item));
        }
      };

      const bulk = (op: "all" | "none" | "invert") => {
        if (how === PICK_NONE) return;
        clearCount();
        for (const item of items) {
          if (!item.selectable) continue;
          if (op === "all") setSelected(item, true);
          else if (op === "none") setSelected(item, false);
          else setSelected(item, !selected.has(item));
        }
      };

      // ---- search (qt_menu.cpp Search: toggle case-insensitive matches) ----
      const openSearch = () => {
        if (searchBox) {
          searchBox.focus();
          return;
        }
        searchBox = document.createElement("input");
        searchBox.type = "text";
        searchBox.placeholder = "Search for…";
        searchBox.className = "menu-search";
        searchBox.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape") closeSearch();
          if (e.key !== "Enter") return;
          const q = searchBox!.value.toLowerCase();
          closeSearch();
          if (!q) return;
          for (const item of items) {
            if (!item.selectable || !item.text.toLowerCase().includes(q)) continue;
            if (how === PICK_ONE) return onPick(item); // first match picks
            onPick(item);
          }
        });
        root.insertBefore(searchBox, footer);
        searchBox.focus();
      };
      const closeSearch = () => {
        searchBox?.remove();
        searchBox = null;
      };

      const accept = () =>
        finish(
          [...selected].map((i) => ({ identifier: i.identifier, count: counts.get(i) ?? -1 })),
        );

      const onKey = (e: KeyboardEvent) => {
        if (e.target === searchBox) return; // search box handles its own keys
        // Browser shortcuts (Cmd+C, Ctrl+F, Cmd+R…) stay native, not menu picks.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        // Bare modifier / function / navigation keydowns are swallowed but
        // never act (Qt's keyValue()==0 bail-out) — otherwise Shift alone
        // would dismiss a PICK_NONE menu before the shifted character lands.
        if (e.key.length !== 1 && !["Escape", "Enter", "Backspace"].includes(e.key)) return;
        if (how === PICK_NONE) return finish([]);
        if (e.key === "Escape") {
          if (counting()) return clearCount();
          if (searchBox) return closeSearch();
          return finish([]);
        }
        if (e.key === "Enter" || (how === PICK_ANY && e.key === " ")) {
          // PICK_ONE accepts the LIVE selection (preselected unless the
          // user cleared/changed it via None/All/Invert) — Qt's accept().
          if (how === PICK_ONE) {
            const sel = [...selected];
            return finish(
              sel.length === 1 ? [{ identifier: sel[0]!.identifier, count: -1 }] : [],
            );
          }
          return accept();
        }
        if (e.key === "Backspace") return inputCount("\b");

        const key = e.key.length === 1 ? e.key : "";
        if (!key) return;
        const code = key.charCodeAt(0);

        // Item accelerator wins over everything (qt_menu keyPressEvent).
        const item = items.find((i) => i.selectable && i.accel === code);
        if (item) return onPick(item);

        if (key >= "0" && key <= "9") {
          if (!counting()) {
            // digit group-accelerators take precedence over starting a count
            const hits = items.filter((i) => i.selectable && i.groupAccel === code);
            if (hits.length) return hits.forEach(onPick);
          }
          return inputCount(key);
        }
        if (key === "#" && !counting()) return inputCount(key);
        if (KEY_ALL.includes(key)) return bulk("all");
        if (KEY_NONE.includes(key)) return bulk("none");
        if (KEY_INVERT.includes(key)) return bulk("invert");
        if (KEY_SEARCH.includes(key)) return openSearch();

        // Any other key: toggle all rows sharing it as a group accelerator.
        const hits = items.filter((i) => i.selectable && i.groupAccel === code);
        hits.forEach(onPick);
      };

      window.addEventListener("keydown", onKey, true);
      this.overlay.replaceChildren(root);
      this.overlay.style.display = "flex";
    });
  }

  private renderRow(item: MenuItem, how: number, countEls: Map<MenuItem, HTMLElement>): HTMLElement {
    const row = document.createElement("div");
    row.className = item.selectable ? "menu-row selectable" : "menu-row header";

    if (item.selectable && how !== PICK_NONE) {
      const key = document.createElement("span");
      key.className = "menu-accel";
      key.textContent = String.fromCharCode(item.accel);
      row.appendChild(key);
      const count = document.createElement("span");
      count.className = "menu-count";
      countEls.set(item, count);
      row.appendChild(count);
    }

    if (item.glyph >= 0) {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      canvas.className = "menu-tile";
      const ctx = canvas.getContext("2d");
      if (ctx && this.renderer.blit(ctx, item.glyph, 0, 0, 32)) row.appendChild(canvas);
    }

    const text = document.createElement("span");
    text.className = "menu-text";
    const attrClass = ATTR_CLASS[item.attr];
    if (attrClass) text.classList.add(attrClass);
    const color = CLR_CSS[item.color];
    if (color) text.style.color = color;
    text.textContent = item.text;
    row.appendChild(text);
    return row;
  }
}

/**
 * Docked, always-visible inventory panel (the `perm_invent` option). Unlike
 * MenuController, this never blocks: NetHack repopulates it silently on every
 * inventory change (see repopulate_perminvent, called with want_reply=FALSE,
 * i.e. PICK_NONE) and expects no reply.
 */
export class PermInventPanel {
  constructor(
    private container: HTMLElement,
    private renderer: TileRenderer,
  ) {}

  render(items: MenuItem[]): void {
    const frag = document.createDocumentFragment();
    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = "Inventory";
    frag.appendChild(title);

    for (const item of items) {
      const row = document.createElement("div");
      row.className = item.selectable ? "menu-row" : "menu-row header";

      if (item.glyph >= 0) {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        canvas.className = "menu-tile";
        const ctx = canvas.getContext("2d");
        if (ctx && this.renderer.blit(ctx, item.glyph, 0, 0, 24)) row.appendChild(canvas);
      }
      if (item.selectable) {
        const key = document.createElement("span");
        key.className = "menu-accel";
        key.textContent = String.fromCharCode(item.accel);
        row.appendChild(key);
      }

      const text = document.createElement("span");
      text.className = "menu-text";
      text.textContent = item.text;
      row.appendChild(text);
      frag.appendChild(row);
    }

    this.container.replaceChildren(frag);
  }
}

/** Assign a-zA-Z accelerators to selectable items that didn't come with one. */
function assignAccelerators(items: MenuItem[]): void {
  const used = new Set<number>();
  for (const i of items) if (i.selectable && i.accel) used.add(i.accel);
  let next = 0;
  for (const i of items) {
    if (!i.selectable || i.accel) continue;
    while (next < ACCEL_POOL.length && used.has(ACCEL_POOL.charCodeAt(next))) next++;
    if (next < ACCEL_POOL.length) {
      i.accel = ACCEL_POOL.charCodeAt(next);
      used.add(i.accel);
      next++;
    }
  }
}

/**
 * Qt forces iflags.menu_tab_sep on and pads tab-separated sub-fields so
 * multi-column menus (skills, enlightenment, symbols) line up. Tabs collapse
 * in HTML, so pad each column to its widest cell — menus render in the
 * monospace UI font, making space-padding exact.
 */
function padTabColumns(items: MenuItem[]): void {
  if (!items.some((i) => i.text.includes("\t"))) return;
  const rows = items.map((i) => i.text.split("\t"));
  const widths: number[] = [];
  for (const cols of rows) {
    if (cols.length < 2) continue;
    cols.forEach((c, j) => {
      widths[j] = Math.max(widths[j] ?? 0, c.length);
    });
  }
  items.forEach((item, r) => {
    const cols = rows[r]!;
    if (cols.length < 2) return;
    item.text = cols.map((c, j) => c.padEnd(widths[j] ?? c.length)).join(" ");
  });
}
