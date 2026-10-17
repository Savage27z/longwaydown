import * as THREE from 'three';
import { WORLD } from '../config/world';
import type { GraphicsSettings } from '../config/graphics';

/**
 * Owns the WebGL renderer, scene, camera and the floating-origin world root.
 *
 * Coordinate spaces:
 * - "global": absolute course coordinates (f64 in JS). Static world content (terrain, props)
 *   lives under `worldRoot` using global coordinates; `worldRoot.position = -origin`.
 * - "local": physics/simulation space (origin-relative, small numbers). Dynamic objects
 *   (vehicles, character, camera, particles) are direct scene children in local space.
 * three.js composes matrices on the CPU in f64, so geometry stays precise either way.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly worldRoot = new THREE.Group();
  readonly reversedDepth: boolean;
  private settings: GraphicsSettings;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    settings: GraphicsSettings,
  ) {
    this.settings = settings;
    const probe = document.createElement('canvas').getContext('webgl2');
    const clipControl = !!probe?.getExtension('EXT_clip_control');
    this.reversedDepth = clipControl;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.antialias,
      powerPreference: 'high-performance',
      reversedDepthBuffer: clipControl,
      logarithmicDepthBuffer: !clipControl,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(70, 1, WORLD.cameraNear, WORLD.cameraFar);
    this.worldRoot.name = 'worldRoot';
    this.worldRoot.matrixAutoUpdate = true;
    this.scene.add(this.worldRoot);
    this.scene.add(this.camera);

    window.addEventListener('resize', this.resize);
    this.applyPixelRatio();
    this.resize();
  }

  get graphics(): GraphicsSettings {
    return this.settings;
  }

  applySettings(settings: GraphicsSettings): void {
    this.settings = settings;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.applyPixelRatio();
    this.resize();
    // Materials need recompiling when shadow support toggles.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }

  private applyPixelRatio(): void {
    const pr = Math.min(window.devicePixelRatio * this.settings.pixelRatioScale, this.settings.maxPixelRatio);
    this.renderer.setPixelRatio(Math.max(0.5, pr));
  }

  resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}
