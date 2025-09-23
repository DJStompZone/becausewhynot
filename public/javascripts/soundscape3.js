/**
 * Soundscape 3 — Synthwave Three.js Visualizer with Bloom, Starfield, Reactive Orbit, and Bass Stellation
 *
 * - WebAudio AnalyserNode -> spectrum DataTexture (WebGL1-safe)
 * - ShaderMaterial displaces an Icosahedron (audio-reactive)
 * - UnrealBloomPass for glow
 * - Neon starfield (main + blur layer) with additive blending
 * - Bass-driven zoom; mid-driven hue shift; treble-driven orbit speed
 * - NEW: Scene radial background (black -> deep purple)
 * - NEW: Translucent core + wireframe overlay
 * - NEW: Bass-driven stellation spikes (low smoothing on bass only)
 * - Higher default subdivision; controls still rebuild geometry
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
 * Return the current palette by id.
 * @param {"synth"|"noir"|"burn"} id
 * @returns {Palette}
 */
function palette(id) {
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

/**
 * Clamp a number between lo and hi.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Linear interpolation between a and b.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Apply a radial gradient background to the sheet UI panel (not the scene).
 * @param {Palette} pal
 */
function applyBackground(pal) {
  const el = document.querySelector(".wrap");
  if (!el) return;
  el.style.background = `radial-gradient(1200px 800px at 50% 40%, ${pal.bgTop} 0%, ${pal.bgBot} 60%, #06070b 100%)`;
}

/**
 * Screen-space radial gradient texture for the scene background (black -> deep purple).
 * Cheap and WebGL1-safe.
 * @returns {THREE.Texture}
 */
function makeRadialBackgroundTexture() {
  const s = 512;
  const cvs = document.createElement("canvas");
  cvs.width = s;
  cvs.height = s;
  const ctx = cvs.getContext("2d");
  const g = ctx.createRadialGradient(
    s * 0.5,
    s * 0.5,
    s * 0.05,
    s * 0.5,
    s * 0.5,
    s * 0.7
  );
  g.addColorStop(0.0, "#000000");
  g.addColorStop(0.5, "#0a0018");
  g.addColorStop(1.0, "#1a0033");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Create a neon starfield as THREE.Points with additive blending.
 * Also supports a softer "blur" layer via size/opacity.
 * @param {number} count
 * @param {number} radius
 * @param {Palette} pal
 * @param {{size?:number, opacity?:number}} [opts]
 * @returns {{points:THREE.Points, geom:THREE.BufferGeometry, mat:THREE.PointsMaterial}}
 */
function createStarfield(count, radius, pal, opts = {}) {
  const size = opts.size ?? 0.1;
  const opacity = opts.opacity ?? 1.0;

  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);

  const glowHSL = { h: 0, s: 1, l: 0.5 };
  pal.glow.getHSL(glowHSL);

  for (let i = 0; i < count; i++) {
    const r = radius * (0.6 + 0.4 * Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    const j = i * 3;
    pos[j] = x;
    pos[j + 1] = y;
    pos[j + 2] = z;

    const h = (glowHSL.h + (Math.random() * 0.1 - 0.05) + 1) % 1;
    const s = 0.85 + Math.random() * 0.15;
    const l = 0.7 + Math.random() * 0.3;
    const c = new THREE.Color().setHSL(h, s, l);
    col[j] = c.r;
    col[j + 1] = c.g;
    col[j + 2] = c.b;
  }

  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geom, mat);
  points.renderOrder = -10;
  return { points, geom, mat };
}

/**
 * Recursively dispose geometries/materials in a Three subtree.
 * @param {THREE.Object3D} obj
 */
function disposeObject(obj) {
  obj.traverse((o) => {
    if ("isMesh" in o && o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm && mm.dispose && mm.dispose());
      else if (m && m.dispose) m.dispose();
    }
    if ("isPoints" in o && o.isPoints) {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m && m.dispose) m.dispose();
    }
  });
}

/**
 * Visualizer: wraps scene, camera, renderer, post, mesh, and starfield.
 */
class Visualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   */
  constructor(canvas, analyser) {
    this.canvas = canvas;
    this.analyser = analyser;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor("#050007", 1);
    this.scene.background = makeRadialBackgroundTexture();

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      1.35,
      0.9,
      0.85
    );
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);

    this.fftBins = this.analyser.frequencyBinCount;
    this.spec = new Uint8Array(this.fftBins);
    this.specTex = new THREE.DataTexture(
      this.spec,
      this.fftBins,
      1,
      THREE.LuminanceFormat
    );
    this.specTex.needsUpdate = true;
    this.specTex.minFilter = THREE.LinearFilter;
    this.specTex.magFilter = THREE.LinearFilter;

    this.pal = palette("synth");
    applyBackground(this.pal);

    const sfMain = createStarfield(2200, 60, this.pal, {
      size: 0.1,
      opacity: 1.0,
    });
    const sfBlur = createStarfield(2200, 60, this.pal, {
      size: 0.16,
      opacity: 0.25,
    });
    this.starfield = sfMain.points;
    this.starfieldBlur = sfBlur.points;
    this.scene.add(this.starfield);
    this.scene.add(this.starfieldBlur);

    this.subdiv = 3; // higher detail by default
    this.mesh = this.makeMesh(this.subdiv);
    this.scene.add(this.mesh);

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

    this.energy = { bass: 0, mid: 0, treble: 0, overall: 0 };
    this.smooth = { bass: 0, mid: 0, treble: 0, overall: 0 };
    this.fast = { bass: 0 }; // fast path for spikes
    this.smoothK = 0.08; // heavy smoothing for feel
    this.fastK = 0.35; // low smoothing just for bass spikes

    this.baseHSL = { h: 0, s: 1, l: 0.5 };
    this.glowHSL = { h: 0, s: 1, l: 0.5 };
    this.pal.base.getHSL(this.baseHSL);
    this.pal.glow.getHSL(this.glowHSL);

    this.orbit = { phase: 0, baseSpeed: 0.14, a: 0.55, b: 0.33 };
    this._lastTime = 0;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || document.body);
    this.resize();
  }

  /**
   * Build or rebuild the mesh with the given subdivision.
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

    // Translucent audio-reactive surface with bass stellation. WebGL1-safe.
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpec: { value: this.specTex },
        uReactivity: { value: this.reactivity },
        uDistortion: { value: this.distortion },
        uBaseColor: { value: pal.base.clone() },
        uGlowColor: { value: pal.glow.clone() },
        uBassFast: { value: 0.35 }, // fast-smoothing bass 0..1
        uSpike: { value: 1.3 }, // spike strength scalar
        uSpikeSharp: { value: 8.0 }, // spike sharpness power
      },
      vertexShader: `
        precision highp float;
        uniform sampler2D uSpec;
        uniform float uReactivity;
        uniform float uDistortion;
        uniform float uBassFast;
        uniform float uSpike;
        uniform float uSpikeSharp;
        varying float vAmp;
        varying vec3 vPos;
        varying float vCorner;

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

          // Bias displacement by band + global distortion
          float bias = 0.6 + 0.4 * pow(band, 0.5);
          p += n * amp * bias * uDistortion * 0.5;

          // "Cornerness" metric approximating stellation toward vertices.
          // For a unit normal, sum(abs(n)) peaks near corners, lower on faces/edges.
          float corner = (abs(n.x) + abs(n.y) + abs(n.z)) / 1.73205080757; // sqrt(3)
          vCorner = corner;

          // Bass-driven stellation: sharp spikes with low smoothing using uBassFast.
          float stell = pow(corner, uSpikeSharp) * uSpike * uBassFast;
          p += n * stell;

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
        varying float vCorner;

        void main() {
          vec3 col = mix(uBaseColor, uGlowColor, pow(clamp(vAmp, 0.0, 1.0), 0.8));
          float rim = smoothstep(0.2, 1.0, 1.0 - abs(vPos.z));
          col += rim * 0.25 * vec3(1.0, 0.9, 1.0);
          float scan = 0.08 * sin(140.0 * vPos.y + uTime * 2.0);
          col += scan;

          // Translucency: more opaque at corners/spikes, more see-through on flats.
          float alpha = 0.55 + 0.35 * pow(clamp(vCorner, 0.0, 1.0), 0.75);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false, // let glow and stars shine through
      blending: THREE.NormalBlending,
      wireframe: false,
    });

    // Wireframe overlay, slightly brighter and more transparent
    const wire = new THREE.Mesh(
      geo.clone(),
      new THREE.MeshBasicMaterial({
        color: pal.line,
        wireframe: true,
        transparent: true,
        opacity: 0.28,
      })
    );
    const group = new THREE.Group();
    const solid = new THREE.Mesh(geo, mat);
    group.add(solid);
    group.add(wire);
    group.renderOrder = 0;
    return group;
  }

  /**
   * Update FFT, compute band energies, with separate fast bass channel for spikes.
   */
  updateFFTAndBands() {
    this.analyser.getByteFrequencyData(this.spec);
    const N = this.spec.length;
    const avg = (lo, hi) => {
      const i0 = Math.max(0, Math.floor(lo * N));
      const i1 = Math.min(N, Math.ceil(hi * N));
      let s = 0,
        c = 0;
      for (let i = i0; i < i1; i++) {
        s += this.spec[i];
        c++;
      }
      return c ? s / (c * 255) : 0;
    };

    const bass = avg(0.001, 0.1);
    const mid = avg(0.12, 0.45);
    const treble = avg(0.45, 0.9);
    const overall = avg(0.02, 0.9);

    this.energy.bass = bass;
    this.energy.mid = mid;
    this.energy.treble = treble;
    this.energy.overall = overall;

    const k = this.smoothK;
    this.smooth.bass = lerp(this.smooth.bass, bass, k);
    this.smooth.mid = lerp(this.smooth.mid, mid, k);
    this.smooth.treble = lerp(this.smooth.treble, treble, k);
    this.smooth.overall = lerp(this.smooth.overall, overall, k);

    // fast bass for spikes
    this.fast.bass = lerp(this.fast.bass, bass, this.fastK);

    this.specTex.needsUpdate = true;
  }

  /**
   * Handle resizes, clamping DPR to sane values.
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
   * Render one animation frame.
   * @param {number} t_ms
   */
  frame(t_ms) {
    const t = t_ms * 0.001;
    const dt = this._lastTime ? Math.min(0.1, t - this._lastTime) : 0.016;
    this._lastTime = t;

    this.updateFFTAndBands();

    const damp = 0.12;
    this.yaw += (this.targetYaw - this.yaw) * damp;
    this.pitch += (this.targetPitch - this.pitch) * damp;
    this.pitch = clamp(this.pitch, -1.2, 1.2);

    const gyroX = this.gyro.on ? this.gyro.roll * 0.5 : 0;
    const gyroY = this.gyro.on ? this.gyro.pitch * 0.5 : 0;

    this.mesh.rotation.y += this.rotationSpeed * 0.01;
    this.mesh.rotation.x = this.pitch + gyroY * 0.25;
    this.mesh.rotation.y += this.yaw * 0.8 + gyroX * 0.25;

    const baseZ = 3.5 / this.zoom;
    const targetZ = baseZ - 0.7 * this.smooth.bass;
    this.camera.position.z += (targetZ - this.camera.position.z) * 0.1;

    const speed =
      this.orbit.baseSpeed +
      0.7 * this.smooth.treble +
      0.2 * this.smooth.overall;
    this.orbit.phase += dt * speed;
    const ox = this.orbit.a * Math.sin(this.orbit.phase * 0.92);
    const oy = this.orbit.b * Math.sin(this.orbit.phase * 0.63 + 1.1);
    this.camera.position.x = lerp(this.camera.position.x, ox, 0.08);
    this.camera.position.y = lerp(this.camera.position.y, oy, 0.08);
    this.camera.lookAt(0, 0, 0);

    if (this.starfield) {
      this.starfield.rotation.y += 0.002 + 0.02 * this.smooth.overall;
      this.starfield.rotation.x += 0.0005 + 0.006 * this.smooth.treble;
      const px = 0.3 * ox,
        py = 0.3 * oy;
      this.starfield.position.x = lerp(
        this.starfield.position.x || 0,
        -px,
        0.05
      );
      this.starfield.position.y = lerp(
        this.starfield.position.y || 0,
        -py,
        0.05
      );
    }
    if (this.starfieldBlur) {
      this.starfieldBlur.rotation.y += 0.002 + 0.02 * this.smooth.overall;
      this.starfieldBlur.rotation.x += 0.0005 + 0.006 * this.smooth.treble;
      const bpx = 0.55 * ox,
        bpy = 0.55 * oy;
      this.starfieldBlur.position.x = lerp(
        this.starfieldBlur.position.x || 0,
        -bpx,
        0.1
      );
      this.starfieldBlur.position.y = lerp(
        this.starfieldBlur.position.y || 0,
        -bpy,
        0.1
      );
    }

    const solid = this.mesh.children[0];
    const mat = solid.material;
    mat.uniforms.uTime.value = t;
    mat.uniforms.uReactivity.value = 0.9 + 2.6 * this.smooth.overall;
    mat.uniforms.uDistortion.value = this.distortion;
    mat.uniforms.uBassFast.value = this.fast.bass;

    const shift = this.smooth.mid * 0.45;
    const h1 = (this.baseHSL.h + shift) % 1;
    const h2 = (this.glowHSL.h + shift * 1.2) % 1;
    mat.uniforms.uBaseColor.value.setHSL(h1, this.baseHSL.s, this.baseHSL.l);
    mat.uniforms.uGlowColor.value.setHSL(h2, this.glowHSL.s, this.glowHSL.l);

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
    if (this.starfieldBlur) {
      this.scene.remove(this.starfieldBlur);
      disposeObject(this.starfieldBlur);
    }
    const sfMain = createStarfield(2200, 60, this.pal, {
      size: 0.1,
      opacity: 1.0,
    });
    const sfBlur = createStarfield(2200, 60, this.pal, {
      size: 0.16,
      opacity: 0.25,
    });
    this.starfield = sfMain.points;
    this.starfieldBlur = sfBlur.points;
    this.scene.add(this.starfield);
    this.scene.add(this.starfieldBlur);
  }
}

