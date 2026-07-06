/**
 * Status HUD. NetHack's field-based status API hands us one field value at a
 * time via status_update(fldidx, ptr, ...); we cache each value and re-render on
 * BL_FLUSH.
 *
 * Note: the shim wires status_enablefield to the *generic* handler (no JS
 * callback), so we can't learn field formats at runtime — we hardcode them from
 * src/botl.c's INIT_BLSTAT table (indexed by BL_* from include/botl.h).
 *
 * Icons (attributes/alignment/hunger/encumbrance/conditions) are ported from
 * the Qt window port's XPMs — see statusicons.ts and gen-status-icons.mjs.
 */
import type { StatusIcons } from "./statusicons";

export const BL_RESET = -2;
export const BL_FLUSH = -1;
export const BL_CONDITION = 22;

// fldidx → printf-style format (as in botl.c initblstats[]).
const FIELD_FMT: Record<number, string> = {
  0: "%s", // title
  1: " St:%s",
  2: " Dx:%s",
  3: " Co:%s",
  4: " In:%s",
  5: " Wi:%s",
  6: " Ch:%s",
  7: " %s", // align
  8: " S:%s", // score
  9: " %s", // carrying-capacity (Burdened, …)
  10: " %s", // gold
  11: " Pw:%s",
  12: "(%s)", // power-max
  13: " Xp:%s",
  14: " AC:%s",
  15: " HD:%s",
  16: " T:%s", // time
  17: " %s", // hunger (Hungry, …)
  18: " HP:%s",
  19: "(%s)", // hp-max
  20: "%s", // dungeon-level (Dlvl:n)
  21: "/%s", // experience points
  22: " %s", // condition
};

// botl.c src/eat.c hu_stat[] order (indices are the raw idx passed to status_update).
const HUNGER_ICON: Record<number, string> = { 0: "satiated", 2: "hungry", 3: "hungry", 4: "hungry", 5: "hungry", 6: "hungry" };
// botl.c enc_stat[] text → Qt's p_encumber[0..4] icon (slt/mod/hvy/ext/ovr_enc).
const ENCUMBER_ICON: Record<string, string> = {
  Burdened: "slt_enc",
  Stressed: "mod_enc",
  Strained: "hvy_enc",
  Overtaxed: "ext_enc",
  Overloaded: "ovr_enc",
};
// Icon per attribute field index.
const ATTR_ICON: Record<number, string> = { 1: "str", 2: "dex", 3: "cns", 4: "int", 5: "wis", 6: "cha" };

// Traditional two-line layout, by BL_* field index.
const LINE1 = [0, 1, 2, 3, 4, 5, 6];
const LINE2 = [20, 10, 18, 19, 11, 12, 14, 13, 21, 15, 16, 8];

// Condition bitmask (BL_MASK_*) → [short display name, icon name or undefined].
const CONDITIONS: Array<[number, string, string?]> = [
  [0x00000002, "Blind", "blind"],
  [0x00000008, "Conf", "confused"],
  [0x00000010, "Deaf", "deaf"],
  [0x00000080, "FoodPois", "sick_fp"],
  [0x00000040, "Fly", "fly"],
  [0x00000400, "Hallu", "hallu"],
  [0x00000800, "Held"],
  [0x00004000, "Lev", "lev"],
  [0x00010000, "Ride", "ride"],
  [0x00020000, "Zzz"],
  [0x00040000, "Slime", "slime"],
  [0x00100000, "Stone", "stone"],
  [0x00200000, "Strngl", "strngl"],
  [0x00400000, "Stun", "stunned"],
  [0x01000000, "TermIll", "sick_il"],
  [0x04000000, "Trapped"],
  [0x08000000, "Unconsc"],
];

const ALIGN_ICON: Record<string, string> = { lawful: "lawful", neutral: "neutral", chaotic: "chaotic" };

// Qt's iflags.wc2_statuslines: 2 ("compact") folds Alignment up next to Cha;
// 3 ("spread", upstream default) shows it with Hunger/Encumbrance/Conditions
// instead. We default to compact (denser, matches what we shipped earlier).
export type StatusLayout = "compact" | "spread";

export class StatusBar {
  private vals = new Map<number, string>();
  private conditionMask = 0;
  private layout: StatusLayout = "compact";

  constructor(
    private el: HTMLElement,
    private icons: StatusIcons,
  ) {}

