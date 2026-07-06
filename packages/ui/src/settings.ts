/**
 * Settings dialog (qt_set.cpp's NetHackQtSettings), with QSettings-style
 * write-through persistence to localStorage: every control applies live AND
 * saves immediately, and boot re-applies the stored values before first
 * render.
 *
 * Two options — hilite_pet / hilite_pile — are core options, not UI state:
 * they're written into the generated ~/.nethackrc at boot (see main.ts), so
 * toggling them takes effect on the next reload (the dialog says so).
 */
import type { TileRenderer } from "./tiles";
import { MIN_RENDER_SIZE, MAX_RENDER_SIZE } from "./tiles";
import type { StatusLayout } from "./status";

const STORE_KEY = "nhu.settings";
const TILE_SIZE_STEP = 8;

// Qt's Settings dialog offers Tiny/Small/Medium/Large/Huge for text.
const FONT_SIZES: Array<[label: string, px: number]> = [
  ["Tiny", 10],
  ["Small", 12],
  ["Medium", 14],
  ["Large", 16],
  ["Huge", 20],
];

export interface Settings {
  tileSize: number;
  fontIdx: number; // index into FONT_SIZES
  statusLayout: StatusLayout;
  paperdollShown: boolean;
  hilitePet: boolean;
  hilitePile: boolean;
}

const DEFAULTS: Settings = {
  tileSize: 32,
  fontIdx: 2, // Medium
  statusLayout: "spread",
  paperdollShown: true,
  hilitePet: true,
  hilitePile: true,
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode — settings just won't persist */
  }
}

export interface SettingsHost {
  renderer: TileRenderer;
  setStatusLayout(layout: StatusLayout): void;
}

/** Apply persisted settings at boot (before the first frame renders). */
export function applySettings(s: Settings, host: SettingsHost): void {
  host.renderer.setSize(s.tileSize);
  document.documentElement.style.setProperty("--hud-font-size", `${FONT_SIZES[s.fontIdx]?.[1] ?? 14}px`);
  host.setStatusLayout(s.statusLayout);
  document.body.classList.toggle("paperdoll-hidden", !s.paperdollShown);
}

/** Wire the gear button to the settings modal. */
export function wireSettingsDialog(button: HTMLElement, overlay: HTMLElement, host: SettingsHost): void {
  button.addEventListener("click", () => {
    const s = loadSettings();

    const root = document.createElement("div");
    root.className = "menu settings";
    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = "Settings";
    root.appendChild(title);

    const body = document.createElement("div");
    body.className = "settings-body";
    root.appendChild(body);

    const apply = () => {
      save(s);
      applySettings(s, host);
    };

    // --- tile size (Qt: tile width/height spinners; square here) ---
    body.appendChild(
      stepperRow("Tile size", () => `${s.tileSize}px`, (dir) => {
        s.tileSize = Math.max(
          MIN_RENDER_SIZE,
          Math.min(MAX_RENDER_SIZE, s.tileSize + dir * TILE_SIZE_STEP),
        );
        apply();
      }),
    );

    // --- text size (Qt's font-size combo) ---
    body.appendChild(
      stepperRow("Text size", () => FONT_SIZES[s.fontIdx]?.[0] ?? "Medium", (dir) => {
        s.fontIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, s.fontIdx + dir));
        apply();
      }),
    );

    // --- status layout (statuslines analog) ---
    body.appendChild(
      toggleRow("Status panel", () => (s.statusLayout === "spread" ? "Icon grid" : "Dense text"), () => {
        s.statusLayout = s.statusLayout === "spread" ? "compact" : "spread";
        apply();
      }),
    );

    // --- paperdoll (Qt: doll Shown checkbox) ---
    body.appendChild(
      checkboxRow("Show equipment doll", s.paperdollShown, (on) => {
        s.paperdollShown = on;
        apply();
      }),
    );

    // --- core options (take effect on reload via the generated .nethackrc) ---
    body.appendChild(
      checkboxRow("Mark pets (heart badge) — applies on reload", s.hilitePet, (on) => {
        s.hilitePet = on;
        apply();
      }),
    );
    body.appendChild(
      checkboxRow("Mark item piles (plus badge) — applies on reload", s.hilitePile, (on) => {
        s.hilitePile = on;
        apply();
      }),
    );

    const footer = document.createElement("div");
    footer.className = "menu-footer settings-footer";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Done";
    footer.appendChild(close);
    root.appendChild(footer);

    const dismiss = () => {
      window.removeEventListener("keydown", onKey, true);
      overlay.replaceChildren();
      overlay.style.display = "none";
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        dismiss();
      }
    };
    close.addEventListener("click", dismiss);
    window.addEventListener("keydown", onKey, true);
    overlay.replaceChildren(root);
    overlay.style.display = "flex";
  });
}

/** RC-file OPTIONS lines for the persisted core options (see main.ts). */
export function settingsRcLines(s: Settings): string {
  return (
    `OPTIONS=${s.hilitePet ? "" : "!"}hilite_pet\n` +
    `OPTIONS=${s.hilitePile ? "" : "!"}hilite_pile\n`
  );
}

function stepperRow(label: string, value: () => string, onStep: (dir: 1 | -1) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";
  const name = document.createElement("span");
  name.textContent = label;
  const ctl = document.createElement("span");
  ctl.className = "ctl";
  const dec = document.createElement("button");
  dec.type = "button";
  dec.textContent = "−";
  const val = document.createElement("span");
  val.className = "settings-value";
  val.textContent = value();
  const inc = document.createElement("button");
  inc.type = "button";
  inc.textContent = "+";
  dec.addEventListener("click", () => {
    onStep(-1);
    val.textContent = value();
  });
  inc.addEventListener("click", () => {
    onStep(1);
    val.textContent = value();
  });
  ctl.append(dec, val, inc);
  row.append(name, ctl);
  return row;
}

function toggleRow(label: string, value: () => string, onToggle: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";
  const name = document.createElement("span");
  name.textContent = label;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = value();
  btn.addEventListener("click", () => {
    onToggle();
    btn.textContent = value();
  });
  row.append(name, btn);
  return row;
}

function checkboxRow(label: string, initial: boolean, onChange: (on: boolean) => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "settings-row";
  const name = document.createElement("span");
  name.textContent = label;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = initial;
  box.addEventListener("change", () => onChange(box.checked));
  row.append(name, box);
  return row;
}
