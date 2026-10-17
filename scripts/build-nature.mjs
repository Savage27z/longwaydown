// Pack hand-picked Quaternius "Stylized Nature MegaKit" (CC0) models into one compact GLB.
// Usage: node scripts/build-nature.mjs "<kit>/glTF" public/models/nature.glb
//
// Each pick becomes a named root node. Foliage keeps its small cut-out texture; bark and rock
// textures (several MB each, invisible at riding speed) become flat colours, and the kit's
// vertex colours (baked shading) are kept. Normals and colours are quantized.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [srcDir, outFile] = process.argv.slice(2);
if (!srcDir || !outFile) {
  console.error('usage: node scripts/build-nature.mjs <glTF dir> <out.glb>');
  process.exit(1);
}

const PICKS = {
  pine_a: 'Pine_5',
  pine_b: 'Pine_2',
  pine_c: 'Pine_1',
  broadleaf_a: 'CommonTree_5',
  broadleaf_b: 'CommonTree_3',
  bush: 'Bush_Common',
  rock_a: 'Rock_Medium_1',
  rock_b: 'Rock_Medium_2',
  rock_c: 'Rock_Medium_3',
  grass_a: 'Grass_Common_Short',
  grass_b: 'Grass_Wispy_Short',
  flowers: 'Flower_3_Group',
};
/** Materials that keep their texture (small cut-out foliage sheets). */
const KEEP_TEXTURE = new Set(['Leaves_Pine', 'Leaves_NormalTree', 'Leaves_TwistedTree', 'Grass', 'Flowers']);
/** Flat colours for materials whose texture is dropped. */
const FLAT = { Bark_NormalTree: [0.36, 0.27, 0.2, 1], Rocks: [0.82, 0.82, 0.84, 1], Leaves: [0.32, 0.5, 0.22, 1] };

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function loadGltf(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const buffers = json.buffers.map((b) => readFileSync(join(dirname(file), decodeURIComponent(b.uri))));
  return { json, buffers, dir: dirname(file) };
}

/** Read an accessor into a packed typed array (and its float view if normalized). */
function readAccessor(g, index) {
  const acc = g.json.accessors[index];
  const view = g.json.bufferViews[acc.bufferView];
  const buf = g.buffers[view.buffer];
  const Typed = TYPED[acc.componentType];
  const comps = COMPONENTS[acc.type];
  const elemBytes = Typed.BYTES_PER_ELEMENT * comps;
  const stride = view.byteStride ?? elemBytes;
  const out = new Typed(acc.count * comps);
  const base = buf.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) out.set(new Typed(buf.buffer.slice(base + i * stride, base + i * stride + elemBytes)), i * comps);
  return { data: out, acc, comps };
}

const out = {
  asset: { version: '2.0', generator: 'rider build-nature.mjs' },
  extensionsUsed: ['KHR_mesh_quantization'],
  extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ nodes: [] }],
  nodes: [],
  meshes: [],
  materials: [],
  textures: [],
  images: [],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  accessors: [],
  bufferViews: [],
  buffers: [],
};
const chunks = [];
let byteLength = 0;

function addView(bytes, target, stride) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  out.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}), ...(stride ? { byteStride: stride } : {}) });
  chunks.push(bytes);
  byteLength += bytes.length;
  return out.bufferViews.length - 1;
}

function addAccessor(data, desc, target, stride) {
  const view = addView(Buffer.from(data.buffer, data.byteOffset, data.byteLength), target, stride);
  out.accessors.push({ bufferView: view, ...desc });
  return out.accessors.length - 1;
}

