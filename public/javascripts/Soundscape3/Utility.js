import * as THREE from "three";

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}export function lerp(a, b, t) {
  return a + (b - a) * t;
}
/** UI panel backdrop (if present) */

export function applyBackground(pal) {
  const el = document.querySelector(".wrap");
  if (!el) return;
  el.style.background = `radial-gradient(1200px 800px at 50% 40%, ${pal.bgTop} 0%, ${pal.bgBot} 60%, #06070b 100%)`;
}
/* ============================== Utilities ============================== */

export function palette(id) {
  switch (id)
  {
    case "noir":
      return {
        base: new THREE.Color("#8a2be2"),
        glow: new THREE.Color("#d9b3ff"),
        line: new THREE.Color("#401a65"),
        bgTop: "#121224",
        bgBot: "#090a12",
      };
    case "burn":
      return {
        base: new THREE.Color("#ff6a00"),
        glow: new THREE.Color("#ffd19c"),
        line: new THREE.Color("#5a1a00"),
        bgTop: "#18110f",
        bgBot: "#0a0706",
      };
    case "synth":
    default:
      return {
        base: new THREE.Color("#a000ff"),
        glow: new THREE.Color("#ff2ea6"),
        line: new THREE.Color("#1a1033"),
        bgTop: "#14162a",
        bgBot: "#0a0b10",
      };
  }
}

