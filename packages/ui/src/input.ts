/**
 * Front-end input: translate browser keyboard events into the command
 * characters NetHack's `nhgetch` expects, and expose an async queue the
 * window-proc callback drains.
 *
 * NetHack has no arrow-key or chord concept (see brief §6). We map single
 * arrows to vi movement keys and chorded arrows to the diagonal vi keys:
 *
 *      y k u        NW  N  NE
 *      h . l   <->   W  .  E
 *      b j n        SW  S  SE
 */

const VI = {
  up: "k",
  down: "j",
  left: "h",
  right: "l",
  upleft: "y",
  upright: "u",
  downleft: "b",
  downright: "n",
} as const;

type ArrowName = "up" | "down" | "left" | "right";

const ARROW_BY_KEY: Record<string, ArrowName> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** An input event: a keystroke, or a map mouse click (for nh_poskey). */
export type NhInput =
  | { kind: "key"; code: number }
  | { kind: "mouse"; x: number; y: number; button: number };

/** An async FIFO of input events that nhgetch / nh_poskey drain. */
export class InputQueue {
  private buffer: NhInput[] = [];
  private waiter: ((ev: NhInput) => void) | null = null;

  push(ev: NhInput): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(ev);
    } else {
      this.buffer.push(ev);
    }
  }

  pushKey(code: number): void {
    this.push({ kind: "key", code });
  }

  /** Resolves with the next event, waiting if the queue is empty. */
  next(): Promise<NhInput> {
    const queued = this.buffer.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  /** Resolves with the next keystroke, skipping (discarding) mouse events. */
  async nextKey(): Promise<number> {
    let ev = await this.next();
    while (ev.kind !== "key") ev = await this.next();
    return ev.code;
  }
}

const held = new Set<ArrowName>();

// Chorded diagonals require two keydowns (e.g. Up then Left) that rarely land
// in the same tick. Committing on the very first one means a quick diagonal
// tap plays as "north" (or worse — an OS auto-repeat "north" or two) followed
// by "northwest", burning turns and inviting free monster hits before the
// player can react. So: wait this long after a *fresh* press (nothing else
// currently held) to see if a perpendicular arrow joins before committing —
// then, since we're now doing our own timing anyway, keep committing at our
// own throttled cadence for as long as a key stays held, instead of at
// whatever rate the OS's key-repeat happens to fire (which is what let a
// too-long hold "move more spaces than intended" in the first place).
// TODO: make these configurable (settings screen).
const CHORD_GRACE_MS = 50;
const REPEAT_DELAY_MS = 220;
const REPEAT_INTERVAL_MS = 130;

let graceTimer: ReturnType<typeof setTimeout> | null = null;
let repeatTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (graceTimer !== null) clearTimeout(graceTimer);
  if (repeatTimer !== null) clearTimeout(repeatTimer);
  graceTimer = repeatTimer = null;
}

/** Wire document-level key handling into the given queue. */
export function attachKeyboard(queue: InputQueue): void {
  const commitMove = () => queue.pushKey(arrowCommand().charCodeAt(0));

  window.addEventListener("keydown", (e) => {
    const arrow = ARROW_BY_KEY[e.key];
    if (arrow) {
      e.preventDefault();
      // Our own repeat cadence replaces the OS's; ignore its auto-repeat
      // keydowns entirely rather than letting them queue extra moves.
      if (e.repeat) return;

      const freshPress = held.size === 0;
      held.add(arrow);

      if (freshPress) {
        clearTimers();
        graceTimer = setTimeout(() => {
          graceTimer = null;
          commitMove();
          repeatTimer = setTimeout(function tick() {
            if (held.size === 0) return; // released during the delay
            commitMove();
            repeatTimer = setTimeout(tick, REPEAT_INTERVAL_MS);
          }, REPEAT_DELAY_MS);
        }, CHORD_GRACE_MS);
      }
      // else: a second (chording) key joined an already-pending or already-
      // repeating press. Nothing to do here — the pending grace timer (or
      // the next repeat tick) reads `held` fresh and picks up the diagonal.
      return;
    }

    // PageUp/PageDown scroll the message log (Qt's global key handling).
    if (e.key === "PageUp" || e.key === "PageDown") {
      const log = document.getElementById("messages");
      if (log) {
        e.preventDefault();
        log.scrollTop += (e.key === "PageUp" ? -0.9 : 0.9) * log.clientHeight;
      }
      return;
    }

    // Special keys the core cares about.
    if (e.key === "Enter") return queue.pushKey(13);
    if (e.key === "Escape") return queue.pushKey(27);
    if (e.key === " ") {
      e.preventDefault();
      return queue.pushKey(32);
    }
    if (e.key === "Backspace") return queue.pushKey(8);

    // Printable single characters pass straight through (letters, digits,
    // punctuation commands like '.', ',', '<', '>', '#', 'i', 'S', etc.).
    if (e.key.length === 1) {
      // Preserve Ctrl-<letter> as a control code (e.g. ^D, ^X wizard cmds).
      if (e.ctrlKey) {
        const c = e.key.toLowerCase().charCodeAt(0);
        if (c >= 97 && c <= 122) {
          e.preventDefault();
          return queue.pushKey(c - 96);
        }
      }
      queue.pushKey(e.key.charCodeAt(0));
    }
  });

  window.addEventListener("keyup", (e) => {
    const arrow = ARROW_BY_KEY[e.key];
    if (!arrow) return;
    held.delete(arrow);
    if (held.size === 0) clearTimers(); // nothing left held; stop the repeat/grace cycle
  });

  // If the window loses focus mid-hold (alt-tab, clicking devtools, ...) we
  // may never see the matching keyup. Don't leave a repeat loop running
  // against a key that isn't physically held anymore.
  window.addEventListener("blur", () => {
    held.clear();
    clearTimers();
  });
}

/** Resolve the currently-held arrow(s) to a vi command (diagonal if two perpendicular ones are held). */
function arrowCommand(): string {
  const vertical = held.has("up") ? "up" : held.has("down") ? "down" : null;
  const horizontal = held.has("left") ? "left" : held.has("right") ? "right" : null;

  if (vertical && horizontal) {
    return VI[`${vertical}${horizontal}` as keyof typeof VI];
  }
  return VI[vertical ?? horizontal ?? "up"];
}
