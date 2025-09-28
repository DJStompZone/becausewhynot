
import * as THREE from "three";
import { STLLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/STLLoader.js";
import { updateOverlay, hideOverlay, showOverlay } from "DOM";

/* ============================== Shader Calculation ============================== */
/**
 * Raycast morph bake; incl. progress callback.
 * @param {THREE.BufferGeometry} stlGeom
 * @param {THREE.BufferGeometry} sphereGeom
 * @param {string} cacheKey
 * @param {(pct:number)=>void} [onProgress]
 */
export async function buildOrLoadRadialMorphTarget(stlGeom, sphereGeom, cacheKey, onProgress) {
  try
  {
    const cached = localStorage.getItem(cacheKey);
    if (cached)
    {
      const arr = new Float32Array(JSON.parse(cached));
      if (arr.length === sphereGeom.attributes.position.array.length) { onProgress?.(1); return arr; }
    }
  } catch { }
  const stl = normalizeGeometry(stlGeom.clone());
  const stlMesh = new THREE.Mesh(stl, new THREE.MeshBasicMaterial());
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const origin = new THREE.Vector3(0, 0, 0);

  const pos = sphereGeom.attributes.position;
  const target = new Float32Array(pos.array.length);
  const v = new THREE.Vector3();
  const total = pos.count;
  const YIELD_EVERY = 600; // Completely arbitrary; based on vibes

  for (let i = 0; i < total; i++)
  {
    v.fromBufferAttribute(pos, i).normalize();
    ray.set(origin, v);
    const hit = ray.intersectObject(stlMesh, false);
    const d = hit && hit.length ? hit[0].distance : 1.0;
    const j = i * 3;
    target[j] = v.x * d; target[j + 1] = v.y * d; target[j + 2] = v.z * d;


    // "Hey knock that shit off for a sec"
    if ((i % YIELD_EVERY) === 0)
    {
      onProgress?.(i / total);
      await new Promise(requestAnimationFrame);
      // "Carry on"
    }
  }
  onProgress?.(1);
  try { localStorage.setItem(cacheKey, JSON.stringify(Array.from(target))); } catch { }
  stl.dispose(); stlMesh.geometry?.dispose?.(); stlMesh.material?.dispose?.();
  return target;
}/* ============================== STL + Bake Wiring ============================== */
export async function loadAndBakeSTLMorph(url, viz) {
  const loader = new STLLoader();
  const stlGeom = await new Promise((resolve, reject) => loader.load(url, (g) => resolve(g), undefined, reject));

  const solid = /** @type {THREE.Mesh} */ (viz.mesh.children[0]);
  const baseGeo = /** @type {THREE.BufferGeometry} */ (solid.geometry);
  const cacheKey = `morph:${url}:verts:${baseGeo.attributes.position.count}`;

  showOverlay("One moment, precomputing shader cache...");
  try
  {
    const targetArray = await buildOrLoadRadialMorphTarget(stlGeom, baseGeo, cacheKey, (pct) => updateOverlay(pct));
    viz.applyMorphTargetArray(targetArray);
  } catch (e)
  {
    console.error("STL morph failed:", e);
  } finally
  {
    hideOverlay();
  }
  stlGeom.dispose?.();
}
export function normalizeGeometry(g) {
  let geom = g.index ? g.toNonIndexed() : g;
  geom.computeBoundingBox();
  const c = new THREE.Vector3();
  geom.boundingBox.getCenter(c).negate();
  geom.translate(c.x, c.y, c.z);
  geom.computeBoundingSphere();
  const r = geom.boundingSphere?.radius || 1;
  if (r > 0) geom.scale(1 / r, 1 / r, 1 / r);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

