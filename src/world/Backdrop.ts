import * as THREE from 'three';
import { addStatic } from '../utils/dispose';
import type { BackdropResult } from './TileBuilder';

const BLOCK = 40;

/**
 * Whole-map low-resolution terrain, split into blocks for frustum culling. Its vertex shader
 * sinks everything inside the streamed-tile radius so it never pokes through the detailed tiles.
 */
export class Backdrop {
  readonly group = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private uniforms = {
    uCenter: { value: new THREE.Vector2() },
    uR0: { value: 300 },
    uR1: { value: 450 },
  };

  constructor(r: BackdropResult, parent: THREE.Object3D, nearRadius: number) {
    // Smooth shading: 80 m facets would look harsh next to the detailed tiles.
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uCenter;\nuniform float uR0;\nuniform float uR1;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 bdWorld = modelMatrix * vec4(transformed, 1.0);
          float bdDist = distance(bdWorld.xz, uCenter);
          transformed.y -= 260.0 * (1.0 - smoothstep(uR0, uR1, bdDist)) + 4.0;`,
        );
    };
    this.setNearRadius(nearRadius);

    const { nx, nz } = r;
    for (let bj = 0; bj < nz - 1; bj += BLOCK) {
      for (let bi = 0; bi < nx - 1; bi += BLOCK) {
        const w = Math.min(BLOCK, nx - 1 - bi) + 1;
        const h = Math.min(BLOCK, nz - 1 - bj) + 1;
        const pos = new Float32Array(w * h * 3);
        const nor = new Float32Array(w * h * 3);
        const col = new Uint8Array(w * h * 3);
        const ox = r.positions[(bj * nx + bi) * 3]!;
        const oz = r.positions[(bj * nx + bi) * 3 + 2]!;
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const src = ((bj + j) * nx + (bi + i)) * 3;
            const dst = (j * w + i) * 3;
            pos[dst] = r.positions[src]! - ox;
            pos[dst + 1] = r.positions[src + 1]!;
            pos[dst + 2] = r.positions[src + 2]! - oz;
            for (let c = 0; c < 3; c++) {
              nor[dst + c] = r.normals[src + c]!;
              col[dst + c] = r.colors[src + c]!;
            }
          }
        }
        const index: number[] = [];
        for (let j = 0; j < h - 1; j++) {
          for (let i = 0; i < w - 1; i++) {
            const a = j * w + i;
            index.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
        geo.setIndex(index);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.position.set(r.originX + ox, 0, r.originZ + oz);
        mesh.receiveShadow = false;
        this.group.add(mesh);
      }
    }
    addStatic(parent, this.group);
  }

  setNearRadius(nearRadius: number): void {
    // Loaded tiles cover at least a disk of nearRadius; sink the backdrop fully inside it.
    this.uniforms.uR1.value = Math.max(150, nearRadius - 10);
    this.uniforms.uR0.value = Math.max(50, nearRadius - 110);
  }

  /** Focus in render-local coordinates. */
  update(focusLocal: THREE.Vector3): void {
    this.uniforms.uCenter.value.set(focusLocal.x, focusLocal.z);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.material.dispose();
  }
}
