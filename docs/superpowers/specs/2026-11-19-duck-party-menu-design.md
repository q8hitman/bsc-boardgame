# Duck Party: new main menu and accounts

## Why

The owner finds the current home page gloomy (night purple), the game cards ugly from the outside, their descriptions
unclear (football's "أعضاء النادي بالملعب · سريع أو كامل" most of all), the "اكتب اسمك" chip odd, and the Arabic
name "حفلة البط" cringe. They want an attractive, smooth menu with some creativity of my own, a real account per
person with their wins, and the site renamed **Duck Party**. The duck characters are the site's identity (pawns stay
inside board games only).

Success: someone opening the site on a phone smiles, finds a game in one glance, understands what each game is, and
sees their own duck, level and wins; signing in with Google keeps all of it across devices.

## Goals

- Rebuild the home page as mockup **A "نهار البطولة"** (picked by the owner from three:
  https://claude.ai/artifact/Mfgu6121DYtm2sqUgKRYEj).
- Rename the site to **Duck Party** (logo, page title, share text). Game names stay as they are for now.
- New, clear one-line descriptions for every game.
- Accounts: sign in with Google (Firebase Auth); profile, level, badges and per-game wins saved in Firestore and
  shown on any device; guests play without signing in.

## Non-goals

- No changes inside the games themselves, the lobby/controller screens or the local setup page (later, "the rest").
- No renaming of individual games.
- No server-checked results: wins are written by the player's own browser (see Risks).
- No paid Firebase features (Storage, backups, phone sign-in).

## Anti-goals (a failure even if it works)

- Signing in becomes a wall: a guest must be able to tap a game and play at once.
- The page is slow on a phone: the hero animation must stay light, Firebase loads after the page shows.
- Pawns or a character picker appear where the owner did not ask for them.

## Approaches

1. **Rebuild the hub in the existing vanilla TS + CSS** (`src/client/main.ts`, `hub.css`), same routes and query
   parameters, Firebase JS SDK added as a lazily loaded module. **Picked:** the whole client is vanilla TS strings,
   nothing else to learn or ship, routes and rooms keep working untouched.
2. Introduce a UI framework for the hub (React/Svelte). Rejected: a second way of building screens for one page,
   bigger bundle, no gain for this size.
3. Accounts on our own Render server with a database. Rejected: the free server sleeps, needs a database and our own
   login; Firebase's free Spark plan does auth and storage with no card and no sleeping.

## Design

### Page (top to bottom, phone first, max width ~980px on a computer)

1. **Account chip** (right) with the player's duck in a circle, name, level and a progress bar; **trophy pill** (left)
   with total wins. Tapping the chip opens the account sheet.
2. **Logo** "Duck Party" (Baloo Bhaijaan 2, yellow, thick ink outline, slight tilt) and a short Arabic tagline.
3. **Running ducks**: 4 club characters running across a grass strip with a ball, animated with their new run-cycle
   frames (sprite sheets already in `public/assets/football/extra`). Respects `prefers-reduced-motion`.
4. **Two buttons**: «سوّ غرفة» and «ادخل بكود» (same routes as today).
5. **لعبة اليوم**: one big card, the game changes every day (date-based pick, same for everyone that day), art,
   description, player count, time, your record in that game, and «العب».
6. **كل الألعاب**: two-column tiles with art, name and one-line description. A tile opens the existing bottom sheet
   (with friends / alone), restyled.
7. **ترتيب النادي** (signed-in players, top 10 by wins from Firestore); for a guest or offline: «ربعك» from the
   local record, as today.
8. Footer links: «العب على هالجهاز», «شاشة كبيرة».

Look: sky blue `#8fd8ff` top, grass `#5bc236`, cream `#fff6dc` lower page, cards `#fffdf6`, ink `#1b1440`, sun yellow
`#ffd23f`, go green `#36c26b`. Chunky ink outlines and hard drop shadows, buttons press down on tap, a short
staggered entrance when the page opens.

### Game descriptions

| Game | Line |
|---|---|
| كورة البط | مباراة ٥ ضد ٥. مرّر وسدّد وافتك الكورة |
| بلياردو البط | دخّل كراتك قبل خصمك |
| بولنق البط | الكل يرمي سوا · منو يطيّح أكثر؟ |
| سلة البط | سجّل ورا بعض وتولّع |
| قولف البط | دخّلها بأقل ضربات |
| كش! | خلّص ورقك وصيح كش! |
| جزيرة البط | لوحة نجوم وألعاب صغيرة |
| الحية والدرج | أول واحد يوصل التاج |

### Account

- **Guest** (default): the existing local profile and record (`profile.ts`) keep working; the chip says «سجّل دخول»
  under a default duck.
- **Sign in** with Google (popup on desktop, redirect on phones). On first sign-in the local record is merged into
  the account (played/won per game added), so nothing earned as a guest is lost.
- **Account sheet**: duck, name (editable), level and progress, wins/played per game, badges, sign out.
- **Level**: XP = 10 per game played + 25 per win; level n needs `50·n` more XP than level n-1. A level title every
  5 levels (e.g. «لاعب جديد», «نجم الملعب»).
- **Badges** (first set): أول فوز، ١٠ فوزات، فوز بكل لعبة، ١٠ مباريات كورة، ٥ أيام لعب.
- **Avatar duck**: proposal, see Open question.

### Firebase

- Project `duck-party-c6e84`, Spark plan; Google provider on; authorised domain `q8hitman.github.io` (+ localhost);
  Firestore `(default)` in `me-central2`, production mode.
- Config in `src/client/firebase-config.ts` (public web config, not a secret).
- Data: `users/{uid}` = `{ name, char, xp, wins, played, games: { <id>: { played, won } }, badges: [], days: [],
  updated }` (`wins` / `played` are totals, kept for ordering the leaderboard).
- Rules: anyone signed in can read `users/*` (leaderboard); a user can create/update only their own document, with
  types and sizes checked (name ≤ 14 chars). On **create** the document may carry the merged guest record (totals
  capped, e.g. ≤ 500 played); on **update** counters only grow, at most +1 played and +1 won per write.
- Leaderboard: query `users` ordered by `wins`, limit 10.
- A guest record found after the account already exists (a second phone) is merged only on that phone's first
  sign-in, through one capped "merge" write allowed when `merged` (a device id list) does not hold that device yet.
- Results: the game-end hook that already calls `recordGame` also updates the signed-in user's document.

## Risks

- Wins are written from the client, so a determined player could fake them; rules limit each write to +1 game. Fine
  for a club; a server-checked version would move writes to the Render server with the Admin SDK later.
- Firestore free quota (about 20K writes/day) is far above club use.
- Google sign-in popups are blocked in some in-app browsers (WhatsApp/Instagram); the sheet says to open in the
  browser.

## Open question (the owner's call)

- Does each account pick its duck from the 26 characters (my proposal: yes, a grid in the account sheet), or is the
  avatar fixed?

## Left to the builder

Exact spacing, animation timing, level titles beyond the first two, badge art (simple pixel icons), empty states.
