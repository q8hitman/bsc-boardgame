import type { FbInput } from "../../../shared/football/types";

/** The player's controls, three ways at once:
 *  - touch: a floating joystick on the left half (it appears where the thumb lands); on the right two big buttons
 *    (A pass/slide, B shoot/switch), a sprint button held next to them, and a small skill button while you have the ball;
 *  - keyboard (a computer: no on-screen controls, a key legend instead): WASD / arrows move, Space or J = A,
 *    K or L = B, Shift = sprint, E or ; = skill, H = show / hide the legend;
 *  - a gamepad: left stick / d-pad, A = A, B = B, X = A, RB / RT = sprint, Y = skill.
 *  Sends FbInput on every change and every 200 ms while something is held; button edges go out at once, stick
 *  movement at most every 40 ms. A press always goes out as "true" at least once, however short the tap. */
const RESEND = 200;
const MIN_GAP = 40;
const CHARGE_MS = 1000;
type Btn = "a" | "b" | "s" | "k";
const KEYS: Record<string, Btn> = {
  Space: "a",
  KeyJ: "a",
  KeyK: "b",
  KeyL: "b",
  ShiftLeft: "s",
  ShiftRight: "s",
  KeyE: "k",
  Semicolon: "k",
};
const MOVE = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"];

/** a touch screen (a phone / tablet) rather than a mouse and keyboard */
export const isTouch = () => {
  try {
    return matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 0 && !matchMedia("(pointer: fine)").matches);
  } catch {
    return false;
  }
};

export class FootballControls {
  readonly el: HTMLDivElement;
  private cb: ((i: FbInput) => void) | null = null;
  private joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private keys = new Set<string>();
  /** button keys held right now (two keys can mean the same button) */
  private bkeys = new Set<string>();
  /** each button: held by touch / by a key / by the gamepad */
  private btn: Record<Btn, { touch: boolean; key: boolean; pad: boolean }> = {
    a: { touch: false, key: false, pad: false },
    b: { touch: false, key: false, pad: false },
    s: { touch: false, key: false, pad: false },
    k: { touch: false, key: false, pad: false },
  };
  private pad = { x: 0, y: 0, on: false };
  private sent: FbInput = { x: 0, y: 0, a: false, b: false, s: false, k: false };
  private lastSend = 0;
  private timer = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private zone: HTMLDivElement;
  private els: Record<Btn, HTMLButtonElement>;
  private ring: SVGCircleElement;
  private legend: HTMLDivElement;
  private hasBall: boolean | null = null;
  private chargeAt = 0;
  private latch: Record<Btn, boolean> = { a: false, b: false, s: false, k: false };
  private raw: Record<Btn, boolean> = { a: false, b: false, s: false, k: false };
  private bHeld = false;
  private raf = 0;
  private padRaf = 0;
  readonly touch: boolean;
  private legendShown = true;
  private legendTimer = 0;

