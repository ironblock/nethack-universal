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

/** Wire document-level key handling into the given queue. */
export function attachKeyboard(queue: InputQueue): void {
  window.addEventListener("keydown", (e) => {
    const arrow = ARROW_BY_KEY[e.key];
    if (arrow) {
      e.preventDefault();
      held.add(arrow);
      queue.pushKey(arrowCommand(arrow).charCodeAt(0));
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
    if (arrow) held.delete(arrow);
  });
}

/** Resolve an arrow press to a vi command, folding in any held perpendicular arrow. */
function arrowCommand(arrow: ArrowName): string {
  const vertical = held.has("up") ? "up" : held.has("down") ? "down" : null;
  const horizontal = held.has("left") ? "left" : held.has("right") ? "right" : null;

  if (vertical && horizontal) {
    return VI[`${vertical}${horizontal}` as keyof typeof VI];
  }
  return VI[arrow];
}
