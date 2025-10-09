/**
 * Soundscape 3 - Interactive Music Visualizer (single entry for all routes)
 *
 * Author: DJ Stomp <DJStompZone>
 * License: MIT
 *
 * Optional data-* (reads from #player first, then <body>, then defaults):
 *   data-default-track  string  default audio URL if #player has empty/missing src
 *   data-autoplay       "true"|"false"  autoplay if allowed (default false)
 *   data-volume         "0.0".."1.0"    initial volume (default 1.0)
 *   data-palette        string  palette key to apply at boot (default "synthwave")
 *   data-title          string  explicit footer label; if omitted we derive from filename
 */

import { Visualizer } from "Visualizer";
import { loadAndBakeSTLMorph } from "Morph";
import { applyBackground, clamp, palette } from "Utility";
import { Config } from "Config";
import * as THREE from "three";

/**
 * @description Resolves a boolean-ish attribute.
 * @param {any} v
 * @returns {boolean}
 */
function parseBool(v) {
  return typeof v === "string" && v.toLowerCase() === "true";
}

/**
 * @description Clamps to [0,1] number or undefined.
 * @param {any} v
 * @returns {number|undefined}
 */
function parseVolume(v) {
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
}

/**
 * @description Gets dataset value from a preferred element, with a fallback host.
 * @param {string} name Dataset key name (without "data-")
 * @param {HTMLElement} primaryEl Primary element to check first
 * @param {HTMLElement} fallbackEl Fallback element to check second
 * @returns {string|undefined} Value if present and non-empty, else undefined
 */
function getData(name, primaryEl, fallbackEl) {
  const k = name in primaryEl.dataset ? primaryEl.dataset[name] : undefined;
  return typeof k === "string" && k.length > 0
    ? k
    : typeof fallbackEl.dataset[name] === "string" &&
      fallbackEl.dataset[name].length > 0
    ? fallbackEl.dataset[name]
    : undefined;
}

/**
 * @description Extracts a friendly name from a URL like "/audio/GoodLuckWithThat_Redux.mp3".
 * @param {string} url
 * @returns {string} Filename without extension, or original URL if invalid.
 */
function filenameLabel(url) {
  try {
    const p = new URL(url, location.href).pathname;
    const base = p.split("/").pop() || "";
    return base.replace(/\.[a-zA-Z0-9]+$/, "");
  } catch {
    return url;
  }
}

/**
 * @description Ensures an <audio> element has a source; prefer its src, else data-default-track on audio/body.
 * @param {HTMLAudioElement} audio
 * @param {HTMLElement|null} statusEl Optional status element to update with messages.
 * @returns {string} The chosen source URL, or empty string if none found.
 */
function ensureDefaultTrack(audio, statusEl) {
  const body = document.body;
  const current = audio.getAttribute("src") || "";
  if (current.trim() !== "") return current;
  const fallback = getData("defaultTrack", audio, body) || "";
  if (fallback) {
    audio.src = fallback;
    if (statusEl)
      statusEl.textContent = `Loaded default: ${filenameLabel(fallback)}`;
    return fallback;
  }
  if (statusEl) statusEl.textContent = "No audio source configured.";
  return "";
}

/**
 * @description Sets the footer text from title override or filename.
 * @param {HTMLDivElement|null} nowPlayingEl
 * @param {string|undefined} explicitTitle
 * @param {string} srcUrl
 * @return {void}
 */
function setFooter(nowPlayingEl, explicitTitle, srcUrl) {
  const title =
    explicitTitle && explicitTitle.trim() !== ""
      ? explicitTitle
      : filenameLabel(srcUrl || "");
  if (nowPlayingEl)
    nowPlayingEl.textContent = title ? `Now Playing: ${title}` : "Idle";
}

