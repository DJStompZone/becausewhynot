/* ============================== Overlay ============================== */

import { clamp } from "Utility";

/**
 * Overlay with blur and progress bar.
 */
export function ensureOverlayDom() {
  let root = document.getElementById("overlay-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "overlay-root";
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.display = "none";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.backdropFilter = "blur(6px)";
  root.style.background = "rgba(0,0,0,0.35)";
  root.style.zIndex = "9999";
  root.innerHTML = `<div id="overlay-card" style="min-width:280px;max-width:70vw;background:rgba(10,10,18,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.6);padding:18px 20px;font-family:system-ui,Segoe UI,Roboto,Arial;color:#e7e7f3;">
    <div id="overlay-text" style="font-size:16px;margin-bottom:12px">Working…</div>
    <div style="height:10px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;">
      <div id="overlay-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#b57cff,#ff2ea6);"></div>
    </div>
  </div>`;
  document.body.appendChild(root);
  return root;
}export function showOverlay(text) {
  const root = ensureOverlayDom();
  root.style.display = "flex";
  const t = document.getElementById("overlay-text");
  if (t) t.textContent = text || "Working...";
  updateOverlay(0);
}
export function hideOverlay() {
  const root = ensureOverlayDom();
  root.style.display = "none";
}
export function updateOverlay(pct) {
  const bar = document.getElementById("overlay-bar");
  if (bar) bar.style.width = `${clamp(pct * 100, 0, 100)}%`;
}

