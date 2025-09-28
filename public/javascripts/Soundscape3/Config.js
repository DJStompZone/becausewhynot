import * as THREE from "three";

/* ============================== Config ============================== */
/**
 * Centralized config so knobs live in one damn place.
 * Change at runtime via Config.update({ ... }) and consumers read from getters.
 */

export class Config {
  /** @type {Config} */
  static #inst = new Config();

  static get i() {
    return Config.#inst;
  }
  static get() {
    return Config.#inst;
  }
  static update(patch) {
    Object.assign(Config.#inst, patch);
    return Config.#inst;
  }

  constructor() {
    // Visuals
    this.starfield = {
      mainCount: 2200,
      blurCount: 7500,
      radius: 62,
      mainSize: 0.1,
      blurSize: 0.12,
      mainOpacity: 0.95,
      blurOpacity: 0.33,
    };
    this.bloom = { strength: 0.45, radius: 0.8, threshold: 0.1 };
    this.mesh = {
      subdiv: 12,
      distortion: 1.2,
      rotationSpeed: 0.7,
      reactivity: 1.5,
      zoom: 0.4,
    };

    // Liquid surfacing
    this.liquid = {
      amount: 0.915,
      roughness: 0.95,
      metallic: 0.65,
      flow: 1.25,
      freq: 2.856,
      amp: 3.1,
    };

    // Lights (directions in world space; colors derived from palette at runtime)
    // key from +X,+Y,+Z; fill from -X,+Y,0; rim from 0,-Y,+Z
    this.lights = {
      keyDir: new THREE.Vector3(0.577, 0.577, 0.577),
      fillDir: new THREE.Vector3(-0.707, 0.707, 0.0),
      rimDir: new THREE.Vector3(0.0, -0.707, 0.707),
      keyIntensity: 0.8,
      fillIntensity: 0.6,
      rimIntensity: 0.9,
    };

    // Morph / gating
    this.morph = {
      threshold: 0.55,
      knee: 1.6 - 0.55,
      attack: 0.07,
      release: 0.05,
      envInit: 0.9,
    };

    // FFT bands
    this.smoothing = { slow: 0.04, fast: 0.02 };

    // Orbit camera motion
    this.orbit = { baseSpeed: 0.015, a: 0.45, b: 0.33 };

    // Drag/Spin
    this.spin = { damp: 0.8, maxOmega: 3.7, dragSensitivity: 0.002 };
  }
}
