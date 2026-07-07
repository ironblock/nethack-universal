/**
 * Generate character-creation data for the graphical picker (Qt's qt_plsel.cpp)
 * from the NetHack source:
 *
 *   include/monsters.h  — MON(...) X-macro list; entry order IS the PM_ index
 *                         (permonst.h expands it with MONS_ENUM), and the entry
 *                         count is NUMMONS
 *   src/role.c          — roles[] / races[] tables: names, self-monster PM_,
 *                         and the `allow` bitmasks that drive validity greying
 *        ↓
 *   packages/ui/public/roles.json
 *
 * Portrait glyphs need no runtime C support: display.h's monnum_to_glyph is
 * `mnum + GLYPH_MON_MALE_OFF(=0)` for males and `mnum + GLYPH_MON_FEM_OFF
 * (=NUMMONS)` for females, and glyph2tile.json (gen-tiles.mjs) already maps
 * those glyphs onto the shipped tilesheet.
 *
 * Mask constants (monflag.h / you.h / align.h). ROLE_RACEMASK bits are the
 * MH_* (= M2_*) monster-herd bits; each race's `selfmask` is one of them, and
 * a race is valid for a role iff (role.allow & race.selfmask) != 0.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NH = join(ROOT, "vendor", "nethack");
const OUT = join(ROOT, "packages", "ui", "public", "roles.json");

const MASK = {
  MH_HUMAN: 0x08,
  MH_ELF: 0x10,
  MH_DWARF: 0x20,
  MH_GNOME: 0x40,
  MH_ORC: 0x80,
  ROLE_MALE: 0x1000,
  ROLE_FEMALE: 0x2000,
  ROLE_NEUTER: 0x4000,
  ROLE_LAWFUL: 0x04, // AM_LAWFUL
  ROLE_NEUTRAL: 0x02, // AM_NEUTRAL
  ROLE_CHAOTIC: 0x01, // AM_CHAOTIC
};
const GENDER_BITS = [
  ["male", MASK.ROLE_MALE],
  ["female", MASK.ROLE_FEMALE],
];
const ALIGN_BITS = [
  ["lawful", MASK.ROLE_LAWFUL],
  ["neutral", MASK.ROLE_NEUTRAL],
  ["chaotic", MASK.ROLE_CHAOTIC],
];

function main() {
  const pmIndex = parseMonsterEnum();
  const nummons = Object.keys(pmIndex).length;
  const roleSrc = readFileSync(join(NH, "src", "role.c"), "utf8");

  const roles = tableEntries(roleSrc, "roles[NUM_ROLES+1]").map((fields) => {
    const [maleName, femName] = stringPair(fields[0]);
    const allow = maskValue(fields.find((f) => f.includes("ROLE_")));
    return {
      name: maleName,
      femName, // null unless the role has a distinct female form (Priestess, …)
      mnum: pmField(fields, pmIndex),
      races: MASK_RACES.filter(([, bit]) => allow & bit).map(([code]) => code),
      genders: GENDER_BITS.filter(([, bit]) => allow & bit).map(([g]) => g),
      aligns: ALIGN_BITS.filter(([, bit]) => allow & bit).map(([a]) => a),
    };
  });

  const races = tableEntries(roleSrc, "races[NUM_RACES + 1]").map((fields) => {
    const allowIdx = fields.findIndex((f) => f.includes("ROLE_"));
    const allow = maskValue(fields[allowIdx]);
    const selfmask = maskValue(fields[allowIdx + 1]);
    return {
      noun: stringLit(fields[0]),
      adjective: stringLit(fields[1]),
      code: MASK_RACES.find(([, bit]) => selfmask & bit)?.[0] ?? "?",
      mnum: pmField(fields, pmIndex),
      genders: GENDER_BITS.filter(([, bit]) => allow & bit).map(([g]) => g),
      aligns: ALIGN_BITS.filter(([, bit]) => allow & bit).map(([a]) => a),
    };
  });

  // NUM_ROLES is 13 and NUM_RACES 5 in 5.0 — a silent parse drop (it
  // happened: a stray comment cost the Rogue) must fail the build instead.
  if (roles.length !== 13) throw new Error(`parsed ${roles.length} roles, expected 13`);
  if (races.length !== 5) throw new Error(`parsed ${races.length} races, expected 5`);
  validatePortraits(pmIndex, roles);

  writeFileSync(OUT, JSON.stringify({ nummons, roles, races }, null, 1));
  console.log(`roles.json: ${roles.length} roles, ${races.length} races, NUMMONS=${nummons}`);
}

/**
 * Closed-loop portrait check: win/share/monsters.txt names each tile in
 * mons[] order ("# tile 676 (archeologist,male)"), and glyph2tile.json (from
 * the same tilemap run that laid out the sheet) maps male glyph == mnum to a
 * tile. If mnum is right, glyph2tile[mnum] must equal the tile number
 * monsters.txt gives that monster's male form. This is exactly the check
 * that would have caught the +7 enum drift.
 */
