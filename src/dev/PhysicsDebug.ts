import * as THREE from 'three';
import type { Game } from '../core/Game';

/** Draws Rapier's debug lines (colliders) over the scene. Dev only. */
export class PhysicsDebug {
  private lines: THREE.LineSegments;
  private geo = new THREE.BufferGeometry();
  enabled = false;

  constructor(private readonly game: Game) {
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthTest: true });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 999;
    this.lines.visible = false;
    game.renderer.scene.add(this.lines);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.lines.visible = on;
  }

  tick(): void {
    if (!this.enabled) return;
    const { vertices, colors } = this.game.physics.world.debugRender();
    this.geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.geo.computeBoundingSphere();
  }
}
