/** Key and gamepad-button bindings for كورة البط, changeable in the key legend (click an action, press the new
 *  key or pad button) and remembered on this device. Every input method maps onto the same eight actions, so the
 *  game itself never knows which one was used. */
export type Act = "up" | "down" | "left" | "right" | "a" | "b" | "s" | "k";
export interface Bindings {
  /** KeyboardEvent.code -> action */
  keys: Record<string, Act>;
  /** standard-mapping gamepad button index -> action */
  pad: Record<number, Act>;
}

export const ACTS: { act: Act; name: string }[] = [
  { act: "up", name: "فوق" },
  { act: "down", name: "تحت" },
  { act: "left", name: "يسار" },
  { act: "right", name: "يمين" },
  { act: "a", name: "تمرير · زحلقة" },
  { act: "b", name: "تسديد · بدّل" },
  { act: "s", name: "ركض سريع" },
  { act: "k", name: "حركة مهارية" },
];

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
    Space: "a", KeyJ: "a", KeyK: "b", KeyL: "b", ShiftLeft: "s", ShiftRight: "s", KeyE: "k", Semicolon: "k",
  },
  // standard mapping: 0 A/cross, 1 B/circle, 2 X/square, 3 Y/triangle, 5 RB, 7 RT, 12-15 d-pad
  pad: { 0: "a", 2: "a", 1: "b", 3: "k", 5: "s", 7: "s", 12: "up", 13: "down", 14: "left", 15: "right" },
};

const STORE = "fb-bindings-v1";
const clone = (b: Bindings): Bindings => ({ keys: { ...b.keys }, pad: { ...b.pad } });

export function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const b = JSON.parse(raw) as Bindings;
      if (b && typeof b.keys === "object" && typeof b.pad === "object") return { keys: { ...b.keys }, pad: { ...b.pad } };
    }
  } catch {
    /* private mode / blocked storage: the defaults */
  }
  return clone(DEFAULT_BINDINGS);
}

export function saveBindings(b: Bindings) {
  try {
    localStorage.setItem(STORE, JSON.stringify(b));
  } catch {
    /* not saved: still works for this match */
  }
}

export function resetBindings(): Bindings {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
  return clone(DEFAULT_BINDINGS);
}

/** bind `code` to `act`: the key leaves whatever it did before; an action keeps at most two keys (the new one + the
 *  most recent other one), so a rebind never leaves an action with no key at all unless the user moved it away */
export function bindKey(b: Bindings, act: Act, code: string): Bindings {
  const keys = { ...b.keys };
  delete keys[code];
  const mine = Object.keys(keys).filter((k) => keys[k] === act);
  for (const k of mine.slice(0, Math.max(0, mine.length - 1))) delete keys[k];
  keys[code] = act;
  return { keys, pad: { ...b.pad } };
}

export function bindPad(b: Bindings, act: Act, button: number): Bindings {
  const pad = { ...b.pad };
  delete pad[button];
  const mine = Object.keys(pad).map(Number).filter((k) => pad[k] === act);
  for (const k of mine.slice(0, Math.max(0, mine.length - 1))) delete pad[k];
  pad[button] = act;
  return { keys: { ...b.keys }, pad };
}

/** a key code as a short label: KeyW -> W, ArrowUp -> ↑, ShiftLeft -> Shift */
export function keyLabel(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const map: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", ShiftLeft: "Shift", ShiftRight: "Shift", Semicolon: ";", Space: "Space", Enter: "Enter", ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", AltRight: "Alt", Comma: ",", Period: ".", Slash: "/", Quote: "'", BracketLeft: "[", BracketRight: "]" };
  return map[code] ?? code;
}
