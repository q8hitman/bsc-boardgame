import type { FbInput } from "../../../shared/football/types";

/** On-screen controls: a floating joystick on the left half (it appears where the thumb lands) and two big
 *  buttons on the right; arrows/WASD + Space/J + Shift/K on a keyboard. Sends FbInput on every change and
 *  every 200 ms while something is held, never more often than every 40 ms. */
const RESEND = 200;
const MIN_GAP = 40;
const CHARGE_MS = 1000;

export class FootballControls {
  readonly el: HTMLDivElement;
  private cb: ((i: FbInput) => void) | null = null;
  private joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private keys = new Set<string>();
  private a = { touch: false, key: false };
  private b = { touch: false, key: false };
  private sent: FbInput = { x: 0, y: 0, a: false, b: false };
  private lastSend = 0;
  private timer = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private zone: HTMLDivElement;
  private btnA: HTMLButtonElement;
  private btnB: HTMLButtonElement;
  private ring: SVGCircleElement;
  private hasBall: boolean | null = null;
  private chargeAt = 0;
  private latch = { a: false, b: false };
  private raw = { a: false, b: false };
  private bHeld = false;
  private raf = 0;

  constructor(root: HTMLElement, private big: boolean) {
    this.el = document.createElement("div");
    this.el.className = `fb-ctrl hidden${big ? " big" : ""}`;
    this.el.innerHTML = `
      <div class="joyzone"><div class="joyhint">اسحب هني للحركة</div></div>
      <div class="joy hidden"><div class="knob"></div></div>
      <div class="btns">
        <button class="fbb a" type="button"><span class="k">A</span><b>زحلقة</b></button>
        <button class="fbb b" type="button"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" pathLength="100"/></svg><span class="k">B</span><b>بدّل</b></button>
      </div>`;
    root.appendChild(this.el);
    this.zone = this.el.querySelector(".joyzone")!;
    this.base = this.el.querySelector(".joy")!;
    this.knob = this.el.querySelector(".knob")!;
    this.btnA = this.el.querySelector(".fbb.a")!;
    this.btnB = this.el.querySelector(".fbb.b")!;
    this.ring = this.el.querySelector(".fbb.b circle")!;

    this.zone.addEventListener("pointerdown", this.joyDown);
    this.el.addEventListener("pointermove", this.joyMove);
    this.el.addEventListener("pointerup", this.joyUp);
    this.el.addEventListener("pointercancel", this.joyUp);
    for (const [btn, st] of [
      [this.btnA, this.a],
      [this.btnB, this.b],
    ] as const) {
      const down = (e: PointerEvent) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        st.touch = true;
        btn.classList.add("on");
        buzz(14);
        this.changed();
      };
      const up = (e: PointerEvent) => {
        e.preventDefault();
        if (!st.touch) return;
        st.touch = false;
        btn.classList.remove("on");
        this.changed();
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("lostpointercapture", up);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    addEventListener("keydown", this.keyDown);
    addEventListener("keyup", this.keyUp);
    addEventListener("blur", this.releaseAll);
    document.addEventListener("visibilitychange", this.onVis);
    this.el.addEventListener("lostpointercapture", (e) => {
      if (e.pointerId === this.joy.id) this.joyUp(e);
    });
  }

  private onVis = () => {
    if (document.hidden) this.releaseAll();
  };

  set(cb: ((i: FbInput) => void) | null) {
    if (cb === this.cb) return;
    if (!cb && this.cb && this.held()) this.cb({ x: 0, y: 0, a: false, b: false });
    this.cb = cb;
    this.el.classList.toggle("hidden", !cb);
    if (!cb) this.releaseAll();
  }

  /** who has the ball, from the frames: true = my team, false = the other team, null = loose */
  possession(mine: boolean | null) {
    if (mine === this.hasBall) return;
    this.hasBall = mine;
    this.btnA.querySelector("b")!.textContent = mine ? "تمرير" : "زحلقة";
    this.btnB.querySelector("b")!.textContent = mine ? "تسديد" : "بدّل";
    this.el.classList.toggle("attack", !!mine);
  }

  private held() {
    return this.a.touch || this.a.key || this.b.touch || this.b.key || this.joy.id >= 0 || this.keyVec()[0] !== 0 || this.keyVec()[1] !== 0;
  }

  private keyVec(): [number, number] {
    const k = this.keys;
    const x = (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0);
    const y = (k.has("ArrowDown") || k.has("KeyS") ? 1 : 0) - (k.has("ArrowUp") || k.has("KeyW") ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  private current(): FbInput {
    let x = this.joy.x;
    let y = this.joy.y;
    const [kx, ky] = this.keyVec();
    if (kx || ky) {
      x = kx;
      y = ky;
    }
    return {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      a: this.a.touch || this.a.key || this.latch.a,
      b: this.b.touch || this.b.key || this.latch.b,
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
    const ra = this.a.touch || this.a.key;
    const rb = this.b.touch || this.b.key;
    if (ra && !this.raw.a) this.latch.a = true;
    if (rb && !this.raw.b) this.latch.b = true;
    this.raw = { a: ra, b: rb };
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
      this.btnB.classList.remove("charging", "full");
    }
    this.flush();
  }

  private charge = () => {
    cancelAnimationFrame(this.raf);
    if (!this.chargeAt) return;
    const f = Math.min(1, (performance.now() - this.chargeAt) / CHARGE_MS);
    // the power ring only means something with the ball at your feet
    this.ring.style.strokeDashoffset = this.hasBall ? String(100 - f * 100) : "100";
    this.btnB.classList.toggle("charging", !!this.hasBall);
    this.btnB.classList.toggle("full", !!this.hasBall && f >= 1);
    this.raf = requestAnimationFrame(this.charge);
  };

  private flush = () => {
    clearTimeout(this.timer);
    if (!this.cb) return;
    const cur = this.current();
    const now = performance.now();
    const same = cur.x === this.sent.x && cur.y === this.sent.y && cur.a === this.sent.a && cur.b === this.sent.b;
    const anyHeld = cur.x !== 0 || cur.y !== 0 || cur.a || cur.b;
    const due = same ? (anyHeld ? RESEND : -1) : 0;
    if (due < 0) return;
    // button edges go out at once; only stick movement is rate-limited
    const edge = cur.a !== this.sent.a || cur.b !== this.sent.b;
    const wait = edge ? 0 : Math.max(due - (now - this.lastSend), MIN_GAP - (now - this.lastSend), 0);
    if (wait > 0) {
      this.timer = window.setTimeout(this.flush, wait);
      return;
    }
    this.sent = cur;
    this.lastSend = now;
    this.cb(cur);
    // a latched tap has been sent as pressed: now let it go (the release follows straight away)
    const unlatch = (this.latch.a && !this.raw.a) || (this.latch.b && !this.raw.b);
    if (cur.a) this.latch.a = false;
    if (cur.b) this.latch.b = false;
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
    const move = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(c);
    const isA = c === "Space" || c === "KeyJ";
    const isB = c === "ShiftLeft" || c === "ShiftRight" || c === "KeyK";
    if (!move && !isA && !isB) return;
    e.preventDefault();
    if (e.repeat) return;
    if (move) this.keys.add(c);
    if (isA) {
      this.a.key = true;
      this.btnA.classList.add("on");
    }
    if (isB) {
      this.b.key = true;
      this.btnB.classList.add("on");
    }
    this.changed();
  };
  private keyUp = (e: KeyboardEvent) => {
    const c = e.code;
    let hit = this.keys.delete(c);
    if (c === "Space" || c === "KeyJ") {
      hit = hit || this.a.key;
      this.a.key = false;
      if (!this.a.touch) this.btnA.classList.remove("on");
    }
    if (c === "ShiftLeft" || c === "ShiftRight" || c === "KeyK") {
      hit = hit || this.b.key;
      this.b.key = false;
      if (!this.b.touch) this.btnB.classList.remove("on");
    }
    if (hit) this.changed();
  };
  private releaseAll = () => {
    const any = this.held();
    this.keys.clear();
    this.a = { touch: false, key: false };
    this.b = { touch: false, key: false };
    this.latch = { a: false, b: false };
    this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.base.classList.add("hidden");
    this.btnA.classList.remove("on");
    this.btnB.classList.remove("on");
    if (any) this.changed();
  };

  destroy() {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    removeEventListener("keydown", this.keyDown);
    removeEventListener("keyup", this.keyUp);
    removeEventListener("blur", this.releaseAll);
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
