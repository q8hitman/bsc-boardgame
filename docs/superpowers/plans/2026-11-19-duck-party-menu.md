# Duck Party Home Page and Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gloomy hub with the bright "نهار البطولة" home page (phone and computer layouts), rename the site Duck Party, rewrite the game descriptions, and add Google-sign-in accounts with levels, badges, per-game wins and a club leaderboard.

**Architecture:** Pure progress logic (levels, badges, merge, game of the day) in one tested module; the hub rebuilt in vanilla TS + CSS as today; Firebase (Auth + Firestore) behind one lazily loaded module so the page shows before Firebase loads; the existing local record stays the guest store and feeds the account.

**Tech Stack:** TypeScript, Vite, vanilla DOM strings, CSS; `firebase` JS SDK (modular, v11+); tests are `tsx` scripts in `tools/` printing `ok`/`FAIL` and exiting non-zero on failure (house style, see `tools/profile-sim.ts`).

**Spec:** `docs/superpowers/specs/2026-11-19-duck-party-menu-design.md`

## Global Constraints

- Site name **Duck Party** (Latin) in the logo, `<title>`, and anywhere "حفلة البط" names the site; game names unchanged.
- Arabic UI copy in Kuwaiti dialect; RTL.
- Colours: sky `#8fd8ff`, grass `#5bc236`, lower page `#fff6dc`, cards `#fffdf6`, ink `#1b1440`, sun `#ffd23f`, go `#36c26b`.
- Font: Baloo Bhaijaan 2 (already loaded in `index.html`).
- Two layouts: phone (≤ 760 px, one column) and computer (≥ 1024 px: hero + account column beside a 3-column games grid); nothing scrolls sideways at 360 px.
- Guests are never blocked: every game opens without signing in.
- Firebase loads lazily after first paint; the page works fully if Firebase fails or is offline.
- Firebase project `duck-party-c6e84`, config in `src/client/firebase-config.ts` (public web config).
- XP: +10 per game played, +25 per win. Level n needs `50·n` XP more than level n−1 (level 1 at 0 XP).
- Pawns (`assets/tokens/*`) do not appear on the home page; avatars are club characters (`CLUB` in `src/shared/football/club.ts`).
- Respect `prefers-reduced-motion` (no running ducks animation, no entrance animation).

## Review Focus

- A player with a 14+ character or empty name: chip and leaderboard rows stay one line with ellipsis; empty shows «لاعب».
- Sign-in popup blocked / closed / in-app browser: a clear message in the account sheet, the page keeps working as guest.
- Same game counted twice (reload on the end screen, two tabs): the cloud write happens only when `recordGame` actually counted it (its `seen` guard).
- Second device signing into an existing account with its own guest record: merged once, never twice.
- Firestore unreachable (offline, quota): leaderboard shows «ربعك» from the local record; no error popups.

---

### Task 1: Progress logic (levels, badges, merge, game of the day)

**Files:**
- Create: `src/client/account/progress.ts`
- Test: `tools/account-sim.ts`

**Interfaces:**
- Produces:
  - `type Stats = { games: Record<string, { played: number; won: number }>; days: string[] }` (days are `YYYY-MM-DD`)
  - `xpOf(s: Stats): number`
  - `levelOf(xp: number): { level: number; into: number; need: number; title: string }` (`into` = XP earned inside the level, `need` = XP that level needs)
  - `BADGES: { id: string; name: string; hint: string }[]` and `badgesOf(s: Stats, allGameIds: string[]): string[]`
  - `mergeStats(a: Stats, b: Stats): Stats` (sums per game, union of days, sorted)
  - `gameOfDay(date: Date, ids: string[]): string` (same id for everyone on a calendar day in Asia/Kuwait)
  - `totals(s: Stats): { played: number; wins: number }`

