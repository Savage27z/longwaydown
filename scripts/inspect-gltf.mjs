// Usage: node scripts/inspect-gltf.mjs <file.gltf>
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const j = JSON.parse(readFileSync(file, 'utf8'));
const nodes = j.nodes ?? [];
console.log('asset', j.asset?.generator, 'scenes', j.scenes?.length, 'nodes', nodes.length);
console.log('meshes', (j.meshes ?? []).map((m) => `${m.name}[${m.primitives.length}]`).join(', '));
console.log('materials', (j.materials ?? []).map((m) => `${m.name}:${(m.pbrMetallicRoughness?.baseColorFactor ?? []).map((v) => v.toFixed(2)).join('/')}${m.pbrMetallicRoughness?.baseColorTexture ? '+tex' : ''}`).join(', '));
console.log('textures', (j.textures ?? []).length, 'images', (j.images ?? []).length);
console.log('skins', (j.skins ?? []).map((s) => `${s.name} joints=${s.joints.length}`).join(', '));
console.log('animations', (j.animations ?? []).map((a) => a.name).join(', '));
const skin = j.skins?.[0];
if (skin) {
  const depth = new Map();
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const d = (i) => (parent.has(i) ? d(parent.get(i)) + 1 : 0);
  for (const ji of skin.joints) {
    const n = nodes[ji];
    const t = (n.translation ?? [0, 0, 0]).map((v) => v.toFixed(3)).join(',');
    const r = (n.rotation ?? [0, 0, 0, 1]).map((v) => v.toFixed(2)).join(',');
    console.log(`${'  '.repeat(d(ji))}${n.name}  t=(${t}) r=(${r})${n.scale ? ' s=' + n.scale : ''}`);
  }
}
const meshNodes = nodes.filter((n) => n.mesh !== undefined).map((n) => `${n.name}${n.skin !== undefined ? '(skinned)' : ''}`);
console.log('mesh nodes', meshNodes.join(', '));
