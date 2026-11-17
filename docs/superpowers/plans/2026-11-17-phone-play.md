# Phone Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any phone can create a room, share it, and everyone sees the whole game (board or card table) on their own phone, portrait or landscape. Projector mode stays as it is.

**Architecture:** The server can create a room with no screen (`room:create`); `state.screen` tells phones whether a projector is attached. When it is not, the controller page splits into a view area and a compact pad. The view area runs the existing `display.ts` in *phone mode*: it gets its state from the controller's socket, runs Phaser at the box's size and device resolution with a following camera, and lays out the card table from the box size.

**Tech Stack:** Vite + TypeScript, Phaser 3, socket.io, puppeteer-core for screenshots. No test runner: tests are `tsx` scripts in `tools/` that print PASS/FAIL.

**Spec:** `docs/superpowers/specs/2026-11-16-phone-play-design.md`

## Global Constraints

- All text is Arabic and RTL. The shout is "كش!", the win shot is "كش ملك!", and "مسكتك!" stays. The game name stays "كواك!".
- Card art is fixed images (360×474). Nothing is drawn with code on top of a card.
- It must work from 360 to 1366 px wide, portrait and landscape, and use `dvh` for height (iPhone Safari).
- Projector mode (`?screen`) and one-device mode on a computer must look and work exactly as today.
- The front door is GitHub Pages. On `*.github.io`, sockets go to `ONLINE_URL`. Share links are `<origin><pathname>?join=CODE`.
- A free Render server sleeps. While the socket is not connected, show "قاعد نصحّي السيرفر…" instead of a blank or broken page.
- Commit and push only when the user says so. Tasks end with a local check, not a commit.

## Review Focus

- **Host leaves the lobby to share the link** (the app goes to the background and the socket drops). They come back and must still be host, in the same seat. Covered by room-sim: a host who drops in the lobby and rejoins within 45 s stays host.
- **Turning the phone mid-game.** The board camera and the card table relayout, with nothing left off-screen. Covered by phone-shots, which resize from portrait to landscape inside one page.
- **A narrow phone (360×640).** No overlay (modal, shop, wheel, results, podium) is wider than the screen. Covered by phone-shots at 360×640, which checks every `#ui` child's rect fits the viewport.
- **6+ players at the card table.** The seat arc compresses and seats don't overlap. Covered by phone-shots, card game with 5 bots.
- **A phone in a room that has a projector.** It must keep today's pad, with no view area. Covered by room-sim (`state.screen === true` for `screen:create` rooms) plus the controller check in Task 3.

---

### Task 1: Phone rooms on the server

**Files:**
- Modify: `src/shared/types.ts` (add `GameState.screen: boolean` and the `room:create` event)
- Modify: `src/server/room.ts` (constructor option, lobby grace on leave)
- Modify: `src/server/wire.ts` (handler)
- Create: `tools/room-sim.ts`

**Interfaces:**
- Produces: `"room:create": (data: { name?: string }, cb: (res: { ok: true; code: string; playerId: string; token: string } | { ok: false; error: string }) => void) => void`
- Produces: `new Room(io, code, { screen: boolean })`, where `state.screen` is set from it. `screen:create` passes `true` and `room:create` passes `false`.
- Produces: the lobby grace. In the lobby, `leave()` marks the player `connected=false`; after `LOBBY_GRACE_MS = 45000`, if they are still disconnected, they are removed and host passes on. A rejoin with the token inside that window gets the same player back.

- [ ] **Step 1: Write `tools/room-sim.ts`.** Use fake sockets in the style of `local-server.ts` and call `wireSocket` directly. It asserts:
  - `room:create` returns ok with a 4-letter code, and the creator `isHost`.
  - That room's `state.screen === false`; a `screen:create` room's is `true`.
  - A second socket `player:join`s the code and is not host.
  - The host disconnects in the lobby, rejoins with the token after 1 s, and is still host with the same id; `players.length` stays 2.
  - With fake timers (`LOBBY_GRACE_MS` exported, overridable to 50), a host who never returns is removed and the other player becomes host.
  - It prints `PASS`.