/**
 * Wire the page.
 */
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

  ensureDefaultTrack(audio);
  await ensureAudio();

  const viz = new Visualizer(canvas, /** @type {AnalyserNode} */ (analyser));

  canvas.addEventListener("pointerdown", (e) => {
    viz.dragging = true;
    viz.lastX = e.clientX;
    viz.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!viz.dragging) return;
    const dx = e.clientX - viz.lastX;
    const dy = e.clientY - viz.lastY;
    viz.lastX = e.clientX;
    viz.lastY = e.clientY;
    viz.targetYaw += dx * 0.002;
    viz.targetPitch += dy * 0.002;
  });
  canvas.addEventListener("pointerup", (e) => {
    viz.dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      viz.zoom = clamp(viz.zoom * Math.exp(-e.deltaY * 0.001), 0.6, 2.5);
      viz.camera.position.z = 3.5 / viz.zoom;
    },
    { passive: false }
  );

  function hookRange(input, label, setter) {
    const places = input.step.includes(".")
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
  });
  hookRange(dist, distv, (v) => {
    viz.distortion = v;
  });
  hookRange(react, reactv, (v) => {
    viz.reactivity = v;
  });
  hookRange(res, resv, (v) => {
    viz.subdiv = v | 0;
    viz.mesh = viz.makeMesh(viz.subdiv);
    viz.scene.add(viz.mesh);
  });
  hookRange(bloom, bloomv, (v) => {
    viz.bloomPass.strength = v;
  });

  paletteSel.addEventListener("change", () => {
    viz.pal = palette(paletteSel.value);
    applyBackground(viz.pal);
    const solid = viz.mesh.children[0];
    const mat = solid.material;
    viz.pal.base.getHSL(viz.baseHSL);
    viz.pal.glow.getHSL(viz.glowHSL);
    mat.uniforms.uBaseColor.value.copy(viz.pal.base);
    mat.uniforms.uGlowColor.value.copy(viz.pal.glow);
    viz.rebuildStarfield();
    const wire = viz.mesh.children[1];
    wire.material.color = viz.pal.line;
  });

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      ensureDefaultTrack(audio);
      return;
    }
    const url = URL.createObjectURL(f);
    audio.src = url;
    stat && (stat.textContent = `Loaded ${f.name}`);
  });

  function setPlayingUI(on) {
    document.getElementById("play").textContent = on ? "⏸ Pause" : "▶︎ Play";
    stat && (stat.textContent = on ? "Playing" : "Paused");
  }
  audio.addEventListener("play", () => setPlayingUI(true));
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("ended", () => setPlayingUI(false));
  audio.addEventListener("error", () => {
    stat &&
      (stat.textContent = "Audio error: check file or default track path.");
  });

  document.getElementById("play").addEventListener("click", async () => {
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

  async function toggleGyro() {
    if (viz.gyro.on) {
      window.removeEventListener("deviceorientation", onDOF);
      viz.gyro.on = false;
      gyroBtn.dataset.on = "false";
      gyroBtn.textContent = "Off";
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
      gyroBtn.dataset.on = "true";
      gyroBtn.textContent = "On";
    } catch {
      stat && (stat.textContent = "Gyro permission denied");
    }
  }
  function onDOF(e) {
    const roll = ((e.gamma || 0) / 90) * Math.PI * 0.25;
    const pitch = ((e.beta || 0) / 180) * Math.PI * 0.25;
    viz.gyro.roll = roll;
    viz.gyro.pitch = pitch;
  }
  gyroBtn.addEventListener("click", toggleGyro);

  function loop(t) {
    viz.frame(t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
