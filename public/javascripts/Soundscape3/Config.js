// @ts-check
import * as THREE from "three";

/** ============================== Config ==============================
 * Centralized config so knobs live in one damn place.
 * Change at runtime via Config.update({ ... }) and consumers read from getters.
 *
 * Author: DJ Stomp <DJStompZone>
 * License: MIT
 */
export class Config {
  /**
   * Singleton instance.
   * @type {Config}
   */
  static #inst = new Config();

  /**
   * Get the singleton instance. Prefer Config.get() or Config.read() to keep the API obvious.
   * @returns {Config}
   */
  static get i() { return Config.#inst; }

  /**
   * Get the whole config object (by reference). Mutate via update to keep intent clear.
   * @returns {Config}
   */
  static get() { return Config.#inst; }

  /**
   * Return a single config subsection or value with key-level typing.
   * @template {keyof Config} K
   * @param {K} key
   * @returns {Config[K]}
   */
  static read(key) { return Config.#inst[key]; }

  /**
   * Shallow-merge a patch into the config. Use nested objects in patch to change subsections.
   * @param {Partial<Config>} patch
   * @returns {Config}
   */
  static update(patch) { Object.assign(Config.#inst, patch); return Config.#inst; }

  /** Visual starfield parameters. */
  starfield;
  /** Bloom postprocess parameters. */
  bloom;
  /** Mesh deformation and motion. */
  mesh;
  /** Liquid-like surface params. */
  liquid;
  /** Key, fill, rim light directions and intensities. */
  lights;
  /** Morph/gating envelope. */
  morph;
  /** FFT smoothing constants. */
  smoothing;
  /** Orbit camera path parameters. */
  orbit;
  /** Drag/spin controls. */
  spin;

  constructor() {
    /** @type {{mainCount:number, blurCount:number, radius:number, mainSize:number, blurSize:number, mainOpacity:number, blurOpacity:number}} */
    this.starfield = { mainCount: 2200, blurCount: 7500, radius: 62, mainSize: 0.1, blurSize: 0.12, mainOpacity: 0.95, blurOpacity: 0.33 };

    /** @type {{strength:number, radius:number, threshold:number}} */
    this.bloom = { strength: 0.45, radius: 0.8, threshold: 0.1 };

    /** @type {{subdiv:number, distortion:number, rotationSpeed:number, reactivity:number, zoom:number}} */
    this.mesh = { subdiv: 12, distortion: 1.2, rotationSpeed: 0.7, reactivity: 1.5, zoom: 0.4 };

    /** @type {{amount:number, roughness:number, metallic:number, flow:number, freq:number, amp:number}} */
    this.liquid = { amount: 0.915, roughness: 0.95, metallic: 0.65, flow: 1.25, freq: 2.856, amp: 3.1 };

    /** @type {{keyDir:import("three").Vector3, fillDir:import("three").Vector3, rimDir:import("three").Vector3, keyIntensity:number, fillIntensity:number, rimIntensity:number}} */
    this.lights = {
      keyDir: new THREE.Vector3(0.577, 0.577, 0.577),
      fillDir: new THREE.Vector3(-0.707, 0.707, 0.0),
      rimDir: new THREE.Vector3(0.0, -0.707, 0.707),
      keyIntensity: 0.8,
      fillIntensity: 0.6,
      rimIntensity: 0.9
    };

    /** @type {{threshold:number, knee:number, attack:number, release:number, envInit:number}} */
    this.morph = { threshold: 0.55, knee: 1.6 - 0.55, attack: 0.07, release: 0.05, envInit: 0.9 };

    /** @type {{slow:number, fast:number}} */
    this.smoothing = { slow: 0.04, fast: 0.02 };

    /** @type {{baseSpeed:number, a:number, b:number}} */
    this.orbit = { baseSpeed: 0.015, a: 0.45, b: 0.33 };

    /** @type {{damp:number, maxOmega:number, dragSensitivity:number}} */
    this.spin = { damp: 0.8, maxOmega: 3.7, dragSensitivity: 0.002 };
  }
}