- [ ] **Step 2:** Run `npx tsx tools/room-sim.ts`. Expected: it fails, since `room:create` doesn't exist yet.
- [ ] **Step 3:** Implement the above. `screen:resume` is unchanged.
- [ ] **Step 4:** Run `npx tsx tools/room-sim.ts` and `npx tsx tools/cards-sim.ts`. Expected: both print PASS, and `npx tsc --noEmit` is clean.

### Task 2: Front door, waking server, create and share

**Files:**
- Modify: `src/client/config.ts`
- Modify: `src/client/net.ts` (`connect()`)
- Modify: `src/client/main.ts` (home and the `?create` route)
- Modify: `src/client/style.css` (home and waking styles)
- Modify: `src/client/controller/controller.ts` (create form, waking overlay, share block in lobby)
- Modify: `src/client/controller/controller.css`
- Modify: `src/client/display/display.ts` (the projector QR keeps the pathname)

**Interfaces:**
- Produces: `serverUrl(): string | undefined`. It returns `ONLINE_URL` when `location.hostname.endsWith("github.io")`, and `undefined` (same origin) otherwise.
- Produces: `joinUrl(code: string): string` in `net.ts`, returning `${location.origin}${location.pathname}?join=${code}`. The display's QR uses it when `lanBase === location.origin`.
- Produces: `startController(root, code, local?, opts?: { create?: boolean })`.

- [ ] **Step 1: The home page.** In order:
  - Big buttons **"سوّ غرفة"** (`?create`) and **"ادخل بكود"** (`?join=`).
  - Then **"العب على هالجهاز"**.
  - Then a small link button **"شاشة كبيرة (بروجكتر)"** (`?screen`).
  - Drop the `/api/lan` probe that rewrote the box. On Pages, prewarm with `fetch(ONLINE_URL + "/api/lan", { mode: "no-cors" })`.
- [ ] **Step 2: The `?create` route.** It shows a name field and **"سوّ الغرفة"**. It emits `room:create`, then behaves exactly like a successful join: it saves the token and sets `?join=CODE` with `history.replaceState`.
- [ ] **Step 3: The waking overlay.** If the socket is not connected 1200 ms after start, or after a disconnect, show a full-screen card: the bobbing duck, "قاعد نصحّي السيرفر…", and the line "أول مرة بعد فترة تاخذ لين دقيقة". Hide it on `connect`. It does not apply in local mode.
- [ ] **Step 4: The share block.** In the lobby of a room with `!s.screen`, show the share block at the top for everyone:
  - The code, large.
  - **"شارك الرابط"**: `navigator.share({ url: joinUrl(code), title: "حفلة البط" })`, falling back to clipboard copy with "انتسخ ✓".
  - **"QR"**, which toggles a 180 px QR of `joinUrl(code)`.
- [ ] **Step 5: Verify.**
  - Run `npx tsc --noEmit`.
  - With `npm run dev`, use puppeteer to open phone A at 390×844 on `/?create`, enter a name and create.
  - Read the code, open phone B on `/?join=CODE`, and join.
  - Screenshot both lobbies to `scratchpad/`.
  - Expected: two players, A is host, and the share block is visible.

### Task 3: The phone shell (view area + compact pad)

**Files:**
- Modify: `src/client/display/display.ts`. Signature: `startDisplay(root, opts?: { phone?: boolean; me?: () => string }): Promise<{ state(s: GameState): void } | void>`. In phone mode it does not connect or create a screen; the caller feeds `state()`. The old behaviour stays the default.
- Create: `src/client/display/phone.css` (phone-mode overlay styles, all under `#stage.phone`)
- Modify: `src/client/controller/controller.ts` (the shell markup, mounting the view, and "طالع البورد" wording)
- Modify: `src/client/controller/controller.css` (`.ph` layout and compact pad)
- Modify: `src/client/local/local.ts` (1 human and `min(innerWidth, innerHeight) < 600` → use the same phone shell instead of `.lp-game`)

