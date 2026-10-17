// Merge Quaternius "Ultimate Modular Men" glTF characters into one compact GLB:
// one shared skeleton, every outfit part mesh (skinned), no animations, deduplicated materials.
// Usage: node scripts/build-riders.mjs <dir-with-gltf-files> <out.glb>
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [srcDir, outFile] = process.argv.slice(2);
if (!srcDir || !outFile) {
  console.error('usage: node scripts/build-riders.mjs <srcDir> <out.glb>');
  process.exit(1);
}

const SKIP_MESHES = new Set(['Pistol']);
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function loadGltf(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const buffers = json.buffers.map((b) => {
    if (b.uri?.startsWith('data:')) return Buffer.from(b.uri.split(',')[1], 'base64');
    return readFileSync(join(dirname(file), decodeURIComponent(b.uri)));
  });
  return { json, buffers };
}

/** Read an accessor into a tightly packed typed array. */
function readAccessor(g, index) {
  const acc = g.json.accessors[index];
  const view = g.json.bufferViews[acc.bufferView];
  const buf = g.buffers[view.buffer];
  const Typed = TYPED[acc.componentType];
  const comps = COMPONENTS[acc.type];
  const elemBytes = Typed.BYTES_PER_ELEMENT * comps;
  const stride = view.byteStride ?? elemBytes;
  const out = new Typed(acc.count * comps);
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    const src = new Typed(buf.buffer.slice(buf.byteOffset + base + i * stride, buf.byteOffset + base + i * stride + elemBytes));
    out.set(src, i * comps);
  }
  return { data: out, acc };
}

// ---- Output builder ----
const out = { asset: { version: '2.0', generator: 'rider build-riders.mjs' }, extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'], scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], skins: [], accessors: [], bufferViews: [], buffers: [] };
const chunks = [];
let byteLength = 0;

/** Quantize vertex attributes: normals -> int8 (KHR_mesh_quantization), weights -> uint8, joints -> uint8. */
function quantize(name, data, acc) {
  if (name === 'NORMAL' && acc.componentType === 5126) {
    // int8 VEC3 must be padded to 4 bytes per element.
    const q = new Int8Array(acc.count * 4);
    for (let i = 0; i < acc.count; i++) for (let c = 0; c < 3; c++) q[i * 4 + c] = Math.round(Math.max(-1, Math.min(1, data[i * 3 + c])) * 127);
    return { data: q, acc: { componentType: 5120, count: acc.count, type: 'VEC3', normalized: true }, stride: 4 };
  }
  if (name === 'WEIGHTS_0' && acc.componentType === 5126) {
    const q = new Uint8Array(acc.count * 4);
    for (let i = 0; i < acc.count; i++) {
      let sum = 0;
      let maxC = 0;
      for (let c = 0; c < 4; c++) {
        q[i * 4 + c] = Math.round(data[i * 4 + c] * 255);
        sum += q[i * 4 + c];
        if (q[i * 4 + c] > q[i * 4 + maxC]) maxC = c;
      }
      q[i * 4 + maxC] += 255 - sum;
    }
    return { data: q, acc: { componentType: 5121, count: acc.count, type: 'VEC4', normalized: true } };
  }
  if (name === 'JOINTS_0' && acc.componentType !== 5121) {
    const q = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) q[i] = data[i];
    return { data: q, acc: { componentType: 5121, count: acc.count, type: 'VEC4' } };
  }
  return { data, acc };
}

function addAccessor(data, acc, target, stride) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  const viewIndex = out.bufferViews.length;
  out.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}), ...(stride ? { byteStride: stride } : {}) });
  chunks.push(bytes);
  byteLength += bytes.length;
  const a = { bufferView: viewIndex, componentType: acc.componentType, count: acc.count, type: acc.type };
  if (acc.normalized) a.normalized = true;
  if (acc.min) a.min = acc.min;
  if (acc.max) a.max = acc.max;
  out.accessors.push(a);
  return out.accessors.length - 1;
}