- [ ] **Step 1: Write `tools/account-sim.ts`** with these assertions:
  - `xpOf({games:{football:{played:3,won:1}},days:[]}) === 55`
  - `levelOf(0)` → `{level:1, into:0, need:50}`; `levelOf(49).level === 1`; `levelOf(50)` → `{level:2, into:0, need:100}`; `levelOf(150).level === 3`
  - `levelOf(0).title === "لاعب جديد"`; `levelOf(xp at level 5).title === "نجم الملعب"`
  - `badgesOf` returns `"first-win"` after 1 win, `"ten-wins"` after 10, `"all-games"` only when every id in `allGameIds` has `won ≥ 1`, `"football-10"` after 10 football games played, `"five-days"` with 5 distinct days
  - `mergeStats` adds played/won per game, keeps games only in one side, unions days without duplicates
  - `gameOfDay(new Date("2026-11-19T22:30:00Z"), ids) === gameOfDay(new Date("2026-11-20T08:00:00Z"), ids)` (both 20 Nov in Kuwait) and differs from 19 Nov 10:00Z for at least one of 7 consecutive days
- [ ] **Step 2: Run** `npx tsx tools/account-sim.ts` → fails (module missing).
- [ ] **Step 3: Implement `src/client/account/progress.ts`.** Titles every 5 levels: 1 «لاعب جديد», 5 «نجم الملعب», 10 «كابتن الفريق», 15 «أسطورة النادي». Badges (id, name): `first-win` «أول فوز», `ten-wins` «١٠ فوزات», `all-games` «فاز بكل لعبة», `football-10` «١٠ مباريات كورة», `five-days` «٥ أيام لعب». `gameOfDay`: day number of the Kuwait date (UTC+3) modulo `ids.length`, shuffled by a fixed multiplier co-prime to the length.
- [ ] **Step 4: Run** `npx tsx tools/account-sim.ts` → all `ok`, exit 0.
- [ ] **Step 5: Commit** `feat(account): progress logic (levels, badges, merge, game of the day)`.

### Task 2: Local profile carries an avatar character and play days

**Files:**
- Modify: `src/client/profile.ts`
- Test: `tools/profile-sim.ts` (extend)

**Interfaces:**
- Consumes: `Stats` from Task 1.
- Produces:
  - `Profile` gains `char: string` (club id, default `"fayzah"` when unset or not `isClubChar`)
  - `localStats(): Stats` (games from the store, plus `days` recorded by `recordGame`)
  - `recordGame(s, me): { gameId: string; won: boolean } | null` (returns what it counted, `null` when it counted nothing)
  - `onRecorded(cb: (r: { gameId: string; won: boolean }) => void): void` (listeners called after a counted game)

