/**
 * Soundscape 3 - Interactive Music Visualizer
 *
 * Author: DJ Stomp <DJStompZone>
 * License: MIT
 */

/**
 * @typedef {{base:THREE.Color, glow:THREE.Color, line:THREE.Color, bgTop:string, bgBot:string}} Palette
 */

import { Visualizer } from "Visualizer";
import { loadAndBakeSTLMorph } from "Morph";
import { applyBackground, clamp, palette } from "Utility";
import { Config } from "Config";

/* ============================== Bootstrap ============================== */

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
  const playBtn = /** @type {HTMLButtonElement} */ (
    document.getElementById("play")
  );
  const gyroBtn = /** @type {HTMLButtonElement} */ (
    document.getElementById("gyro")
  );
  const stat = /** @type {HTMLSpanElement} */ (document.getElementById("stat"));
  const paletteSel = /** @type {HTMLSelectElement} */ (
    document.getElementById("palette")
  );

  const DEFAULT_TRACK = "/audio/singularity_320k.mp3";
  function hasEmptySrc(el) {
    const raw = el.getAttribute("src");
    return !raw || raw.trim() === "";
  }
  function ensureDefaultTrack(el) {
    if (hasEmptySrc(el)) {
      el.src = DEFAULT_TRACK;
      stat && (stat.textContent = "Loaded default: Singularity");
    }
  }

  let actx = null,
    analyser = null;
  async function ensureAudio() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    src.connect(analyser).connect(actx.destination);
  }

  ensureDefaultTrack(audio);
  await ensureAudio();
  const viz = new Visualizer(canvas, /** @type {AnalyserNode} */ (analyser));

  // Precompute morph target from STL
  loadAndBakeSTLMorph("/spikeball.stl", viz).catch((e) => console.error(e));

  // Drag controls
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

  // Palette swap -> lights & starfields update too
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
    stat && (stat.textContent = on ? "Playing" : "Paused");
  }

  fileInput?.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    // force paused state to avoid undefined behavior mid-stream
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
      ensureDefaultTrack(audio);
      return;
    }
    const url = URL.createObjectURL(f);
    audio.src = url;
    stat && (stat.textContent = `Loaded ${f.name}`);
  });

  // Audio events
  audio.addEventListener("play", () => setPlayingUI(true));
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("ended", () => setPlayingUI(false));
  audio.addEventListener("error", () => {
    stat &&
      (stat.textContent = "Audio error: check file or default track path.");
  });

  // Play button
  document.getElementById("play")?.addEventListener("click", async () => {
    ensureDefaultTrack(audio);
    if (audio.paused || audio.ended) {
      if (!actx) await ensureAudio();
      if (actx.state === "suspended") {
        try {
          await actx.resume();
        } catch {}
      }
      audio.muted = false;
      audio.volume = 1;
      try {
        await audio.play();
      } catch {
        stat && (stat.textContent = "Tap the audio control");
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
    const gyroBtn = document.getElementById("gyro");
    if (viz.gyro.on) {
      window.removeEventListener("deviceorientation", onDOF);
      viz.gyro.on = false;
      if (gyroBtn) {
        gyroBtn.dataset.on = "false";
        gyroBtn.textContent = "Off";
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
      if (gyroBtn) {
        gyroBtn.dataset.on = "true";
        gyroBtn.textContent = "On";
      }
    } catch {
      const stat = document.getElementById("stat");
      if (stat) stat.textContent = "Gyro permission denied";
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