  update(idx: number, val: string): void {
    // NetHack embeds glyphs in mixed text as "\G%04X%04X" (rndencode + glyph).
    // On the status line this only occurs for gold; render it as "$".
    const clean = val.replace(/\\G[0-9A-Fa-f]{8}/g, idx === 10 ? "$" : "");
    this.vals.set(idx, clean);
  }

  setCondition(mask: number): void {
    this.conditionMask = mask;
  }

  setLayout(layout: StatusLayout): void {
    this.layout = layout;
  }

  render(): void {
    const frag = document.createDocumentFragment();
    frag.appendChild(this.hpBar());
    frag.appendChild(this.line(LINE1, true));
    frag.appendChild(this.line(LINE2, false));
    this.el.replaceChildren(frag);
  }

  // Qt's status window shows a color-coded HP bar above the title
  // (iflags.wc2_hitpointbar); simplified to 4 tiers instead of Qt's 6 since
  // several of theirs (e.g. "black" at 100%) assume a light-background theme.
  private hpBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "hp-bar";
    const hp = Number(this.vals.get(18));
    const hpmax = Number(this.vals.get(19));
    if (Number.isFinite(hp) && Number.isFinite(hpmax) && hpmax > 0) {
      const pct = Math.max(0, Math.min(1, hp / hpmax));
      const fill = document.createElement("div");
      fill.className = "hp-bar-fill";
      fill.style.width = `${pct * 100}%`;
      fill.style.background =
        pct >= 0.5 ? "#3a9e3a" : pct >= 0.25 ? "#c9b93a" : pct >= 0.1 ? "#d67f2a" : "#c93a3a";
      bar.appendChild(fill);
    }
    return bar;
  }

  private line(indices: number[], isLine1: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = "status-line";
    for (const idx of indices) {
      const val = this.vals.get(idx);
      if (!val) continue;
      const icon = ATTR_ICON[idx];
      if (icon) row.appendChild(this.iconChip(icon, (FIELD_FMT[idx] ?? "%s").replace("%s", val)));
      else row.appendChild(this.text((FIELD_FMT[idx] ?? "%s").replace("%s", val)));
    }
    if (isLine1) {
      if (this.layout === "compact") this.appendAlignment(row);
    } else {
      if (this.layout === "spread") this.appendAlignment(row);
      this.appendHungerEncumberConditions(row);
    }
    return row;
  }

  private appendAlignment(row: HTMLElement): void {
    const align = this.vals.get(7);
    if (!align) return;
    const iconName = ALIGN_ICON[align.trim().toLowerCase()];
    row.appendChild(
      iconName ? this.iconChip(iconName, ` ${align}`) : this.text(` ${align}`),
    );
  }

  private appendHungerEncumberConditions(row: HTMLElement): void {
    const hungerIdx = this.hungerStateIndex();
    const hunger = this.vals.get(17)?.trim();
    if (hunger && hungerIdx !== undefined) {
      const icon = HUNGER_ICON[hungerIdx];
      row.appendChild(icon ? this.iconChip(icon, ` ${hunger}`) : this.text(` ${hunger}`));
    }

    const encumber = this.vals.get(9)?.trim();
    if (encumber) {
      const icon = ENCUMBER_ICON[encumber];
      row.appendChild(icon ? this.iconChip(icon, ` ${encumber}`) : this.text(` ${encumber}`));
    }

    for (const [bit, name, icon] of CONDITIONS) {
      if (!(this.conditionMask & bit)) continue;
      row.appendChild(icon ? this.iconChip(icon, ` ${name}`) : this.text(` ${name}`));
    }
  }

  /** hu_stat[]/hutxt[] index for the current hunger text, for icon lookup. */
  private hungerStateIndex(): number | undefined {
    const val = this.vals.get(17)?.trim();
    if (!val) return undefined;
    const order = ["Satiated", "", "Hungry", "Weak", "Fainting", "Fainted", "Starved"];
    const idx = order.indexOf(val);
    return idx >= 0 ? idx : undefined;
  }

  private iconChip(name: string, label: string): HTMLElement {
    const span = document.createElement("span");
    span.className = "status-chip";
    const icon = this.icons.render(name, 16);
    if (icon) span.appendChild(icon);
    span.appendChild(document.createTextNode(label));
    return span;
  }

  private text(s: string): Text {
    return document.createTextNode(s);
  }
}
