import type { Shot } from "../../shared/sports/types";
import type { GameState } from "../../shared/types";
import type { SportView, SportViewOpts } from "./view";

/** Temporary view while the real sport is built: scores + a tap-to-shoot button. */
export function placeholderView(root: HTMLElement, opts: SportViewOpts, title: string): SportView {
  root.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;background:#123a5c;font-weight:800"><h2 style="margin:0">${title}</h2><div id="spScore"></div><button id="spShoot" class="big-btn" style="display:none">ارمِ</button></div>`;
  let cb: ((s: Shot) => void) | null = null;
  const btn = root.querySelector<HTMLButtonElement>("#spShoot")!;
  btn.onclick = () => cb?.({ aim: 0, power: 0.5 + Math.random() * 0.5, spin: 0, start: 0 });
  return {
    render(s: GameState) {
      const sp = s.sport;
      if (!sp) return;
      root.querySelector("#spScore")!.textContent = s.players.map((p) => `${p.name}: ${sp.total[p.id] ?? 0}`).join(" · ");
    },
    anim() {},
    setInput(onShot) {
      cb = onShot;
      btn.style.display = onShot && opts.mode === "personal" ? "" : "none";
    },
    destroy() {
      root.innerHTML = "";
    },
  };
}
