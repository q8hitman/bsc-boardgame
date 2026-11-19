import type { FbInput } from "../../../shared/football/types";
import { ACTS, bindKey, bindPad, keyLabel, loadBindings, resetBindings, saveBindings, type Act, type Bindings } from "./bindings";

/** The player's controls, three ways at once:
 *  - touch: a floating joystick on the left half (it appears where the thumb lands); on the right two big buttons
 *    (A pass/slide, B shoot/switch), a sprint button held next to them, and a small skill button while you have the ball;
 *  - keyboard (a computer: no on-screen controls, a key legend instead): WASD / arrows move, Space or J = A,
 *    K or L = B, Shift = sprint, E or ; = skill, H = show / hide the legend;
 *  - a gamepad (any connected one, the last used wins): left stick / d-pad, A = A, B = B, X = A, RB / RT = sprint,
 *    Y = skill.
 *  Keys and pad buttons can be changed in the legend (click an action, press the new key / button; Esc cancels) and
 *  are remembered on this device (bindings.ts).
 *  Sends FbInput on every change and every 200 ms while something is held; button edges go out at once, stick
 *  movement at most every 40 ms. A press always goes out as "true" at least once, however short the tap. */
const RESEND = 200;
const MIN_GAP = 40;
const CHARGE_MS = 1000;
type Btn = "a" | "b" | "s" | "k";
const BTNS: Btn[] = ["a", "b", "s", "k"];
const isBtn = (a: Act | undefined): a is Btn => a === "a" || a === "b" || a === "s" || a === "k";
const isDir = (a: Act | undefined) => a === "up" || a === "down" || a === "left" || a === "right";

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
  private joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0, sprint: false };
  /** touch: what a held pass would be (from the server: 1 through / long, 2 cross) and the A press timer */
  private aimK = 0;
  private aTimer = 0;
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
  /** keys / pad buttons -> actions (changeable) and the action waiting for its new key (null = not rebinding) */
  private bind: Bindings = loadBindings();
  private rebind: Act | null = null;
  /** pad buttons held at the last poll (a rebind takes the first newly pressed one) */
  private padPrev = new Set<number>();
  private padName = "";
  /** solo play: the match can be paused (P / Esc / the pause button); while paused nothing else is sent */
  private paused = false;
  private canPause = false;

  constructor(root: HTMLElement, private big: boolean) {
    this.touch = isTouch();
    this.el = document.createElement("div");
    this.el.className = `fb-ctrl hidden${big ? " big" : ""}${this.touch ? " touch" : " desk"}`;
    this.el.innerHTML = `
      <div class="joyzone"><div class="joyhint">اسحب هني للحركة<small>لبعيد = ركض</small></div></div>
      <div class="joy hidden"><div class="knob"></div></div>
      <div class="btns">
        <button class="fbb a" type="button"><span class="k">A</span><b>افتك</b></button>
        <button class="fbb b" type="button"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" pathLength="100"/></svg><span class="k">B</span><b>بدّل</b></button>
        <button class="fbb s" type="button"><span class="k">»</span><b>ركض</b></button>
        <button class="fbb k" type="button"><span class="k">★</span><b>حركة</b></button>
      </div>
      <div class="fb-keys" dir="rtl"></div>
      <button class="fb-pause" type="button" title="إيقاف مؤقت (P)">❚❚</button>
      <div class="fb-paused" dir="rtl"><div><b>موقّفة</b><button class="fb-resume" type="button">▶ كمّل</button><small>P أو Esc</small></div></div>`;
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
    this.renderLegend();
    for (const sel of [".fb-pause", ".fb-resume"]) {
      const b = this.el.querySelector<HTMLButtonElement>(sel)!;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.togglePause();
      });
    }
    // click an action to give it a new key / pad button
    this.legend.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".reset")) {
        this.bind = resetBindings();
        this.rebind = null;
        return this.renderLegend();
      }
      const row = t.closest<HTMLElement>("[data-act]");
      if (!row) return;
      this.rebind = this.rebind === row.dataset.act ? null : (row.dataset.act as Act);
      this.renderLegend();
    });

    this.zone.addEventListener("pointerdown", this.joyDown);
    this.el.addEventListener("pointermove", this.joyMove);
    this.el.addEventListener("pointerup", this.joyUp);
    this.el.addEventListener("pointercancel", this.joyUp);
    for (const id of ["a", "b", "s", "k"] as Btn[]) {
      const el = this.els[id];
      const st = this.btn[id];
      const down = (e: PointerEvent) => {
        e.preventDefault();
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {
          /* already gone */
        }
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
    addEventListener("gamepaddisconnected", this.padGone);
    if (navigator.getGamepads?.().some(Boolean)) this.padStart();
  }

  /** the legend: one row per action with its keys (and pad buttons); the row being rebound waits for a key */
  private renderLegend() {
    const keysOf = (a: Act) => Object.keys(this.bind.keys).filter((k) => this.bind.keys[k] === a);
    const padOf = (a: Act) => Object.keys(this.bind.pad).map(Number).filter((k) => this.bind.pad[k] === a);
    const PADN: Record<number, string> = { 0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT", 8: "Back", 9: "Start", 10: "L3", 11: "R3", 12: "D↑", 13: "D↓", 14: "D←", 15: "D→" };
    const chip = (t: string) => `<i class="${t.length > 2 ? "w" : ""}">${t.replace(/</g, "&lt;")}</i>`;
    const dirs = ACTS.filter((a) => isDir(a.act));
    const moveRow = `<div class="kr dirs"><span>${dirs
      .map((d) => `<em data-act="${d.act}" class="${this.rebind === d.act ? "wait" : ""}">${this.rebind === d.act ? chip("…") : chip(keyLabel(keysOf(d.act)[0] ?? "?"))}</em>`)
      .join("")}</span><b>حركة</b></div>`;
    const rows = ACTS.filter((a) => !isDir(a.act))
      .map((a) => {
        const ks = keysOf(a.act).map((k) => chip(keyLabel(k))).join(" / ");
        const ps = this.padName ? padOf(a.act).map((b) => chip(PADN[b] ?? String(b))).join("") : "";
        const label = a.act === "a" ? "تمرير (مطوّل = طويلة / عرضية) · زحلقة" : a.act === "b" ? "تسديد (مطوّل = أقوى · مع الركض = لوب) · بدّل" : a.name;
        return `<div class="kr${this.rebind === a.act ? " wait" : ""}" data-act="${a.act}"><span>${this.rebind === a.act ? "اضغط مفتاح أو زر…" : ks}${ps ? ` <small>${ps}</small>` : ""}</span><b class="l${a.act}">${label}</b></div>`;
      })
      .join("");
    this.legend.innerHTML = `<div class="kt">المفاتيح <i>H</i></div>${moveRow}${rows}<div class="kf">${
      this.padName ? `🎮 ${this.padName.slice(0, 26).replace(/</g, "&lt;")} · ` : ""
    }اضغط أي سطر عشان تغيّر مفتاحه · <u class="reset">افتراضي</u></div>`;
  }

  private padGone = () => {
    if (!navigator.getGamepads?.().some((g) => g && g.connected)) {
      this.padName = "";
      this.renderLegend();
    }
  };

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
    const pass = team ? "تمرير" : "افتك";
    const shoot = team ? "تسديد" : "بدّل";
    this.els.a.querySelector("b")!.textContent = pass;
    this.els.b.querySelector("b")!.textContent = shoot;
    this.el.classList.toggle("attack", !!team);
    const la = this.el.querySelector(".la");
    const lb = this.el.querySelector(".lb");
    if (la) la.textContent = team ? "تمرير (مطوّل = بينية / عرضية)" : "افتك (قريب) · زحلقة (بعيد)";
    if (lb) lb.textContent = team ? "تسديد (اضغط مطوّل)" : "بدّل اللاعب";
  }

  /** what my held pass would become (the server's pass target kind: 1 through / long, 2 cross) */
  aimKind(k: number) {
    this.aimK = k;
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
    const held = new Set<Act>();
    for (const c of this.keys) {
      const a = this.bind.keys[c];
      if (a) held.add(a);
    }
    const x = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    const y = (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  private isDown(id: Btn) {
    const b = this.btn[id];
    return b.touch || b.key || b.pad;
  }

  private current(): FbInput {
    if (this.paused) return { x: 0, y: 0, a: false, b: false, s: false, k: false, p: true };
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
      s: this.isDown("s") || this.joy.sprint,
      k: this.isDown("k") || this.latch.k,
      p: false,
    };
  }

  /** pausing is offered only when this person is alone against the computer, in open play */
  setPausable(on: boolean) {
    if (on === this.canPause) return;
    this.canPause = on;
    this.el.classList.toggle("pausable", on);
    // (a goal, the whistle: the match moved on, the pause is over)
    if (!on && this.paused) this.setPausedState(false);
  }
  private togglePause() {
    if (!this.cb || (!this.paused && !this.canPause)) return;
    this.setPausedState(!this.paused);
  }
  private setPausedState(on: boolean) {
    this.paused = on;
    // nothing stays held across a pause (a key let go while paused would stick)
    this.keys.clear();
    this.bkeys.clear();
    for (const id of BTNS) {
      this.btn[id] = { touch: false, key: false, pad: false };
      this.latch[id] = false;
      this.els[id].classList.remove("on");
    }
    this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0, sprint: false };
    this.base.classList.add("hidden");
    this.base.classList.remove("sprint");
    this.el.classList.toggle("paused", on);
    this.changed();
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
    // a held pass: after a moment the button says what it has become (a through ball / a cross)
    if (cur.a && !this.aTimer && this.hasBall) {
      this.aTimer = window.setTimeout(() => {
        if (this.isDown("a") && this.hasBall && this.el.classList.contains("withball")) {
          this.els.a.querySelector("b")!.textContent = this.aimK === 2 ? "عرضية" : "بينية";
          this.els.a.classList.add("long");
          buzz(10);
        }
      }, 230);
    } else if (!cur.a && this.aTimer) {
      clearTimeout(this.aTimer);
      this.aTimer = 0;
      if (this.els.a.classList.contains("long")) {
        this.els.a.classList.remove("long");
        this.els.a.querySelector("b")!.textContent = this.hasBall ? "تمرير" : "افتك";
      }
    }
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
    const same = cur.x === s.x && cur.y === s.y && cur.a === s.a && cur.b === s.b && cur.s === s.s && cur.k === s.k && !!cur.p === !!s.p;
    const anyHeld = cur.x !== 0 || cur.y !== 0 || cur.a || cur.b || !!cur.s || !!cur.k;
    const due = same ? (anyHeld ? RESEND : -1) : 0;
    if (due < 0) return;
    // button edges go out at once; only stick movement is rate-limited
    const edge = cur.a !== s.a || cur.b !== s.b || cur.s !== s.s || cur.k !== s.k || !!cur.p !== !!s.p;
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
    if (this.joy.id >= 0 || this.paused) return;
    e.preventDefault();
    const [ox, oy] = this.local(e);
    this.joy = { id: e.pointerId, ox, oy, x: 0, y: 0, sprint: false };
    try {
      this.zone.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer is already gone (a very quick tap): nothing to capture */
    }
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
    // the thumb pushed out past the ring: flat-out sprint (no sprint button to find on a phone)
    const sprint = l > R * 1.3;
    if (sprint !== this.joy.sprint) {
      this.joy.sprint = sprint;
      this.base.classList.toggle("sprint", sprint);
      if (sprint) buzz(6);
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
    this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0, sprint: false };
    this.base.classList.add("hidden");
    this.base.classList.remove("sprint");
    this.changed();
  };

  /* ---------------- keyboard */
  private keyDown = (e: KeyboardEvent) => {
    if (!this.cb) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const c = e.code;
    if (this.rebind) {
      // waiting for a new key: this one is it (Esc cancels)
      e.preventDefault();
      e.stopPropagation();
      if (c !== "Escape" && c !== "KeyH") {
        this.releaseAll();
        this.bind = bindKey(this.bind, this.rebind, c);
        saveBindings(this.bind);
      }
      this.rebind = null;
      this.renderLegend();
      return;
    }
    if (c === "KeyH") {
      if (!e.repeat) this.showLegend(!this.legendShown);
      return;
    }
    if (c === "KeyP" || c === "Escape") {
      if (!e.repeat && (this.paused || this.canPause)) {
        e.preventDefault();
        this.togglePause();
      }
      return;
    }
    if (this.paused) return;
    const act = this.bind.keys[c];
    const move = isDir(act);
    const b = isBtn(act) ? act : undefined;
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
    const act = this.bind.keys[c];
    const b = isBtn(act) ? act : undefined;
    if (b) {
      this.bkeys.delete(c);
      // e.g. both Shift keys: the button is up when neither is held
      const other = [...this.bkeys].some((k) => this.bind.keys[k] === b);
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
      // every connected pad; the one used most recently drives (two pads never fight)
      const pads = (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g && g.connected);
      const gp = pads.sort((p, q) => q.timestamp - p.timestamp)[0];
      if (gp && gp.id !== this.padName) {
        this.padName = gp.id;
        this.renderLegend();
      }
      if (!gp) {
        if (this.pad.on) {
          this.pad = { x: 0, y: 0, on: false };
          for (const id of ["a", "b", "s", "k"] as Btn[]) this.btn[id].pad = false;
          this.changed();
        }
        return;
      }
      const B = (i: number) => !!gp.buttons[i]?.pressed;
      // rebinding: the first newly pressed button takes the action
      const now = new Set<number>();
      gp.buttons.forEach((b, i) => b.pressed && now.add(i));
      if (this.rebind) {
        const fresh = [...now].find((i) => !this.padPrev.has(i));
        if (fresh !== undefined) {
          this.bind = bindPad(this.bind, this.rebind, fresh);
          saveBindings(this.bind);
          this.rebind = null;
          this.renderLegend();
        }
        this.padPrev = now;
        return;
      }
      // Start: pause / carry on
      const startNew = now.has(9) && !this.padPrev.has(9);
      this.padPrev = now;
      if (startNew) this.togglePause();
      if (this.paused) return;
      const P = (a: Act) => Object.keys(this.bind.pad).some((k) => this.bind.pad[+k] === a && B(+k));
      let x = gp.axes[0] ?? 0;
      let y = gp.axes[1] ?? 0;
      const m = Math.hypot(x, y);
      if (m < 0.22) x = y = 0;
      else {
        const v = Math.min(1, (m - 0.22) / 0.78);
        x = (x / m) * v;
        y = (y / m) * v;
      }
      const dx = (P("right") ? 1 : 0) - (P("left") ? 1 : 0);
      const dy = (P("down") ? 1 : 0) - (P("up") ? 1 : 0);
      if (dx || dy) {
        const l = Math.hypot(dx, dy);
        x = dx / l;
        y = dy / l;
      }
      x = Math.round(x * 20) / 20;
      y = Math.round(y * 20) / 20;
      const next = { a: P("a"), b: P("b"), s: P("s"), k: P("k") };
      let diff = x !== this.pad.x || y !== this.pad.y;
      for (const id of BTNS) if (this.btn[id].pad !== next[id]) diff = true;
      if (!diff) return;
      this.pad = { x, y, on: true };
      for (const id of BTNS) this.btn[id].pad = next[id];
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
    this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0, sprint: false };
    this.base.classList.add("hidden");
    this.base.classList.remove("sprint");
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
    removeEventListener("gamepaddisconnected", this.padGone);
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
