// scripts/fix-routes.js  (CommonJS so Node 18 runs it without ESM flags)
/**
 * Normalizes routes in dist/ and wires BecauseWhyNot:
 * - dist/soundscape.html -> dist/soundscape/index.html
 * - dist/victory.html    -> dist/victory/index.html
 * - dist/index.html      -> dist/becausewhynot/index.html (alias)
 * - adds _redirects rule: /BecauseWhyNot -> /becausewhynot (301)
 */
const fs = require("fs").promises;
const path = require("path");

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
async function exists(p) { try { await fs.stat(p); return true; } catch { return false; } }

async function moveIntoRoute(file, routeDir) {
  const dist = "dist";
  const src = path.join(dist, file);
  if (await exists(src)) {
    const dstDir = path.join(dist, routeDir);
    await ensureDir(dstDir);
    await fs.rename(src, path.join(dstDir, "index.html"));
    process.stdout.write(`Route normalized: ${file} -> ${routeDir}/index.html\n`);
  }
}

async function aliasIndexToBWN() {
  const dist = "dist";
  const rootIndex = path.join(dist, "index.html");
  if (await exists(rootIndex)) {
    const bwnDir = path.join(dist, "becausewhynot");
    await ensureDir(bwnDir);
    await fs.copyFile(rootIndex, path.join(bwnDir, "index.html"));
    process.stdout.write("Alias created: /index.html -> /becausewhynot/index.html\n");
  }
}

async function addRedirect() {
  const redirectsPath = path.join("dist", "_redirects");
  const rule = "/BecauseWhyNot   /becausewhynot   301\n";
  let existing = "";
  if (await exists(redirectsPath)) existing = await fs.readFile(redirectsPath, "utf8");
  if (!existing.includes("/BecauseWhyNot")) {
    await fs.appendFile(redirectsPath, rule, "utf8");
    process.stdout.write("Added redirect: /BecauseWhyNot -> /becausewhynot\n");
  }
}

(async () => {
  await moveIntoRoute("soundscape.html", "soundscape");
  await moveIntoRoute("victory.html", "victory");
  await aliasIndexToBWN();
  await addRedirect();
})().catch((e) => { console.error(e); process.exit(1); });