  constructor(root: HTMLElement, private big: boolean) {
    this.touch = isTouch();
    this.el = document.createElement("div");
    this.el.className = `fb-ctrl hidden${big ? " big" : ""}${this.touch ? " touch" : " desk"}`;
    this.el.innerHTML = `
      <div class="joyzone"><div class="joyhint">اسحب هني للحركة</div></div>
      <div class="joy hidden"><div class="knob"></div></div>
      <div class="btns">
        <button class="fbb a" type="button"><span class="k">A</span><b>زحلقة</b></button>
        <button class="fbb b" type="button"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" pathLength="100"/></svg><span class="k">B</span><b>بدّل</b></button>
        <button class="fbb s" type="button"><span class="k">»</span><b>ركض</b></button>
        <button class="fbb k" type="button"><span class="k">★</span><b>حركة</b></button>
      </div>
      <div class="fb-keys" dir="rtl">
        <div class="kt">المفاتيح <i>H</i></div>
        <div class="kr"><span><i>W</i><i>A</i><i>S</i><i>D</i> / <i>←↑↓→</i></span><b>حركة</b></div>
        <div class="kr"><span><i class="w">Shift</i></span><b>ركض سريع</b></div>
        <div class="kr"><span><i class="w">Space</i> / <i>J</i></span><b class="la">تمرير · زحلقة</b></div>
        <div class="kr"><span><i>K</i> / <i>L</i></span><b class="lb">تسديد (اضغط مطوّل) · بدّل</b></div>
        <div class="kr"><span><i>E</i> / <i>;</i></span><b>حركة مهارية</b></div>
      </div>`;
    root.appendChild(this.el);
    this.zone = this.el.querySelector(".joyzone")!;
    this.base = this.el.querySelector(".joy")!;
    this.knob = this.el.querySelector(".knob")!;
    this.els = {
      a: this.el.querySelector(".fbb.a")!,
      b: this.el.querySelector(".fbb.b")!,
      s: this.el.querySelector(".fbb.s")!,
      k: this.el.querySelector(".fbb.k")!,
    };
    this.ring = this.el.querySelector(".fbb.b circle")!;
    this.legend = this.el.querySelector(".fb-keys")!;

    this.zone.addEventListener("pointerdown", this.joyDown);
    this.el.addEventListener("pointermove", this.joyMove);
    this.el.addEventListener("pointerup", this.joyUp);
    this.el.addEventListener("pointercancel", this.joyUp);
    for (const id of ["a", "b", "s", "k"] as Btn[]) {
      const el = this.els[id];
      const st = this.btn[id];
      const down = (e: PointerEvent) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        st.touch = true;
        el.classList.add("on");
        buzz(id === "s" ? 8 : 14);
        this.changed();
      };
      const up = (e: PointerEvent) => {
        e.preventDefault();
        if (!st.touch) return;
        st.touch = false;
        el.classList.remove("on");
        this.changed();
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    addEventListener("keydown", this.keyDown, true);
    addEventListener("keyup", this.keyUp, true);
    addEventListener("blur", this.releaseAll);
    document.addEventListener("visibilitychange", this.onVis);
    this.el.addEventListener("lostpointercapture", (e) => {
      if (e.pointerId === this.joy.id) this.joyUp(e);
    });
    addEventListener("gamepadconnected", this.padStart);
    if (navigator.getGamepads?.().some(Boolean)) this.padStart();
  }

  private onVis = () => {
    if (document.hidden) this.releaseAll();
  };

  set(cb: ((i: FbInput) => void) | null) {
    if (cb === this.cb) return;
    if (!cb && this.cb && this.held()) this.cb({ x: 0, y: 0, a: false, b: false, s: false, k: false });
    this.cb = cb;
    this.el.classList.toggle("hidden", !cb);
    if (!cb) this.releaseAll();
    else if (!this.touch) {
      // the page must not keep focus on a button (Space would click it) or scroll: the window gets the keys
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }

  /** who has the ball, from the frames: true = my team, false = the other team, null = loose; `mine` = at my feet */
  possession(team: boolean | null, mine = false) {
    this.el.classList.toggle("withball", mine);
    if (team === this.hasBall) return;
    this.hasBall = team;
    const pass = team ? "تمرير" : "زحلقة";
    const shoot = team ? "تسديد" : "بدّل";
    this.els.a.querySelector("b")!.textContent = pass;
    this.els.b.querySelector("b")!.textContent = shoot;
    this.el.classList.toggle("attack", !!team);
    this.el.querySelector(".la")!.textContent = team ? "تمرير (مطوّل = كورة طويلة / عرضية)" : "زحلقة";
    this.el.querySelector(".lb")!.textContent = team ? "تسديد (اضغط مطوّل)" : "بدّل اللاعب";
  }

  /** the key legend: shown at first, fades a while after you start playing (H brings it back) */
  showLegend(on: boolean) {
    this.legendShown = on;
    this.legend.classList.toggle("gone", !on);
  }
  /** a few goals in: the legend has done its job */
  goalScored() {
    if (this.legendShown) this.showLegend(false);
  }

  private held() {
    const b = this.btn;
    const any = (id: Btn) => b[id].touch || b[id].key || b[id].pad;
    const [kx, ky] = this.keyVec();
    return any("a") || any("b") || any("s") || any("k") || this.joy.id >= 0 || kx !== 0 || ky !== 0 || this.pad.x !== 0 || this.pad.y !== 0;
  }

  private keyVec(): [number, number] {
    const k = this.keys;
    const x = (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0);
    const y = (k.has("ArrowDown") || k.has("KeyS") ? 1 : 0) - (k.has("ArrowUp") || k.has("KeyW") ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  private isDown(id: Btn) {
    const b = this.btn[id];
    return b.touch || b.key || b.pad;
  }

  private current(): FbInput {
    let x = this.joy.x;
    let y = this.joy.y;
    if (this.pad.x || this.pad.y) {
      x = this.pad.x;
      y = this.pad.y;
    }
    const [kx, ky] = this.keyVec();
    if (kx || ky) {
      x = kx;
      y = ky;
    }
    return {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      a: this.isDown("a") || this.latch.a,
      b: this.isDown("b") || this.latch.b,
      s: this.isDown("s"),
      k: this.isDown("k") || this.latch.k,
    };
  }

  /** what the player is pressing right now (for predicting their own duck), null when not playing */
  input(): FbInput | null {
    return this.cb ? this.current() : null;
  }

  /** shot charge 0..1 while B is held with the ball, -1 otherwise */
  chargeLevel(): number {
    if (!this.chargeAt || !this.hasBall) return -1;
    return Math.min(1, (performance.now() - this.chargeAt) / CHARGE_MS);
  }

  private changed() {
    // a press always goes out as "true" at least once, however short the tap
    for (const id of ["a", "b", "k"] as Btn[]) {
      const r = this.isDown(id);
      if (r && !this.raw[id]) this.latch[id] = true;
      this.raw[id] = r;
    }
    this.raw.s = this.isDown("s");
    const cur = this.current();
    const bWas = this.bHeld;
    this.bHeld = cur.b;
    if (cur.b && !bWas) {
      this.chargeAt = performance.now();
      this.charge();
    }
    if (!cur.b) {
      this.chargeAt = 0;
      this.ring.style.strokeDashoffset = "100";
      this.els.b.classList.remove("charging", "full");
    }
    this.flush();
  }

  private charge = () => {
    cancelAnimationFrame(this.raf);
    if (!this.chargeAt) return;
    const f = Math.min(1, (performance.now() - this.chargeAt) / CHARGE_MS);
    // the power ring only means something with the ball at your feet
    this.ring.style.strokeDashoffset = this.hasBall ? String(100 - f * 100) : "100";
    this.els.b.classList.toggle("charging", !!this.hasBall);
    this.els.b.classList.toggle("full", !!this.hasBall && f >= 1);
    this.raf = requestAnimationFrame(this.charge);
  };

  private flush = () => {
    clearTimeout(this.timer);
    if (!this.cb) return;
    const cur = this.current();
    const now = performance.now();
    const s = this.sent;
    const same = cur.x === s.x && cur.y === s.y && cur.a === s.a && cur.b === s.b && cur.s === s.s && cur.k === s.k;
    const anyHeld = cur.x !== 0 || cur.y !== 0 || cur.a || cur.b || !!cur.s || !!cur.k;
    const due = same ? (anyHeld ? RESEND : -1) : 0;
    if (due < 0) return;
    // button edges go out at once; only stick movement is rate-limited
    const edge = cur.a !== s.a || cur.b !== s.b || cur.s !== s.s || cur.k !== s.k;
    const wait = edge ? 0 : Math.max(due - (now - this.lastSend), MIN_GAP - (now - this.lastSend), 0);
    if (wait > 0) {
      this.timer = window.setTimeout(this.flush, wait);
      return;
    }
    this.sent = cur;
    this.lastSend = now;
    this.cb(cur);
    // a latched tap has been sent as pressed: now let it go (the release follows straight away)
    const unlatch = (this.latch.a && !this.raw.a) || (this.latch.b && !this.raw.b) || (this.latch.k && !this.raw.k);
    if (cur.a) this.latch.a = false;
    if (cur.b) this.latch.b = false;
    if (cur.k) this.latch.k = false;
    if (unlatch) this.timer = window.setTimeout(this.flush, MIN_GAP);
    else if (anyHeld) this.timer = window.setTimeout(this.flush, RESEND);
  };

  /** a pointer in this element's own (un-scaled) pixels: the display may scale its stage with a transform */
  private local(e: PointerEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    const k = this.el.offsetWidth ? r.width / this.el.offsetWidth : 1;
    return [(e.clientX - r.left) / (k || 1), (e.clientY - r.top) / (k || 1)];
  }

  /* ---------------- joystick */
  private joyDown = (e: PointerEvent) => {
    if (this.joy.id >= 0) return;
    e.preventDefault();
    const [ox, oy] = this.local(e);
    this.joy = { id: e.pointerId, ox, oy, x: 0, y: 0 };
    this.zone.setPointerCapture?.(e.pointerId);
    this.base.style.left = `${this.joy.ox}px`;
    this.base.style.top = `${this.joy.oy}px`;
    this.base.classList.remove("hidden");
    this.knob.style.transform = "translate(-50%,-50%)";
    this.el.classList.add("used");
    this.changed();
  };
  private joyMove = (e: PointerEvent) => {
    if (e.pointerId !== this.joy.id) return;
    const R = this.base.offsetWidth * 0.42 || 50;
    const [lx, ly] = this.local(e);
    let dx = lx - this.joy.ox;
    let dy = ly - this.joy.oy;
    const l = Math.hypot(dx, dy);
    // a thumb that drags far pulls the stick along with it
    if (l > R * 1.6) {
      const k = (l - R * 1.6) / l;
      this.joy.ox += dx * k;
      this.joy.oy += dy * k;
      this.base.style.left = `${this.joy.ox}px`;
      this.base.style.top = `${this.joy.oy}px`;
      dx -= dx * k;
      dy -= dy * k;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / R);
    const ang = Math.atan2(dy, dx);
    const dead = 0.14;
    const v = m < dead ? 0 : (m - dead) / (1 - dead);
    this.joy.x = Math.cos(ang) * v;
    this.joy.y = Math.sin(ang) * v;
    this.knob.style.transform = `translate(calc(-50% + ${Math.cos(ang) * m * R}px), calc(-50% + ${Math.sin(ang) * m * R}px))`;
    this.changed();
  };
  private joyUp = (e: PointerEvent) => {
    if (e.pointerId !== this.joy.id) return;
    this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.base.classList.add("hidden");
    this.changed();
  };

  /* ---------------- keyboard */
  private keyDown = (e: KeyboardEvent) => {
    if (!this.cb) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const c = e.code;
    if (c === "KeyH") {
      if (!e.repeat) this.showLegend(!this.legendShown);
      return;
    }
    const move = MOVE.includes(c);
    const b = KEYS[c];
    if (!move && !b) return;
    // these keys belong to the game: no page scrolling, no clicking a focused button with Space
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    this.firstKey();
    if (move) this.keys.add(c);
    if (b) {
      this.bkeys.add(c);
      this.btn[b].key = true;
      this.els[b].classList.add("on");
    }
    this.changed();
  };
  private keyUp = (e: KeyboardEvent) => {
    const c = e.code;
    let hit = this.keys.delete(c);
    const b = KEYS[c];
    if (b) {
      this.bkeys.delete(c);
      // e.g. both Shift keys: the button is up when neither is held
      const other = [...this.bkeys].some((k) => KEYS[k] === b);
      if (!other) {
        hit = hit || this.btn[b].key;
        this.btn[b].key = false;
        if (!this.btn[b].touch) this.els[b].classList.remove("on");
      }
    }
    if (hit) {
      e.preventDefault();
      this.changed();
    }
  };
  /** the first real key press: the legend steps back after a while */
  private firstKey() {
    if (this.legendTimer || !this.legendShown) return;
    this.legendTimer = window.setTimeout(() => this.showLegend(false), 9000);
  }

  /* ---------------- gamepad */
  private padStart = () => {
    if (this.padRaf) return;
    const poll = () => {
      this.padRaf = requestAnimationFrame(poll);
      const gp = navigator.getGamepads?.().find((g) => g && g.connected);
      if (!gp) {
        if (this.pad.on) {
          this.pad = { x: 0, y: 0, on: false };
          for (const id of ["a", "b", "s", "k"] as Btn[]) this.btn[id].pad = false;
          this.changed();
        }
        return;
      }
      const B = (i: number) => !!gp.buttons[i]?.pressed;
      let x = gp.axes[0] ?? 0;
      let y = gp.axes[1] ?? 0;
      const m = Math.hypot(x, y);
      if (m < 0.22) x = y = 0;
      else {
        const v = Math.min(1, (m - 0.22) / 0.78);
        x = (x / m) * v;
        y = (y / m) * v;
      }
      const dx = (B(15) ? 1 : 0) - (B(14) ? 1 : 0);
      const dy = (B(13) ? 1 : 0) - (B(12) ? 1 : 0);
      if (dx || dy) {
        const l = Math.hypot(dx, dy);
        x = dx / l;
        y = dy / l;
      }
      x = Math.round(x * 20) / 20;
      y = Math.round(y * 20) / 20;
      const next = { a: B(0) || B(2), b: B(1), s: B(5) || B(7), k: B(3) };
      let diff = x !== this.pad.x || y !== this.pad.y;
      for (const id of ["a", "b", "s", "k"] as Btn[]) if (this.btn[id].pad !== next[id]) diff = true;
      if (!diff) return;
      this.pad = { x, y, on: true };
      for (const id of ["a", "b", "s", "k"] as Btn[]) this.btn[id].pad = next[id];
      if (this.cb) this.firstKey();
      this.changed();
    };
    poll();
  };

  private releaseAll = () => {
    const any = this.held();
    this.keys.clear();
    this.bkeys.clear();
    for (const id of ["a", "b", "s", "k"] as Btn[]) {
      this.btn[id] = { touch: false, key: false, pad: false };
      this.latch[id] = false;
      this.els[id].classList.remove("on");
    }
    this.pad = { x: 0, y: 0, on: false };
    this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.base.classList.add("hidden");
    if (any) this.changed();
  };

  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.legendTimer);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.padRaf);
    removeEventListener("keydown", this.keyDown, true);
    removeEventListener("keyup", this.keyUp, true);
    removeEventListener("blur", this.releaseAll);
    removeEventListener("gamepadconnected", this.padStart);
    document.removeEventListener("visibilitychange", this.onVis);
    this.el.remove();
  }
}

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed */
  }
}
