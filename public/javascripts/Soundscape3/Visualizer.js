import * as THREE from "three";
import { EffectComposer } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Config } from "Config";
import { applyBackground, lerp, clamp, palette } from "Utility";

/* ============================== Visualizer ============================== */
/**
 * Visualizer
 *
 * High-level audio-reactive WebGL visualizer built with Three.js and postprocessing.
 * Creates a scene containing an animated, stellated icosahedron mesh with both solid
 * and wireframe ShaderMaterials driven by an FFT texture supplied by a Web Audio
 * AnalyserNode. The visualizer also manages camera motion, starfield layers,
 * bloom postprocessing, palette drift, and audio-band smoothing & gating for
 * morphology and flow effects.
 *
 * Usage:
 *   const viz = new Visualizer(canvasElement, analyserNode);
 *   // call viz.frame(t_ms) each animation frame
 *
 * @class
 *
 * @param {HTMLCanvasElement} canvas - Canvas element used to create the WebGLRenderer.
 * @param {AnalyserNode} analyser - Web Audio AnalyserNode used to populate the spectrogram buffer.
 *
 * Public properties (high level)
 * @property {THREE.Scene} scene - Three.js scene containing the mesh and starfields.
 * @property {THREE.PerspectiveCamera} camera - Camera used to render the scene.
 * @property {THREE.WebGLRenderer} renderer - WebGL renderer rendering to the provided canvas.
 * @property {EffectComposer} composer - Postprocessing composer (contains render & bloom passes).
 * @property {UnrealBloomPass} bloomPass - Bloom pass used by the composer.
 * @property {Uint8Array} spec - Byte array containing the latest FFT frequency bins (0..255).
 * @property {THREE.DataTexture} specTex - Three.js texture backed by `spec` used by shaders.
 * @property {Object} pal - Palette object used for base and glow colors (palette implementation-specific).
 * @property {THREE.Group} mesh - Group containing the solid and wireframe mesh children.
 * @property {THREE.Points} starfield - Primary starfield Points object.
 * @property {THREE.Points} starfieldBlur - Blurred/secondary starfield Points object.
 * @property {number} sampleRate - AudioContext sample rate used for freq <-> bin calculations.
 * @property {Object} energy - Raw per-band energies { bass, mid, treble, overall } in 0..1.
 * @property {Object} smooth - Smoothed versions of the per-band energies (same keys).
 * @property {Object} fast - Fast-reacting (short-time) values used for gating (e.g. fast.bass).
 * @property {Object} orbit - Orbit parameters and current phase used to move the camera.
 * @property {Object} lights - Light configuration used to drive shader intensities & directions.
 * @property {Object} liquid - Material flow/noise parameters used by the fragment shader.
 *
 * Shader uniforms
 * The mesh ShaderMaterials expose a rich uniform set including:
 * - uTime, uSpec (spectrogram texture), uReactivity, uDistortion
 * - uBaseColor, uGlowColor
 * - uKeyDir, uFillDir, uRimDir (normalized light directions)
 * - uKeyCol, uFillCol, uRimCol (light colors) and uKeyI/uFillI/uRimI (intensities)
 * - uBassFast, uSpikeStrength, uSpikeSharp, uDirs (stellation directions)
 * - uMorph (morph/blend between base and displaced geometry)
 * - uLiquid, uRoughness, uMetallic (material properties)
 * - uFlowPhase, uNoiseFreq, uNoiseAmp (flow / noise controls)
 *
 *
 * @method applyMorphTargetArray
 * @method frame
 * @method makeMesh
 * @method dispose
 * @method resize
 * @method updateFFTAndBands
 *
 * Resource management notes
 * - When makeMesh() replaces an existing mesh it will remove and dispose of the previous mesh.
 * - applyMorphTargetArray expects an array length matching the geometry's position attribute length.
 * - The class uses a ResizeObserver on the canvas container to automatically call resize().
 *
 * Implementation notes / expectations
 * - The analyser is expected to be an AudioContext AnalyserNode configured with a suitable
 *   FFT size; Visualizer uses analyser.frequencyBinCount to size the spectrogram texture.
 * - Palette, Config, createStarfield, EffectComposer, RenderPass, UnrealBloomPass, and utility
 *   helpers (clamp, lerp, smoothstepEdge, disposeObject, palette, applyBackground, etc.)
 *   are external dependencies that must be present in the runtime environment.
 * - Shaders rely on a fixed DIR_COUNT (12) stellation direction array and expect uDirs to be an array
 *   of vec3s. The vertex shader reads the spectrogram texture horizontally (uSpec at v = 0.5).
 */
