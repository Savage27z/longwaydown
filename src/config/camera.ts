import type { VehicleId } from './vehicles';

export interface CameraProfile {
  /** Distance behind and height above the rider (m). */
  distance: number;
  height: number;
  /** Look target height above the rider and look-ahead along velocity (m). */
  lookHeight: number;
  lookAhead: number;
  fovBase: number;
  /** FOV increase per 100 km/h. */
  fovPerSpeed: number;
  fovMax: number;
  /** Follow stiffness (1/s). */
  follow: number;
  /** How fast the camera swings behind the travel direction (1/s). */
  yawFollow: number;
  /** Extra distance at high speed (m per 100 km/h). */
  distancePerSpeed: number;
}

const bike: CameraProfile = {
  distance: 4.3,
  height: 1.35,
  lookHeight: 1.05,
  lookAhead: 9,
  fovBase: 68,
  fovPerSpeed: 14,
  fovMax: 90,
  follow: 11,
  yawFollow: 6.5,
  distancePerSpeed: 0.3,
};

export const CAMERA_PROFILES: Record<VehicleId, CameraProfile> = {
  bicycle: bike,
  mountainBike: bike,
  motorbike: { ...bike, distance: 5.4, height: 1.9, fovBase: 68 },
  car: { ...bike, distance: 7.5, height: 2.8, lookHeight: 1.4, fovBase: 66, distancePerSpeed: 1.5 },
  flyingCar: { ...bike, distance: 8, height: 3, lookHeight: 1.5, fovBase: 68, distancePerSpeed: 1.6 },
  jet: { ...bike, distance: 11, height: 3.5, lookHeight: 1.5, lookAhead: 20, fovBase: 72, fovPerSpeed: 10, fovMax: 100, distancePerSpeed: 2 },
  snowboard: { ...bike, distance: 4.4, height: 1.8, lookHeight: 1.0 },
  onFoot: { ...bike, distance: 3.8, height: 1.7, lookHeight: 1.3, lookAhead: 6, fovBase: 66, fovPerSpeed: 8 },
  wingsuit: { ...bike, distance: 6.5, height: 1.6, lookHeight: 0.6, lookAhead: 18, fovBase: 72, fovPerSpeed: 12, fovMax: 98, distancePerSpeed: 1.2 },
  skis: { ...bike, distance: 4.4, height: 1.8, lookHeight: 1.0 },
};

export const CAMERA = {
  /** Seconds after the last orbit input before the camera swings back behind the rider. */
  orbitReturnDelay: 1.5,
  orbitReturnSpeed: 3,
  mouseSensitivity: 0.0045,
  stickSpeed: 2.6,
  minClearance: 1.2,
  shakeDecay: 1.8,
  shakeMaxOffset: 0.22,
  shakeMaxRoll: 0.03,
  /** First-person shake is scaled down by this (the view is attached to the head). */
  firstPersonShake: 0.4,
  /** First-person view. */
  firstPersonFov: 84,
  firstPersonFovPerSpeed: 12,
  firstPersonNear: 0.05,
  thirdPersonNear: 0.3,
  /** Far chase view multipliers. */
  farDistance: 1.9,
  farHeight: 2.3,
  /** Constant rumble on rough ground (max trauma). */
  rumble: 0.04,
  /** Vertical follow spring (1/s² on the ground; softer in the air) and damping ratio. Velocity is
   *  fed forward, so steady slopes track exactly and only takeoffs, landings and bumps lag. */
  verticalStiffness: 150,
  airStiffness: 50,
  verticalDamping: 0.85,
  maxVerticalLag: 0.8,
  /** Camera roll as a fraction of the bike's lean / the flyer's bank. */
  leanRoll: 0.07,
  bankRoll: 0.2,
  /** How much the chase angle follows the flight path when climbing / diving. */
  flightPitchFollow: 0.55,
  /** Extra distance in the air (fraction) and FOV kick while boosting (degrees). */
  airPullBack: 0.07,
  boostFov: 7,
  /** Shake (trauma 0..1) from landings: (impact - landingShakeFrom) / landingShakeRange, capped. */
  landingShakeFrom: 5,
  landingShakeRange: 20,
  landingShakeMax: 0.45,
  crashShake: 0.45,
};

export type CameraView = 'chase' | 'far' | 'first';
export const CAMERA_VIEW_LABELS: Record<CameraView, string> = { chase: 'Chase cam', far: 'Far chase cam', first: 'First person' };
