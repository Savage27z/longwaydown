import * as THREE from 'three';

export interface NameTagItem {
  id: string;
  name: string;
  position: number;
  color: string;
  /** Where the tag sits (local coordinates), usually just above the rider's head. */
  at: THREE.Vector3;
  show: boolean;
}

const _v = new THREE.Vector3();

/** Floating name tags (position + name) over the other riders, projected each frame. */
export class NameTags {
  readonly el = document.createElement('div');
  private tags = new Map<string, HTMLDivElement>();

  constructor(parent: HTMLElement) {
    this.el.className = 'hud-tags';
    parent.appendChild(this.el);
  }

  update(camera: THREE.Camera, items: NameTagItem[]): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const it of items) {
      let tag = this.tags.get(it.id);
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'tag';
        this.el.appendChild(tag);
        this.tags.set(it.id, tag);
      }
      // Behind the camera, projection mirrors points onto the screen: check camera space first.
      const inFront = _v.copy(it.at).applyMatrix4(camera.matrixWorldInverse).z < -0.5;
      _v.copy(it.at).project(camera);
      const visible = it.show && inFront && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      tag.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const html = `<b style="background:${it.color}">${it.position}</b>${it.name}`;
      if (tag.dataset.html !== html) {
        tag.innerHTML = html;
        tag.dataset.html = html;
      }
      tag.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
