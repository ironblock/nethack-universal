/**
 * Paper-doll equipment view (qt_inv.cpp's NetHackQtPaperDollWindow): a 3x6
 * grid showing worn/wielded items as tiles in roughly the positions Qt uses.
 *
 * The core has no dedicated "equipment" API — Qt's own version just inspects
 * object flags it has direct C access to. We only see the same perm_invent
 * item list everyone else does (identifier/glyph/text), so slots are
 * classified from the "(being worn)"/"(wielded)"/etc. suffixes doname()
 * appends in objnam.c, plus item-name keyword matching for which armor
 * sub-slot a "(being worn)" piece occupies (the suffix itself doesn't say).
 * Heuristic, not exact — good enough for a cosmetic view.
 */
import type { MenuItem } from "./menu";
import type { TileRenderer } from "./tiles";

type SlotKey =
  | "quiver"
  | "weapon"
  | "altweapon"
  | "ringr"
  | "light"
  | "helmet"
  | "amulet"
  | "cloak"
  | "suit"
  | "shirt"
  | "boots"
  | "blindfold"
  | "shield"
  | "gloves"
  | "ringl"
  | "leash";

// Qt's qt_inv.cpp 3x6 grid: left column is the hero's right side, right
// column is the hero's left side (mirrored, as if facing the doll).
const LAYOUT: Array<{ slot: SlotKey | null; label: string }[]> = [
  [
    { slot: "quiver", label: "Quiver" },
    { slot: "helmet", label: "Helmet" },
    { slot: "blindfold", label: "Eyes" },
  ],
  [
    { slot: "weapon", label: "Weapon" },
    { slot: "amulet", label: "Amulet" },
    { slot: "shield", label: "Shield" },
  ],
  [
    { slot: "altweapon", label: "Alt.weap" },
    { slot: "cloak", label: "Cloak" },
    { slot: "gloves", label: "Gloves" },
  ],
  [
    { slot: "ringr", label: "R.ring" },
    { slot: "suit", label: "Suit" },
    { slot: "ringl", label: "L.ring" },
  ],
  [
    { slot: "light", label: "Light" },
    { slot: "shirt", label: "Shirt" },
    { slot: "leash", label: "Leash" },
  ],
  [
    { slot: null, label: "" },
    { slot: "boots", label: "Boots" },
    { slot: null, label: "" },
  ],
];

const ARMOR_KEYWORDS: Array<[RegExp, SlotKey]> = [
  [/blindfold|towel|lenses/i, "blindfold"], // eyewear, before the suit fallback
  [/shield/i, "shield"],
  [/gloves|gauntlets|mitten/i, "gloves"],
  [/\bhelm\b|helmet|\bcap\b|crown|mask/i, "helmet"],
  [/cloak|robe|mummy wrapping|leather jacket|apron/i, "cloak"],
  [/shirt/i, "shirt"],
  [/boots|shoes/i, "boots"],
];

function classify(text: string): SlotKey | null {
  const t = text.toLowerCase();
  if (t.includes("weapon in") || t === "(wielded)" || t.includes(" (wielded)")) return "weapon";
  if (t.includes("alternate weapon")) return "altweapon";
  if (t.includes("wielded in")) return "altweapon"; // two-weapon secondary (ambiguous with primary, rare case)
  if (t.includes("tethered to")) return "weapon";
  if (t.includes("in quiver") || t.includes("at the ready")) return "quiver";
  if (t.includes("on right hand")) return "ringr";
  if (t.includes("on left hand")) return "ringl";
  if (t.includes("attached to")) return "leash";
  if (t.includes("(lit)")) return "light";
  if (t.includes("being worn") || t.includes("embedded in your skin")) {
    for (const [re, slot] of ARMOR_KEYWORDS) if (re.test(text)) return slot;
    if (t.includes("amulet")) return "amulet"; // fallback if name-keyword match above missed it
    return "suit"; // generic body armor with no more specific keyword match
  }
  return null;
}

/** doname() spells out known BUC state; tint the slot border like Qt does. */
function bucClass(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("blessed")) return "buc-blessed";
  if (t.includes("cursed") && !t.includes("uncursed")) return "buc-cursed";
  if (t.includes("uncursed")) return "buc-uncursed";
  return null;
}

/** "(weapon in hands)" = two-handed grip: the weapon occupies the shield slot too. */
function isTwoHanded(text: string): boolean {
  return /\(weapon in hands\)/i.test(text);
}

export class PaperdollPanel {
  /** Optional: invoked when the doll is clicked (main.ts wires #seeall, like Qt). */
  onClick: (() => void) | null = null;

  constructor(
    private container: HTMLElement,
    private renderer: TileRenderer,
  ) {
    container.addEventListener("click", () => this.onClick?.());
  }

  render(items: MenuItem[]): void {
    const bySlot = new Map<SlotKey, MenuItem>();
    for (const item of items) {
      if (!item.selectable) continue; // category header
      const slot = classify(item.text);
      // Amulet class items reach classify() via "being worn" already; guard
      // against an alt-weapon/weapon collision by first match wins per slot.
      if (slot && !bySlot.has(slot)) bySlot.set(slot, item);
      // A two-handed weapon fills both hands — mirror it into the shield
      // slot (qt_inv.cpp shows the same object twice).
      if (slot === "weapon" && isTwoHanded(item.text) && !bySlot.has("shield")) {
        bySlot.set("shield", item);
      }
    }

    const frag = document.createDocumentFragment();
    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = "Equipment";
    frag.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "paperdoll-grid";
    for (const row of LAYOUT) {
      for (const cell of row) {
        const div = document.createElement("div");
        div.className = "paperdoll-cell";
        if (!cell.slot) {
          div.classList.add("empty");
          grid.appendChild(div);
          continue;
        }
        const item = bySlot.get(cell.slot);
        if (item) {
          div.classList.add("filled");
          const buc = bucClass(item.text);
          if (buc) div.classList.add(buc);
          div.title = item.text;
          const canvas = document.createElement("canvas");
          canvas.width = 28;
          canvas.height = 28;
          canvas.className = "menu-tile";
          const ctx = canvas.getContext("2d");
          if (ctx && item.glyph >= 0) this.renderer.blit(ctx, item.glyph, 0, 0, 28);
          div.appendChild(canvas);
        }
        const label = document.createElement("span");
        label.className = "paperdoll-label";
        label.textContent = cell.label;
        div.appendChild(label);
        grid.appendChild(div);
      }
    }
    frag.appendChild(grid);
    this.container.replaceChildren(frag);
  }
}
