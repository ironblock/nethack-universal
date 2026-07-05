/**
 * Menu overlay: renders NetHack menus (start_menu / add_menu / end_menu /
 * select_menu) as clickable HTML popups with tile-annotated rows, and resolves
 * a promise with the user's selection.
 *
 * how: PICK_NONE (0) display-only, PICK_ONE (1) single pick, PICK_ANY (2) multi.
 */
import type { TileRenderer } from "./tiles";

export const PICK_NONE = 0;
export const PICK_ONE = 1;
export const PICK_ANY = 2;

/**
 * The menu identifier. The shim marshals the `anything` union as fmt 'i', i.e.
 * its low 32 bits (a_int, or a 32-bit wasm pointer), so a single number round-trips
 * it: on the way back we write [id, 0] into the 8-byte union.
 */
export type Identifier = number;

export interface MenuItem {
  identifier: Identifier;
  accel: number; // accelerator char code; 0 = not selectable (header/text)
  glyph: number; // -1 if none
  text: string;
  selectable: boolean;
  preselected: boolean;
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
    const selected = new Set<MenuItem>(how === PICK_ANY ? items.filter((i) => i.preselected) : []);

    return new Promise<MenuPick[]>((resolve) => {
      const root = document.createElement("div");
      root.className = "menu";

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
      for (const item of items) {
        const row = this.renderRow(item, how);
        rowEls.set(item, row);
        list.appendChild(row);
        if (selected.has(item)) row.classList.add("selected");
        if (item.selectable && how !== PICK_NONE) {
          row.addEventListener("click", () => onPick(item));
        }
      }

      const footer = document.createElement("div");
      footer.className = "menu-footer";
      footer.textContent =
        how === PICK_NONE
          ? "(press any key)"
          : how === PICK_ONE
            ? "click an item, or press its letter · Esc to cancel"
            : "toggle items · Enter to accept · Esc to cancel";
      root.appendChild(footer);

      const finish = (picks: MenuPick[]) => {
        window.removeEventListener("keydown", onKey, true);
        this.overlay.replaceChildren();
        this.overlay.style.display = "none";
        resolve(picks);
      };

      const onPick = (item: MenuItem) => {
        if (how === PICK_ONE) {
          finish([{ identifier: item.identifier, count: -1 }]);
        } else {
          // PICK_ANY: toggle
          if (selected.has(item)) selected.delete(item);
          else selected.add(item);
          rowEls.get(item)?.classList.toggle("selected", selected.has(item));
        }
      };

      const accept = () =>
        finish([...selected].map((i) => ({ identifier: i.identifier, count: -1 })));

      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (how === PICK_NONE) return finish([]);
        if (e.key === "Escape") return finish([]);
        if (how === PICK_ANY && (e.key === "Enter" || e.key === " ")) return accept();

        const code = e.key.length === 1 ? e.key.charCodeAt(0) : 0;
        const item = items.find((i) => i.selectable && i.accel === code);
        if (item) onPick(item);
      };

      window.addEventListener("keydown", onKey, true);
      this.overlay.replaceChildren(root);
      this.overlay.style.display = "flex";
    });
  }

  private renderRow(item: MenuItem, how: number): HTMLElement {
    const row = document.createElement("div");
    row.className = item.selectable ? "menu-row selectable" : "menu-row header";

    if (item.selectable && how !== PICK_NONE) {
      const key = document.createElement("span");
      key.className = "menu-accel";
      key.textContent = String.fromCharCode(item.accel);
      row.appendChild(key);
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
