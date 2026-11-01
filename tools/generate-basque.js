// 巴斯克专用：从彩图去白底 -> 裁剪居中 -> 400x400 主图 + 100x100 缩略图（透明底）
const sharp = require('sharp');
const path = require('path');

const INPUT = path.join(__dirname, '../raw-cakes/basque_reference.png');
const OUT_DIR = path.join(__dirname, '../miniprogram/assets/cakes');
const SIZE = 400;
const THUMB = 100;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { data, info } = await sharp(INPUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const idx = (x, y) => (y * W + x) * ch;
  const isBg = (i) => data[i] > 226 && data[i + 1] > 223 && data[i + 2] > 218;

  // 1) 从四边 flood fill 去白底（保留内部高光，不做全局阈值）
  const bg = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  const push = (p) => { if (!bg[p] && isBg(p * ch)) { bg[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }

  // 2) 边缘羽化：背景旁的浅色像素半透明，避免白边
  for (let p = 0; p < W * H; p++) {
    if (!bg[p]) continue;
    const i = p * ch;
    data[i + 3] = 0;
  }
  // 轻度去白边：主体边缘 1-2px 内的非主体浅像素降 alpha
  for (let p = 0; p < W * H; p++) {
    if (bg[p]) continue;
    const x = p % W, y = (p / W) | 0;
    let nearBg = false;
    for (let dy = -2; dy <= 2 && !nearBg; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (bg[yy * W + xx]) { nearBg = true; break; }
      }
    }
    if (!nearBg) continue;
    const i = p * ch;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // 边缘偏白的像素透明度打折
    const light = Math.min(r, g, b);
    if (light > 190) data[i + 3] = Math.max(0, Math.round(255 * (1 - (light - 190) / 65)));
  }

  // 3) 计算主体 bbox + 留白
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let p = 0; p < W * H; p++) {
    if (data[p * ch + 3] < 8) continue;
    const x = p % W, y = (p / W) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bw = maxX - minX, bh = maxY - minY;
  console.log(`bbox: (${minX},${minY})-(${maxX},${maxY}) ${bw}x${bh}`);

  // 4) 裁剪后等比放到 400x400 画布（蛋糕占 90%，居中偏下一点更稳）
  const pad = 0.9;
  const scale = Math.min((SIZE * pad) / bw, (SIZE * pad) / bh);
  const dw = Math.round(bw * scale), dh = Math.round(bh * scale);
  const dx = Math.round((SIZE - dw) / 2);
  const dy = Math.round((SIZE - dh) / 2);

  const cropped = await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .resize(dw, dh)
    .png()
    .toBuffer();

  const canvas = sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const composited = await canvas.composite([{ input: cropped, left: dx, top: dy }]).png().toBuffer();

  await sharp(composited).toFile(path.join(OUT_DIR, 'basque_original.png'));
  await sharp(composited).resize(THUMB, THUMB).png().toFile(path.join(OUT_DIR, 'basque_original_thumb.png'));
  console.log('✅ basque_original.png + thumb');

  // 预览（垫粉底）
  await sharp(composited).flatten({ background: '#fff8fb' }).png()
    .toFile('C:/Users/yanmingzhang/AppData/Local/Temp/opencode/basque_preview.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
