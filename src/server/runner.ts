import type { FbFrame, FbInput } from "../shared/football/types";
import type { PoolShot } from "../shared/pool/types";
import type { SportHost } from "./sports";

/** What football and pool get from the Room: the sports host plus a way to send football frames to the room. */
export interface RunnerHost extends SportHost {
  /** football: send a position snapshot to every screen and phone in the room (not stored in the state) */
  frame(f: FbFrame): void;
}

/** A game with its own server loop (football, pool). The Room calls these; everything is ignored when it does not
 *  apply (e.g. `input` in pool, `shoot` in football). */
export interface GameRunner {
  /** the host pressed start: build the game from GameState (players, course, fbChars, fbTeams) and run it */
  start(): void;
  /** stop every timer / loop (room restart, room disposed) */
  stop(): void;
  /** the host's "skip" button: pool = end this turn, football = blow the whistle for the end of the half */
  timeUp(): void;
  /** a phone dropped mid-game: the computer plays for it */
  playFor(pid: string): void;
  /** pool: a shot from the phone whose turn it is */
  shoot(pid: string, shot: PoolShot): void;
  /** football: a phone's joystick / buttons */
  input(pid: string, input: FbInput): void;
}
