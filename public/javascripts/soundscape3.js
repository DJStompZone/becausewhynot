/**
 * Soundscape 3 — Synthwave Three.js Visualizer with Bloom and Gyro
 *
 * - WebAudio AnalyserNode -> spectrum DataTexture
 * - Custom ShaderMaterial displaces an Icosahedron along normals based on spectrum
 * - UnrealBloomPass for glow; themeable colors; mobile gyro tilt
 * - Inertia orbit + sliders for rotation speed, distortion, reactivity, geometry, bloom
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
 * Get the current palette by id.
 * @param {"synth"|"noir"|"burn"} id
 * @returns {Palette}
 */
function palette(id) {
  switch (id) {
    case "noir":
      return { base: new THREE.Color("#8a2be2"), glow: new THREE.Color("#d9b3ff"), line: new THREE.Color("#401a65"), bgTop: "#121224", bgBot: "#090a12" };
    case "burn":
      return { base: new THREE.Color("#ff6a00"), glow: new THREE.Color("#ffd19c"), line: new THREE.Color("#5a1a00"), bgTop: "#18110f", bgBot: "#0a0706" };
    case "synth":
    default:
      return { base: new THREE.Color("#a000ff"), glow: new THREE.Color("#ff2ea6"), line: new THREE.Color("#1a1033"), bgTop: "#14162a", bgBot: "#0a0b10" };
  }
}

/**
 * Clamp a number. Not for use on nipples.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Create a gradient background on the document root matching palette.
 * (Just for the aesthetic)
 * @param {Palette} pal
 */
function applyBackground(pal) {
  const el = document.querySelector(".wrap");
  if (!el) return;
  el.style.background = `radial-gradient(1200px 800px at 50% 40%, ${pal.bgTop} 0%, ${pal.bgBot} 60%, #06070b 100%)`;
}

/**
 * Go go Gadget synthwave factory
 */
class Visualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   */
  constructor(canvas, analyser) {
    this.canvas = canvas;
    this.analyser = analyser;

    // Eyehole candy init
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.5);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setClearColor("#0a0b10", 1);

    // Postprocess
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.3, 0.9, 0.85);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    
    // Theme
    this.pal = palette("synth");
    applyBackground(this.pal);

    // Math stuff (for fuckin nerds)
    this.fftBins = this.analyser.frequencyBinCount;
    this.spec = new Uint8Array(this.fftBins);
    this.specTex = new THREE.DataTexture(this.spec, this.fftBins, 1, THREE.RedFormat);
    this.specTex.needsUpdate = true;
    this.specTex.minFilter = THREE.LinearFilter;
    this.specTex.magFilter = THREE.LinearFilter;

    // Geometry stuff (for dorks)
    this.subdiv = 2;
    this.mesh = this.makeMesh(this.subdiv);
    this.scene.add(this.mesh);

    // Controls (for geeks)
    this.rotationSpeed = 0.7;
    this.reactivity = 1.0;
    this.distortion = 1.2;
    this.zoom = 1.0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.gyro = { on: false, roll: 0, pitch: 0 };

    // If a viewport resizes in the forest and no observer is around to catch it, does it emit?
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || document.body);
    this.resize();
  }

  /**
   * Techno waffle iron
   * @param {number} subdiv
   */
  makeMesh(subdiv) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    const geo = new THREE.IcosahedronGeometry(1, subdiv);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpec: { value: this.specTex },
        uReactivity: { value: this.reactivity },
        uDistortion: { value: this.distortion },
        uBaseColor: { value: this.pal.base },
        uGlowColor: { value: this.pal.glow }
      },
      vertexShader: `
        uniform sampler2D uSpec;
        uniform float uReactivity;
        uniform float uDistortion;
        attribute vec3 position;
        varying float vAmp;
        varying vec3 vPos;
        vec3 getNormal(vec3 p) { return normalize(p); }
        float sampleSpec(float t) {
          float x = clamp(t, 0.0, 1.0);
          return texture(uSpec, vec2(x, 0.5)).r;
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

    const wire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: this.pal.line, wireframe: true, transparent: true, opacity: 0.2 }));
    const group = new THREE.Group();
    const solid = new THREE.Mesh(geo, mat);
    group.add(solid);
    group.add(wire);
    this.meshGroup = group;
    return group;
  }

  /**
   * Update FFT data and the spectrum texture. Thanks, Fourier!
   * @returns {number}
   */
  updateFFT() {
    this.analyser.getByteFrequencyData(this.spec);
    let bass = 0;
    const bassBins = Math.max(8, Math.floor(this.spec.length * 0.06));
    for (let i = 0; i < bassBins; i++) bass += this.spec[i];
    bass /= bassBins * 255;
    this.specTex.needsUpdate = true;
    return bass;
  }

  /**
   * Make up your damn mind.
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
   * Beep one boop
   * @param {number} t
   */
  frame(t) {
    const time = t * 0.001;
    const bass = this.updateFFT();

    const damp = 0.12;
    this.yaw += (this.targetYaw - this.yaw) * damp;
    this.pitch += (this.targetPitch - this.pitch) * damp;
    this.pitch = clamp(this.pitch, -1.2, 1.2);

    const gyroX = this.gyro.on ? this.gyro.roll * 0.5 : 0;
    const gyroY = this.gyro.on ? this.gyro.pitch * 0.5 : 0;

    this.mesh.rotation.y += this.rotationSpeed * 0.01;
    this.mesh.rotation.x = this.pitch + gyroY * 0.3;
    this.mesh.rotation.y += this.yaw + gyroX * 0.3;

    const z = 3.5 - 0.15 * bass;
    this.camera.position.z += (z - this.camera.position.z) * 0.08;

    const solid = /** @type {THREE.Mesh} */ (this.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    mat.uniforms.uTime.value = time;
    mat.uniforms.uReactivity.value = this.reactivity;
    mat.uniforms.uDistortion.value = this.distortion;

    this.composer.render();
  }
}

/**
 * Kick the tires
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

  /** @const {string} */
  const DEFAULT_TRACK = "/audio/singularity_320k.mp3";

  /**
   * Return true if the audio element has no explicit src attribute value.
   * @param {HTMLAudioElement} el
   * @returns {boolean}
   */
  function hasEmptySrc(el) {
    const raw = el.getAttribute("src");
    return !raw || raw.trim() === "";
  }

  /**
   * Ensure the audio element points at a usable source, defaulting to DEFAULT_TRACK if none is set.
   * Does not override an existing src attribute (e.g., if you set one in Pug).
   * @param {HTMLAudioElement} el
   */
  function ensureDefaultTrack(el) {
    if (hasEmptySrc(el)) {
      el.src = DEFAULT_TRACK;
      if (stat) stat.textContent = "Loaded default: Singularity";
    }
  }

  /**
   * Create or resume the AudioContext graph.
   * Connects media element -> analyser -> destination.
   * Idempotent
   */
  /** @type {AudioContext | null} */ let actx = null;
  /** @type {AnalyserNode | null} */ let analyser = null;
  async function ensureAudio() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    src.connect(analyser).connect(actx.destination);
  }

  // Initialize audio graph and default track before building the viz.
  ensureDefaultTrack(audio);
  await ensureAudio();

  const viz = new Visualizer(canvas, /** @type {AnalyserNode} */ (analyser));

  // Pointer controls
  canvas.addEventListener("pointerdown", (e) => { viz.dragging = true; viz.lastX = e.clientX; viz.lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!viz.dragging) return;
    const dx = e.clientX - viz.lastX; const dy = e.clientY - viz.lastY;
    viz.lastX = e.clientX; viz.lastY = e.clientY;
    viz.targetYaw += dx * 0.004;
    viz.targetPitch += dy * 0.004;
  });
  canvas.addEventListener("pointerup", (e) => { viz.dragging = false; canvas.releasePointerCapture(e.pointerId); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); viz.zoom = clamp(viz.zoom * Math.exp(-e.deltaY * 0.001), 0.6, 2.5); viz.camera.position.z = 3.5 / viz.zoom; }, { passive: false });

  // UI sliders
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
    const solid = /** @type {THREE.Mesh} */ (viz.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    mat.uniforms.uBaseColor.value = viz.pal.base;
    mat.uniforms.uGlowColor.value = viz.pal.glow;
    const wire = /** @type {THREE.Mesh} */ (viz.mesh.children[1]);
    /** @type {THREE.MeshBasicMaterial} */ (wire.material).color = viz.pal.line;
  });

  // File load
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      // If user cleared the picker and no src is present, ensure default again.
      ensureDefaultTrack(audio);
      return;
    }
    const url = URL.createObjectURL(f);
    audio.src = url;
    if (stat) stat.textContent = `Loaded ${f.name}`;
  });

  // Basic error visibility
  audio.addEventListener("error", () => {
    if (stat) stat.textContent = "Audio error: check file or default track path.";
  });

  // Play
  playBtn.addEventListener("click", async () => {
    await ensureAudio();
    // If still no src (e.g., dev removed it from Pug), set default right before playing.
    ensureDefaultTrack(audio);
    try {
      await audio.play();
      if (stat) stat.textContent = "Playing";
    } catch {
      if (stat) stat.textContent = "Tap the audio control";
    }
  });

  // Tilty stuffs
  async function toggleGyro() {
    if (viz.gyro.on) {
      window.removeEventListener("deviceorientation", onDOF);
      viz.gyro.on = false; gyroBtn.dataset.on = "false"; gyroBtn.textContent = "Off"; return;
    }
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") throw new Error("Denied");
      }
      window.addEventListener("deviceorientation", onDOF);
      viz.gyro.on = true; gyroBtn.dataset.on = "true"; gyroBtn.textContent = "On";
    } catch {
      if (stat) stat.textContent = "Gyro permission denied";
    }
  }
  function onDOF(e) {
    const roll = ((e.gamma || 0) / 90) * Math.PI * 0.25;
    const pitch = ((e.beta || 0) / 180) * Math.PI * 0.25;
    viz.gyro.roll = roll;
    viz.gyro.pitch = pitch;
  }
  gyroBtn.addEventListener("click", toggleGyro);

  // Light the fires
  function loop(t) { viz.frame(t); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
})();
