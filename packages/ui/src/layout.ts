/**
 * Pane layout: Qt's main window is a vertical splitter (message | paperdoll |
 * status over the map) with user-draggable dividers whose positions persist
 * across sessions (QSettings). Same idea here: two drag handles adjust the
 * top-row height and the inventory-sidebar width via CSS custom properties,
 * saved to localStorage. The sidebar (our perm-invent panel — a feature Qt
 * didn't have docked) can also be hidden entirely.
 */

const STORE_KEY = "nhu.layout";

interface LayoutPrefs {
  toprowHeight?: number;
  sidebarWidth?: number;
  sidebarHidden?: boolean;
}

function loadPrefs(): LayoutPrefs {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as LayoutPrefs;
  } catch {
    return {};
  }
}

function savePrefs(patch: Partial<LayoutPrefs>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* private mode etc. — layout just won't persist */
  }
}

export function wireLayout(): void {
  const root = document.documentElement;
  const prefs = loadPrefs();

  if (prefs.toprowHeight) root.style.setProperty("--toprow-height", `${prefs.toprowHeight}px`);
  if (prefs.sidebarWidth) root.style.setProperty("--sidebar-width", `${prefs.sidebarWidth}px`);
  if (prefs.sidebarHidden) document.body.classList.add("sidebar-collapsed");

  wireDrag(byId("hsplit"), (e) => {
    // Top row spans from under the header down to the pointer.
    const top = byId("toprow").getBoundingClientRect().top;
    const h = clamp(e.clientY - top, 110, window.innerHeight * 0.6);
    root.style.setProperty("--toprow-height", `${h}px`);
    return { toprowHeight: h };
  });

  wireDrag(byId("vsplit"), (e) => {
    const w = clamp(window.innerWidth - e.clientX, 140, 480);
    root.style.setProperty("--sidebar-width", `${w}px`);
    return { sidebarWidth: w };
  });

  byId("sidebar-toggle").addEventListener("click", () => {
    const hidden = document.body.classList.toggle("sidebar-collapsed");
    savePrefs({ sidebarHidden: hidden });
  });
}

function wireDrag(handle: HTMLElement, onMove: (e: PointerEvent) => Partial<LayoutPrefs>): void {
  handle.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    let last: Partial<LayoutPrefs> = {};
    const move = (e: PointerEvent) => {
      last = onMove(e);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      savePrefs(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}
