import { MAP_ORDER, MAPS, type MapId } from '../config/maps';
import type { Save } from '../core/Save';
import { generateCourse, type CourseData } from '../world/CourseGenerator';
import { formatTime } from '../utils/math';

const courseCache = new Map<MapId, CourseData>();

function courseFor(id: MapId): CourseData {
  let c = courseCache.get(id);
  if (!c) {
    c = generateCourse(MAPS[id]);
    courseCache.set(id, c);
  }
  return c;
}

/** Top-down course line + elevation profile preview. */
function drawPreview(canvas: HTMLCanvasElement, c: CourseData, accent: string): void {
  const g = canvas.getContext('2d')!;
  const W = (canvas.width = canvas.clientWidth * 2 || 560);
  const H = (canvas.height = 340);
  g.clearRect(0, 0, W, H);
  const b = c.bounds;
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  // Lay the course left-to-right along its longest axis.
  const alongX = spanX > spanZ;
  const len = Math.max(spanX, spanZ);
  const wid = Math.min(spanX, spanZ);
  const sx = (W - 40) / len;
  const sy = Math.min((H * 0.55) / Math.max(wid, 1), sx);
  const map = (x: number, z: number): [number, number] => {
    const u = alongX ? x - b.minX : z - b.minZ;
    const v = alongX ? z - (b.minZ + b.maxZ) / 2 : x - (b.minX + b.maxX) / 2;
    return [20 + u * sx, H * 0.32 + v * sy];
  };
  g.lineWidth = 5;
  g.lineJoin = 'round';
  g.strokeStyle = accent;
  g.beginPath();
  for (let i = 0; i < c.count; i += 10) {
    const [x, y] = map(c.x[i]!, c.z[i]!);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  // Elevation profile along the bottom.
  const minY = c.finishElevation;
  const maxY = c.summitElevation;
  g.beginPath();
  g.moveTo(20, H - 10);
  for (let i = 0; i < c.count; i += 20) {
    const x = 20 + (i / c.count) * (W - 40);
    const y = H - 10 - ((c.y[i]! - minY) / (maxY - minY)) * (H * 0.35);
    g.lineTo(x, y);
  }
  g.lineTo(W - 20, H - 10);
  g.closePath();
  g.fillStyle = 'rgba(244,248,255,0.18)';
  g.fill();
  g.strokeStyle = 'rgba(244,248,255,0.6)';
  g.lineWidth = 2;
  g.stroke();
}

/** Map select screen: one card per map with preview, stats, best time and lock state. */
export function mapSelectScreen(save: Save, onPick: (id: MapId) => void, onBack: () => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'menu-panel wide card';
  panel.innerHTML = `<h2 class="menu-heading">Choose your mountain</h2><div class="map-cards"></div><div class="row back-row"><button class="btn small" data-back><span>Back</span></button></div>`;
  const cards = panel.querySelector('.map-cards')!;
  for (const id of MAP_ORDER) {
    const map = MAPS[id];
    const c = courseFor(id);
    const unlocked = save.isMapUnlocked(id);
    const best = save.data.progress.bestTimes[id];
    const card = document.createElement('div');
    card.className = `map-card${unlocked ? '' : ' locked'}`;
    card.innerHTML = `
      <canvas></canvas>
      ${unlocked ? '' : '<div class="lock-badge">🔒 Finish Snow Peak to unlock</div>'}
      <h3>${map.name}</h3>
      <p>${map.tagline}</p>
      <div class="map-stats">
        <div>Length<b>${(c.length / 1000).toFixed(1)} km</b></div>
        <div>Drop<b>${map.totalDrop.toLocaleString()} m</b></div>
        <div>Best<b>${best ? formatTime(best.time, false) : '—'}</b></div>
      </div>`;
    if (unlocked) card.addEventListener('click', () => onPick(id));
    cards.appendChild(card);
    requestAnimationFrame(() => drawPreview(card.querySelector('canvas')!, c, map.biome === 'snow' ? '#3ec8ff' : '#7ddc5a'));
  }
  panel.querySelector('[data-back]')!.addEventListener('click', onBack);
  return panel;
}
