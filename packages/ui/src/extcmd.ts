/**
 * Extended-command ('#') entry, resolving `get_ext_cmd`'s index into
 * vendor/nethack/src/cmd.c's `extcmdlist[]` (core dispatches that index
 * itself — we never call the command, just pick which one).
 *
 * The list is generated at build time (packages/core-wasm/gen-extcmds.sh)
 * by preprocessing cmd.c with the same defines the WASM build uses, so
 * flags like CMD_NOT_AVAILABLE already reflect our environment.
 *
 * Selection behavior mirrors the Qt port's typed-prefix autocomplete
 * (win/Qt/qt_xcmd.cpp): each keystroke narrows the candidate list; as soon
 * as only one candidate matches the typed prefix it's chosen immediately;
 * if the typed text is itself one full command name that's also a prefix
 * of another (e.g. "drop" vs "droptype"), Enter/Space confirms the shorter
 * one. We additionally render the live candidate list as a clickable
 * command palette (Qt uses a static button grid instead).
 */
import { BASE_URL } from "./base";

// func_tab.h
const WIZMODECMD = 0x0004;
const CMD_NOT_AVAILABLE = 0x0010;
const INTERNALCMD = 0x0040;

// Present in extcmdlist but meaningless (or unsafe to block on) in a
// browser sandbox: no real subprocess/signal semantics to back them.
const BROWSER_UNAVAILABLE = new Set(["shell", "suspend", "bugreport"]);

export interface ExtCmd {
  index: number;
  txt: string;
  desc: string;
  flags: number;
}

export class ExtCmdController {
  private cmds: ExtCmd[] = [];

  constructor(private overlay: HTMLElement) {}

  async load(): Promise<void> {
    const res = await fetch(`${BASE_URL}extcmds.json`);
    const all: ExtCmd[] = await res.json();
    this.cmds = all.filter(
      (c) =>
        c.txt !== "#" &&
        !BROWSER_UNAVAILABLE.has(c.txt) &&
        (c.flags & (CMD_NOT_AVAILABLE | INTERNALCMD | WIZMODECMD)) === 0,
    );
  }

  choose(): Promise<number> {
    const overlay = this.overlay;
    return new Promise((resolve) => {
      let typed = "";
      let pendingExact: ExtCmd | null = null;

      const root = document.createElement("div");
      root.className = "menu extcmd";
      const title = document.createElement("div");
      title.className = "menu-title";
      root.appendChild(title);
      const list = document.createElement("div");
      list.className = "menu-list";
      root.appendChild(list);
      const footer = document.createElement("div");
      footer.className = "menu-footer";
      footer.textContent = "type to filter · Enter/click to choose · Esc to cancel";
      root.appendChild(footer);

      const finish = (index: number) => {
        window.removeEventListener("keydown", onKey, true);
        overlay.replaceChildren();
        overlay.style.display = "none";
        resolve(index);
      };

      const render = () => {
        title.textContent = `#${typed}`;
        const candidates = this.cmds.filter((c) => c.txt.startsWith(typed));
        pendingExact = candidates.find((c) => c.txt === typed) ?? null;
        list.replaceChildren();
        for (const c of candidates) {
          const row = document.createElement("div");
          row.className = "menu-row selectable";
          if (c === pendingExact) row.classList.add("selected");
          const name = document.createElement("span");
          name.className = "menu-accel";
          name.textContent = c.txt;
          const desc = document.createElement("span");
          desc.className = "menu-text";
          desc.textContent = c.desc;
          row.append(name, desc);
          row.addEventListener("click", () => finish(c.index));
          list.appendChild(row);
        }
      };

      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          if (typed === "") return finish(-1);
          typed = "";
          return render();
        }
        if (e.key === "Backspace") {
          typed = typed.slice(0, -1);
          return render();
        }
        if (e.key === "Enter" || e.key === " ") {
          return finish(pendingExact ? pendingExact.index : -1);
        }
        if (e.key.length !== 1 || !/[a-zA-Z?]/.test(e.key)) return;

        const candidate = typed + e.key.toLowerCase();
        let matches = this.cmds.filter((c) => c.txt.startsWith(candidate));
        // "rest" is a friendlier synonym for "wait" (matches Qt).
        if (matches.length === 0 && "rest".startsWith(candidate)) {
          const wait = this.cmds.find((c) => c.txt === "wait");
          if (wait) matches = [wait];
        }
        if (matches.length === 0) return; // typed char doesn't extend any match; ignore
        if (matches.length === 1) return finish(matches[0]!.index);
        typed = candidate;
        render();
      };

      window.addEventListener("keydown", onKey, true);
      overlay.replaceChildren(root);
      overlay.style.display = "flex";
      render();
    });
  }
}
