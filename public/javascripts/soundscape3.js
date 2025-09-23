/**
 * Soundscape 3 — Synthwave Three.js Visualizer with Bloom, Starfield, and Reactive Orbit
 *
 * - WebAudio AnalyserNode -> spectrum DataTexture (WebGL1-safe)
 * - Custom ShaderMaterial displaces an Icosahedron along normals based on spectrum (unchanged)
 * - UnrealBloomPass for glow
 * - NEW: Neon starfield background with additive blending
 * - NEW: Bass-driven zoom; mid-driven hue shift; treble-driven camera orbit speed
 * - NEW: Smooth, non-circular (Lissajous-ish) orbit around the object relative to the background
 * - Heavy smoothing on energies; reduced drag sensitivity
 * - Default track fallback: /audio/singularity_320k.mp3 if no file is provided and no src is set
 *
 * Author: DJ Stomp <DJStompZone>
 * License: MIT
 */

import * as THREE from "three";
import { EffectComposer } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js";

/** @typedef {{base:THREE.Color, glow:THREE.Color, line:THREE.Color, bgTop:string, bgBot:string}} Palette */

/**
 * Current palette by id.
 * @param {"synth"|"noir"|"burn"} id
 * @returns {Palette}
 */
function palette(id) {
  switch (id) {
    case "noir": return { base: new THREE.Color("#8a2be2"), glow: new THREE.Color("#d9b3ff"), line: new THREE.Color("#401a65"), bgTop: "#121224", bgBot: "#090a12" };
    case "burn": return { base: new THREE.Color("#ff6a00"), glow: new THREE.Color("#ffd19c"), line: new THREE.Color("#5a1a00"), bgTop: "#18110f", bgBot: "#0a0706" };
    case "synth":
    default: return { base: new THREE.Color("#a000ff"), glow: new THREE.Color("#ff2ea6"), line: new THREE.Color("#1a1033"), bgTop: "#14162a", bgBot: "#0a0b10" };
  }
}

/**
 * Clamp a number.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Apply radial gradient background behind the canvas UI.
 * @param {Palette} pal
 */
function applyBackground(pal) {
  const el = document.querySelector(".wrap");
  if (!el) return;
  el.style.background = `radial-gradient(1200px 800px at 50% 40%, ${pal.bgTop} 0%, ${pal.bgBot} 60%, #06070b 100%)`;
}

/**
 * Create a neon starfield as THREE.Points with additive blending.
 * @param {number} count Total stars
 * @param {number} radius Spawn radius
 * @param {Palette} pal Color seed
 * @returns {THREE.Points}
 */
function createStarfield(count, radius, pal) {
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);

  const glowHSL = { h: 0, s: 1, l: 0.5 };
  pal.glow.getHSL(glowHSL);

  for (let i = 0; i < count; i++) {
    // random point in a sphere shell for parallax depth variance
    const r = radius * (0.6 + 0.4 * Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    const j = i * 3;
    pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;

    // neon-ish colors clustered around glow hue
    const h = (glowHSL.h + (Math.random() * 0.12 - 0.06) + 1) % 1;
    const s = 0.85 + Math.random() * 0.15;
    const l = 0.55 + Math.random() * 0.35;
    const c = new THREE.Color().setHSL(h, s, l);
    col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
  }

  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({ size: 0.025, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geom, mat);
  points.renderOrder = -10;
  return points;
}

/**
 * Dispose a THREE.Object3D subtree (meshes, materials, geometries).
 * @param {THREE.Object3D} obj
 */
function disposeObject(obj) {
  obj.traverse((o) => {
    // @ts-ignore
    if (o.isMesh) {
      // @ts-ignore
      o.geometry && o.geometry.dispose();
      // @ts-ignore
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm && mm.dispose());
      else if (m && typeof m.dispose === "function") m.dispose();
    }
    // @ts-ignore
    if (o.isPoints) {
      // @ts-ignore
      o.geometry && o.geometry.dispose();
      // @ts-ignore
      o.material && typeof o.material.dispose === "function" && o.material.dispose();
    }
  });
}

/**
 * Create a screen-space radial gradient texture for the scene background.
 * Center: near-black, Edge: deep purple. Cheap and works in WebGL1.
 * @param {string} inner - CSS color at the center
 * @param {string} outer - CSS color at the edge
 * @returns {THREE.Texture}
 */