export class Visualizer {
  /**
   *
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   */
  constructor(canvas, analyser) {
    // Lights
    this.canvas = canvas;
    this.analyser = analyser;

    // Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
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

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;

    // Action
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    const { strength, radius, threshold } = Config.get().bloom;
    this.baseBloomStrength = strength;
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      strength,
      radius,
      threshold
    );
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);

    // Math is fun
    const format = this.renderer.capabilities.isWebGL2
      ? THREE.RedFormat
      : THREE.AlphaFormat;

    this.fftBins = this.analyser.frequencyBinCount;
    this.spec = new Uint8Array(this.fftBins);
    this.specTex = new THREE.DataTexture(
      this.spec,
      this.fftBins,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.specTex.needsUpdate = true;
    this.specTex.minFilter = THREE.LinearFilter;
    this.specTex.magFilter = THREE.LinearFilter;

    // Pretty colors
    this.pal = palette("burn");
    applyBackground(this.pal);

    // Boldly go
    const cf = Config.get().starfield;
    const sfMain = createStarfield(cf.mainCount, cf.radius, this.pal, {
      size: cf.mainSize,
      opacity: cf.mainOpacity,
    });
    const sfBlur = createStarfield(cf.blurCount, cf.radius - 2, this.pal, {
      size: cf.blurSize,
      opacity: cf.blurOpacity,
    });
    this.starfield = sfMain.points;
    this.starfieldBlur = sfBlur.points;
    this.scene.add(this.starfield);
    this.scene.add(this.starfieldBlur);

    // Mesh > mush

    const mx = /** @type MeshConfig */ Config.get().mesh;
    this.subdiv = mx.subdiv;
    this.rotationSpeed = mx.rotationSpeed;
    this.reactivity = mx.reactivity;
    this.distortion = mx.distortion;
    this.zoom = mx.zoom;

    // Spin
    const sp = Config.get().spin;
    this.angVelX = 0;
    this.angVelY = 0;
    this.spinDamp = sp.damp;
    this.maxOmega = sp.maxOmega;
    this.dragSensitivity = sp.dragSensitivity;
    this.gyro = { on: false, roll: 0, pitch: 0 };

    // Audio analysis state
    this.energy = { bass: 0, mid: 0, treble: 0, overall: 0 };
    this.smooth = { bass: 0, mid: 0, treble: 0, overall: 0 };
    this.fast = { bass: 0 };

    // Smoothing
    const sm = Config.get().smoothing;
    this.smoothK = sm.slow;
    this.fastK = sm.fast;

    // Morph gate
    const mp = Config.get().morph;
    this.morphThreshold = mp.threshold;
    this.morphKnee = mp.knee;
    this.morphAttack = mp.attack;
    this.morphRelease = mp.release;
    this.morphEnv = mp.envInit;

    // Palette HSL cache
    this.baseHSL = { h: 0, s: 1, l: 0.5 };
    this.glowHSL = { h: 0, s: 1, l: 0.5 };
    this.pal.base.getHSL(this.baseHSL);
    this.pal.glow.getHSL(this.glowHSL);

    // Orbit
    this.orbit = {
      phase: 0,
      baseSpeed: Config.get().orbit.baseSpeed,
      a: Config.get().orbit.a,
      b: Config.get().orbit.b,
    };
    this._lastTime = 0;

    this.sampleRate = /** @type {AudioContext} */ (
      this.analyser.context
    ).sampleRate;

    this.lights = Config.get().lights;
    this.liquid = { ...Config.get().liquid };

    // Flow smoothing
    this.flowSpeed = this.liquid.flow;
    this.flowPhase = 0;

    this.mesh = this.makeMesh(this.subdiv);
    this.scene.add(this.mesh);

    // Size does matter
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || document.body);
    this.resize();
  }

  /**
   * @method makeMesh
   * @param {number} subdiv - Icosahedron subdivision level used to create the base geometry.
   * @returns {THREE.Group} group - Group containing the solid and wireframe mesh instances. Internally
   *   sets up a "target" attribute used for morphing/stellation and creates ShaderMaterials that
   *   reference the visualizer's spectrogram texture and other uniforms.
   */
  makeMesh(subdiv) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeObject(this.mesh);
    }

    const geo = new THREE.IcosahedronGeometry(1, subdiv);
    const targetAttr = new THREE.Float32BufferAttribute(
      new Float32Array(geo.attributes.position.array.length),
      3
    );
    geo.setAttribute("target", targetAttr);

    const pal = this.pal || palette("synth");

    const PHI = (1 + Math.sqrt(5)) / 2;
    const dirs = [
      [0, 1, PHI],
      [0, -1, PHI],
      [0, 1, -PHI],
      [0, -1, -PHI],
      [1, PHI, 0],
      [-1, PHI, 0],
      [1, -PHI, 0],
      [-1, -PHI, 0],
      [PHI, 0, 1],
      [-PHI, 0, 1],
      [PHI, 0, -1],
      [-PHI, 0, -1],
    ].map((v) => new THREE.Vector3(v[0], v[1], v[2]).normalize());
    this._stellationDirs = dirs;

    const L = this.lights || Config.get().lights;
    const liquid = this.liquid || Config.get().liquid;

    /**
     * Uniforms for the Visualizer shader material.
     *
     * Each property follows the Three.js uniform convention: { value: ... } and can be passed
     * directly to THREE.ShaderMaterial.uniforms.
     * @type {{
     *   uTime: { value: number };
     *   uSpec: { value: import("three").Texture };
     *   uReactivity: { value: number };
     *   uDistortion: { value: number };
     *   uBaseColor: { value: import("three").Color };
     *   uGlowColor: { value: import("three").Color };
     *   uKeyDir: { value: import("three").Vector3 };
     *   uFillDir: { value: import("three").Vector3 };
     *   uRimDir: { value: import("three").Vector3 };
     *   uKeyCol: { value: import("three").Color };
     *   uFillCol: { value: import("three").Color };
     *   uRimCol: { value: import("three").Color };
     *   uKeyI: { value: number };
     *   uFillI: { value: number };
     *   uRimI: { value: number };
     *   uBassFast: { value: number };
     *   uSpikeStrength: { value: number };
     *   uSpikeSharp: { value: number };
     *   uDirs: { value: any };
     *   uMorph: { value: number };
     *   uLiquid: { value: number };
     *   uRoughness: { value: number };
     *   uMetallic: { value: number };
     *   uFlowPhase: { value: number };
     *   uNoiseFreq: { value: number };
     *   uNoiseAmp: { value: number };
     * }}
     */

    const uniforms = {
      uTime: { value: 1 },
      uSpec: { value: this.specTex },
      uReactivity: { value: this.reactivity },
      uDistortion: { value: this.distortion },
      uBaseColor: { value: pal.base.clone() },
      uGlowColor: { value: pal.glow.clone() },

      // Lighting
      uKeyDir: { value: L.keyDir.clone().normalize() },
      uFillDir: { value: L.fillDir.clone().normalize() },
      uRimDir: { value: L.rimDir.clone().normalize() },
      uKeyCol: { value: new THREE.Color(1, 1, 1) },
      uFillCol: { value: new THREE.Color(1, 1, 1) },
      uRimCol: { value: new THREE.Color(1, 1, 1) },
      uKeyI: { value: L.keyIntensity },
      uFillI: { value: L.fillIntensity },
      uRimI: { value: L.rimIntensity },

      // FFT / stellation
      uBassFast: { value: 0.1 },
      uSpikeStrength: { value: 1.1 },
      uSpikeSharp: { value: 1.0 },
      uDirs: { value: dirs },
      uMorph: { value: 0.05 },

      // Fluid material properties
      uLiquid: { value: liquid.amount },
      uRoughness: { value: liquid.roughness },
      uMetallic: { value: liquid.metallic },

      // Phase-driven flow
      uFlowPhase: { value: 0.0 },
      uNoiseFreq: { value: liquid.freq },
      uNoiseAmp: { value: liquid.amp },
    };

    const vert = `
      precision highp float;
      const int DIR_COUNT = 12;
      uniform vec3 uDirs[DIR_COUNT];
      uniform sampler2D uSpec;
      uniform float uReactivity;
      uniform float uDistortion;
      uniform float uBassFast;
      uniform float uSpikeStrength;
      uniform float uSpikeSharp;
      uniform float uMorph;

      attribute vec3 target;
      varying float vAmp;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vCorner;

      float sampleSpec(float t){ float x = clamp(t, 0.0, 1.0); return texture2D(uSpec, vec2(x, 0.5)).r; }

      void main() {
        vec3 p0 = position;
        vec3 p1 = target;
        vec3 p = mix(p0, p1, clamp(uMorph, 0.0, 1.0));
        vec3 n = normalize(p);

        float ang = atan(p.z, p.x);
        float band = fract(0.5 + ang / 6.28318530718);
        float amp = sampleSpec(band) * uReactivity;
        vAmp = amp;

        float bias = 0.6 + 0.4 * pow(band, 0.5);
        p += n * amp * bias * uDistortion * 0.5;

        vec3 nn = normalize(p);
        vCorner = (abs(nn.x) + abs(nn.y) + abs(nn.z)) / 1.73205080757;

        float m = 0.0;
        for (int i = 0; i < DIR_COUNT; i++) {
          float d = max(0.0, dot(nn, uDirs[i]));
          m = max(m, pow(d, uSpikeSharp));
        }
        float stell = m * uSpikeStrength * uBassFast;
        p += nn * stell;

        vec4 wp4 = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp4.xyz;
        vWorldNormal = normalize((modelMatrix * vec4(nn, 0.0)).xyz);
        gl_Position = projectionMatrix * viewMatrix * wp4;
      }
    `;

    const frag = `
      precision highp float;

      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uGlowColor;

      // Lights
      uniform vec3 uKeyDir; uniform vec3 uFillDir; uniform vec3 uRimDir;
      uniform vec3 uKeyCol; uniform vec3 uFillCol; uniform vec3 uRimCol;
      uniform float uKeyI; uniform float uFillI; uniform float uRimI;

      // Liquid
      uniform float uLiquid; // 0..1
      uniform float uRoughness;
      uniform float uMetallic;
      uniform float uFlowPhase;
      uniform float uNoiseFreq;
      uniform float uNoiseAmp;

      varying float vAmp;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vCorner;

      vec3 mod289(vec3 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
      vec4 mod289(vec4 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
      vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
      vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
      float snoise(vec3 v){
        const vec2  C = vec2(1.0/6.0, 1.0/3.0);
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute( permute( permute(
                  i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
      }

      vec3 noiseNormal(vec3 p, float freq, float amp) {
        vec3 q = p * freq + vec3(0.0, uFlowPhase, 0.0);
        float e = 0.001;
        float n  = snoise(q);
        float nx = snoise(q + vec3(e,0.0,0.0)) - n;
        float ny = snoise(q + vec3(0.0,e,0.0)) - n;
        float nz = snoise(q + vec3(0.0,0.0,e)) - n;
        return normalize(vec3(nx, ny, nz)) * amp;
      }

      vec3 blinnPhong(vec3 N, vec3 V, vec3 L, vec3 lightCol, float lightI, float shininess) {
        float NoL = max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float NoH = max(dot(N, H), 0.0);
        float spec = pow(NoH, shininess);
        vec3 diffuse = lightCol * NoL;
        vec3 specular = lightCol * spec;
        return lightI * (diffuse + specular);
      }

      void main() {
        float a = clamp(vAmp, 0.0, 1.0);
        vec3 baseCol = mix(uBaseColor, uGlowColor, pow(a, 0.8));

        vec3 N = normalize(vWorldNormal);
        vec3 dN = noiseNormal(vWorldPos, uNoiseFreq, uNoiseAmp) * uRoughness;
        N = normalize(N + dN);

        vec3 V = normalize(cameraPosition - vWorldPos);

        float shininess = mix(16.0, 96.0, clamp(uMetallic, 0.0, 1.0)) * (1.0 - 0.6 * clamp(uRoughness, 0.0, 1.0));

        // Lighting
        vec3 colLit = vec3(0.0);
        colLit += blinnPhong(N, V, normalize(uKeyDir),  uKeyCol,  uKeyI,  shininess);
        colLit += blinnPhong(N, V, normalize(uFillDir), uFillCol, uFillI, shininess);
        colLit += blinnPhong(N, V, normalize(uRimDir),  uRimCol,  uRimI,  shininess);

        vec3 litTinted = colLit * baseCol;
        vec3 col = mix(baseCol, litTinted, uLiquid);
        // Reinhard tone mapping
        col = col / (1.0 + col);

        float alpha = 0.55 + 0.40 * pow(clamp(vCorner, 0.0, 1.0), 0.75);
        gl_FragColor = vec4(col, alpha);
      }
    `;

    const matSolid = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const matWire = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: true,
      blending: THREE.NormalBlending,
      wireframe: true,
    });
    matWire.opacity = 0.28;
    matWire.polygonOffset = true;
    matWire.polygonOffsetFactor = -1;
    matWire.polygonOffsetUnits = -1;

    const group = new THREE.Group();
    const solid = new THREE.Mesh(geo, matSolid);
    const wire = new THREE.Mesh(geo.clone(), matWire);
    group.add(solid);
    group.add(wire);
    group.renderOrder = 0;
    return group;
  }

  /**
   * @method applyMorphTargetArray
   * @param {Float32Array | Array<number>} targetArray - Flat float array (XYZ triplets) matching the
   *   geometry position attribute length. Copies values into the "target" attribute of both solid
   *   and wireframe geometries and marks them needsUpdate.
   * @description
   *  Updates the "target" morph attribute used by the vertex shader to displace vertices. Expects
   *  the provided array to match the length of the geometry's position attribute; otherwise, no action
   *  is taken.
   */
  applyMorphTargetArray(targetArray) {
    const solid = /** @type {THREE.Mesh} */ (this.mesh.children[0]);
    const wire = /** @type {THREE.Mesh} */ (this.mesh.children[1]);
    const geoS = /** @type {THREE.BufferGeometry} */ (solid.geometry);
    const geoW = /** @type {THREE.BufferGeometry} */ (wire.geometry);
    const attrS = geoS.getAttribute("target");
    if (attrS && attrS.array && attrS.array.length === targetArray.length) {
      const dst = attrS.array;
      if (dst && typeof dst.set === "function") {
        dst.set(targetArray);
      } else {
        const maybeCopy = /** @type {any} */ (attrS).copyArray;
        if (typeof maybeCopy === "function") {
          maybeCopy.call(attrS, targetArray);
        } else {
          for (let i = 0; i < targetArray.length; i++) dst[i] = targetArray[i];
        }
      }
      attrS.needsUpdate = true;
    }

    const attrW = geoW.getAttribute("target");
    if (attrW && attrW.array && attrW.array.length === targetArray.length) {
      const dstW = attrW.array;
      if (dstW && typeof dstW.set === "function") {
        dstW.set(targetArray);
      } else {
        const maybeCopyW = /** @type {any} */ (attrW).copyArray;
        if (typeof maybeCopyW === "function") {
          maybeCopyW.call(attrW, targetArray);
        } else {
          for (let i = 0; i < targetArray.length; i++) dstW[i] = targetArray[i];
        }
      }
      attrW.needsUpdate = true;
    }
  }
  /**
   *
   * @method freqToIndex
   * @param {number} hz - Frequency in Hz.
   * @returns {number} index - Closest FFT bin index corresponding to `hz`, clamped to valid range.
   * @description
   *  Converts a frequency in Hz to the closest FFT bin index based on the AudioContext sample rate
   *
   */
  freqToIndex(hz) {
    const nyq = this.sampleRate * 0.5;
    const frac = clamp(hz / nyq, 0, 1);
    return Math.round(frac * (this.spec.length - 1));
  }

  /**
   * @method updateFFTAndBands
   * @description
   *   Samples the analyser into the internal `spec` byte array (via getByteFrequencyData),
   *   computes averaged band energies (bass, mid, treble, overall) and updates the fast &
   *   smoothed band trackers used throughout the visualizer. Also marks the spectrogram texture
   *   needsUpdate so shaders read the latest audio data.
   * @returns {void}
   */
  updateFFTAndBands() {
    this.analyser.getByteFrequencyData(this.spec);
    const N = this.spec.length;
    /**
     * @typedef {(i0: number, i1: number) => number} AvgFunc
     */

    /** @type {AvgFunc} */
    const avg = (i0, i1) => {
      /** @type {number} */
      let s = 0;
      /** @type {number} */
      let c = 0;
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        s += /** @type {number} */ (this.spec[i]);
        c++;
      }
      return c ? s / (c * 255) : 0;
    };
    const bass = avg(this.freqToIndex(20), this.freqToIndex(200));
    const mid = avg(this.freqToIndex(110), this.freqToIndex(1500));
    const treble = avg(this.freqToIndex(20), this.freqToIndex(3000));
    const overall = avg(this.freqToIndex(0), this.freqToIndex(20000));
    this.energy.bass = bass;
    this.energy.mid = mid;
    this.energy.treble = treble;
    this.energy.overall = overall;
    this.smooth.bass = lerp(this.smooth.bass, bass, this.smoothK);
    this.smooth.mid = lerp(this.smooth.mid, mid, this.smoothK);
    this.smooth.treble = lerp(this.smooth.treble, treble, this.smoothK);
    this.smooth.overall = lerp(this.smooth.overall, overall, this.smoothK);
    this.fast.bass = lerp(this.fast.bass, bass, this.fastK);
    this.specTex.needsUpdate = true;
  }

  /**
   *
   * @method resize
   * @description
   *   Resizes the renderer, composer and bloom pass to the canvas display size (accounting for DPR).
   *   Updates camera aspect and adjusts camera Z position relative to configured zoom and canvas
   *   aspect to maintain a pleasing framing.
   * @returns {void}
   *
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor(rect.width * dpr)),
      h = Math.max(2, Math.floor(rect.height * dpr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.position.z = clamp(
      (3.5 / this.zoom) * (this.canvas.height / this.canvas.width) ** 1.075,
      3.0,
      5.5
    );
    this.camera.updateProjectionMatrix();
    this.bloomPass.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /**
   *
   * @method frame
   * @param {number} t_ms - Current animation timestamp in milliseconds (typically provided by requestAnimationFrame).
   * @description
   *   Main per-frame update function. Steps:
   *     - converts time and dt, updates FFT & band trackers
   *     - updates camera position, orbit phase, and starfield motion based on audio energies
   *     - integrates spin / gyro rotation and damping
   *     - updates shader uniforms (time, reactivity, distortion, morph, bass-driven stellation)
   *     - applies palette hue drift
   *     - smooths and integrates flow speed & phase used by the liquid noise
   *     - scales light intensities and bloom strength based on energy
   *     - updates noise/liquid uniforms and invokes the composer.render()
   * @returns {void}
   */
  frame(t_ms) {
    const t = t_ms * 0.001,
      dt = this._lastTime ? Math.min(0.1, t - this._lastTime) : 0.016;
    this._lastTime = t;
    this.updateFFTAndBands();

    // Camera motion
    const baseZ = clamp(
      (3.5 / this.zoom) * (this.canvas.height / this.canvas.width) ** 1.075,
      3.0,
      5.5
    );
    const targetZ = baseZ - 0.25 * this.smooth.bass;
    this.camera.position.z += (targetZ - this.camera.position.z) * 0.26;

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

    // Starfields
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

    // Spin & gyro
    const gyroY = this.gyro.on ? this.gyro.pitch * 0.08 : 0;
    const gyroX = this.gyro.on ? this.gyro.roll * 0.08 : 0;
    this.mesh.rotateY(this.rotationSpeed * 0.01);
    this.mesh.rotateX(this.angVelX + gyroY);
    this.mesh.rotateY(this.angVelY + gyroX);
    const cap = this.maxOmega;
    this.angVelX = clamp(this.angVelX * this.spinDamp, -cap, cap);
    this.angVelY = clamp(this.angVelY * this.spinDamp, -cap, cap);

    const solid = /** @type {THREE.Mesh} */ (this.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    mat.uniforms.uTime.value = t;
    mat.uniforms.uReactivity.value = 0.9 + 2.6 * this.smooth.overall;
    mat.uniforms.uDistortion.value = this.distortion;

    // Morph gate
    const x = this.fast.bass;
    const start = this.morphThreshold - this.morphKnee;
    const end = this.morphThreshold + this.morphKnee;
    const gate = smoothstepEdge(start, end, x);
    const lifted = clamp((x - start) / (1 - start), 0, 1);
    const desired = clamp(gate * lifted * 1.35, 0.0, 1.0);
    const rate = desired > this.morphEnv ? this.morphAttack : this.morphRelease;
    this.morphEnv += (desired - this.morphEnv) * rate;
    mat.uniforms.uMorph.value = this.morphEnv;
    mat.uniforms.uBassFast.value = gate * x;

    // Palette hue drift
    const shift = this.smooth.mid * 0.45;
    this.pal.base.getHSL(this.baseHSL);
    this.pal.glow.getHSL(this.glowHSL);
    const baseH = (this.baseHSL.h + shift) % 1;
    const glowH = (this.glowHSL.h + shift * 1.2) % 1;
    mat.uniforms.uBaseColor.value.setHSL(baseH, this.baseHSL.s, this.baseHSL.l);
    mat.uniforms.uGlowColor.value.setHSL(glowH, this.glowHSL.s, this.glowHSL.l);

    // Flow smoothing & integration
    const targetFlow =
      0.6 + 2.4 * (0.35 * this.smooth.mid + 0.65 * this.smooth.treble);
    const maxAccel = 3.0;
    const dv = clamp(
      targetFlow - this.flowSpeed,
      -maxAccel * dt,
      maxAccel * dt
    );
    this.flowSpeed += dv;
    this.flowPhase += dt * this.flowSpeed;
    mat.uniforms.uFlowPhase.value = this.flowPhase;

    const energy = clamp(this.smooth.overall, 0, 1);
    const lightScale = 0.95 - 0.55 * energy; // 1.0..0.4
    mat.uniforms.uKeyI.value = this.lights.keyIntensity * lightScale;
    mat.uniforms.uFillI.value = this.lights.fillIntensity * lightScale;
    mat.uniforms.uRimI.value = this.lights.rimIntensity * lightScale;

    const targetBloom = this.baseBloomStrength * (0.95 - 0.55 * energy);
    this.bloomPass.strength += (targetBloom - this.bloomPass.strength) * 0.08;

    // Noise & liquid
    mat.uniforms.uNoiseFreq.value = this.liquid.freq;
    mat.uniforms.uNoiseAmp.value = this.liquid.amp;
    mat.uniforms.uLiquid.value = this.liquid.amount;
    mat.uniforms.uRoughness.value = this.liquid.roughness;
    mat.uniforms.uMetallic.value = this.liquid.metallic;

    this.composer.render();
  }

  /**
   * @method rebuildStarfield
   * @description
   *   Recreates starfield and blurred-starfield point clouds using the current palette and
   *   configuration. Disposes previous starfield objects and adds new ones to the scene.
   * @returns {void}
   */
  rebuildStarfield() {
    const cf = Config.get().starfield;
    if (this.starfield) {
      this.scene.remove(this.starfield);
      disposeObject(this.starfield);
    }
    if (this.starfieldBlur) {
      this.scene.remove(this.starfieldBlur);
      disposeObject(this.starfieldBlur);
    }
    const sfMain = createStarfield(cf.mainCount, cf.radius, this.pal, {
      size: cf.mainSize,
      opacity: cf.mainOpacity,
    });
    const sfBlur = createStarfield(cf.blurCount, cf.radius - 2, this.pal, {
      size: cf.blurSize,
      opacity: cf.blurOpacity,
    });
    this.starfield = sfMain.points;
    this.starfieldBlur = sfBlur.points;
    this.scene.add(this.starfield);
    this.scene.add(this.starfieldBlur);
  }
}

