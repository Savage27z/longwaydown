import * as THREE from 'three';
import type { GraphicsSettings } from '../config/graphics';
import { DEG } from '../utils/math';
import type { BiomeDef } from './Biome';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.25, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.18 + pow(s, 6.0) * 0.08);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Sky dome, sun (shadow-casting, follows the player with texel snapping), hemisphere light,
 * distance fog matched to the horizon colour, and a distant ring of mountain silhouettes.
 */
export class Sky {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3();
  private dome: THREE.Mesh;
  private ring: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private horizon: THREE.Color;
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();
  private extent = 90;
  /** Global elevation the horizon ring stands on. */
  ringBase = 0;
  private mapSize = 2048;

  constructor(
    private readonly scene: THREE.Scene,
    readonly biome: BiomeDef,
    graphics: GraphicsSettings,
  ) {
    const sky = biome.sky;
    this.horizon = new THREE.Color(sky.horizon);
    const el = sky.sunElevationDeg * DEG;
    const az = sky.sunAzimuthDeg * DEG;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this.lightUp.crossVectors(this.sunDir, this.lightRight).normalize();

    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uZenith: { value: new THREE.Color(sky.zenith) },
        uHorizon: { value: this.horizon },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Color(sky.sunColor) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.ring = this.buildRing();
    scene.add(this.ring);

    this.hemi = new THREE.HemisphereLight(sky.hemiSky, sky.hemiGround, sky.hemiIntensity);
    this.sun = new THREE.DirectionalLight(sky.sunColor, sky.sunIntensity);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 900;
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = new THREE.Fog(this.horizon, sky.fogNear, graphics.fogFar);
    this.applyGraphics(graphics);
  }

  applyGraphics(g: GraphicsSettings): void {
    this.sun.castShadow = g.shadows;
    this.extent = g.shadowExtent;
    const cam = this.sun.shadow.camera;
    cam.left = -this.extent;
    cam.right = this.extent;
    cam.top = this.extent;
    cam.bottom = -this.extent;
    cam.updateProjectionMatrix();
    if (this.mapSize !== g.shadowMapSize) {
      this.mapSize = g.shadowMapSize;
      this.sun.shadow.mapSize.set(g.shadowMapSize, g.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    } else {
      this.sun.shadow.mapSize.set(g.shadowMapSize, g.shadowMapSize);
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.far = g.fogFar;
  }

  /** Follow the camera (dome, ring) and the focus (sun shadow frustum, texel snapped). */
  update(camera: THREE.Camera, focusLocal: THREE.Vector3, originY: number): void {
    this.dome.position.copy(camera.position);
    this.ring.position.set(camera.position.x, this.ringBase - originY, camera.position.z);
    const texel = (this.extent * 2) / this.mapSize;
    const r = Math.round(focusLocal.dot(this.lightRight) / texel) * texel;
    const u = Math.round(focusLocal.dot(this.lightUp) / texel) * texel;
    const f = focusLocal.dot(this.sunDir);
    const snapped = new THREE.Vector3().addScaledVector(this.lightRight, r).addScaledVector(this.lightUp, u).addScaledVector(this.sunDir, f);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDir, 400);
    this.sun.target.updateMatrixWorld();
  }

  /** Jagged mountain silhouettes on the horizon (no fog, atmospheric tint baked in). */
  private buildRing(): THREE.Mesh {
    const segs = 160;
    const radius = 14000;
    const positions: number[] = [];
    const colors: number[] = [];
    // Heavy atmospheric perspective: faint silhouettes just darker than the horizon haze.
    const base = new THREE.Color(this.biome.sky.horizon).lerp(new THREE.Color('#7186a3'), 0.32);
    const peak = new THREE.Color(this.biome.id === 'snow' ? '#f4f8fc' : '#dfe5ea').lerp(this.horizon, 0.45);
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const heights: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      heights.push(900 + Math.abs(Math.sin(a * 3.1) * 900 + Math.sin(a * 7.3 + 1) * 500) + Math.pow(rnd(), 2) * 900);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const h0 = heights[i]!;
      const h1 = heights[(i + 1) % segs]!;
      const shade = 1;
      const p = (a: number, y: number) => [Math.sin(a) * radius, y, Math.cos(a) * radius];
      const quad = [p(a0, -500), p(a1, -500), p(a1, h1), p(a0, -500), p(a1, h1), p(a0, h0)];
      for (const v of quad) {
        positions.push(...(v as number[]));
        colors.push(shade, shade, shade);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // Colour by altitude in the fragment shader (haze at the base, snow on the peaks).
    const mat = new THREE.ShaderMaterial({
      uniforms: { uBase: { value: base }, uPeak: { value: peak }, uBaseH: { value: 0 } },
      vertexShader: `
        attribute vec3 color;
        varying float vH;
        varying vec3 vShade;
        void main() { vH = position.y; vShade = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uBase; uniform vec3 uPeak; uniform float uBaseH;
        varying float vH; varying vec3 vShade;
        void main() {
          float t = smoothstep(uBaseH + 300.0, uBaseH + 2200.0, vH);
          gl_FragColor = vec4(mix(uBase, uPeak, t) * vShade, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
      fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -5;
    return m;
  }

  dispose(): void {
    this.scene.remove(this.dome, this.ring, this.hemi, this.sun, this.sun.target);
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
    this.scene.fog = null;
  }
}