function makeRadialBackgroundTexture(inner = "#000000", outer = "#130020") {
  const s = 512;
  const cvs = document.createElement("canvas");
  cvs.width = s; cvs.height = s;
  const ctx = cvs.getContext("2d");
  const g = ctx.createRadialGradient(s * 0.5, s * 0.6, s * 0.05, s * 0.5, s * 0.6, s * 0.7);
  g.addColorStop(0.0, inner);
  g.addColorStop(1.0, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Visualizer scene wrapper.
 */
class Visualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   */
  constructor(canvas, analyser) {
    this.canvas = canvas;
    this.analyser = analyser;

    // Scene + camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.5);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setClearColor("#050007", 1);

    // Scene background: black to deep purple gradient (screen-space)
    this.scene.background = makeRadialBackgroundTexture("#000000", "#12001f");

    // Post
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.3, 0.9, 0.85);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);

    // Audio -> spectrum texture (WebGL1-safe)
    this.fftBins = this.analyser.frequencyBinCount;
    this.spec = new Uint8Array(this.fftBins);
    this.specTex = new THREE.DataTexture(this.spec, this.fftBins, 1, THREE.LuminanceFormat);
    this.specTex.needsUpdate = true;
    this.specTex.minFilter = THREE.LinearFilter;
    this.specTex.magFilter = THREE.LinearFilter;

    // Theme (must be before mesh)
    this.pal = palette("synth");
    applyBackground(this.pal);

    // Starfield behind everything
    this.starfield = createStarfield(2200, 40, this.pal);
    this.scene.add(this.starfield);

    // Mesh
    this.subdiv = 2;
    this.mesh = this.makeMesh(this.subdiv);
    this.scene.add(this.mesh);

    // Controls/state
    this.rotationSpeed = 0.7;
    this.reactivity = 1.0;
    this.distortion = 1.2;
    this.zoom = 0.7;

    this.targetYaw = 0;
    this.targetPitch = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.gyro = { on: false, roll: 0, pitch: 0 };

    // Energies with smoothing
    this.energy = { bass: 0, mid: 0, treble: 0, overall: 0 };
    this.smooth = { bass: 0, mid: 0, treble: 0, overall: 0 };
    this.smoothK = 0.03; // strong smoothing

    // Base HSLs for hue-shift
    this.baseHSL = { h: 0, s: 1, l: 0.5 };
    this.glowHSL = { h: 0, s: 1, l: 0.5 };
    this.pal.base.getHSL(this.baseHSL);
    this.pal.glow.getHSL(this.glowHSL);

    // Non-circular orbit params
    this.orbit = { phase: 0, baseSpeed: 0.14, a: 0.55, b: 0.33 };
    this._lastTime = 0;

    // Resize
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || document.body);
    this.resize();
  }

  /**
   * Build or rebuild the mesh with given subdivision.
   * @param {number} subdiv
   * @returns {THREE.Group}
   */
  makeMesh(subdiv) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeObject(this.mesh);
    }
    const geo = new THREE.IcosahedronGeometry(1, subdiv);
    const pal = this.pal || palette("synth");

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpec: { value: this.specTex },
        uReactivity: { value: this.reactivity },
        uDistortion: { value: this.distortion },
        uBaseColor: { value: pal.base },
        uGlowColor: { value: pal.glow }
      },
      // DO NOT TOUCH SHADERS (WebGL1-safe, already fixed earlier)
      vertexShader: `
        precision highp float;
        uniform sampler2D uSpec;
        uniform float uReactivity;
        uniform float uDistortion;
        varying float vAmp;
        varying vec3 vPos;
        vec3 getNormal(vec3 p) { return normalize(p); }
        float sampleSpec(float t) {
          float x = clamp(t, 0.0, 1.0);
          return texture2D(uSpec, vec2(x, 0.5)).r;
        }
        void main() {
          vec3 p = position;
          vec3 n = getNormal(p);
          float ang = atan(p.z, p.x);
          float band = fract(0.5 + ang / 6.28318530718);
          float amp = sampleSpec(band) * uReactivity;
          vAmp = amp;
          float bias = 0.6 + 0.4 * pow(band, 0.5);
          p += n * amp * bias * uDistortion * 0.5;
          vPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform vec3 uBaseColor;
        uniform vec3 uGlowColor;
        varying float vAmp;
        varying vec3 vPos;
        void main() {
          float r = length(vPos.xy);
          vec3 col = mix(uBaseColor, uGlowColor, pow(clamp(vAmp, 0.0, 1.0), 0.8));
          float rim = smoothstep(0.2, 1.0, 1.0 - abs(vPos.z));
          col += rim * 0.25 * vec3(1.0, 0.9, 1.0);
          float scan = 0.08 * sin(140.0 * vPos.y + uTime * 2.0);
          col += scan;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: false,
      wireframe: false
    });

    const wire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: pal.line, wireframe: true, transparent: true, opacity: 0.12 }));
    const group = new THREE.Group();
    const solid = new THREE.Mesh(geo, mat);
    group.add(solid);
    group.add(wire);
    group.renderOrder = 0;
    return group;
  }

  /**
   * Compute energy for a fractional bin range and update smoothed bands.
   * Ranges are fractions of [0..1] across FFT bins.
   */
  updateFFTAndBands() {
    this.analyser.getByteFrequencyData(this.spec);

    const N = this.spec.length;
    const avg = (lo, hi) => {
      const i0 = Math.max(0, Math.floor(lo * N));
      const i1 = Math.min(N, Math.ceil(hi * N));
      let s = 0, c = 0;
      for (let i = i0; i < i1; i++) { s += this.spec[i]; c++; }
      return c ? (s / (c * 255)) : 0;
    };

    // Rough bands that work across unknown sampleRates
    const bass = avg(0.001, 0.1);       // ~ <200Hz-ish
    const mid = avg(0.12, 0.45);        // ~ 300-2000Hz
    const treble = avg(0.45, 0.90);     // ~ 2k-18kHz
    const overall = avg(0.02, 0.90);

    this.energy.bass = bass;
    this.energy.mid = mid;
    this.energy.treble = treble;
    this.energy.overall = overall;

    // Heavy smoothing to feel premium
    const k = this.smoothK;
    this.smooth.bass = lerp(this.smooth.bass, bass, k);
    this.smooth.mid = lerp(this.smooth.mid, mid, k);
    this.smooth.treble = lerp(this.smooth.treble, treble, k);
    this.smooth.overall = lerp(this.smooth.overall, overall, k);

    this.specTex.needsUpdate = true;
  }

  /**
   * Resize viewport.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor(rect.width * dpr));
    const h = Math.max(2, Math.floor(rect.height * dpr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bloomPass.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /**
   * One frame.
   * @param {number} t_ms
   */
  frame(t_ms) {
    const t = t_ms * 0.001;
    const dt = this._lastTime ? Math.min(0.1, t - this._lastTime) : 0.016;
    this._lastTime = t;

    // FFT + smoothed bands
    this.updateFFTAndBands();

    // Inertia orbit (drag sensitivity toned down)
    const damp = 0.12;
    this.yaw += (this.targetYaw - this.yaw) * damp;
    this.pitch += (this.targetPitch - this.pitch) * damp;
    this.pitch = clamp(this.pitch, -1.2, 1.2);

    const gyroX = this.gyro.on ? this.gyro.roll * 0.5 : 0;
    const gyroY = this.gyro.on ? this.gyro.pitch * 0.5 : 0;

    // Object self-rotation
    this.mesh.rotation.y += this.rotationSpeed * 0.01;
    this.mesh.rotation.x = this.pitch + gyroY * 0.25; // slightly toned down
    this.mesh.rotation.y += this.yaw * 0.8 + gyroX * 0.25;

    // Bass-driven zoom
    const baseZ = 3.5 / this.zoom;
    const targetZ = baseZ - 0.9 * this.smooth.bass; // stronger bass zoom
    this.camera.position.z += (targetZ - this.camera.position.z) * 0.15;

    // Non-circular orbit around sphere, treble->speed
    const speed = this.orbit.baseSpeed + 0.70 * this.smooth.treble + 0.20 * this.smooth.overall;
    this.orbit.phase += dt * speed;
    const ox = this.orbit.a * Math.sin(this.orbit.phase * 0.92);
    const oy = this.orbit.b * Math.sin(this.orbit.phase * 0.63 + 1.1);
    this.camera.position.x = lerp(this.camera.position.x, ox, 0.08);
    this.camera.position.y = lerp(this.camera.position.y, oy, 0.08);
    this.camera.lookAt(0, 0, 0);

    // Starfield parallax + subtle spin
    if (this.starfield) {
      this.starfield.rotation.y += 0.002 + 0.02 * this.smooth.overall;
      this.starfield.rotation.x += 0.0005 + 0.006 * this.smooth.treble;
      // tiny drift for parallax
      const px = 0.3 * ox, py = 0.3 * oy;
      this.starfield.position.x = lerp(this.starfield.position.x || 0, -px, 0.05);
      this.starfield.position.y = lerp(this.starfield.position.y || 0, -py, 0.05);
    }

    // Pump shader uniforms (without touching shader code)
    const solid = /** @type {THREE.Mesh} */ (this.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    mat.uniforms.uTime.value = t;
    // Dramatically more reactive to wide-band energy
    mat.uniforms.uReactivity.value = 0.9 + 2.6 * this.smooth.overall;
    mat.uniforms.uDistortion.value = this.distortion;

    // Midrange-driven hue shift (rotate palette hues, keep S/L)
    const shift = this.smooth.mid * 0.45; // 0..~0.45
    const h1 = (this.baseHSL.h + shift) % 1;
    const h2 = (this.glowHSL.h + shift * 1.2) % 1;
    mat.uniforms.uBaseColor.value.setHSL(h1, this.baseHSL.s, this.baseHSL.l);
    mat.uniforms.uGlowColor.value.setHSL(h2, this.glowHSL.s, this.glowHSL.l);

    // Render
    this.composer.render();
  }

  /**
   * Rebuild starfield on palette change.
   */
  rebuildStarfield() {
    if (this.starfield) {
      this.scene.remove(this.starfield);
      disposeObject(this.starfield);
    }
    this.starfield = createStarfield(2200, 60, this.pal);
    this.scene.add(this.starfield);
  }
}

/**
 * Wire the page.
 */
(async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("stage"));
  const audio = /** @type {HTMLAudioElement} */ (document.getElementById("player"));
  const fileInput = /** @type {HTMLInputElement} */ (document.getElementById("file"));
  const rot = /** @type {HTMLInputElement} */ (document.getElementById("rot"));
  const rotv = /** @type {HTMLSpanElement} */ (document.getElementById("rotv"));
  const dist = /** @type {HTMLInputElement} */ (document.getElementById("dist"));
  const distv = /** @type {HTMLSpanElement} */ (document.getElementById("distv"));
  const react = /** @type {HTMLInputElement} */ (document.getElementById("react"));
  const reactv = /** @type {HTMLSpanElement} */ (document.getElementById("reactv"));
  const res = /** @type {HTMLInputElement} */ (document.getElementById("res"));
  const resv = /** @type {HTMLSpanElement} */ (document.getElementById("resv"));
  const bloom = /** @type {HTMLInputElement} */ (document.getElementById("bloom"));
  const bloomv = /** @type {HTMLSpanElement} */ (document.getElementById("bloomv"));
  const playBtn = /** @type {HTMLButtonElement} */ (document.getElementById("play"));
  const gyroBtn = /** @type {HTMLButtonElement} */ (document.getElementById("gyro"));
  const stat = /** @type {HTMLSpanElement} */ (document.getElementById("stat"));
  const paletteSel = /** @type {HTMLSelectElement} */ (document.getElementById("palette"));

  const DEFAULT_TRACK = "/audio/singularity_320k.mp3";

  /**
   * True if <audio> has no explicit src attribute.
   * @param {HTMLAudioElement} el
   */
  function hasEmptySrc(el) { const raw = el.getAttribute("src"); return !raw || raw.trim() === ""; }

  /**
   * Ensure the audio element points at a usable source, defaulting to DEFAULT_TRACK if none is set.
   * @param {HTMLAudioElement} el
   */
  function ensureDefaultTrack(el) { if (hasEmptySrc(el)) { el.src = DEFAULT_TRACK; stat && (stat.textContent = "Loaded default: Singularity"); } }

  /** @type {AudioContext | null} */ let actx = null;
  /** @type {AnalyserNode | null} */ let analyser = null;

  async function ensureAudio() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;                          // enough bins for band splits
    analyser.smoothingTimeConstant = 0.82;            // keep native smoothing, we add our own too
    src.connect(analyser).connect(actx.destination);
  }

  ensureDefaultTrack(audio);
  await ensureAudio();

  const viz = new Visualizer(canvas, /** @type {AnalyserNode} */ (analyser));

  // Pointer controls (reduced sensitivity)
  canvas.addEventListener("pointerdown", (e) => { viz.dragging = true; viz.lastX = e.clientX; viz.lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!viz.dragging) return;
    const dx = e.clientX - viz.lastX; const dy = e.clientY - viz.lastY;
    viz.lastX = e.clientX; viz.lastY = e.clientY;
    viz.targetYaw += dx * 0.002;       // half sensitivity
    viz.targetPitch += dy * 0.002;     // half sensitivity
  });
  canvas.addEventListener("pointerup", (e) => { viz.dragging = false; canvas.releasePointerCapture(e.pointerId); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); viz.zoom = clamp(viz.zoom * Math.exp(-e.deltaY * 0.001), 0.6, 2.5); viz.camera.position.z = 3.5 / viz.zoom; }, { passive: false });

  // Ranges
  function hookRange(input, label, setter) {
    const fmt = (x) => Number(x).toFixed(input.step.includes(".") ? input.step.split(".")[1].length : 0);
    label.textContent = fmt(input.value);
    input.addEventListener("input", () => { label.textContent = fmt(input.value); setter(Number(input.value)); });
  }
  hookRange(rot, rotv, (v) => { viz.rotationSpeed = v; });
  hookRange(dist, distv, (v) => { viz.distortion = v; });
  hookRange(react, reactv, (v) => { viz.reactivity = v; });
  hookRange(res, resv, (v) => { viz.subdiv = v | 0; viz.mesh = viz.makeMesh(viz.subdiv); viz.scene.add(viz.mesh); });
  hookRange(bloom, bloomv, (v) => { viz.bloomPass.strength = v; });

  // Palette
  paletteSel.addEventListener("change", () => {
    viz.pal = palette(paletteSel.value);
    applyBackground(viz.pal);
    // recolor uniforms immediately
    const solid = /** @type {THREE.Mesh} */ (viz.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    viz.pal.base.getHSL(viz.baseHSL);
    viz.pal.glow.getHSL(viz.glowHSL);
    mat.uniforms.uBaseColor.value.copy(viz.pal.base);
    mat.uniforms.uGlowColor.value.copy(viz.pal.glow);
    // rebuild starfield with new palette
    viz.rebuildStarfield();
    // update wire color
    const wire = /** @type {THREE.Mesh} */ (viz.mesh.children[1]);
    /** @type {THREE.MeshBasicMaterial} */ (wire.material).color = viz.pal.line;
  });

  // File load
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) { ensureDefaultTrack(audio); return; }
    const url = URL.createObjectURL(f);
    audio.src = url;
    stat && (stat.textContent = `Loaded ${f.name}`);
  });

  // Media events
  function setPlayingUI(on) { document.getElementById("play").textContent = on ? "⏸ Pause" : "▶︎ Play"; stat && (stat.textContent = on ? "Playing" : "Paused"); }
  audio.addEventListener("play", () => setPlayingUI(true));
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("ended", () => setPlayingUI(false));
  audio.addEventListener("error", () => { stat && (stat.textContent = "Audio error: check file or default track path."); });

  // Play/Pause toggle with AudioContext handling
  document.getElementById("play").addEventListener("click", async () => {
    ensureDefaultTrack(audio);
    if (audio.paused || audio.ended) {
      if (!actx) await ensureAudio();
      if (actx.state === "suspended") { try { await actx.resume(); } catch {} }
      audio.muted = false; audio.volume = 1;
      try { await audio.play(); } catch { stat && (stat.textContent = "Tap the audio control"); }
    } else {
      audio.pause();
      if (actx && actx.state === "running") { try { await actx.suspend(); } catch {} }
    }
  });

  // Gyro
  async function toggleGyro() {
    if (viz.gyro.on) { window.removeEventListener("deviceorientation", onDOF); viz.gyro.on = false; gyroBtn.dataset.on = "false"; gyroBtn.textContent = "Off"; return; }
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") throw new Error("Denied");
      }
      window.addEventListener("deviceorientation", onDOF);
      viz.gyro.on = true; gyroBtn.dataset.on = "true"; gyroBtn.textContent = "On";
    } catch { stat && (stat.textContent = "Gyro permission denied"); }
  }
  function onDOF(e) {
    const roll = ((e.gamma || 0) / 90) * Math.PI * 0.25;
    const pitch = ((e.beta || 0) / 180) * Math.PI * 0.25;
    viz.gyro.roll = roll;
    viz.gyro.pitch = pitch;
  }
  gyroBtn.addEventListener("click", toggleGyro);

  // Animate
  function loop(t) { viz.frame(t); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
})();
