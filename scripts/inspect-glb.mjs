// Usage: node scripts/inspect-glb.mjs <file.glb> [more.glb...]
// Prints the node tree (with translations), mesh bounds from accessor min/max, materials and textures.
import { readFileSync } from 'node:fs';

function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

for (const file of process.argv.slice(2)) {
  const j = readGlb(file);
  const nodes = j.nodes ?? [];
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const fmt = (a) => (a ?? []).map((v) => v.toFixed(2)).join(',');
  console.log(`\n== ${file}`);
  console.log('materials:', (j.materials ?? []).map((m) => `${m.name}${m.pbrMetallicRoughness?.baseColorTexture ? '+tex' : ''}`).join(', '));
  console.log('textures:', (j.textures ?? []).length, 'images:', (j.images ?? []).map((im) => im.name ?? im.mimeType).join(', '));
  const walk = (i, depth) => {
    const n = nodes[i];
    let bounds = '';
    if (n.mesh !== undefined) {
      const mesh = j.meshes[n.mesh];
      const acc = j.accessors[mesh.primitives[0].attributes.POSITION];
      bounds = ` mesh=${mesh.name} min=(${fmt(acc.min)}) max=(${fmt(acc.max)}) prims=${mesh.primitives.length}`;
    }
    console.log(`${'  '.repeat(depth)}${n.name ?? '(node)'} t=(${fmt(n.translation)})${n.rotation ? ` r=(${fmt(n.rotation)})` : ''}${n.scale ? ` s=(${fmt(n.scale)})` : ''}${bounds}`);
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  const roots = (j.scenes?.[j.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !parent.has(i)));
  for (const r of roots) walk(r, 0);
}
