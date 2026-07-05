/**
 * The NetHack window-proc callback.
 *
 * The WASM shim (`win/shim/winshim.c`) marshals every `window_procs` call to a
 * single JS callback registered via `shim_graphics_set_callback`. It invokes us
 * as `callback(name, ...args)` and expects a Promise whose resolved value is the
 * proc's return value (written back through `setPointerValue`).
 *
 * Phase 1: graphical tiles blitted to a canvas (TileRenderer), a scrolling
 * message log, and keyboard input. Menus, mouse, and the HUD come in Phase 2;
 * unhandled procs are logged so we can see what the core asks for next.
 */
import type { NetHackModule } from "./emscripten";
import { InputQueue } from "./input";
import type { TileRenderer } from "./tiles";

// include/wintype.h
const NHW = { MESSAGE: 1, STATUS: 2, MAP: 3, MENU: 4, TEXT: 5, PERMINVENT: 6 } as const;

// glyph_info layout (include/wintype.h): int glyph @0; int ttychar @4; ...
const GLYPHINFO_GLYPH_OFFSET = 0;

interface Dom {
  messages: HTMLElement;
  status: HTMLElement;
}

export class NetHackUI {
  readonly input = new InputQueue();

  private mod!: NetHackModule;
  private dom!: Dom;
  private renderer!: TileRenderer;

  private windowType = new Map<number, number>();
  private nextWinid = 1;

  private seenProcs = new Set<string>();

  bind(mod: NetHackModule, dom: Dom, renderer: TileRenderer): void {
    this.mod = mod;
    this.dom = dom;
    this.renderer = renderer;
  }

  /** Set true to trace every window-proc call to the console (capped). */
  debug = false;
  private callCount = 0;

  /** Registered on globalThis; the shim calls this for every window proc. */
  callback = async (name: string, ...args: unknown[]): Promise<unknown> => {
    if (this.debug && this.callCount < 200) {
      console.log(`[proc ${this.callCount}]`, name, JSON.stringify(args));
    }
    this.callCount++;

    switch (name) {
      case "shim_create_nhwindow": {
        const type = args[0] as number;
        const id = this.nextWinid++;
        this.windowType.set(id, type);
        return id;
      }
      case "shim_clear_nhwindow": {
        if (this.windowType.get(args[0] as number) === NHW.MAP) this.renderer.clear();
        return;
      }
      case "shim_display_nhwindow":
      case "shim_destroy_nhwindow":
        if (name === "shim_destroy_nhwindow") this.windowType.delete(args[0] as number);
        return;

      case "shim_print_glyph": {
        const x = args[1] as number;
        const y = args[2] as number;
        const glyphinfo = args[3] as number;
        const bkglyphinfo = args[4] as number;
        // Draw the background glyph (e.g. floor) first, then the foreground.
        if (bkglyphinfo) {
          this.renderer.drawGlyph(x, y, this.mod.getValue(bkglyphinfo + GLYPHINFO_GLYPH_OFFSET, "i32"));
        }
        if (glyphinfo) {
          this.renderer.drawGlyph(x, y, this.mod.getValue(glyphinfo + GLYPHINFO_GLYPH_OFFSET, "i32"));
        }
        return;
      }

      case "shim_putstr": {
        const str = args[2] as string;
        if (str) this.log(str);
        return;
      }
      case "shim_raw_print":
      case "shim_raw_print_bold": {
        const str = args[0] as string;
        if (str) this.log(str);
        return;
      }
      case "shim_putmsghistory": {
        const str = args[0] as string;
        if (str) this.log(str);
        return;
      }

      case "shim_nhgetch":
        return this.input.next();

      case "shim_nh_poskey": {
        // Keyboard only for now (no mouse). Zero out the position/modifier outs.
        const [xPtr, yPtr, modPtr] = args as [number, number, number];
        if (xPtr) this.mod.setValue(xPtr, 0, "i16");
        if (yPtr) this.mod.setValue(yPtr, 0, "i16");
        if (modPtr) this.mod.setValue(modPtr, 0, "i32");
        return this.input.next();
      }

      case "shim_yn_function": {
        const query = args[0] as string;
        const resp = args[1] as string;
        const def = args[2] as number;
        this.log(`${query} ${resp ? `[${resp}]` : ""}`);
        // Auto-answer the default (or 'y') for now so startup prompts don't stall.
        const answer = def && def > 0 ? def : "y".charCodeAt(0);
        return answer;
      }

      case "shim_getlin": {
        // query (string), bufp (pointer we must fill). Empty line for now.
        const bufp = args[1] as number;
        if (bufp) this.mod.stringToUTF8("", bufp, 256);
        return;
      }

      case "shim_player_selection_or_tty":
        return true; // let the generic setup honor our pre-selected character

      case "shim_select_menu": {
        const menuListPtr = args[2] as number;
        if (menuListPtr) this.mod.setValue(menuListPtr, 0, "i32");
        return 0; // nothing selected
      }
      case "shim_message_menu":
        return args[0] as number; // return the offered letter unchanged

      case "shim_getmsghistory":
      case "shim_get_color_string":
        return "";
      case "shim_doprev_message":
      case "shim_get_ext_cmd":
        return -1;
      case "set_shim_font_name":
        return 0;

      case "shim_curs": {
        // Cursor placement on the map window ≈ the hero's cell; follow it.
        if (this.windowType.get(args[0] as number) === NHW.MAP) {
          this.renderer.centerOn(args[1] as number, args[2] as number);
        }
        return;
      }
      case "shim_cliparound":
        this.renderer.centerOn(args[0] as number, args[1] as number);
        return;

      // Known-but-ignored for now.
      case "shim_init_nhwindows":
      case "shim_askname":
      case "shim_get_nh_event":
      case "shim_exit_nhwindows":
      case "shim_suspend_nhwindows":
      case "shim_resume_nhwindows":
      case "shim_display_file":
      case "shim_start_menu":
      case "shim_add_menu":
      case "shim_end_menu":
      case "shim_mark_synch":
      case "shim_wait_synch":
      case "shim_update_positionbar":
      case "shim_nhbell":
      case "shim_number_pad":
      case "shim_delay_output":
      case "shim_change_color":
      case "shim_change_background":
      case "shim_preference_update":
      case "shim_status_init":
      case "shim_status_enablefield":
      case "shim_status_update":
      case "shim_update_inventory":
        return;

      default:
        if (!this.seenProcs.has(name)) {
          this.seenProcs.add(name);
          console.warn("[nethack] unhandled proc:", name, args);
        }
        return;
    }
  };

  private log(line: string): void {
    const el = document.createElement("div");
    el.textContent = line;
    this.dom.messages.appendChild(el);
    this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
  }
}
