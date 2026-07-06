# @nethack-universal/core-wasm

The NetHack 5.0.0 game core, compiled to WebAssembly, plus the thin loader the
TypeScript UI talks to.

## What this is

NetHack 5.0.0 ships an in-tree WASM cross-compile (see
`vendor/nethack/Cross-compiling` §B6) built on two upstream pieces:

- **`win/shim`** — a pseudo window port (`window_procs`) that, instead of drawing
  a TTY, marshals every windowing call out to a single JS callback:
  `globalThis[cbName](name, ...args)`. This is the neth4ck pattern, upstreamed.
- **`sys/libnh`** — builds NetHack as a library (`nethack.js` / `nethack.wasm`)
  rather than an executable.

We deliberately **do not** fork or reimplement the window port. All of our
differentiation lives one layer up, in `packages/ui` (canvas tile renderer,
clickable menus, mouse map interaction, chorded diagonals, HUD, prompts).

## The JS interface

After the module loads:

```js
Module.ccall("shim_graphics_set_callback", null, ["string"], ["myCb"], { async: true });
globalThis.myCb = function (name, ...args) {
  // name  = a window_procs function, e.g. "print_glyph", "nhgetch", "yn_function"
  // args  = its arguments
  // return the value the core expects (blocking input is handled via Asyncify)
};
```

Blocking input (`nhgetch`, `nh_poskey`, `yn_function`, `getlin`) works because the
build is linked with **Asyncify**: the WASM stack suspends while JS awaits input,
then resumes. (JSPI is a possible later optimization; Asyncify is what upstream
uses and is correct for a turn-based game.)

## Building

Requires the emscripten SDK activated in your shell (`source ~/emsdk/emsdk_env.sh`).

`vendor/nethack` is a git submodule pinned to the `NetHack-5.0.0_Released` tag and
kept **pristine**; our source changes live in `patches/nethack-5.0.0-web.patch` and
are applied on top by the prep script.

One-time prep (from the repo root) — idempotent:
```
bash scripts/setup-core.sh   # submodule init + apply patch + setup.sh + fetch-lua
```

Then build (re-run any time):
```
npm run build:core
```

Artifacts land in `artifacts/` (gitignored): `nethack.js`, `nethack.wasm`. The
build also stages a copy into `packages/ui/public/core/` for Vite. Note the build
uses `NO_NHUUID=1` (see delta #2 below).

## Local deltas from upstream (patches/nethack-5.0.0-web.patch)

Four changes are needed because emscripten's clang is newer/stricter than the
DevTeam's toolchain and the libnh port had latent gaps:

1. **`-Werror` → `-Wno-error`** for the WASM `EMCC_CFLAGS` — newer clang flags
   benign warnings (e.g. `-Wunused-but-set-variable`) that would abort the build.
   Warnings still print. (`cross-pre2.500`)
2. **`NO_NHUUID=1`** at build time — `hints/macOS.500` unconditionally pulls in
   `macuuid.o` (Objective-C / CoreFoundation), which can't cross-compile to WASM.
   This is a make flag in `build.sh`, not part of the patch.
3. **`callMain` added to `EXPORTED_RUNTIME_METHODS`** — the UI disables auto-run
   and starts `main()` itself *after* registering the shim callback, so `nhgetch`
   suspends via Asyncify instead of spinning. (`cross-pre2.500`)
4. **`libnhmain.c`**: removed a duplicate `after_opt_showpaths` (already in the
   shared `earlyarg.c`) that newer wasm-ld rejects, and added the missing
   `get_nhuuid`/`free_nhuuid` stubs the core calls unconditionally (the libnh main
   never defined them, so the game trapped at startup).
5. **`-DCHDIR` / `-DVAR_PLAYGROUND` / `-DHACKDIR="/"`** (twice, later wins) —
   redirect save/level/bones/lock/record to an IDBFS-mounted directory for
   browser persistence. See `packages/ui/src/persistence.ts`.

## Generated assets (not hand-maintained, not part of the patch)

Two browser assets are derived from `vendor/nethack/src/*.c` at prep time and
regenerated whenever the submodule/patch changes — neither requires touching
core source:

- **Tiles** (`packages/core-wasm/gen-tiles.sh`): builds the host `tilemap`/
  `tile2bmp` tools from `src/tile.c`, renders `nhtiles.bmp`, and converts to
  `packages/ui/public/tiles/{tiles.png,glyph2tile.json,meta.json}`.
- **Extended commands** (`packages/core-wasm/gen-extcmds.sh`): preprocesses
  `src/cmd.c` with the exact defines the WASM build uses (so `CMD_NOT_AVAILABLE`
  reflects our environment, e.g. no real `SUSPEND`/`SHELL`) and parses the
  macro-expanded `extcmdlist[]` literal into `packages/ui/public/extcmds.json`.
  The UI's `#`-command palette (`packages/ui/src/extcmd.ts`) filters and
  displays this list; `get_ext_cmd`'s return value is the raw array index,
  which core dispatches itself — the JS side never needs to know what a
  command *does*, only its name/description/flags.

Both scripts are run by `scripts/setup-core.sh`; re-run them manually after
pulling a submodule update if you skip the full prep script.
