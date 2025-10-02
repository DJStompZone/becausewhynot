import * as THREE from "three";

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
export function lerp(a, b, t) {
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
  switch (id) {
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
    case "voltage":
      return {
        base: new THREE.Color("#ff0000"),
        glow: new THREE.Color("#ffea00"),
        line: new THREE.Color("#660000"),
        bgTop: "#1a0a0a",
        bgBot: "#0b0505",
      };
    case "iron":
      return {
        base: new THREE.Color("#b0b0b0"),
        glow: new THREE.Color("#ffffff"),
        line: new THREE.Color("#303030"),
        bgTop: "#0e0e12",
        bgBot: "#050507",
      };
    case "ember":
      return {
        base: new THREE.Color("#ff4500"),
        glow: new THREE.Color("#ffa94d"),
        line: new THREE.Color("#661a00"),
        bgTop: "#1c0d05",
        bgBot: "#090503",
      };
    case "acid":
      return {
        base: new THREE.Color("#39ff14"),
        glow: new THREE.Color("#b6ffb3"),
        line: new THREE.Color("#004400"),
        bgTop: "#101812",
        bgBot: "#050805",
      };
    case "storm":
      return {
        base: new THREE.Color("#0077ff"),
        glow: new THREE.Color("#cce6ff"),
        line: new THREE.Color("#001a33"),
        bgTop: "#0a0f18",
        bgBot: "#05070b",
      };
    case "crimson":
      return {
        base: new THREE.Color("#d00030"),
        glow: new THREE.Color("#ff8095"),
        line: new THREE.Color("#400010"),
        bgTop: "#18090c",
        bgBot: "#080406",
      };
    case "grunge":
      return {
        base: new THREE.Color("#7f6000"),
        glow: new THREE.Color("#e6d96b"),
        line: new THREE.Color("#2e2500"),
        bgTop: "#12100a",
        bgBot: "#060504",
      };
    case "obsidian":
      return {
        base: new THREE.Color("#5b00ae"),
        glow: new THREE.Color("#d1a3ff"),
        line: new THREE.Color("#1a0033"),
        bgTop: "#0e0c12",
        bgBot: "#040305",
      };
    case "hellfire":
      return {
        base: new THREE.Color("#ff2200"),
        glow: new THREE.Color("#ff9933"),
        line: new THREE.Color("#660000"),
        bgTop: "#1a0b08",
        bgBot: "#080302",
      };
    case "diesel":
      return {
        base: new THREE.Color("#444444"),
        glow: new THREE.Color("#bbbbbb"),
        line: new THREE.Color("#1a1a1a"),
        bgTop: "#101010",
        bgBot: "#050505",
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
