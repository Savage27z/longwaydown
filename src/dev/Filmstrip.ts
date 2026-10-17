import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { PlayMode } from '../core/PlayMode';

const _focus = new THREE.Vector3();

interface FilmOptions {
  /** Frames to capture and game frames between captures. */
  count?: number;
  every?: number;
  cols?: number;
  /** Keep this centred fraction of each frame (zooms on the rider). */
  crop?: number;
  /** Cell width in the sheet (px). */
  cell?: number;
  /** File name under .shots/ (dev server). */
  name?: string;
  /** Film camera orbiting the rider: yaw relative to their heading (0 = behind, π/2 = their right side), pitch, distance (m). */
  view?: { yaw: number; pitch: number; dist: number };
}

/**
 * Dev: render a run of frames synchronously and tile them into one contact sheet, saved by the dev
 * server to `.shots/<name>.jpg`, so motion can be judged from one image even when the browser pane
 * is hidden or throttled.   __film({ count: 12, every: 5, crop: 0.6, name: 'jump' })
 */
export function installFilmstrip(game: Game): void {
  const w = window as unknown as Record<string, unknown>;
  w.__film = async (o: FilmOptions = {}): Promise<string> => {
    const { count = 12, every = 5, cols = 4, crop = 1, cell = 320, name = 'film' } = o;
    const src = game.renderer.renderer.domElement;
    const sw = src.width * crop;
    const sh = src.height * crop;
    const ch = Math.round((cell * sh) / sw);
    const rows = Math.ceil(count / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * cell;
    sheet.height = rows * ch;
    const ctx = sheet.getContext('2d')!;
    ctx.font = 'bold 16px sans-serif';
    for (let i = 0; i < count; i++) {
      game.loop.advance(every / 60);
      if (o.view) {
        const player = (game.mode as PlayMode).player;
        player.focusLocal(_focus);
        _focus.y += 0.7;
        const a = player.vehicle.telemetry.heading + Math.PI + o.view.yaw;
        const cam = game.renderer.camera;
        const r = o.view.dist * Math.cos(o.view.pitch);
        cam.position.set(_focus.x + Math.sin(a) * r, _focus.y + o.view.dist * Math.sin(o.view.pitch), _focus.z + Math.cos(a) * r);
        cam.up.set(0, 1, 0);
        cam.lookAt(_focus);
        game.renderer.render();
      }
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * ch;
      // Drawn right after the render, before the drawing buffer is discarded.
      ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, x, y, cell, ch);
      ctx.fillStyle = '#ff0';
      ctx.fillText(String(i), x + 6, y + 18);
    }
    const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.82) });
    return res.ok ? `.shots/${name}.jpg` : `failed ${res.status}`;
  };
}
