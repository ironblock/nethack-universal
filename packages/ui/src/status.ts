/**
 * Status HUD. NetHack's field-based status API hands us one field value at a
 * time via status_update(fldidx, ptr, ...); we cache each value and re-render on
 * BL_FLUSH.
 *
 * Note: the shim wires status_enablefield to the *generic* handler (no JS
 * callback), so we can't learn field formats at runtime — we hardcode them from
 * src/botl.c's INIT_BLSTAT table (indexed by BL_* from include/botl.h).
 */

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

// Traditional two-line layout, by BL_* field index.
const LINE1 = [0, 1, 2, 3, 4, 5, 6, 7];
const LINE2 = [20, 10, 18, 19, 11, 12, 14, 13, 21, 15, 16, 17, 9, 8, 22];

// Condition bitmask (BL_MASK_*) → short display name.
const CONDITIONS: Array<[number, string]> = [
  [0x00000002, "Blind"],
  [0x00000008, "Conf"],
  [0x00000010, "Deaf"],
  [0x00000080, "FoodPois"],
  [0x00000040, "Fly"],
  [0x00000400, "Hallu"],
  [0x00000800, "Held"],
  [0x00004000, "Lev"],
  [0x00010000, "Ride"],
  [0x00020000, "Zzz"],
  [0x00040000, "Slime"],
  [0x00100000, "Stone"],
  [0x00200000, "Strngl"],
  [0x00400000, "Stun"],
  [0x01000000, "TermIll"],
  [0x04000000, "Trapped"],
  [0x08000000, "Unconsc"],
];

export class StatusBar {
  private vals = new Map<number, string>();

  constructor(private el: HTMLElement) {}

  update(idx: number, val: string): void {
    // NetHack embeds glyphs in mixed text as "\G%04X%04X" (rndencode + glyph).
    // On the status line this only occurs for gold; render it as "$".
    const clean = val.replace(/\\G[0-9A-Fa-f]{8}/g, idx === 10 ? "$" : "");
    this.vals.set(idx, clean);
  }

  setCondition(mask: number): void {
    const names = CONDITIONS.filter(([bit]) => mask & bit).map(([, n]) => n);
    if (names.length) this.vals.set(BL_CONDITION, names.join(" "));
    else this.vals.delete(BL_CONDITION);
  }

  render(): void {
    const l1 = this.line(LINE1);
    const l2 = this.line(LINE2);
    this.el.textContent = `${l1}\n${l2}`;
  }

  private line(indices: number[]): string {
    let out = "";
    for (const idx of indices) {
      const val = this.vals.get(idx);
      if (val) out += (FIELD_FMT[idx] ?? "%s").replace("%s", val);
    }
    return out.trim();
  }
}