- [ ] **Step 1: Extend `tools/profile-sim.ts`**: `profile().char === "fayzah"` on a fresh store; `saveProfile({char:"tima"})` persists; `saveProfile({char:"nope"})` falls back to `"fayzah"` on read; `recordGame` returns `{gameId:"bowling",won:true}` the first time and `null` when called again with the same game; `onRecorded` listener fires exactly once; `localStats().days` holds today's date once after two counted games.
- [ ] **Step 2: Run** `npx tsx tools/profile-sim.ts` → new checks fail.
- [ ] **Step 3: Implement** in `profile.ts` (store `days` in the record store, ≤ 60 kept).
- [ ] **Step 4: Run** `npx tsx tools/profile-sim.ts` → all ok; `npm run typecheck` clean (controller's `recordGame` call ignores the return value).
- [ ] **Step 5: Commit** `feat(profile): avatar character, play days, recorded-game hook`.

### Task 3: Copy and name (Duck Party, game descriptions)

**Files:**
- Modify: `src/shared/catalog.ts` (tags), `index.html` (`<title>Duck Party</title>`, meta description), any visible "حفلة البط" site name (`grep -rn "حفلة البط" src index.html`), `README.md` title line
- Test: `tools/account-sim.ts` (add catalog checks)

- [ ] **Step 1: Add assertions**: each `CATALOG` tag equals the spec table (football «مباراة ٥ ضد ٥. مرّر وسدّد وافتك الكورة», pool «دخّل كراتك قبل خصمك», bowling «الكل يرمي سوا · منو يطيّح أكثر؟», hoops «سجّل ورا بعض وتولّع», golf «دخّلها بأقل ضربات», cards «خلّص ورقك وصيح كش!», island board «لوحة نجوم وألعاب صغيرة», race board «أول واحد يوصل التاج»); no `CATALOG` entry has a `badge` other than `"جديد"`.
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Update** `catalog.ts` and the site name.
- [ ] **Step 4: Run** `npx tsx tools/account-sim.ts` and `npm run typecheck` → pass; `grep -rn "حفلة البط" src index.html` → no site-name hits (game names "… البط" stay).
- [ ] **Step 5: Commit** `feat: Duck Party name, clearer game descriptions`.

### Task 4: The new home page (phone + computer)

**Files:**
- Create: `src/client/hub/hub.ts` (exports `home(app: HTMLElement, go: (q: string, key: string, extra?: [string, string]) => () => void): void`), `src/client/hub/runners.ts` (the running ducks strip)
- Modify: `src/client/main.ts` (route() calls `home` from `hub/hub.ts`; the old `home` and `editName` removed), `src/client/hub.css` (rewritten)
- Test: browser checks (Step 4) + `npm run typecheck`

**Interfaces:**
- Consumes: `levelOf`, `xpOf`, `gameOfDay`, `totals` (Task 1); `profile`, `localStats`, `gameStats`, `rivals` (Task 2); `CATALOG` (Task 3).
- Produces: elements other tasks fill: `#acct` (account chip button), `#board` (leaderboard / ربعك section), `renderBoard(rows: { name: string; char: string; wins: number; me: boolean }[] | null)` exported from `hub.ts` (`null` = show local «ربعك»).

- [ ] **Step 1: Build `hub.ts`** with the sections in spec order: account chip + trophy pill, logo «Duck Party» + tagline «ألعاب النادي · كل واحد من تلفونه», runners strip, «سوّ غرفة» / «ادخل بكود», «لعبة اليوم» card (from `gameOfDay`, with the player's record when played > 0), «كل الألعاب» tiles (every `CATALOG` entry except the one of the day), `#board` section, footer links «العب على هالجهاز» / «شاشة كبيرة». The game sheet (with friends / alone) keeps today's behaviour and routes, restyled. Avatar images: the character's idle frame from `assets/football/<char>-blue.png` shown with `object-fit`/`object-position` cropping frame 0 and `image-rendering: pixelated`.
- [ ] **Step 2: Build `runners.ts`**: 4 characters (fixed: fayzah, ahmad, tima, ali) as divs with `background: url(assets/football/extra/<char>-blue.png)` stepping frames 0–3 (`steps(4)`, 0.5 s), drifting across the grass with a ball; static frame under `prefers-reduced-motion`.
- [ ] **Step 3: Write `hub.css`**: phone layout per mockup A; at `min-width: 1024px` a two-column page (right column: account, logo, runners, buttons, leaderboard; left: «لعبة اليوم» wide card then the games grid in 3 columns), max content width 1240 px; press-down buttons (`translateY(4px)`, smaller shadow on `:active`); staggered fade-up on load; `:focus-visible` ring.
- [ ] **Step 4: Verify in the browser** (preview `duck-party`, `http://localhost:5191/`): screenshots at 390×844 and 1440×900 match mockup A's structure; no horizontal scroll at 360 px (`document.documentElement.scrollWidth <= 360`); a tile opens the sheet; «لحالك» goes to `?local&game=<id>`; «سوّ غرفة» / «ادخل بكود» still route; console has no errors.
- [ ] **Step 5: Commit** `feat(hub): Duck Party home page, phone and computer layouts`.

### Task 5: Account sheet and avatar picker (works as guest)

**Files:**
- Create: `src/client/account/sheet.ts` (exports `openAccount(): void`)
- Modify: `src/client/hub/hub.ts` (chip opens the sheet), `src/client/hub.css` (sheet styles)

**Interfaces:**
- Consumes: Tasks 1–2; `CLUB`.
- Produces: `openAccount()`; the sheet shows a sign-in area element `#acctAuth` that Task 6 fills.

- [ ] **Step 1: Build the sheet**: big avatar, editable name (≤ 14 chars, saved with `saveProfile`), level title + bar (`levelOf(xpOf(localStats()))`), per-game wins/played list for every `CATALOG` game, badges (earned bright, others dimmed with their hint), a «اختار بطتك» grid of all `CLUB` characters (tap = `saveProfile({char})`, chip updates), `#acctAuth` area (guest text «سجّل دخول عشان تنحفظ فوزاتك بكل جهاز»).
- [ ] **Step 2: Verify in the browser**: picking a character changes the chip and survives reload; a 20-character name is cut to 14; sheet scrolls on a 390×700 screen; closes on backdrop tap and Esc.
- [ ] **Step 3: Commit** `feat(account): account sheet with avatar picker, level and badges`.

### Task 6: Firebase accounts (sign-in, sync, leaderboard)

**Files:**
- Create: `src/client/firebase-config.ts`, `src/client/account/cloud.ts`, `firestore.rules`
- Modify: `package.json` (`firebase` dependency), `src/client/hub/hub.ts` (start cloud after first paint), `src/client/account/sheet.ts` (`#acctAuth` buttons), `src/client/controller/controller.ts` (nothing if `onRecorded` is used)

**Interfaces:**
- Consumes: `onRecorded`, `localStats`, `profile`, `saveProfile` (Task 2); `mergeStats`, `xpOf`, `badgesOf`, `totals` (Task 1); `renderBoard` (Task 4); `#acctAuth` (Task 5).
- Produces (all async, never throw to callers; failures logged and reported as `null`/`false`):
  - `startCloud(): void` (lazy import target; wires `onAuthStateChanged`, `onRecorded`, leaderboard)
  - `signIn(): Promise<boolean>` (popup on computers, redirect when `matchMedia("(pointer: coarse)")`)
  - `signOut(): Promise<void>`
  - `currentUser(): { uid: string; name: string } | null`

- [ ] **Step 1: `npm i firebase`** and write `firebase-config.ts` with the config the owner pasted (projectId `duck-party-c6e84`).
- [ ] **Step 2: Write `firestore.rules`**: `users/{uid}` readable by any signed-in user; create only by `request.auth.uid == uid` with `name` string ≤ 14, `char` string ≤ 24, `played`/`wins` ints ≤ 500, `games` map, `merged` list ≤ 10; update only by the owner where `wins`/`played` grow by 0 or 1 (or by any amount ≤ 500 when the write adds one new id to `merged`), `xp` equals `played*10 + wins*25`; delete denied; everything else denied.
- [ ] **Step 3: Write `cloud.ts`**: on sign-in, read `users/{uid}`; create it from `localStats()` + profile (with this device's id in `merged`) or, if it exists and this device is not in `merged`, one merge write; then mirror cloud stats into the chip/sheet. On `onRecorded` while signed in: one `updateDoc` with `increment(1)` for `played`, `games.<id>.played`, and the won fields, plus `xp` increment and `days` `arrayUnion`. Leaderboard: `query(collection(db,"users"), orderBy("wins","desc"), limit(10))` → `renderBoard`, signed out or failing → `renderBoard(null)`.
- [ ] **Step 4: Apply the rules** in the Firebase console (Firestore → Rules → paste `firestore.rules` → Publish) and confirm an unauthenticated REST read `GET https://firestore.googleapis.com/v1/projects/duck-party-c6e84/databases/(default)/documents/users` returns 403.
- [ ] **Step 5: Verify**: `npm run typecheck`, `npx tsx tools/account-sim.ts`, `npx tsx tools/profile-sim.ts` pass; built page loads with Firebase blocked (DevTools offline for `firestore.googleapis.com`) and still shows «ربعك»; the owner signs in on the test link (their own Google account; the assistant does not sign in for them) and sees their record and the leaderboard.
- [ ] **Step 6: Commit** `feat(account): Google sign-in, cloud stats, club leaderboard`.

### Task 7: Ship to the test link

- [ ] **Step 1:** `npm run build`; all sims that ran before still pass (`football-scenarios`, `football-sim`, `profile-sim`, `account-sim`).
- [ ] **Step 2:** publish `dist` to `gh-pages:/test-football` (worktree procedure), confirm the live `index-*.js` name.
- [ ] **Step 3:** screenshots at phone and computer size of the test link for the owner.
