# كورة البط — gameplay audit (2026-11-18)

Branch `football/smooth-controls`. Read with the code: `src/shared/football/engine.ts` (simulation),
`ai.ts` (computer players), `types.ts`, `src/server/football.ts` (match flow + loop), `src/client/sports/football/`
(`scene.ts` rendering + local prediction, `controls.ts` input, `interp.ts` snapshot playback, `hud.ts`).

## 1. Architecture (what is there, and it is sound)

| Layer | Where | Notes |
|---|---|---|
| Simulation | `FbEngine.step()` fixed 30 Hz, seeded RNG, no timers | Deterministic, headless, ~0.01 ms a step. Keep. |
| Match flow | `src/server/football.ts` | intro → halves → goal → kick-off → half time → pens → end. Runs on Render, or in the browser for solo play (`local-server.ts`) through the same class. |
| Network | 15 snapshots/s (`FbFrame`), view plays ~110 ms behind and interpolates | Own duck predicted locally from the stick. |
| Rendering | Phaser 3, pixel art, `scene.ts` | Pose per action from 3 sprite strips (main, extra, moves). |
| Input | `controls.ts` | Touch joystick + buttons, keyboard, gamepad → one `FbInput {x,y,a,b,s,k}`. All three already feed the same actions. |
| Tests | `tools/football-sim.ts` | Engine + room tests, all passing. |

**No rewrite is justified**: the fixed-step deterministic engine is the right base; the problems are in the rules
inside it.

## 2. Problems found, root causes, fixes

Rounds 1–2 (already on the branch) fixed: slide limbo (ball rolled away + lock + control jump), prediction jumps around
slides, distorted rotated poses (new per-character move strips), passes into space nobody chased, instant
interceptions, over-long leads, slow rolling ball, glued defenders, label re-creation hitches.

Still open, found in this audit:

| # | Problem | Root cause | Kind |
|---|---|---|---|
| A1 | Keys and pad buttons can't be changed | `KEYS` / pad indices are constants | repair |
| A2 | Gamepad: only the first pad, no reconnect message, D-pad wins over the stick even when barely touched | `padStart` polling | repair |
| A3 | Ball "possessed" = position written every tick (spring on top of a hard set) | `glue()` sets `b.x/b.y`; physics (boards, posts) skipped while owned | **redesign** → velocity-driven ball that is integrated like a loose ball, possession lost if it gets away |
| A4 | A pass along the stick can still go to a "better scoring" mate well off the stick | `pickPass` score `cos*3 - dist*0.04 - risk`: a near mate at 60° can beat a far one at 5° | repair: direction dominates, distance only breaks ties |
| A5 | Switching play across the pitch: no long ground/lofted ball *to a mate's feet* | held A = through ball into space or cross only; `through()` scores forward progress | redesign held-A: lofted pass to the mate along the stick (any direction, full width), through ball only when that mate is running into space ahead |
| A6 | Through ball ignores defenders between | target = runner + lead, no lane check | repair: pick lob vs ground by lane obstruction |
| A7 | Shooting: no chip / lofted shot; aim only by stick-Y | `personDrive` | add chip (shoot + sprint held = lofted chip), aim from full stick |
| A8 | Keeper saves decided by a probability roll | `keeperContact` p = f(skill, speed, offset) + rng | redesign: geometric reach (can the keeper get a hand there in time?) + small skill noise |
| A9 | Switching to a team-mate on B can pick one behind the ball | `nearestOutfield` by distance only | repair: prefer goal-side / ball-ward duck |
| A10 | No development view of what the engine thinks | — | add debug overlay (`?fbdebug`, F2) |
| A11 | Most of the 36 requested scenarios have no automated test | — | add `tools/football-scenarios.ts` |
| A12 | Ball out of bounds | By design the ad boards keep it in (arcade, like many indoor-style games); no throw-ins | keep, documented |

## 3. Regression risks

- Changing possession (A3) touches pokes, slides, keeper holds, kick-offs and penalties: covered by the existing
  sim tests + new scenarios.
- Changing A/B semantics on phones: the touch buttons keep their meaning (tap A pass, hold A long ball, B shoot);
  only additions.
- Online play: the server runs the same engine; old phones running the old client still send the same `FbInput`.

## 4. Order of work

1. Input (A1, A2) 2. Ball & possession (A3) 3. Passing (A4–A6) 4. Shooting & keeper (A7, A8) 5. Switching (A9)
6. Debug overlay (A10) 7. Scenario tests (A11) 8. Full regression, build, test deploy.
