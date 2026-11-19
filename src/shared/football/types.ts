/** كورة البط: real-time 5-a-side football. The server runs the match (src/server/football.ts with the engine in
 *  src/shared/football/engine.ts); every screen draws it from FbFrame snapshots (~15 a second) and FbState (in
 *  GameState.football, sent with the normal "state" updates when something changes: score, clock start/stop, stage).
 *
 *  Pitch coordinates are metres, origin at the centre spot. x runs along the length (goal to goal), y across
 *  (+y = towards the bottom of the screen / the camera). Team 0 (blue) attacks +x in the first half, team 1 (red)
 *  attacks -x; they swap at half time. The ball never goes out: the ad boards around the pitch bounce it back
 *  (arcade football, no throw-ins or corners). */

export const PITCH = {
  /** playing area, inside the boards */
  length: 64,
  width: 40,
  /** goal mouth width (along y) and how deep the net is (behind the goal line, along x) */
  goalWidth: 7,
  goalDepth: 2.2,
  /** crossbar height: a ball above it goes over the goal and bounces off the board behind */
  goalHeight: 2.4,
  /** penalty box: depth from the goal line and width */
  boxDepth: 10,
  boxWidth: 22,
  /** penalty spot distance from the goal line */
  penSpot: 8,
  centreRadius: 6,
};

export type FbTeam = 0 | 1;

/** One duck on the pitch. `slot` is its index in FbState.roster and in FbFrame.p. */
export interface FbPlayer {
  slot: number;
  team: FbTeam;
  /** club character id: the sprite file is /assets/football/<char>-<blue|red>.png (see CLUB in ./club.ts) */
  char: string;
  /** name over the head (the person's name for people, the character's name for the computer) */
  name: string;
  /** goalkeeper (always played by the computer) */
  gk: boolean;
  /** the room player who plays this duck (people and lobby bots). Missing = a computer team-mate. */
  pid?: string;
}

/** The match modes the host picks in the lobby (shown like golf's course picker; GameState.course holds the id). */
export const FB_MODES: { id: string; name: string; halves: 1 | 2; halfSeconds: number }[] = [
  { id: "quick", name: "سريع · ٣ دقايق", halves: 1, halfSeconds: 180 },
  { id: "full", name: "كامل · شوطين ٤+٤", halves: 2, halfSeconds: 240 },
  { id: "m2", name: "دقيقتين", halves: 1, halfSeconds: 120 },
  { id: "m5", name: "٥ دقايق", halves: 1, halfSeconds: 300 },
  { id: "m10", name: "١٠ دقايق · شوطين", halves: 2, halfSeconds: 300 },
];

export type FbStage = "kickoff" | "play" | "goal" | "halftime" | "pens" | "over";

/** Public match state, in GameState.football. Only changes a few times a minute (it rides the "state" event). */
export interface FbState {
  mode: string;
  halves: 1 | 2;
  halfSeconds: number;
  half: 1 | 2;
  /** match clock: seconds played in this half at server time `clockAt`; it is ticking when `running` */
  clock: number;
  clockAt: number;
  running: boolean;
  score: [number, number];
  roster: FbPlayer[];
  stage: FbStage;
  /** which team kicks off (or takes the next penalty) */
  kickoff: FbTeam;
  /** penalty shoot-out (full mode, level after full time): kicks taken per team, true = scored */
  pens?: { kicks: [boolean[], boolean[]]; taker: FbTeam; shooterSlot: number; keeperSlot: number };
  /** the last goal, for the banner: team that scored, the scorer's slot (-1 = own goal), server time */
  /** + how fast the ball crossed the line (m/s: a screamer bursts the net, a slow one trickles in) and how it went in */
  lastGoal?: { team: FbTeam; slot: number; at: number; speed?: number; kind?: "screamer" | "header" | "tap" | "lob" | "pen" | "own" };
  /** set at full time: the winning team, or -1 for a draw (a level one-half match) */
  result?: FbTeam | -1;
  /** room player id -> the slot they control right now (people only; switches to the duck nearest the ball) */
  control: Record<string, number>;
}

