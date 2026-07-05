/**
 * Phase-0 bootstrap: load the WASM core, register the window-proc callback
 * before `main` auto-runs, and point NetHack at the embedded data.
 *
 * Ordering matters. `main()` (in sys/libnh/libnhmain.c) auto-runs during module
 * init and immediately starts calling window procs. `js_helpers_init()` (which
 * installs the pointer helpers the shim needs) also runs inside `main`. So we
 * register our callback in `onRuntimeInitialized`, which emscripten fires just
 * before `callMain`, guaranteeing the shim sees a callback from the first proc.
 */
import type { NetHackFactory, NetHackModule } from "./emscripten";
import { NetHackUI } from "./nethack";
import { attachKeyboard } from "./input";
import { TileRenderer } from "./tiles";
import { MenuController } from "./menu";
import { PromptController } from "./prompt";

const CALLBACK_NAME = "nethackCallback";

async function boot(): Promise<void> {
  const dom = {
    messages: byId("messages"),
    status: byId("status"),
  };

  const renderer = new TileRenderer();
  await renderer.load();
  renderer.attach(byId("map") as HTMLCanvasElement);

  const menuCtl = new MenuController(byId("overlay"), renderer);
  const promptCtl = new PromptController(byId("overlay"));

  const ui = new NetHackUI();
  // The shim looks up the callback by name on globalThis.
  (globalThis as Record<string, unknown>)[CALLBACK_NAME] = ui.callback;
  (globalThis as Record<string, unknown>).__nh = { ui, renderer, menuCtl, promptCtl }; // debug handle
  attachKeyboard(ui.input);
  // Click a map cell to travel there (left) or look (right).
  renderer.onCellClick((x, y, button) => ui.input.push({ kind: "mouse", x, y, button }));

  // Emscripten ES6 module: default export is the factory. It lives in /public
  // and is served as-is; hide the specifier from Vite's import-analysis so the
  // browser does a native runtime import instead of a build-time transform.
  const nativeImport = new Function("u", "return import(u)") as (u: string) => Promise<{
    default: NetHackFactory;
  }>;
  const { default: factory } = await nativeImport("/core/nethack.js");

  const mod: Partial<NetHackModule> = {
    // Don't auto-run main(); we start it ourselves after the callback is wired,
    // so the shim never sees a null callback (which would spin nhgetch and peg
    // the main thread instead of suspending via Asyncify).
    noInitialRun: true,
    locateFile: (path) => `/core/${path}`,
    print: (s) => console.log("[nh stdout]", s),
    printErr: (s) => console.log("[nh stderr]", s),
    preRun: [
      () => {
        const m = mod as NetHackModule;
        m.ENV.NETHACKDIR = "/"; // embedded data (nhdat, sysconf) is at FS root
        m.ENV.HACKDIR = "/";
        m.ENV.USER = "Adventurer";
        // Fully specify the character AND disable the 5.0 tutorial prompt — it's
        // a forced PICK_ONE menu that would loop until we implement real menu
        // selection (Phase 2). !legacy skips the intro poem's --More--.
        // Real character selection now works via the menu system (Phase 2), so
        // we no longer pre-specify role/race/gender/align. !tutorial keeps the
        // tutorial prompt off; time/showexp drive the status line.
        m.ENV.NETHACKOPTIONS = "!tutorial,!legacy,time,showexp";
      },
    ],
  };

  const m = await factory(mod);
  ui.bind(m, dom, renderer, menuCtl, promptCtl);
  m.ccall("shim_graphics_set_callback", null, ["string"], [CALLBACK_NAME]);
  console.log("[nethack] callback registered; starting main()");

  // Asyncify: callMain returns as soon as the core suspends for input.
  try {
    m.callMain(["-u", "Adventurer"]);
  } catch (e) {
    if (!isExitStatus(e)) throw e;
  }
}

function isExitStatus(e: unknown): boolean {
  return typeof e === "object" && e !== null && "status" in e;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById("messages");
  if (el) el.textContent = `boot error: ${err?.message ?? err}`;
});
