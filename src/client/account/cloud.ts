/** Accounts in the cloud (Firebase): Google sign-in, the player's record in Firestore (users/{uid}), syncing every
 *  counted game, and the club leaderboard. Loaded lazily after the page shows; when anything fails the page keeps
 *  working on this device's record (a guest). Rules: firestore.rules. */
import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut as fbSignOut, type User } from "firebase/auth";
import { arrayUnion, collection, doc, getDoc, getDocs, getFirestore, increment, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, type DocumentData } from "firebase/firestore";
import { isClubChar } from "../../shared/football/club";
import { FIREBASE_CONFIG } from "../firebase-config";
import { esc } from "../net";
import { localStats, onRecorded, profile, saveProfile } from "../profile";
import { refreshMe, renderBoard, setMeSource } from "../hub/hub";
import { kuwaitDay, mergeStats, totals, type Stats } from "./progress";
import { NAME_MAX, refreshAccount, setAuthArea, setSaver } from "./sheet";

interface UserDoc {
  name: string;
  char: string;
  xp: number;
  wins: number;
  played: number;
  games: Stats["games"];
  days: string[];
  merged: string[];
}

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
let user: User | null = null;
let data: UserDoc | null = null;
let authError = "";
let busy = false;

const log = (what: string, e: unknown) => console.warn(`[account] ${what}`, e);
const xpFor = (played: number, wins: number) => played * 10 + wins * 25;

export function currentUser(): { uid: string; name: string } | null {
  return user ? { uid: user.uid, name: data?.name ?? user.displayName ?? "" } : null;
}

/** the account's record from a Firestore document, defensively (another client wrote it) */
function fromDoc(d: DocumentData): UserDoc {
  const games: Stats["games"] = {};
  if (d.games && typeof d.games === "object")
    for (const [id, g] of Object.entries(d.games as Record<string, { played?: unknown; won?: unknown }>)) {
      games[id] = { played: Number(g?.played) || 0, won: Number(g?.won) || 0 };
    }
  return {
    name: typeof d.name === "string" ? d.name : "",
    char: typeof d.char === "string" && isClubChar(d.char) ? d.char : profile().char,
    xp: Number(d.xp) || 0,
    wins: Number(d.wins) || 0,
    played: Number(d.played) || 0,
    games,
    days: Array.isArray(d.days) ? d.days.filter((x): x is string => typeof x === "string") : [],
    merged: Array.isArray(d.merged) ? d.merged.filter((x): x is string => typeof x === "string") : [],
  };
}

/** first sign-in on this device: create the account from this device's record, or add it to the account once */
async function attach(u: User) {
  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  const dev = profile().id;
  const local = localStats();
  const lt = totals(local);
  if (!snap.exists()) {
    const p = profile();
    const t = { played: Math.min(lt.played, 500), wins: Math.min(lt.wins, lt.played, 500) };
    const fresh: UserDoc = {
      name: (p.name || u.displayName || "").trim().slice(0, NAME_MAX),
      char: p.char,
      xp: xpFor(t.played, t.wins),
      wins: t.wins,
      played: t.played,
      games: local.games,
      days: local.days.slice(-400),
      merged: [dev],
    };
    await setDoc(ref, { ...fresh, updated: serverTimestamp() });
    return fresh;
  }
  const cur = fromDoc(snap.data());
  if (cur.merged.includes(dev) || cur.merged.length >= 10) return cur;
  // this device's guest games join the account (once)
  const add = { played: Math.min(lt.played, 500), wins: Math.min(lt.wins, lt.played, 500) };
  const m = mergeStats({ games: cur.games, days: cur.days }, local);
  const next: UserDoc = {
    ...cur,
    played: cur.played + add.played,
    wins: cur.wins + add.wins,
    xp: xpFor(cur.played + add.played, cur.wins + add.wins),
    games: m.games,
    days: m.days.slice(-400),
    merged: [...cur.merged, dev],
  };
  await setDoc(ref, { ...next, updated: serverTimestamp() });
  return next;
}

