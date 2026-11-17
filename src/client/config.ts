/** The game server online (Render, see render.yaml). */
export const ONLINE_URL = "https://bsc-boardgame.onrender.com";

/** Where the sockets go. GitHub Pages is only static files, so it talks to the online server; everywhere else
 *  (dev, Render, a laptop at the booth) the page and the game server share one address. */
export const serverUrl = (): string | undefined => (location.hostname.endsWith("github.io") ? ONLINE_URL : undefined);