**Interfaces:**
- Consumes: Task 4's `new BoardView(parent, board, { fluid: true })` and Task 5's `new CardTable(root, clock, { phone: true, me })`. Until those land, phone mode passes the options through and they are ignored.
- Produces: the DOM contract `<div class="ph [land] [cards]"><div class="ph-view"></div><div class="ph-side">…pad-wrap…</div></div>`. `land` follows `matchMedia("(orientation: landscape)")`; `cards` follows `isCards(s)`.

Layout decisions:
- **Portrait:** the view is on top (flex 1) and the side is at the bottom (auto height, at most 46dvh).
- **Landscape:** the view is on the left and the side is a 300 px column on the right (RTL page, so the pad sits under the thumb of a right-handed player).
- **Lobby:** the view is hidden and the pad is full screen.
- **Waiting turns:** while it isn't your turn, the pad collapses to one row (duck at 44 px, then "دور فلان").
- **Phone overlays:**
  - Banner: a top strip.
  - Modals: 92 vw max, at most 80% of the view height, scrolling inside.
  - Dice: 110 px.
  - Player HUD (`#cards`): one horizontal row of chips at the top of the view, with the current player outlined in gold.
  - Round chip: top-left.
  - Minigame stage: fits the view.

- [ ] **Step 1:** Refactor `startDisplay` so the body of `sock.on("state")` becomes `onState(s)`, and add the phone branch. In phone mode, `fit()` sets the stage to the root size with no scaling, and `stage.classList.add("phone")`. `flyBread` uses `k = stageRect.width / stage.offsetWidth`.
- [ ] **Step 2:** In the controller, when `!local && s.screen === false` (or local phone mode), build the shell once and call `startDisplay(view, { phone: true, me })`. Every state goes to both the pad and the display.
- [ ] **Step 3:** Write `phone.css` and the `.ph` CSS.
- [ ] **Step 4: Verify.**
  - Run `npx tsc --noEmit`.
  - Load `?screen` at 1920×1080 with puppeteer before and after, and confirm the lobby screenshot is unchanged.
  - Load a local game at 390×844 and confirm the view and pad both show.

### Task 4: The fluid board (following camera, drag and pinch)

**Files:**
- Modify: `src/client/display/board.ts`

**Interfaces:**
- Produces: `new BoardView(parent, board, opts?: { fluid?: boolean })`. With `fluid`:
  - The canvas is `parent.clientWidth*dpr × parent.clientHeight*dpr`, with `dpr = min(2, devicePixelRatio)` and Phaser `scale.zoom = 1/dpr`.
  - A `ResizeObserver` calls `game.scale.resize` and re-applies the camera.
- Produces: `BoardScene.screenPos(id)` returns CSS pixels in fluid mode.
- Camera rules in fluid mode (`vw`, `vh` are the CSS size of the box):
  - `cover = max(vw/W, vh/H)`.
  - Island: `follow(id)` zooms to `max(cover, 0.62) * dpr`, and `follow(null)` and the intro zoom to `cover * dpr`, centred. `lookAt(node)` uses the follow zoom.
  - Race: `grid = 10 * cell * scale2`. `follow(null)` zooms to `min(vw, vh) / grid * dpr`, centred on the grid. `follow(id)` zooms to `max(that, 0.55) * dpr` and follows the piece, without the projector's "never zoom" rule.
- Drag pans: stop the follow, and resume on the next `follow()` call. Two-finger pinch zooms, clamped to `[cover*0.8, 1.6] * dpr`.

- [ ] **Step 1:** Implement the above; non-fluid paths stay byte-for-byte as they are.
- [ ] **Step 2: Verify.**
  - Run `npx tsc --noEmit`.
  - Take puppeteer screenshots of a local island game at 390×844 and 844×390 mid-turn: the current piece is near the centre and the token is at least 28 CSS px.
  - Do the same for snakes: the cell numbers are readable at 100% zoom.