/** a game this device just counted: +1 game (and +1 win) on the account */
async function push(gameId: string, won: boolean) {
  if (!user || !data) return;
  const day = kuwaitDay(new Date());
  const g = data.games[gameId] ?? { played: 0, won: 0 };
  data.games[gameId] = { played: g.played + 1, won: g.won + (won ? 1 : 0) };
  data.played++;
  if (won) data.wins++;
  data.xp = xpFor(data.played, data.wins);
  if (!data.days.includes(day)) data.days = [...data.days, day];
  refreshMe();
  try {
    await updateDoc(doc(db, "users", user.uid), {
      played: increment(1),
      wins: increment(won ? 1 : 0),
      xp: increment(won ? 35 : 10),
      [`games.${gameId}.played`]: increment(1),
      [`games.${gameId}.won`]: increment(won ? 1 : 0),
      days: arrayUnion(day),
      updated: serverTimestamp(),
    });
  } catch (e) {
    log("result not saved", e);
  }
}

async function loadBoard() {
  if (!user) return renderBoard(null);
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("wins", "desc"), limit(10)));
    const rows = snap.docs.map((d) => {
      const u = fromDoc(d.data());
      return { name: u.name, char: u.char, wins: u.wins, me: d.id === user?.uid };
    });
    renderBoard(rows.length ? rows : null);
  } catch (e) {
    log("leaderboard", e);
    renderBoard(null);
  }
}

export async function signIn(): Promise<boolean> {
  authError = "";
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try {
        await signInWithRedirect(auth, provider);
        return true;
      } catch (e2) {
        log("sign-in redirect", e2);
      }
    }
    if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request")
      authError = "ما قدرنا نسجّل دخولك. لو فاتح الموقع من واتساب أو انستقرام، افتحه بالمتصفح وجرّب مرة ثانية.";
    log("sign-in", e);
    refreshAccount();
    return false;
  }
}

export async function signOut() {
  try {
    await fbSignOut(auth);
  } catch (e) {
    log("sign-out", e);
  }
}

function fillAuth(el: HTMLElement) {
  if (user) {
    el.innerHTML = `<p>مسجّل دخول${user.email ? ` (${esc(user.email)})` : ""}. فوزاتك محفوظة بحسابك.</p>
      <button type="button" class="cta" id="acctOut">سجّل خروج</button>`;
    el.querySelector<HTMLButtonElement>("#acctOut")!.onclick = () => void signOut();
    return;
  }
  el.innerHTML = `<p>سجّل دخول عشان تنحفظ فوزاتك بكل جهاز وتطلع بترتيب النادي.</p>
    <button type="button" class="cta gold" id="acctIn">سجّل دخول بقوقل</button>${authError ? `<p class="err" role="alert">${esc(authError)}</p>` : ""}`;
  const b = el.querySelector<HTMLButtonElement>("#acctIn")!;
  b.onclick = async () => {
    if (busy) return;
    busy = true;
    b.disabled = true;
    await signIn();
    busy = false;
    b.disabled = false;
  };
}

let started = false;
export function startCloud() {
  if (started) return;
  started = true;
  setAuthArea(fillAuth);
  onRecorded((r) => void push(r.gameId, r.won));
  setSaver((p) => {
    saveProfile(p);
    if (!user || !data) return;
    if (p.name !== undefined) data.name = p.name.slice(0, NAME_MAX);
    if (p.char !== undefined && isClubChar(p.char)) data.char = p.char;
    updateDoc(doc(db, "users", user.uid), { name: data.name, char: data.char, updated: serverTimestamp() }).catch((e) => log("profile not saved", e));
  });
  getRedirectResult(auth).catch((e) => log("redirect result", e));
  onAuthStateChanged(auth, async (u) => {
    user = u;
    data = null;
    if (u) {
      try {
        data = await attach(u);
      } catch (e) {
        log("account", e);
      }
    }
    if (data) {
      const d = data;
      if (d.name && d.name !== profile().name) saveProfile({ name: d.name });
      if (d.char !== profile().char) saveProfile({ char: d.char });
      setMeSource(() => ({ name: d.name, char: d.char, stats: { games: d.games, days: d.days }, signedIn: true }));
    } else {
      setMeSource(() => {
        const p = profile();
        return { name: p.name, char: p.char, stats: localStats(), signedIn: false };
      });
    }
    refreshAccount();
    void loadBoard();
  });
}