const files = readdirSync(srcDir).filter((f) => f.endsWith('.gltf')).sort();
const materialKeys = new Map();
let skeletonDone = false;
let armatureIndex = -1;
const report = [];

for (const f of files) {
  const g = loadGltf(join(srcDir, f));
  const j = g.json;
  const skin = j.skins[0];
  const character = f.replace('.gltf', '');

  if (!skeletonDone) {
    // Copy the armature: every ancestor of the skin joints plus the joints themselves.
    const parent = new Map();
    j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
    const keep = new Set();
    for (const ji of skin.joints) {
      let i = ji;
      while (i !== undefined) {
        keep.add(i);
        i = parent.get(i);
      }
    }
    const remap = new Map();
    for (const i of [...keep].sort((a, b) => a - b)) {
      const n = j.nodes[i];
      const copy = { name: n.name };
      for (const k of ['translation', 'rotation', 'scale', 'matrix']) if (n[k]) copy[k] = n[k];
      remap.set(i, out.nodes.length);
      out.nodes.push(copy);
    }
    for (const i of keep) {
      const kids = (j.nodes[i].children ?? []).filter((c) => keep.has(c)).map((c) => remap.get(c));
      if (kids.length) out.nodes[remap.get(i)].children = kids;
    }
    const roots = [...keep].filter((i) => !keep.has(parent.get(i)));
    armatureIndex = remap.get(roots[0]);
    out.scenes[0].nodes.push(armatureIndex);
    const ibm = readAccessor(g, skin.inverseBindMatrices);
    out.skins.push({ name: 'Rider', joints: skin.joints.map((ji) => remap.get(ji)), inverseBindMatrices: addAccessor(ibm.data, ibm.acc) });
    skeletonDone = true;
  }

  for (const n of j.nodes) {
    if (n.mesh === undefined || SKIP_MESHES.has(n.name)) continue;
    const mesh = j.meshes[n.mesh];
    const prims = [];
    for (const p of mesh.primitives) {
      const attributes = {};
      for (const name of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']) {
        if (p.attributes[name] === undefined) continue;
        const a = readAccessor(g, p.attributes[name]);
        const q = quantize(name, a.data, a.acc);
        attributes[name] = addAccessor(q.data, q.acc, 34962, q.stride);
      }
      const prim = { attributes };
      if (p.indices !== undefined) {
        const idx = readAccessor(g, p.indices);
        prim.indices = addAccessor(idx.data, idx.acc, 34963);
      }
      if (p.material !== undefined) {
        const m = j.materials[p.material];
        const color = m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
        const key = `${m.name}|${color.map((c) => c.toFixed(3)).join(',')}`;
        let mi = materialKeys.get(key);
        if (mi === undefined) {
          const sameName = out.materials.filter((x) => x.extras.baseName === m.name).length;
          mi = out.materials.length;
          out.materials.push({
            name: sameName ? `${m.name}_${character}` : m.name,
            pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.85 },
            extras: { baseName: m.name },
          });
          materialKeys.set(key, mi);
        }
        prim.material = mi;
      }
      prims.push(prim);
    }
    out.meshes.push({ name: n.name, primitives: prims });
    const node = { name: n.name, mesh: out.meshes.length - 1, skin: 0 };
    for (const k of ['translation', 'rotation', 'scale']) if (n[k]) node[k] = n[k];
    out.nodes.push(node);
    out.scenes[0].nodes.push(out.nodes.length - 1);
    report.push(`${character}: ${n.name}`);
  }
}

// ---- Write GLB ----
const bin = Buffer.concat(chunks);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
out.buffers.push({ byteLength: binPadded.length });
const jsonBuf = Buffer.from(JSON.stringify(out));
const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(jsonPadded.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(binPadded.length, 0);
bh.writeUInt32LE(0x004e4942, 4);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, Buffer.concat([header, jh, jsonPadded, bh, binPadded]));
console.log(`wrote ${outFile}: ${(12 + 16 + jsonPadded.length + binPadded.length) / 1e6} MB, ${out.meshes.length} meshes, ${out.materials.length} materials, ${out.skins[0].joints.length} joints`);
console.log(report.join('\n'));