(async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (
    document.getElementById("stage")
  );
  const audio = /** @type {HTMLAudioElement} */ (
    document.getElementById("player")
  );
  const fileInput = /** @type {HTMLInputElement} */ (
    document.getElementById("file")
  );
  const rot = /** @type {HTMLInputElement} */ (document.getElementById("rot"));
  const rotv = /** @type {HTMLSpanElement} */ (document.getElementById("rotv"));
  const dist = /** @type {HTMLInputElement} */ (
    document.getElementById("dist")
  );
  const distv = /** @type {HTMLSpanElement} */ (
    document.getElementById("distv")
  );
  const react = /** @type {HTMLInputElement} */ (
    document.getElementById("react")
  );
  const reactv = /** @type {HTMLSpanElement} */ (
    document.getElementById("reactv")
  );
  const res = /** @type {HTMLInputElement} */ (document.getElementById("res"));
  const resv = /** @type {HTMLSpanElement} */ (document.getElementById("resv"));
  const bloom = /** @type {HTMLInputElement} */ (
    document.getElementById("bloom")
  );
  const bloomv = /** @type {HTMLSpanElement} */ (
    document.getElementById("bloomv")
  );
  const stat = /** @type {HTMLSpanElement} */ (document.getElementById("stat"));
  const paletteSel = /** @type {HTMLSelectElement|null} */ (
    document.getElementById("palette")
  );
  const nowPlaying = /** @type {HTMLDivElement} */ (
    document.querySelector(".footer .now-playing")
  );

  const fileLabel = document.getElementById("file-label");

  if (fileInput && fileLabel && audio) {
    fileLabel.textContent = audio.dataset.title || "Default track";

    fileInput.addEventListener("change", () => {
      if (fileInput.files.length > 0) {
        fileLabel.textContent = fileInput.files[0].name;
      }
    });
  }

  // Per-page options via data-* (audio takes precedence, then body)
  const autoplay = parseBool(
    getData("autoplay", audio, document.body) || "false"
  );
  const startVolume = parseVolume(getData("volume", audio, document.body));
  const startPalette = getData("palette", audio, document.body);
  const explicitTitle = getData("title", audio, document.body);

  var /** @type {AudioContext|null} */ actx = null;
  var /** @type {AnalyserNode|null} */ analyser = null;

  async function ensureAudioGraph() {
    if (actx) return;
    // @ts-ignore
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    src.connect(analyser).connect(actx.destination);
  }

  const chosen = ensureDefaultTrack(audio, stat);
  setFooter(nowPlaying, explicitTitle, chosen);

  await ensureAudioGraph();
  if (analyser === null) {
    if (stat) stat.textContent = "Audio initialization failed.";
    return;
  }
  const viz = new Visualizer(canvas, /** @type {AnalyserNode} */ (analyser));

  // optional palette override at boot
  if (startPalette) {
    viz.pal = palette(startPalette);
    applyBackground(viz.pal);
    const solid = /** @type {THREE.Mesh} */ (viz.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    viz.pal.base.getHSL(viz.baseHSL);
    viz.pal.glow.getHSL(viz.glowHSL);
    mat.uniforms.uBaseColor.value.copy(viz.pal.base);
    mat.uniforms.uGlowColor.value.copy(viz.pal.glow);
    viz.rebuildStarfield();
  }

  if (typeof startVolume === "number") audio.volume = startVolume;
  if (autoplay) {
    try {
      await audio.play();
    } catch {
      if (stat) stat.textContent = "Autoplay blocked; press Play.";
    }
  }

  // Precompute morph target from STL (fire-and-forget)
  loadAndBakeSTLMorph("/spikeball.stl", viz).catch((e) => console.error(e));

  // Drag rotation
  let dragging = false,
    lastX = 0,
    lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX,
      dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    viz.angVelY = clamp(
      viz.angVelY + dx * viz.dragSensitivity,
      -viz.maxOmega,
      viz.maxOmega
    );
    viz.angVelX = clamp(
      viz.angVelX + dy * viz.dragSensitivity,
      -viz.maxOmega,
      viz.maxOmega
    );
  });
  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });

  // Hue wheel
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      viz.pal.base.getHSL(viz.baseHSL);
      viz.pal.glow.getHSL(viz.glowHSL);
      let h = (viz.baseHSL.h + (e.deltaY > 0 ? -0.02 : 0.02) + 1) % 1;
      viz.pal.base.setHSL(h, viz.baseHSL.s, viz.baseHSL.l);
      h = (viz.glowHSL.h + (e.deltaY > 0 ? -0.02 : 0.02) + 1) % 1;
      viz.pal.glow.setHSL(h, viz.glowHSL.s, viz.glowHSL.l);
      const solid = /** @type {THREE.Mesh} */ (viz.mesh.children[0]);
      const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
      mat.uniforms.uBaseColor.value.copy(viz.pal.base);
      mat.uniforms.uGlowColor.value.copy(viz.pal.glow);
      applyBackground(viz.pal);
    },
    { passive: false }
  );

  // UI sliders
  /**
   *
   * @param {*} input
   * @param {*} label
   * @param {*} setter
   */
  function hookRange(input, label, setter) {
    const places =
      input.step && input.step.includes(".")
        ? input.step.split(".")[1].length
        : 0;
    const fmt = (x) => Number(x).toFixed(places);
    label.textContent = fmt(input.value);
    input.addEventListener("input", () => {
      label.textContent = fmt(input.value);
      setter(Number(input.value));
    });
  }
  hookRange(rot, rotv, (v) => {
    viz.rotationSpeed = v;
    Config.update({ mesh: { ...Config.get().mesh, rotationSpeed: v } });
  });
  hookRange(dist, distv, (v) => {
    viz.distortion = v;
    Config.update({ mesh: { ...Config.get().mesh, distortion: v } });
  });
  hookRange(react, reactv, (v) => {
    viz.reactivity = v;
    Config.update({ mesh: { ...Config.get().mesh, reactivity: v } });
  });
  hookRange(res, resv, (v) => {
    viz.subdiv = v | 0;
    viz.mesh = viz.makeMesh(viz.subdiv);
    viz.scene.add(viz.mesh);
    Config.update({ mesh: { ...Config.get().mesh, subdiv: v | 0 } });
  });
  hookRange(bloom, bloomv, (v) => {
    viz.bloomPass.strength = v;
    Config.update({ bloom: { ...Config.get().bloom, strength: v } });
  });

  // Palette select
  paletteSel?.addEventListener("change", () => {
    viz.pal = palette(paletteSel.value);
    applyBackground(viz.pal);
    const solid = /** @type {THREE.Mesh} */ (viz.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    viz.pal.base.getHSL(viz.baseHSL);
    viz.pal.glow.getHSL(viz.glowHSL);
    mat.uniforms.uBaseColor.value.copy(viz.pal.base);
    mat.uniforms.uGlowColor.value.copy(viz.pal.glow);
    viz.rebuildStarfield();
  });

  // Play UI
  function setPlayingUI(on) {
    const pb = document.getElementById("play");
    if (pb) pb.textContent = on ? "⏸ Pause" : "▶︎ Play";
    if (stat) stat.textContent = on ? "Playing" : "Paused";
  }
  function updateFooterFromAudio() {
    setFooter(
      nowPlaying,
      explicitTitle,
      audio.currentSrc || audio.src || chosen
    );
  }

  // File picker
  fileInput?.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    try {
      audio.pause();
    } catch {}
    setPlayingUI(false);
    if (actx && actx.state === "running") {
      try {
        await actx.suspend();
      } catch {}
    }
    if (!f) {
      const back = ensureDefaultTrack(audio, stat);
      updateFooterFromAudio();
      return;
    }
    const url = URL.createObjectURL(f);
    audio.src = url;
    if (stat) stat.textContent = `Loaded ${f.name}`;
    updateFooterFromAudio();
  });

  // Audio events
  audio.addEventListener("play", () => {
    setPlayingUI(true);
    updateFooterFromAudio();
  });
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("ended", () => setPlayingUI(false));
  audio.addEventListener("loadedmetadata", updateFooterFromAudio);
  audio.addEventListener("error", () => {
    if (stat)
      stat.textContent = "Audio error: check file or default track path.";
  });

  // Play button
  document.getElementById("play")?.addEventListener("click", async () => {
    ensureDefaultTrack(audio, stat);
    if (audio.paused || audio.ended) {
      if (!actx) await ensureAudioGraph();
      if (actx.state === "suspended") {
        try {
          await actx.resume();
        } catch {}
      }
      audio.muted = false;
      if (typeof startVolume === "number") audio.volume = startVolume;
      else audio.volume = 1;
      try {
        await audio.play();
      } catch {
        if (stat) stat.textContent = "Tap the audio control";
      }
    } else {
      audio.pause();
      if (actx && actx.state === "running") {
        try {
          await actx.suspend();
        } catch {}
      }
    }
  });

  // Gyro
  async function toggleGyro() {
    const btn = document.getElementById("gyro");
    if (viz.gyro.on) {
      window.removeEventListener("deviceorientation", onDOF);
      viz.gyro.on = false;
      if (btn) {
        btn.dataset.on = "false";
        btn.textContent = "Off";
      }
      return;
    }
    try {
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") throw new Error("Denied");
      }
      window.addEventListener("deviceorientation", onDOF, { passive: true });
      viz.gyro.on = true;
      if (btn) {
        btn.dataset.on = "true";
        btn.textContent = "On";
      }
    } catch {
      const s = document.getElementById("stat");
      if (s) s.textContent = "Gyro permission denied";
    }
  }
  function onDOF(e) {
    const roll = ((e.gamma || 0) / 90) * Math.PI * 0.25;
    const pitch = ((e.beta || 0) / 180) * Math.PI * 0.25;
    viz.gyro.roll = roll;
    viz.gyro.pitch = pitch;
  }
  document.getElementById("gyro")?.addEventListener("click", toggleGyro);

  // Render loop
  function loop(t) {
    viz.frame(t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
