import * as THREE from 'three';
import { damp } from '../utils/math';
import type { RigBinding } from './rig/RigBinding';

const _p = new THREE.Vector3();

/** Joint indices into the sampled point list. */
const S_L = 0, W_L = 1, H_L = 2, K_L = 3, A_L = 4, S_R = 5, W_R = 6, H_R = 7, K_R = 8, A_R = 9, MID = 10;

/** Arm wings (shoulder–wrist–hip, plus a flap down to the knee) and the tail wing between the legs. */
const TRIS: [number, number, number][] = [
  [S_L, W_L, H_L],
  [W_L, K_L, H_L],
  [S_R, H_R, W_R],
  [W_R, H_R, K_R],
  [H_L, K_L, MID],
  [MID, K_L, A_L],
  [MID, A_L, A_R],
  [MID, A_R, K_R],
  [MID, K_R, H_R],
];

/**
 * Wingsuit fabric stretched between the rider's limbs, rebuilt from the posed skeleton each frame
 * so it works with any outfit. Unfurls from the body line when the suit deploys.
 */
export class WingsuitMembrane {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos = new Float32Array(TRIS.length * 9);
  private readonly pts = Array.from({ length: 11 }, () => new THREE.Vector3());
  private open = 0;

  constructor(
    private readonly rig: RigBinding,
    color = '#ff5a1f',
  ) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    rig.root.add(this.mesh);
  }

  /** Call after the pose has been applied. */
  update(deployed: boolean, dt: number): void {
    this.open = damp(this.open, deployed ? 1 : 0, deployed ? 6 : 14, dt);
    this.mesh.visible = this.open > 0.02;
    if (!this.mesh.visible) return;
    const r = this.rig;
    const root = r.root;
    const sample = (o: THREE.Object3D, out: THREE.Vector3) => root.worldToLocal(o.getWorldPosition(out));
    const p = this.pts;
    sample(r.armL.upper, p[S_L]!);
    sample(r.armL.end, p[W_L]!);
    sample(r.legL.upper, p[H_L]!);
    sample(r.legL.lower, p[K_L]!);
    sample(r.legL.end, p[A_L]!);
    sample(r.armR.upper, p[S_R]!);
    sample(r.armR.end, p[W_R]!);
    sample(r.legR.upper, p[H_R]!);
    sample(r.legR.lower, p[K_R]!);
    sample(r.legR.end, p[A_R]!);
    p[MID]!.copy(p[H_L]!).add(p[H_R]!).multiplyScalar(0.5);
    // Unfurl: limb points start folded onto the body line (shoulder/hip) and spread out.
    const k = this.open;
    p[W_L]!.lerpVectors(p[S_L]!, p[W_L]!, k);
    p[W_R]!.lerpVectors(p[S_R]!, p[W_R]!, k);
    p[A_L]!.lerpVectors(p[K_L]!, p[A_L]!, k);
    p[A_R]!.lerpVectors(p[K_R]!, p[A_R]!, k);
    let o = 0;
    for (const [a, b, c] of TRIS) {
      for (const i of [a, b, c]) {
        _p.copy(p[i]!);
        this.pos[o++] = _p.x;
        this.pos[o++] = _p.y;
        this.pos[o++] = _p.z;
      }
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
