import type { FbFrame, FbInput } from "../../shared/football/types";
import type { PoolShot } from "../../shared/pool/types";
import type { Shot, SportId } from "../../shared/sports/types";
import type { GameState } from "../../shared/types";

/** How a sport draws itself. One factory per sport (bowling-view.ts, golf-view.ts), loaded only when needed.
 *  - mode "screen": the projector / big screen. Shows every player (all lanes / all balls), no input.
 *  - mode "personal": one player's phone. Big view of `me()`'s own lane / ball, others small or as ghosts.
 *    With `setInput(cb)` the player shoots by dragging on the view itself. */
export interface SportViewOpts {
  mode: "screen" | "personal";
  me: () => string;
  /** play sounds (the projector, or a phone room where this phone is the only screen) */
  sound: boolean;
  /** server clock: the server's "now" in ms (football frames carry server times) */
  serverNow?: () => number;
  /** football on a phone next to a big screen: only the controller (joystick, buttons, score), no pitch */
  controllerOnly?: boolean;
}

export interface SportView {
  /** every state update (scores, lanes, phase, timer) */
  render(s: GameState): void;
  /** a fresh one-shot animation: `shot` (play s.anim.replay on that player's lane), `sportRound`, `win` */
  anim(s: GameState): void;
  /** personal mode: let the player shoot by dragging on the view (null = not now). The view sends at most one
   *  shot per call and shows the aim while dragging. */
  setInput(onShot: ((shot: Shot | PoolShot) => void) | null): void;
  /** football only: a position snapshot from the server (~15 a second) */
  fbFrame?(f: FbFrame): void;
  /** football only: show on-screen controls (joystick + two buttons; keyboard on a computer) reporting here.
   *  null = just watch. */
  setControl?(onInput: ((input: FbInput) => void) | null): void;
  destroy(): void;
}

export type SportViewFactory = (root: HTMLElement, opts: SportViewOpts) => SportView;

/** Load a sport's view (its own chunk, with three.js). */
export async function loadSportView(id: SportId): Promise<SportViewFactory> {
  if (id === "bowling") return (await import("./bowling-view")).createBowlingView;
  if (id === "hoops") return (await import("./hoops-view")).createHoopsView;
  if (id === "football") return (await import("./football-view")).createFootballView;
  if (id === "pool") return (await import("./pool-view")).createPoolView;
  return (await import("./golf-view")).createGolfView;
}
