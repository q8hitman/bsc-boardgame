# Duck survival show — design draft (in the style of Squid Game, our own version)

Status: DRAFT, not approved yet. Written 2026-11-21 when the user's weekly limit was nearly used up. Continue from here.

## What the user asked for (their words, summarised)
- A long game with as many players as we can fit. Players are knocked out in every game until one winner is left.
- All the games of the show, with new names. Extra tie-break games when needed.
- "Same vibe as Squid Game".
- The giant doll that turns round becomes a duck: "almost the same shape, with changes, as a clear reference". Memes in it.
- Two ways to play:
  1. Everyone at home on their own device, with a big screen that only shows the action (a projector at a club event, or a stream).
  2. Everyone at home on their own device, with no big screen.

## Limits found
- Rooms today hold at most 8 players (`MAX_PLAYERS = 8` in src/shared/data.ts). This game needs its own bigger room type.
- The server is Render's free plan: one small instance that sleeps. A test with many sockets is needed before promising a number. 30–50 players is a guess to check.
- Rights: we cannot use the show's name, logo, music, guards' look, or the doll's exact design.
  - The childhood games themselves are fine (red-light/green-light, marbles, tug of war and so on).
  - A parody nod is fine (a giant duck doll that turns its head and sings). Copying the doll's shape and outfit closely is not.
  - We design our own duck doll that people recognise as the joke without being the same character.

## Games (names are proposals, Kuwaiti flavour; user to confirm)
| # | Show game | Our name (proposal) | How it plays on a phone |
|---|-----------|---------------------|-------------------------|
| 1 | Red light, green light | «وقف يا بط!» | Hold to run, let go when the duck doll turns. Moving while it watches = out. |
| 2 | Dalgona (carve the shape) | «نقش الكعك» | Trace the shape with a finger before time runs out. Off the line = cracked = out. |
| 3 | Tug of war | «شد الحبل» | Teams tap in rhythm. The losing team falls. |
| 4 | Marbles | «التيلة» | Pairs, a guessing game (odd/even). The loser of each pair is out. |
| 5 | Glass bridge | «جسر الزجاج» | Pick left or right on each step. Wrong glass = fall. Those behind learn from it. |
| 6 | Final duel | «النزال الأخير» | Last two players, a short 1v1. |

- **Tie-breaks:** when too many players are left, or none, add a quick game such as reaction tap, memory, or musical chairs.
- **Vibe:** the count of players left on a big counter; a prize jar (piggy bank) that fills; dramatic slow music (our own); eliminations shown with a meme (no gore); dorm-hall voting between games (optional).

## Approaches (to choose)
1. **One server-run show, 2D top-down (Phaser) on every phone, big screen = spectator view.** (Recommended.)
   - Cheapest to run on phones with many players, and one code path for both modes.
2. **3D like the kart.** Looks bigger, but heavy with 30+ ducks on old phones and a lot more work per game.
3. **Turn-based / async.** Each game plays on its own and results are compared. Easy on the server, but loses the live tension.

## Open questions for the user
- How many players at once do they expect (20? 50? 100)?
- The names above: ok, or other ideas?
- What does the winner get (a title on the leaderboard, XP)?
- Duck doll design: show 2–3 sketches first.

## Next steps once approved
Load test of the server with N sockets, then the room type for big games, then game 1 («وقف يا بط!») end to end with a spectator screen.
