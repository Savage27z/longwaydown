import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Helpers for building stylized low-poly geometry with baked vertex colours. */

/** Paint every vertex of a geometry one colour (linear space handled by THREE.Color). */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const count = g.attributes.position!.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g !== geo) geo.dispose();
  return g;
}

/** Paint vertices by a function of their position. */
export function paintBy(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position!;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g !== geo) geo.dispose();
  return g;
}

/** Paint each triangle (flat) by a function of its centroid. */
export function paintFaces(geo: THREE.BufferGeometry, fn: (cx: number, cy: number, cz: number, face: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position!;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < pos.count / 3; f++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(f * 3 + k) / 3;
      cy += pos.getY(f * 3 + k) / 3;
      cz += pos.getZ(f * 3 + k) / 3;
    }
    fn(cx, cy, cz, f, c);
    for (let k = 0; k < 3; k++) {
      arr[(f * 3 + k) * 3] = c.r;
      arr[(f * 3 + k) * 3 + 1] = c.g;
      arr[(f * 3 + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g !== geo) geo.dispose();
  return g;
}

export function translate(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geo.translate(x, y, z);
  return geo;
}

/** Merge geometries that all carry position + color (normals recomputed). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'color') g.deleteAttribute(name);
    }
    return g;
  });
  const merged = mergeGeometries(clean, false);
  if (!merged) throw new Error('mergeGeometries failed (attribute mismatch)');
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  for (const p of parts) p.dispose();
  return merged;
}

/** Deterministically jitter vertex positions (rocks). Keeps shared vertices welded. */
export function jitter(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = geo.attributes.position!;
  const cache = new Map<string, [number, number, number]>();
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = cache.get(key);
    if (!d) {
      d = [rnd() * amount, rnd() * amount, rnd() * amount];
      cache.set(key, d);
    }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  pos.needsUpdate = true;
  return geo;
}
