// 照参考线稿生成蛋糕素材：线稿 -> 深棕描边 + 按区域填充口味色 -> 400x400 + 100x100
// 输入: raw-cakes/reference.png (960x960 教程线稿)
// 结构: 顶面椭圆 / 糖霜层 / 中间层 / 饼干底层（flood fill 自动分区上色）
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const INPUT = path.join(__dirname, '../raw-cakes/reference.png');
const OUT_DIR = path.join(__dirname, '../miniprogram/assets/cakes');
const W = 960, H = 960;
const OUT_SIZE = 400;
const THUMB = 100;
const OUTLINE = [0x3d, 0x24, 0x19];
const DILATE_R = 4; // 线条加粗半径（960 尺度）

// ===== 口味色板 =====
// 中性蛋糕体（两个方案共用）
const NEUTRAL = { cream: '#FDF3DE', biscuit: '#E2C79B' };
const FLAVORS = {
  vanilla:    '#FFF3D6',
  strawberry: '#FF7A98',
  matcha:     '#8FA565',
  chocolate:  '#8B5126',
  mango:      '#FFB13D',
  basque:     '#A96C33' // 巴斯克顶面焦糖色
};
// 生成方案：A = 顶面+奶油层上色；B = 仅奶油层上色（顶面奶白）
const VARIANT = process.argv.includes('--cream-only') ? 'B' : 'A';