const materialIndex = new Map();
function material(g, matIdx) {
  const src = g.json.materials[matIdx];
  if (materialIndex.has(src.name)) return materialIndex.get(src.name);
  const m = { name: src.name, doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } };
  const texInfo = src.pbrMetallicRoughness?.baseColorTexture;
  if (KEEP_TEXTURE.has(src.name) && texInfo) {
    const img = g.json.images[g.json.textures[texInfo.index].source];
    const png = readFileSync(join(g.dir, decodeURIComponent(img.uri)));
    out.images.push({ name: img.uri.replace(/\.png$/i, ''), mimeType: 'image/png', bufferView: addView(png) });
    out.textures.push({ source: out.images.length - 1, sampler: 0 });
    m.pbrMetallicRoughness.baseColorTexture = { index: out.textures.length - 1 };
    m.alphaMode = 'MASK';
    m.alphaCutoff = src.alphaCutoff ?? 0.5;
  } else {
    m.pbrMetallicRoughness.baseColorFactor = FLAT[src.name] ?? [0.7, 0.7, 0.7, 1];
  }
  out.materials.push(m);
  materialIndex.set(src.name, out.materials.length - 1);
  return out.materials.length - 1;
}

const report = [];
for (const [key, name] of Object.entries(PICKS)) {
  const g = loadGltf(join(srcDir, `${name}.gltf`));
  const srcMesh = g.json.meshes[g.json.nodes[g.json.scenes[0].nodes[0]].mesh];
  const prims = [];
  let tris = 0;
  for (const p of srcMesh.primitives) {
    const mat = material(g, p.material);
    const textured = out.materials[mat].pbrMetallicRoughness.baseColorTexture !== undefined;
    const attributes = {};
    const pos = readAccessor(g, p.attributes.POSITION);
    attributes.POSITION = addAccessor(pos.data, { componentType: 5126, count: pos.acc.count, type: 'VEC3', min: pos.acc.min, max: pos.acc.max }, 34962);
    // Normals -> int8 (VEC3 padded to 4 bytes per element).
    const nrm = readAccessor(g, p.attributes.NORMAL);
    const qn = new Int8Array(nrm.acc.count * 4);
    for (let i = 0; i < nrm.acc.count; i++) for (let c = 0; c < 3; c++) qn[i * 4 + c] = Math.round(Math.max(-1, Math.min(1, nrm.data[i * 3 + c])) * 127);
    attributes.NORMAL = addAccessor(qn, { componentType: 5120, normalized: true, count: nrm.acc.count, type: 'VEC3' }, 34962, 4);
    // Vertex colours (baked shading) -> uint8 RGBA.
    if (p.attributes.COLOR_0 !== undefined) {
      const col = readAccessor(g, p.attributes.COLOR_0);
      const scale = col.acc.componentType === 5126 ? 1 : 1 / NORM[col.acc.componentType];
      const qc = new Uint8Array(col.acc.count * 4);
      for (let i = 0; i < col.acc.count; i++) {
        for (let c = 0; c < 4; c++) qc[i * 4 + c] = c < col.comps ? Math.round(Math.max(0, Math.min(1, col.data[i * col.comps + c] * scale)) * 255) : 255;
      }
      attributes.COLOR_0 = addAccessor(qc, { componentType: 5121, normalized: true, count: col.acc.count, type: 'VEC4' }, 34962);
    }
    if (textured) {
      const uv = readAccessor(g, p.attributes.TEXCOORD_0);
      attributes.TEXCOORD_0 = addAccessor(new Float32Array(uv.data), { componentType: 5126, count: uv.acc.count, type: 'VEC2' }, 34962);
    }
    const idx = readAccessor(g, p.indices);
    const small = pos.acc.count < 65536;
    const indices = small ? Uint16Array.from(idx.data) : Uint32Array.from(idx.data);
    tris += indices.length / 3;
    prims.push({ attributes, indices: addAccessor(indices, { componentType: small ? 5123 : 5125, count: indices.length, type: 'SCALAR' }, 34963), material: mat });
  }
  out.meshes.push({ name: key, primitives: prims });
  out.nodes.push({ name: key, mesh: out.meshes.length - 1 });
  out.scenes[0].nodes.push(out.nodes.length - 1);
  report.push(`${key.padEnd(12)} ${name.padEnd(20)} ${tris} tris`);
}

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
console.log(report.join('\n'));
console.log(`wrote ${outFile} (${(binPadded.length / 1024).toFixed(0)} KB binary, ${out.images.length} textures)`);
