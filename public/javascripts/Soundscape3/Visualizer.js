
import * as THREE from "three";
import { EffectComposer } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Config } from "Config";
import { applyBackground, lerp, clamp, palette } from "Utility";

/**
 * Visualizer
 */
export class Visualizer {
  constructor(canvas, analyser) {
    this.canvas = canvas;
    this.analyser = analyser;

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.camera.position.set(0, 0, 3.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;

    // PostFX
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    const { strength, radius, threshold } = Config.get().bloom;
    this.baseBloomStrength = strength;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), strength, radius, threshold);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);

    // FFT Texture — WebGL2-safe (R8)
    this.fftBins = this.analyser.frequencyBinCount;
    this.spec = new Uint8Array(this.fftBins);
    this.specTex = new THREE.DataTexture(this.spec, this.fftBins, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.specTex.needsUpdate = true;
    this.specTex.minFilter = THREE.LinearFilter;
    this.specTex.magFilter = THREE.LinearFilter;
    this.specTex.generateMipmaps = false;
    this.specTex.flipY = false;

    // Palette
    this.pal = palette("burn");
    applyBackground(this.pal); // CSS backdrop

    function mixHex(a, b, t) {
      const ai = parseInt(a.replace("#",""), 16), bi = parseInt(b.replace("#",""), 16);
      const ar = (ai >> 16) & 255, ag = (ai >> 8) & 255, ab = ai & 255;
      const br = (bi >> 16) & 255, bg = (bi >> 8) & 255, bb = bi & 255;
      const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
      return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
    }

    // GPU backdrop (radial) — set at startup
    const mid0 = mixHex(this.pal.bgTop, this.pal.bgBot, 0.5);
    this._bgTex = makeRadialBackgroundTexture(this.pal.bgTop, mid0, this.pal.bgBot);
    this.scene.background = this._bgTex;

    // Starfields
    const cf = Config.get().starfield;
    const sfMain = createStarfield(cf.mainCount, cf.radius, this.pal, { size: cf.mainSize, opacity: cf.mainOpacity });
    const sfBlur = createStarfield(cf.blurCount, cf.radius - 2, this.pal, { size: cf.blurSize, opacity: cf.blurOpacity });
    this.starfield = sfMain.points;
    this.starfieldBlur = sfBlur.points;
    this.scene.add(this.starfield);
    this.scene.add(this.starfieldBlur);

    // Mesh config
    const mx = Config.get().mesh;
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

    this.sampleRate = /** @type {AudioContext} */ (this.analyser.context).sampleRate;

    this.lights = Config.get().lights;
    this.liquid = { ...Config.get().liquid };

    // Flow smoothing
    this.flowSpeed = this.liquid.flow;
    this.flowPhase = 0;

    // Geometry
    this.mesh = this.makeMesh(this.subdiv);
    this.scene.add(this.mesh);

    // Resize
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || document.body);
    this.resize();
  }

  /**
   * Swap palettes at runtime and refresh everything that visually depends on it.
   * Call this from the dropdown change handler.
   * @param {string} id
   */
  setPalette(id) {
    this.pal = palette(id);

    // Update CSS gradient
    applyBackground(this.pal);

    // Update GPU radial background, disposing the old one to avoid leaks
    if (this._bgTex && typeof this._bgTex.dispose === "function") this._bgTex.dispose();
    const mid = mixHex(this.pal.bgTop, this.pal.bgBot, 0.5);
    this._bgTex = makeRadialBackgroundTexture(this.pal.bgTop, mid, this.pal.bgBot);
    this.scene.background = this._bgTex;

    // Update HSL caches (used by frame() hue drift)
    this.pal.base.getHSL(this.baseHSL);
    this.pal.glow.getHSL(this.glowHSL);

    // Push raw palette colors once (frame() will animate hue each tick)
    const solid = /** @type {THREE.Mesh} */ (this.mesh.children[0]);
    const mat = /** @type {THREE.ShaderMaterial} */ (solid.material);
    mat.uniforms.uBaseColor.value.copy(this.pal.base);
    mat.uniforms.uGlowColor.value.copy(this.pal.glow);

    // Rebuild starfields so their baked vertex colors pick up new glow hue
    this.rebuildStarfield();
  }

  makeMesh(subdiv) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeObject(this.mesh);
    }

    const geo = new THREE.IcosahedronGeometry(1, subdiv);
    const targetAttr = new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.array.length), 3);
    geo.setAttribute("target", targetAttr);

    const pal = this.pal || palette("synth");

    const PHI = (1 + Math.sqrt(5)) / 2;
    const dirs = [
      [0, 1, PHI],[0, -1, PHI],[0, 1, -PHI],[0, -1, -PHI],
      [1, PHI, 0],[-1, PHI, 0],[1, -PHI, 0],[-1, -PHI, 0],
      [PHI, 0, 1],[-PHI, 0, 1],[PHI, 0, -1],[-PHI, 0, -1],
    ].map((v) => new THREE.Vector3(v[0], v[1], v[2]).normalize());
    this._stellationDirs = dirs;

    const L = this.lights || Config.get().lights;
    const liquid = this.liquid || Config.get().liquid;

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

      uniform vec3 uKeyDir; uniform vec3 uFillDir; uniform vec3 uRimDir;
      uniform vec3 uKeyCol; uniform vec3 uFillCol; uniform vec3 uRimCol;
      uniform float uKeyI; uniform float uFillI; uniform float uRimI;

      uniform float uLiquid;
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

        vec3 colLit = vec3(0.0);
        colLit += blinnPhong(N, V, normalize(uKeyDir),  uKeyCol,  uKeyI,  shininess);
        colLit += blinnPhong(N, V, normalize(uFillDir), uFillCol, uFillI, shininess);
        colLit += blinnPhong(N, V, normalize(uRimDir),  uRimCol,  uRimI,  shininess);

        vec3 litTinted = colLit * baseCol;
        vec3 col = mix(baseCol, litTinted, uLiquid);
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

  applyMorphTargetArray(targetArray) {
    const solid = /** @type {THREE.Mesh} */ (this.mesh.children[0]);
    const wire = /** @type {THREE.Mesh} */ (this.mesh.children[1]);
    const geoS = /** @type {THREE.BufferGeometry} */ (solid.geometry);
    const geoW = /** @type {THREE.BufferGeometry} */ (wire.geometry);
    if (
      geoS.getAttribute("target") &&
      geoS.getAttribute("target").array.length === targetArray.length
    ) {
      geoS.getAttribute("target").set(targetArray);
      geoS.getAttribute("target").needsUpdate = true;
    }
    if (
      geoW.getAttribute("target") &&
      geoW.getAttribute("target").array.length === targetArray.length
    ) {
      geoW.getAttribute("target").set(targetArray);
      geoW.getAttribute("target").needsUpdate = true;
    }
  }

  freqToIndex(hz) {
    const nyq = this.sampleRate * 0.5;
    const frac = clamp(hz / nyq, 0, 1);
    return Math.round(frac * (this.spec.length - 1));
  }

  updateFFTAndBands() {
    this.analyser.getByteFrequencyData(this.spec);
    const N = this.spec.length;
    const avg = (i0, i1) => {
      let s = 0,
        c = 0;
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        s += this.spec[i];
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

    // Palette hue drift (now respects runtime palette changes)
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
    const lightScale = 0.95 - 0.55 * energy;
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
 * Starfield — colored around pal.glow hue at construction time. Rebuild when the palette changes.
 */
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
    const h = (glowHSL.h + (Math.random() * 0.1 - 0.05) + 1.0) % 1.0,
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
 * Optional scene bg texture builder — now palette-driven if you want to use it.
 * Keep scene.background = null to let CSS show through, or set it to this texture.
 */
export function makeRadialBackgroundTexture(
  top = "#000000",
  mid = "#0a0018",
  bot = "#1a0033"
) {
  const s = 512,
    cvs = document.createElement("canvas");
  cvs.width = s;
  cvs.height = s;
  const ctx = cvs.getContext("2d");
  const g = ctx.createRadialGradient(
    s * 0.5,
    s * 0.55,
    s * 0.05,
    s * 0.5,
    s * 0.55,
    s * 0.7
  );
  g.addColorStop(0.0, top);
  g.addColorStop(0.5, mid);
  g.addColorStop(1.0, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
    else m?.dispose?.();
  });
}

export function smoothstepEdge(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