// 方案 -> 各区域颜色
function paletteFor(flavor) {
  const c = FLAVORS[flavor];
  if (flavor === 'basque') {
    // 巴斯克：焦面顶 + 奶酪色身体
    return { face: c, b1: NEUTRAL.cream, b2: NEUTRAL.cream, b3: NEUTRAL.biscuit };
  }
  if (VARIANT === 'B') {
    // 香草在 B 方案下顶面已近白，奶油层加深米黄以区分层次
    const creamColor = flavor === 'vanilla' ? '#F0DBA4' : c;
    return { face: NEUTRAL.cream, b1: creamColor, b2: NEUTRAL.cream, b3: NEUTRAL.biscuit };
  }
  return { face: c, b1: c, b2: NEUTRAL.cream, b3: NEUTRAL.biscuit };
}
// 巴斯克焦面斑块色
const CARAMELS = ['#8B5126', '#5E3518', '#C98A4B', '#E0A96D'];

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { data, info } = await sharp(INPUT)
    .resize(W, H, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const at = (i, c) => data[i * ch + c];

  // 1) 线掩码：非白 且 非蓝（去掉蓝紫色序号标）+ 抹掉左下角序号区域
  const n = W * H;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % W, y = (i / W) | 0;
    if (x < 175 && y > 775) continue; // 左下角「2」序号标区域，直接留白
    const r = at(i, 0), g = at(i, 1), b = at(i, 2);
    const mean = (r + g + b) / 3;
    const isBlue = b > r + 30 && b > g + 30;
    mask[i] = mean < 210 && !isBlue ? 1 : 0;
  }

  // 2) 加粗（dilation）
  const dil = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      for (let dy = -DILATE_R; dy <= DILATE_R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -DILATE_R; dx <= DILATE_R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          dil[yy * W + xx] = 1;
        }
      }
    }
  }

  // 3) 中线扫描，量出 5 条分界线（椭圆后缘/前缘/糖霜波浪/中层波浪/底缘）
  const cx = 480;
  const crossings = [];
  let inLine = false;
  for (let y = 0; y < H; y++) {
    const v = dil[y * W + cx];
    if (v && !inLine) { crossings.push(y); inLine = true; }
    else if (!v) inLine = false;
  }
  // 每段线的中点作为分界 y
  const segs = [];
  {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const v = y < H ? dil[y * W + cx] : 0;
      if (v && start < 0) start = y;
      if (!v && start >= 0) { segs.push([start, y - 1]); start = -1; }
    }
  }
  const bounds = segs.map(([a, b]) => Math.round((a + b) / 2));
  console.log('中线分界点:', JSON.stringify(bounds));
  if (bounds.length < 3) throw new Error('分界线识别失败');

  // 4) 连通域（非线条），边界连通 = 背景
  const label = new Int32Array(n).fill(-1);
  const comps = [];
  const queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (dil[i] || label[i] >= 0) continue;
    const id = comps.length;
    let head = 0, tail = 0, touchesBorder = false;
    queue[tail++] = i;
    label[i] = id;
    const px = [];
    while (head < tail) {
      const cur = queue[head++];
      px.push(cur);
      const x = cur % W, y = (cur / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesBorder = true;
      // 4 邻居
      if (x > 0 && !dil[cur - 1] && label[cur - 1] < 0) { label[cur - 1] = id; queue[tail++] = cur - 1; }
      if (x < W - 1 && !dil[cur + 1] && label[cur + 1] < 0) { label[cur + 1] = id; queue[tail++] = cur + 1; }
      if (y > 0 && !dil[cur - W] && label[cur - W] < 0) { label[cur - W] = id; queue[tail++] = cur - W; }
      if (y < H - 1 && !dil[cur + W] && label[cur + W] < 0) { label[cur + W] = id; queue[tail++] = cur + W; }
    }
    let sx = 0, sy = 0;
    for (const p of px) { sx += p % W; sy += (p / W) | 0; }
    comps.push({ id, px, touchesBorder, cy: sy / px.length, cx: sx / px.length });
  }
  console.log(`连通域: ${comps.length} 个`);

  // 按质心 y 分带到颜色：face(椭圆) / b1 / b2 / b3
  function bandColor(comp, p) {
    const cy = comp.cy;
    const b = bounds;
    if (cy < b[0]) return null;                  // 椭圆上方（背景侧）
    if (b.length >= 5) {
      if (cy < (b[0] + b[1]) / 2) return p.face;
      if (cy < (b[1] + b[2]) / 2) return p.b1;
      if (cy < (b[2] + b[3]) / 2) return p.b2;
      if (cy < b[4]) return p.b3;
      return null;
    }
    // 兜底：3 分界
    if (cy < b[1]) return p.face;
    if (cy < b[2]) return p.b1;
    return p.b2;
  }

  // 5) 上色合成（各口味分别输出）
  const styles = Object.keys(FLAVORS);
  const flavorName = { vanilla: 'vanilla', strawberry: 'strawberry', matcha: 'matcha', chocolate: 'chocolate', mango: 'mango', basque: 'original' };
  // 款式映射：3 款式共用此线稿结构，颜色一样；basque 只有 original
  for (const flavor of styles) {
    const p = paletteFor(flavor);
    const out = Buffer.alloc(n * 4, 0); // 全透明
    // 组件颜色表
    const compColor = new Array(comps.length).fill(null);
    for (const c of comps) {
      if (c.touchesBorder) continue;
      const col = bandColor(c, p);
      if (col) compColor[c.id] = hex(col);
    }
    // 巴斯克：顶面加焦斑
    if (flavor === 'basque') {
      const rnd = mulberry32(7);
      const faceComp = comps.find(c => !c.touchesBorder && compColor[c.id] && c.cy < bounds[0] + 180 && c.cx > 200 && c.cx < 760 && c.px.length > 20000);
      if (faceComp) {
        const faceSet = new Set(faceComp.px);
        const patches = [
          { x: 300, y: 340, r: 95, c: hex(CARAMELS[0]) },
          { x: 620, y: 330, r: 85, c: hex(CARAMELS[2]) },
          { x: 460, y: 455, r: 110, c: hex(CARAMELS[1]) },
          { x: 720, y: 440, r: 70, c: hex(CARAMELS[3]) },
          { x: 230, y: 450, r: 65, c: hex(CARAMELS[0]) }
        ];
        for (const pt of patches) {
          const jr = pt.r * (0.85 + rnd() * 0.3);
          for (let dy = -jr; dy <= jr; dy++) {
            for (let dx = -jr; dx <= jr; dx++) {
              if (dx * dx + dy * dy > jr * jr) continue;
              const x = (pt.x + dx) | 0, y = (pt.y + dy) | 0;
              const i = y * W + x;
              if (faceSet.has(i)) {
                out[i * 4] = pt.c[0]; out[i * 4 + 1] = pt.c[1]; out[i * 4 + 2] = pt.c[2]; out[i * 4 + 3] = 255;
              }
            }
          }
        }
      }
    }
    // 填充区域
    for (const c of comps) {
      const col = compColor[c.id];
      if (!col) continue;
      for (const i of c.px) {
        out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = 255;
      }
    }
    // 画线（最上层）
    for (let i = 0; i < n; i++) {
      if (!dil[i]) continue;
      out[i * 4] = OUTLINE[0]; out[i * 4 + 1] = OUTLINE[1]; out[i * 4 + 2] = OUTLINE[2]; out[i * 4 + 3] = 255;
    }

    const buf = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    // 三种款式共用颜色（款式差异后续加细节）
    const styleList = flavor === 'basque' ? ['basque'] : ['cream', 'mille', 'mousse'];
    for (const style of styleList) {
      const base = `${style}_${flavorName[flavor]}`;
      await sharp(buf).resize(OUT_SIZE, OUT_SIZE).png().toFile(path.join(OUT_DIR, `${base}.png`));
      await sharp(buf).resize(THUMB, THUMB).png().toFile(path.join(OUT_DIR, `${base}_thumb.png`));
      console.log(`✅ ${base}.png + thumb`);
    }
  }
  console.log('完成');
}

main().catch(e => { console.error(e); process.exit(1); });