### Task 5: The card table on the phone, "كش!" and "كش ملك!"

**Files:**
- Modify: `src/client/display/table.ts`. The geometry becomes instance fields set by `layout(w, h)`. The constructor takes `opts?: { phone?: boolean; me?: () => string }`.
- Modify: `src/client/display/table.css` (`#table.phone` overrides)
- Modify: `src/client/controller/cardpad.ts` (in the phone shell: hand fan, the two buttons, and hiding the parts the view already shows)
- Modify: `src/client/controller/controller.css`
- Modify: `src/client/display/display.ts` (the deal banner text and the win overlay)

**Interfaces:**
- Produces: on the projector, `layout()` gives today's constants exactly (CX 960, CY 520, RX 760, RY 385, CW 176).
- Phone geometry (from the box `w × h`):
  - Seats for the other players sit on an upper arc. Seat k of n−1 is at angle `π + (k+1)·π/n`, with `rx = w*0.42` and `ry = h*0.30`, centred at `(w/2, h*0.44)`.
  - My seat is a hidden anchor at `(w/2, h + 40)`, so my cards fly from the hand area.
  - `CW = clamp(w*0.24, 78, 130)`. The deck is at `(w/2 − CW*0.62, h*0.47)` and the pile at `(w/2 + CW*0.62, h*0.47)`.
  - Seat avatars are 58 px (50 in landscape) with the mini fan above them, matching the mockups.
- **"كش!" and "كش ملك!":**
  - The kwak callout and every button and hint say "كش!" instead of "كواك!".
  - On a `win` anim, every display (projector and phone) shows a full-stage gold "كش ملك!" with the winner's duck for 2.6 s, using `sfx.fanfare`.
  - The deal banner text ends with "صيح كش!".

- [ ] **Step 1:** Implement the geometry, the phone CSS and the strings. In the phone shell, cardpad hides `.cp-table` and `.cp-count`, lays the hand out as an arc across the pad, and renders the two buttons:
  - **Portrait:** "اسحب كرت" (yellow) and "كش!" (red) side by side, under the hand.
  - **Landscape:** they are stacked on the right edge, with the hand overlaying the bottom of the view (the `.ph.cards.land` pad is absolutely positioned over the view).
- [ ] **Step 2: Verify.**
  - Run `npx tsc --noEmit` and `npx tsx tools/cards-sim.ts` (PASS).
  - Take screenshots of a local card game with 5 bots at 390×844, 844×390 and 360×640.
  - Compare them to `docs/previews/27-phone-portrait.png` and `28-phone-landscape.png`.
  - Take the projector table at 1920×1080 and confirm it is unchanged apart from the strings.

### Task 6: Full check and previews

**Files:**
- Create: `tools/phone-shots.ts`. It runs puppeteer against `npm run dev` and plays local games for island, snakes and cards. At 390×844, 844×390 and 360×640 it saves screenshots at the lobby, a turn, a modal, a minigame and the end. It asserts every visible `#ui > *` and `.ph-side` child fits the viewport, and prints PASS or the offenders.
- Create: `docs/previews/29-phone-board-portrait.jpg`, `30-phone-board-landscape.jpg`, `31-phone-snakes.jpg` and `32-phone-cards.jpg`.
- Modify: `README.md` (the "على التليفون" section: create a room, share, the full view; projector for events).

- [ ] **Step 1:** Write and run `npx tsx tools/phone-shots.ts`. Expected: PASS, and the screenshots look right when opened.
- [ ] **Step 2:** Run the online flow from Task 2 with two phones through a full card game against bots, then a board game to the first minigame.
- [ ] **Step 3:** Run `npx tsc --noEmit`, `room-sim`, `cards-sim` and `check-card-art`. All pass.
