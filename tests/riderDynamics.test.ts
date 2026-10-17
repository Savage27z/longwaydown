import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BODY_MOTION } from '../src/config/riderMotion';
import { RiderDynamics, type MotionFrame } from '../src/player/RiderDynamics';
import { makePose } from '../src/player/rig/pose';
import { emptyInput } from '../src/vehicles/Vehicle';

const DT = 1 / 60;
const G = 14.715;
const ID = new THREE.Quaternion();

function frame(over: Partial<MotionFrame> = {}): MotionFrame {
  return { vehicle: 'bicycle', quaternion: ID, input: emptyInput(), speed: 20, grounded: true, heading: 0, height: 0, vy: 0, ...over };
}

/** Ride on flat ground at a steady speed for a while so the body settles. */
function settled(): RiderDynamics {
  const d = new RiderDynamics();
  for (let i = 0; i < 120; i++) d.step(DT, 'bicycle', { x: 0, y: 0, z: 20 }, ID, G, true, 0, 20);
  return d;
}

describe('rider body dynamics', () => {
  it('stays put when nothing changes', () => {
    const d = settled();
    expect(d.offset.length()).toBeLessThan(0.005);
  });

  it('compresses on a landing, within the limit, then recovers', () => {
    const d = settled();
    const p = BODY_MOTION.bicycle;
    // Falling at 7 m/s, then the ground stops it over a few steps.
    for (let i = 0; i < 4; i++) d.step(DT, 'bicycle', { x: 0, y: -7 + i * 2.3, z: 20 }, ID, G, true, 0, 20);
    let lowest = 0;
    for (let i = 0; i < 30; i++) {
      d.step(DT, 'bicycle', { x: 0, y: 0, z: 20 }, ID, G, true, 0, 20);
      lowest = Math.min(lowest, d.offset.y);
    }
    expect(lowest).toBeLessThan(-0.08);
    expect(lowest).toBeGreaterThanOrEqual(-p.maxDown - 1e-9);
    for (let i = 0; i < 240; i++) d.step(DT, 'bicycle', { x: 0, y: 0, z: 20 }, ID, G, true, 0, 20);
    expect(Math.abs(d.offset.y)).toBeLessThan(0.01);
  });

  it('floats up while weightless and pops instead of squashing on takeoff', () => {
    const d = settled();
    // Takeoff: a jump adds 5 m/s upward in one step.
    d.step(DT, 'bicycle', { x: 0, y: 5, z: 20 }, ID, G, false, 0, 20);
    let vy = 5;
    for (let i = 0; i < 20; i++) {
      vy -= G * DT;
      d.step(DT, 'bicycle', { x: 0, y: vy, z: 20 }, ID, G, false, 0, 20);
    }
    expect(d.offset.y).toBeGreaterThan(0.02);
    expect(d.offset.y).toBeLessThanOrEqual(BODY_MOTION.bicycle.maxUp + 1e-9);
  });

  it('throws the body forward under hard braking', () => {
    const d = settled();
    let v = 20;
    for (let i = 0; i < 20; i++) {
      v -= 9 * DT;
      d.step(DT, 'bicycle', { x: 0, y: 0, z: v }, ID, G, true, 0, v);
    }
    expect(d.offset.z).toBeGreaterThan(0.02);
  });

  it('tucks in the air and reaches for the landing', () => {
    const d = settled();
    const rest = makePose();
    const hipsY = rest.hips.y;
    // High in the air: tuck pulls the hips toward the feet.
    let pose = makePose();
    for (let i = 0; i < 30; i++) {
      pose = makePose();
      d.apply(pose, DT, frame({ grounded: false, height: 6, vy: -2 }));
    }
    const tucked = pose.hips.y;
    expect(tucked).toBeLessThan(hipsY - 0.03);
    // About to land: the legs extend again.
    for (let i = 0; i < 20; i++) {
      pose = makePose();
      d.apply(pose, DT, frame({ grounded: false, height: 1, vy: -6 }));
    }
    expect(pose.hips.y).toBeGreaterThan(tucked + 0.05);
  });

  it('plays the switch hop and then lands back in the pose', () => {
    const d = settled();
    d.hop();
    let peak = 0;
    let pose = makePose();
    for (let i = 0; i < 60; i++) {
      pose = makePose();
      d.apply(pose, DT, frame());
      peak = Math.max(peak, pose.hips.y);
    }
    expect(peak).toBeGreaterThan(makePose().hips.y + 0.3);
    expect(Math.abs(pose.hips.y - makePose().hips.y)).toBeLessThan(0.02);
  });
});