/** Everything that moves, ~15 times a second over the "fb:frame" socket event. Small on purpose. */
export interface FbFrame {
  /** server time (ms) of this snapshot; screens draw ~100 ms behind and interpolate */
  t: number;
  /** ball: x, y, z (height), owner slot (-1 = loose) */
  b: [number, number, number, number];
  /** per roster slot, 4 numbers: x, y, facing (1 = right, -1 = left), action (see FbAction) */
  p: number[];
  /** referee x, y */
  r: [number, number];
  /** room player id -> the slot they control right now (changes often: the duck nearest the ball) */
  c: Record<string, number>;
  /** what happened since the last frame, for sounds and little effects: [FbEvent, slot] pairs (slot -1 = none) */
  ev?: [number, number][];
  /** room player id -> stamina 0..1 of the duck they control (for the sprint bar); people only */
  st?: Record<string, number>;
  /** room player id -> who their pass would reach right now (slot + 100 * kind: 0 to feet, 1 through / long, 2 cross);
   *  only while they have the ball and a team-mate that way. The screens mark him. */
  pt?: Record<string, number>;
}

/** FbFrame.ev kinds */
export const FbEvent = {
  Kick: 1,
  Pass: 2,
  Tackle: 3,
  /** ball hit the post / crossbar */
  Post: 4,
  /** keeper save */
  Save: 5,
  Whistle: 6,
  /** ball in the net */
  Net: 7,
  /** ball bounced off the ad boards */
  Board: 8,
  /** a big shot leaves the boot (≥ 25 m/s): whoosh / camera shake; slot = the shooter */
  Screamer: 9,
} as const;

/** What a duck is doing, for the sprite (FbFrame.p action number): */
export const FbAction = {
  Idle: 0,
  Run: 1,
  Kick: 2,
  Slide: 3,
  /** goalkeeper dive */
  Dive: 4,
  Celebrate: 5,
  /** knocked over by a slide (a short tumble, then up again) */
  Fall: 6,
  /** a beaten keeper on his knees, head down, after conceding / losing */
  Kneel: 7,
  /** flat-out sprint (the sprint button): leaning forward, longer strides */
  Sprint: 8,
  /** first touch: controlling a pass / loose ball (a short trap) */
  Trap: 9,
  /** a dribbling skill move (feint / step-over / roulette) that beats a tackle */
  Skill: 10,
  /** a standing tackle: leaning in, then the boot reaching for the ball */
  Tackle: 11,
  /** off balance: a missed tackle, beaten by a skill move */
  Stagger: 12,
  /** leaning in before a standing tackle (the screens show a "!" over a defender about to tackle you) */
  Lean: 13,
} as const;

/** One phone's controls, sent over "fb:input" whenever they change (and at least every 250 ms while held).
 *  - x, y: joystick, -1..1 each (screen directions: +x right, +y down). The server turns it into pitch directions.
 *  - a: "تمرير" (pass) when your team has the ball; "زحلقة" (slide tackle) when it doesn't.
 *  - b: "تسديد" (shoot) — held to charge, the shot goes on release; without the ball it switches to the duck
 *       nearest the ball.
 *  Both buttons are "is it held down right now"; the server sees the press and the release. */
export interface FbInput {
  x: number;
  y: number;
  a: boolean;
  b: boolean;
  /** sprint, held (uses stamina) */
  s?: boolean;
  /** skill move, pressed: with the ball = a feint / step-over in the joystick direction; without = a quick dash */
  k?: boolean;
  /** pause (held as a state: true while the player wants the match paused). Only honoured when this person is the
   *  only one in the match (solo against the computer): the whole match stops until it is false again */
  p?: boolean;
}