function validatePortraits(pmIndex, roles) {
  const tilesTxt = readFileSync(join(NH, "win", "share", "monsters.txt"), "utf8");
  const tileByName = new Map();
  for (const m of tilesTxt.matchAll(/^# tile (\d+) \(([^),]+),male\)/gm)) {
    tileByName.set(m[2], Number(m[1]));
  }
  const glyph2tile = JSON.parse(
    readFileSync(join(ROOT, "packages", "ui", "public", "tiles", "glyph2tile.json"), "utf8"),
  );
  const nameOf = new Map(Object.entries(pmIndex).map(([bn, idx]) => [idx, bn]));
  for (const role of roles) {
    const bn = nameOf.get(role.mnum);
    const expected = tileByName.get(bn.toLowerCase().replace(/_/g, " "));
    if (expected === undefined) continue; // tile name ≠ bn transform; skip
    if (glyph2tile[role.mnum] !== expected) {
      throw new Error(
        `${role.name}: glyph2tile[${role.mnum}] = ${glyph2tile[role.mnum]}, ` +
          `but monsters.txt says tile ${expected} — monster enum drift?`,
      );
    }
  }
}

const MASK_RACES = [
  ["human", MASK.MH_HUMAN],
  ["elf", MASK.MH_ELF],
  ["dwarf", MASK.MH_DWARF],
  ["gnome", MASK.MH_GNOME],
  ["orc", MASK.MH_ORC],
];

/**
 * MON(...) entries in order → { BASENAME: index }, i.e. the PM_ enum values.
 *
 * MUST go through the preprocessor: monsters.h has "#if 0 DEFERRED" blocks
 * and #ifdef'd entries (CHARON excluded, MAIL_STRUCTURES included — the
 * latter unconditionally set by global.h), and naively counting raw MON(
 * occurrences over-counted by 7 — which shifted every role portrait onto
 * the wrong monster (Caveman wore the Samurai's face). MAIL_STRUCTURES is
 * defined here to mirror global.h since the wrapper doesn't drag config in.
 */
function parseMonsterEnum() {
  const wrapperDir = join(ROOT, "packages", "core-wasm", "artifacts");
  mkdirSync(wrapperDir, { recursive: true });
  const wrapper = join(wrapperDir, "monenum.c");
  writeFileSync(
    wrapper,
    "#define MAIL_STRUCTURES /* global.h defines it unconditionally */\n" +
      "#define MON(nam, sym, lvl, gen, atk, siz, mr1, mr2, flg1, flg2, flg3, d, col, bn) @MON@ bn\n" +
      '#include "monsters.h"\n',
  );
  const out = execFileSync("cc", ["-E", "-I", join(NH, "include"), wrapper], { encoding: "utf8" });
  const map = {};
  let i = 0;
  for (const m of out.matchAll(/@MON@\s+([A-Z0-9_]+)/g)) {
    map[m[1]] = i++;
  }
  if (i < 300) throw new Error(`only ${i} MON entries parsed — format change?`);
  return map;
}

/** Split `const struct X name[len] = { {..}, {..}, ... };` into per-entry depth-1 field lists. */
function tableEntries(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`table ${marker} not found in role.c`);
  const open = src.indexOf("{", start);
  const body = balanced(src, open).slice(1, -1);
  const entries = [];
  for (const entry of splitDepth0(body)) {
    // Strip block comments BEFORE the brace check — a comment between
    // entries (e.g. the one preceding Rogue in role.c) otherwise makes the
    // chunk fail startsWith("{") and silently drops that role.
    const trimmed = entry.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!trimmed.startsWith("{")) continue; // terminator macro
    const fields = splitDepth0(trimmed.slice(1, -1)).map((f) => f.trim());
    if (fields.length > 5) entries.push(fields);
  }
  return entries;
}

/** Text of the balanced (...) or {...} group starting at src[openIdx], braces included. */
function balanced(src, openIdx) {
  const open = src[openIdx];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(openIdx, i + 1);
  }
  throw new Error("unbalanced group");
}

/** Split on commas at brace/paren depth 0, respecting string literals. */
function splitDepth0(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '"' && s[i - 1] !== "\\") inStr = false;
    } else if (c === '"') {
      cur += c;
      inStr = true;
    } else if (c === "{" || c === "(") {
      depth++;
      cur += c;
    } else if (c === "}" || c === ")") {
      depth--;
      cur += c;
    } else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** `{ "Name", 0 }` / `{ "Priest", "Priestess" }` → [name, femName|null]. */
function stringPair(field) {
  const strs = field.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  return [strs[0] ?? "?", strs[1] ?? null];
}

function stringLit(field) {
  return field.match(/"([^"]*)"/)?.[1] ?? "?";
}

/** First field that's a PM_ token → monster index. */
function pmField(fields, pmIndex) {
  const f = fields.find((f) => /^PM_[A-Z0-9_]+$/.test(f.trim()));
  if (!f) throw new Error(`no PM_ field in entry: ${fields[0]}`);
  const idx = pmIndex[f.trim().slice(3)];
  if (idx === undefined) throw new Error(`unknown monster ${f.trim()}`);
  return idx;
}

/** OR together the MH_/ROLE_ tokens of a mask expression (comments stripped). */
function maskValue(field) {
  if (!field) return 0;
  const cleaned = field.replace(/\/\*.*?\*\//gs, "");
  let mask = 0;
  for (const tok of cleaned.match(/[A-Z_]+/g) ?? []) {
    if (tok in MASK) mask |= MASK[tok];
    else if (tok !== "L") throw new Error(`unknown mask token ${tok}`);
  }
  return mask;
}

main();
