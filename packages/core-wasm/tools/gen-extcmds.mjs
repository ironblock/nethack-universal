#!/usr/bin/env node
/**
 * Parses vendor/nethack/src/cmd.c's `extcmdlist[]` array out of a
 * preprocessed (`cc -E`) translation unit and emits
 * packages/ui/public/extcmds.json.
 *
 * Preprocessing (done by gen-extcmds.sh, with the same defines the WASM
 * build uses) has already stripped comments and resolved #ifdefs and the
 * M()/C() key macros, so each entry is a uniform literal:
 *   { <key>, <txt>, <desc>, <func>, <flags>, <last> }
 * We only need txt/desc/flags — the array POSITION is the index
 * `get_ext_cmd` must return to core (core dispatches extcmdlist[n] itself),
 * so entries are kept in original order and never renumbered; entries
 * filtered out client-side (wizard-mode, unavailable, internal) just carry
 * their flags for the UI to filter by, per NHW shim_get_ext_cmd contract.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

const srcPath = process.argv[2];
if (!srcPath) {
  console.error("usage: gen-extcmds.mjs <preprocessed cmd.c path>");
  process.exit(1);
}
const text = readFileSync(srcPath, "utf8");

const startMarker = "struct ext_func_tab extcmdlist[] = {";
const startIdx = text.indexOf(startMarker);
if (startIdx < 0) throw new Error("extcmdlist[] not found in preprocessed source");
const bodyStart = startIdx + startMarker.length;

// Find the matching closing brace for the array, tracking string/char literals
// so braces inside them (none expected here, but be safe) don't confuse depth.
function findMatchingBrace(s, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\") i++;
        i++;
      }
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  throw new Error("unbalanced braces");
}
const bodyEnd = findMatchingBrace(text, startIdx + startMarker.length - 1);
const body = text.slice(bodyStart, bodyEnd);

// Split `body` into top-level `{ ... }` entries.
function splitEntries(s) {
  const entries = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "{") {
      const close = findMatchingBrace(s, i);
      entries.push(s.slice(i + 1, close));
      i = close + 1;
    } else {
      i++;
    }
  }
  return entries;
}

// Split one entry's inner text into its top-level comma-separated fields.
function splitFields(s) {
  const fields = [];
  let depth = 0;
  let cur = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const quote = c;
      let tok = c;
      i++;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\") {
          tok += s[i] + (s[i + 1] ?? "");
          i += 2;
          continue;
        }
        tok += s[i];
        i++;
      }
      tok += s[i];
      i++;
      cur += tok;
      continue;
    }
    if (c === "(" ) depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      fields.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) fields.push(cur.trim());
  return fields;
}

function parseCString(tok) {
  if (!tok.startsWith('"')) return null; // NULL sentinel (char *)0, ((void*)0)
  const inner = tok.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") {
      const n = inner[i + 1];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      i++;
    } else {
      out += inner[i];
    }
  }
  return out;
}

function parseFlags(tok) {
  return tok
    .split("|")
    .map((t) => t.trim())
    .reduce((acc, t) => acc | Number(t), 0);
}

const entries = splitEntries(body);
const cmds = [];
entries.forEach((raw, index) => {
  const fields = splitFields(raw);
  if (fields.length < 5) return;
  const txt = parseCString(fields[1]);
  if (txt === null) return; // terminator entry ({ '\0', (char*)0, ... })
  const desc = parseCString(fields[2]) ?? "";
  const flags = parseFlags(fields[4]);
  cmds.push({ index, txt, desc, flags });
});

if (cmds.length < 50) {
  throw new Error(`only parsed ${cmds.length} extended commands — parser likely broken`);
}

const outDir = join(root, "packages/ui/public");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "extcmds.json");
writeFileSync(outPath, JSON.stringify(cmds));
console.log(`wrote ${cmds.length} extended commands -> ${outPath}`);
