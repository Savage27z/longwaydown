import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBone } from '../src/utils/ik';

function chain(): { root: THREE.Group; upper: THREE.Group; lower: THREE.Group; end: THREE.Group } {
  const root = new THREE.Group();
  root.position.set(1, 2, 3);
  root.rotation.y = 0.7;
  const upper = new THREE.Group();
  upper.position.set(0, 1, 0);
  root.add(upper);
  const lower = new THREE.Group();
  lower.position.set(0, -0.44, 0);
  upper.add(lower);
  const end = new THREE.Group();
  end.position.set(0, -0.43, 0);
  lower.add(end);
  root.updateMatrixWorld(true);
  return { root, upper, lower, end };
}

describe('two-bone IK', () => {
  it('reaches a reachable target and bends toward the pole', () => {
    const { upper, lower, end } = chain();
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const target = hip.clone().add(new THREE.Vector3(0.2, -0.7, 0.25));
    const pole = new THREE.Vector3(0, 0, 1);
    solveTwoBone(upper, lower, 0.44, 0.43, target, pole);
    const tip = end.getWorldPosition(new THREE.Vector3());
    expect(tip.distanceTo(target)).toBeLessThan(1e-3);
    const knee = lower.getWorldPosition(new THREE.Vector3());
    // Knee is pushed toward +Z relative to the hip-target line.
    const mid = hip.clone().lerp(target, 0.5);
    expect(knee.z - mid.z).toBeGreaterThan(0);
  });

  it('stretches straight toward an unreachable target', () => {
    const { upper, lower, end } = chain();
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const target = hip.clone().add(new THREE.Vector3(0, -3, 0));
    solveTwoBone(upper, lower, 0.44, 0.43, target, new THREE.Vector3(0, 0, 1));
    const tip = end.getWorldPosition(new THREE.Vector3());
    expect(tip.distanceTo(hip)).toBeGreaterThan(0.86);
    expect(tip.y).toBeLessThan(hip.y - 0.85);
  });
});
