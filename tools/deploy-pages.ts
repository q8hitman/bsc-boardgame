// Publishes the one-device version to GitHub Pages: builds, then pushes dist/ to the `gh-pages` branch.
// The site: https://<user>.github.io/<repo>/  (projector + phones still needs the server: npm start)
// Usage: npx tsx tools/deploy-pages.ts
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd: string, cwd?: string) => execSync(cmd, { stdio: "inherit", cwd });
const out = (cmd: string) => execSync(cmd).toString().trim();

const remote = out("git remote get-url origin");
const sha = out("git rev-parse --short HEAD");
run("npx vite build");

const tmp = mkdtempSync(join(tmpdir(), "duck-pages-"));
try {
  cpSync("dist", tmp, { recursive: true });
  writeFileSync(join(tmp, ".nojekyll"), ""); // serve files as they are
  run("git init -q -b gh-pages", tmp);
  run("git add -A", tmp);
  run(`git -c user.name=q8hitman -c user.email=q8hitman@users.noreply.github.com commit -q -m "Publish ${sha}"`, tmp);
  run(`git push -f "${remote}" gh-pages`, tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log("published", sha);
