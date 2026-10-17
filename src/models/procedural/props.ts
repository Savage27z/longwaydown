import * as THREE from 'three';
import type { BiomeDef } from '../../world/Biome';
import { jitter, merge, paint, paintBy, paintFaces, translate } from './geometry';

/** Low-poly vegetation and rock geometry (unit scale, origin at the base). */

export function pineTree(biome: BiomeDef, detail: 'high' | 'low'): THREE.BufferGeometry {
  const foliage = new THREE.Color(biome.trees.foliage[0]);
  const foliage2 = new THREE.Color(biome.trees.foliage[1] ?? biome.trees.foliage[0]);
  const snow = new THREE.Color('#f2f7fc');
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(translate(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 5), 0, 0.8, 0), biome.trees.trunk));
  const tiers = detail === 'high' ? [[2.3, 3.6, 1.2], [1.8, 3.0, 3.1], [1.2, 2.6, 4.8], [0.65, 2.0, 6.3]] : [[2.2, 7.2, 1.2]];
  tiers.forEach(([r, h, y], k) => {
    const cone = translate(new THREE.ConeGeometry(r!, h!, detail === 'high' ? 7 : 5), 0, y! + h! / 2, 0);
    const base = k % 2 === 0 ? foliage : foliage2;
    parts.push(
      paintBy(cone, (_x, py, _z, out) => {
        out.copy(base);
        if (biome.trees.snowTips && py > y! + h! * 0.42) out.lerp(snow, 0.8);
      }),
    );
  });
  return merge(parts);
}

export function broadleafTree(biome: BiomeDef, detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(translate(new THREE.CylinderGeometry(0.2, 0.3, 3.2, 5), 0, 1.6, 0), biome.trees.trunk));
  const leaf = biome.trees.foliage;
  const blobs = detail === 'high' ? [[0, 4.6, 0, 2.4], [1.1, 3.9, 0.5, 1.6], [-0.9, 4.0, -0.6, 1.7], [0.2, 5.6, -0.3, 1.5]] : [[0, 4.6, 0, 2.6]];
  blobs.forEach(([x, y, z, r], k) => {
    const g = translate(new THREE.IcosahedronGeometry(r!, 0), x!, y!, z!);
    g.scale(1, 0.85, 1);
    parts.push(paint(g, leaf[k % leaf.length]!));
  });
  return merge(parts);
}

export function bush(biome: BiomeDef): THREE.BufferGeometry {
  const color = biome.id === 'snow' ? '#5f7a66' : biome.trees.foliage[2] ?? biome.trees.foliage[0]!;
  const g = translate(new THREE.IcosahedronGeometry(0.9, 0), 0, 0.5, 0);
  g.scale(1.2, 0.7, 1.1);
  const snow = new THREE.Color('#eef4fa');
  const base = new THREE.Color(color);
  return merge([
    paintFaces(g, (_x, y, _z, _f, out) => {
      out.copy(base);
      if (biome.trees.snowTips && y > 0.65) out.lerp(snow, 0.75);
    }),
  ]);
}

export function rock(biome: BiomeDef, seed = 7): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  jitter(g, 0.32, seed);
  g.scale(1.35, 0.85, 1.15);
  g.translate(0, 0.45, 0);
  const base = new THREE.Color(biome.rock);
  const dark = base.clone().multiplyScalar(0.78);
  const snow = new THREE.Color('#eef4fa');
  return merge([
    paintFaces(g, (_x, y, _z, f, out) => {
      out.copy(f % 3 === 0 ? dark : base);
      if (biome.id === 'snow' && y > 0.95) out.lerp(snow, 0.85);
    }),
  ]);
}

/** Course marker pole with a small pennant. Vertex colour is white so instance colour tints it. */
export function markerPole(): THREE.BufferGeometry {
  const pole = paint(translate(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 5), 0, 1.3, 0), '#ffffff');
  const flag = paint(translate(new THREE.BoxGeometry(0.04, 0.42, 0.62), 0, 2.32, 0.33), '#ffffff');
  const cap = paint(translate(new THREE.SphereGeometry(0.08, 5, 3), 0, 2.64, 0), '#ffffff');
  return merge([pole, flag, cap]);
}
