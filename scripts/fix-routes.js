/**
 * Normalizes routes in dist/ and wires BecauseWhyNot:
 * - dist/soundscape.html     -> dist/soundscape/index.html
 * - dist/victory.html        -> dist/victory/index.html
 * - dist/singularity.html    -> dist/singularity/index.html
 * - dist/index.html          -> dist/becausewhynot/index.html (alias)
 *
 * - adds _redirects rule:
 *             /BecauseWhyNot -> /becausewhynot (301)
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

async function aliasIndexToBecauseWhyNot() {
  const dist = "dist";
  const rootIndex = path.join(dist, "index.html");
  if (await exists(rootIndex)) {
    const bwnDir = path.join(dist, "becausewhynot");
    await ensureDir(bwnDir);
    await fs.copyFile(rootIndex, path.join(bwnDir, "index.html"));
    process.stdout.write("Alias created: /index.html -> /becausewhynot/index.html\n");
  }
}

async function addRedirects() {
  const redirectsPath = path.join("dist", "_redirects");
  const lines = [
    "/BecauseWhyNot   /becausewhynot   301"
  ];
  let existing = (await exists(redirectsPath)) ? await fs.readFile(redirectsPath, "utf8") : "";
  let wrote = false;
  for (const line of lines) {
    if (!existing.includes(line)) { await fs.appendFile(redirectsPath, line + "\n", "utf8"); wrote = true; }
  }
  if (wrote) process.stdout.write("Updated _redirects\n");
}

(async () => {
  await moveIntoRoute("soundscape.html", "soundscape");
  await moveIntoRoute("victory.html", "victory");
  await moveIntoRoute("singularity.html", "singularity");
  await moveIntoRoute("gravytrain.html", "gravytrain");
  await moveIntoRoute("goodluck.html", "goodluck");
  await moveIntoRoute("whiplash.html", "whiplash");
  await moveIntoRoute("cotl.html", "cotl");
  await aliasIndexToBecauseWhyNot();
  await addRedirects();
})().catch((e) => { console.error(e); process.exit(1); });
