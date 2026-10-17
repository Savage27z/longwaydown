// Usage: node scripts/compare-rigs.mjs <dir-with-gltf-files>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.gltf'));
let ref = null;
for (const f of files) {
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const names = j.skins[0].joints.map((i) => j.nodes[i].name).join('|');
  const meshes = j.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name);
  const mats = j.materials.map((m) => m.name).join(',');
  const size = readFileSync(join(dir, f)).length;
  if (!ref) ref = names;
  console.log(`${f.padEnd(20)} joints=${j.skins[0].joints.length} same=${names === ref} meshes=${meshes.join(',')} mats=${mats} ${(size / 1e6).toFixed(1)}MB`);
}