/**
 * Starfield
 * @param {number} count - Number of stars to generate.
 * @param {number} radius - Radius of the starfield sphere.
 * @param {{base: THREE.Color, glow: THREE.Color}} pal - Color palette with base and glow colors.
 * @param {{size?: number, opacity?: number}} [opts] - Optional parameters.
 * @returns {{points: THREE.Points, geom: THREE.BufferGeometry, mat: THREE.PointsMaterial}}
 * @description
 *   Creates a starfield point cloud with stars distributed on a sphere of given radius.
 *   Each star's color is based on the glow color of the provided palette, with slight random
 *   variations in hue, saturation, and lightness. Returns the Points object along with its
 *   geometry and material for further customization if needed.
 * */
export function createStarfield(count, radius, pal, opts = {}) {
  const size = opts.size ?? 0.1,
    opacity = opts.opacity ?? 1.0;
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3),
    col = new Float32Array(count * 3);
  const glowHSL = { h: 0, s: 1, l: 0.5 };
  pal.glow.getHSL(glowHSL);
  for (let i = 0; i < count; i++) {
    const r = radius * (0.6 + 0.4 * Math.random());
    const theta = Math.random() * Math.PI * 2,
      phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta),
      y = r * Math.sin(phi) * Math.sin(theta),
      z = r * Math.cos(phi);
    const j = i * 3;
    pos[j] = x;
    pos[j + 1] = y;
    pos[j + 2] = z;
    const h = (glowHSL.h + (Math.random() * 0.1 - 0.05) + 1) % 1,
      s = 0.85 + Math.random() * 0.15,
      l = 0.7 + Math.random() * 0.3;
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
 * @description Dark radial background for the scene
 * @returns {THREE.CanvasTexture} - Radial gradient texture
 */
export function makeRadialBackgroundTexture() {
  const s = 512,
    cvs = document.createElement("canvas");
  cvs.width = s;
  cvs.height = s;
  const ctx = cvs.getContext("2d");
  if (!ctx) throw new Error("2D canvas context not supported");
  const g = ctx.createRadialGradient(
    s * 0.5,
    s * 0.55,
    s * 0.05,
    s * 0.5,
    s * 0.55,
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
 *
 * @param {THREE.Object3D} obj - Object to dispose of (geometry and materials of all children).
 * @description
 *   Disposes of the geometries and materials of an object and all its children.
 */
export function disposeObject(obj) {
  obj.traverse((o) => {
    const g = /** @type {any} */ (o).geometry;
    if (g) g.dispose?.();
    const m = /** @type {any} */ (o).material;
    if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
    else m?.dispose?.();
  });
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} x
 * @returns {number} smoothstep value
 * @description
 *   Smoothstep function that eases from 0 to 1 as x goes from a to b, clamped outside that range.
 */
export function smoothstepEdge(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
