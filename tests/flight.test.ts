import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLIGHT, VEHICLES, type FlyerId } from '../src/config/vehicles';
import { FlightModel } from '../src/vehicles/FlightModel';
import { emptyInput, type VehicleInput } from '../src/vehicles/Vehicle';

const DT = 1 / 60;

/** Fly for `seconds` the way the game does: gravity (Rapier), flight model, then aero drag. */
function fly(id: FlyerId, aero: number, seconds: number, input: VehicleInput = emptyInput(), v0 = new THREE.Vector3(0, -2, 30), height = 300) {
  const f = FLIGHT[id];
  const model = new FlightModel(() => f);
  const v = v0.clone();
  let heading = 0;
  const start = { y: 0, z: 0 };
  const pos = { y: 0, z: 0 };
  for (let i = 0; i < seconds / DT; i++) {
    v.y -= 9.81 * f.gravity * DT;
    heading = model.step(DT, input, v, heading, height + pos.y);
    v.multiplyScalar(Math.max(0, 1 - aero * v.length() * DT));
    pos.y += v.y * DT;
    pos.z += Math.hypot(v.x, v.z) * DT;
  }
  return { model, v, drop: start.y - pos.y, dist: pos.z - start.z, heading };
}

describe('flight model', () => {
  it('wingsuit glides about 1.5–2.5 : 1 at the neutral attitude, at freeride speeds', () => {
    // Settle into the glide, then measure.
    const settled = fly('wingsuit', VEHICLES.wingsuit.aero, 12);
    const run = fly('wingsuit', VEHICLES.wingsuit.aero, 10, emptyInput(), settled.v);
    const ratio = run.dist / run.drop;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
    const kmh = run.v.length() * 3.6;
    expect(kmh).toBeGreaterThan(110);
    expect(kmh).toBeLessThan(190);
  });

  it('diving is faster and flaring slows the wingsuit', () => {
    const settled = fly('wingsuit', VEHICLES.wingsuit.aero, 12).v;
    const dive = fly('wingsuit', VEHICLES.wingsuit.aero, 6, { ...emptyInput(), throttle: 1 }, settled);
    const flare = fly('wingsuit', VEHICLES.wingsuit.aero, 3, { ...emptyInput(), brake: 1 }, settled);
    expect(dive.v.length()).toBeGreaterThan(settled.length() + 5);
    expect(flare.v.length()).toBeLessThan(settled.length() - 3);
  });

  it('levels its wings and returns to the neutral attitude when the stick is released', () => {
    const f = FLIGHT.jet;
    const model = new FlightModel(() => f);
    const v = new THREE.Vector3(0, 0, 40);
    const hard = { ...emptyInput(), steer: 1, brake: 1 };
    for (let i = 0; i < 60; i++) model.step(DT, hard, v, 0, 100);
    expect(model.bank).toBeGreaterThan(f.bankMax * 0.6);
    expect(model.pitch).toBeGreaterThan(0.2);
    for (let i = 0; i < 180; i++) model.step(DT, emptyInput(), v, 0, 100);
    expect(Math.abs(model.bank)).toBeLessThan(0.05);
    expect(Math.abs(model.pitch - f.neutralPitch)).toBeLessThan(0.05);
  });

  it('turns toward the stick (right = negative heading change)', () => {
    const right = fly('jet', VEHICLES.jet.aero, 2, { ...emptyInput(), steer: 1 });
    expect(right.heading).toBeLessThan(-0.3);
  });

  it('noses down when too slow (stall recovery)', () => {
    const f = FLIGHT.wingsuit;
    const model = new FlightModel(() => f);
    const v = new THREE.Vector3(0, 0, 5);
    const climb = { ...emptyInput(), brake: 1 };
    for (let i = 0; i < 60; i++) model.step(DT, climb, v, 0, 200);
    expect(model.pitch).toBeLessThan(f.neutralPitch);
  });

  it('eases the nose up just above the terrain', () => {
    const f = FLIGHT.wingsuit;
    const model = new FlightModel(() => f);
    const v = new THREE.Vector3(0, -12, 40);
    for (let i = 0; i < 60; i++) model.step(DT, emptyInput(), v, 0, 1);
    expect(model.pitch).toBeGreaterThan(f.neutralPitch + 0.1);
  });
});
