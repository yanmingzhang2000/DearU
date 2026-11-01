// 手绘涂鸦风蛋糕素材生成器（参考贴纸插画风：粗描边 + 高饱和平涂 + 轻噪点）
// 输出：400×400 主图 + 100×100 缩略图，透明背景，顶面无任何装饰（留给用户贴）
// 用法：
//   node generate-cake-assets.js            # 生成全部 16 组
//   node generate-cake-assets.js --sample   # 只生成 cream_vanilla 样图（调风格用）

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '../miniprogram/assets/cakes');
const SIZE = 400;
const THUMB = 100;
const OUTLINE = '#3D2419'; // 深棕描边（非纯黑，手绘感）
const SW = 7;              // 描边宽度

// ===== 口味配色（top=顶面亮色 / side=侧面主色 / shade=阴影色）=====
const FLAVORS = {
  vanilla:    { top: '#FFF9EA', side: '#FFF6E0', shade: '#EDDBB4' },
  strawberry: { top: '#FF93AC', side: '#FF7A98', shade: '#E8557A' }, // 偏红的粉
  matcha:     { top: '#A3B77A', side: '#8FA565', shade: '#6E8449' }, // 降饱和军绿
  chocolate:  { top: '#A06237', side: '#8B5126', shade: '#6B3D1C' },
  mango:      { top: '#FFC35E', side: '#FFB13D', shade: '#F2921D' }
};

// 巴斯克专用（多色焦面）
const BASQUE_PAL = { side: '#F5DFA8', shade: '#E3C88F', top: '#C98A4B' };
const CARAMELS = ['#8B5126', '#A96C33', '#E0A96D', '#5E3518', '#C98A4B'];

// ===== 手绘感几何（轮廓刻意轻微不规则，非标准椭圆）=====
// 侧面轮廓（开口路径，先填充后描边）
const SIDE_PATH =
  'M 66 150 L 67 281 C 68 308 131 329 199 330 C 268 331 331 310 332 282 L 333 153';
// 顶面（手绘感椭圆）
const TOP_PATH =
  'M 66 150 C 66 127 127 106 199 109 C 272 112 334 129 333 153 C 332 177 270 197 199 194 C 128 191 66 174 66 150 Z';
// 底部阴影带（贴着底边渐隐）
const BAND_PATH =
  'M 67 281 C 68 308 131 329 199 330 C 268 331 331 310 332 282 L 332 270 C 300 298 250 313 199 312 C 146 311 96 297 67 269 Z';
// 奶油款底部一圈波浪裱花（属于蛋糕本身，非用户装饰）
const DOLLOP_PATH =
  'M 67 288 C 75 322 105 342 112 313 C 118 348 150 356 157 327 ' +
  'C 163 354 193 360 199 330 C 205 360 235 354 241 327 ' +
  'C 248 348 280 348 286 313 C 293 342 323 322 332 288';
// 巴斯克坑洼顶面（起伏边缘，像烤箱鼓包又塌下去）
const BASQUE_TOP_PATH =
  'M 66 152 C 70 128 105 112 145 110 C 166 103 186 116 206 108 ' +
  'C 246 103 286 112 310 122 C 333 133 337 149 333 157 ' +
  'C 329 178 275 196 200 194 C 128 192 70 176 66 152 Z';

// ===== 确定性伪随机（保证每次生成结果一致）=====
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 手绘感不规则色块（8 控制点平滑闭合曲线），用于巴斯克焦面补丁
function blob(cx, cy, rx, ry, seed) {
  const rnd = mulberry32(seed);
  const n = 8;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const j = 0.78 + rnd() * 0.32;
    pts.push([cx + Math.cos(ang) * rx * j, cy + Math.sin(ang) * ry * j]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + ' Z';
}

// ===== 款式绘制 =====

// 通用圆柱体：侧面 + 底部阴影 + 顶面 + 描边
function cylinder(pal) {
  return `
  <path d="${SIDE_PATH}" fill="${pal.side}"/>
  <path d="${BAND_PATH}" fill="${pal.shade}"/>
  <path d="${TOP_PATH}" fill="${pal.top}"/>
  <path d="${SIDE_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="${TOP_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

// 奶油款：光面抹面 + 底部一圈裱花
function drawCream(pal) {
  return `
  <path d="${SIDE_PATH}" fill="${pal.side}"/>
  <path d="${BAND_PATH}" fill="${pal.shade}"/>
  <path d="${DOLLOP_PATH}" fill="${pal.top}"/>
  <path d="${TOP_PATH}" fill="${pal.top}"/>
  <path d="${SIDE_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="${DOLLOP_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${TOP_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

// 千层款：侧面手绘波浪层次线
function drawMille(pal) {
  const lines = [];
  const ys = [207, 233, 259, 285, 311];
  ys.forEach((y, i) => {
    const w = i % 2 === 0 ? 6 : 3.5; // 粗细交替，像饼皮+奶油层
    lines.push(
      `<path d="M 69 ${y} C 112 ${y + 7} 152 ${y + 10} 199 ${y + 10} C 248 ${y + 10} 289 ${y + 7} 330 ${y}" fill="none" stroke="${pal.shade}" stroke-width="${w}" stroke-linecap="round"/>`
    );
  });
  return `
  <path d="${SIDE_PATH}" fill="${pal.side}"/>
  <path d="${BAND_PATH}" fill="${pal.shade}" opacity="0.55"/>
  ${lines.join('')}
  <path d="${TOP_PATH}" fill="${pal.top}"/>
  <path d="${SIDE_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="${TOP_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

// 慕斯款：光滑镜面 + 顶面高光
function drawMousse(pal) {
  return `
  <path d="${SIDE_PATH}" fill="${pal.side}"/>
  <path d="${BAND_PATH}" fill="${pal.shade}"/>
  <path d="${TOP_PATH}" fill="${pal.top}"/>
  <ellipse cx="155" cy="138" rx="48" ry="17" fill="#FFFFFF" opacity="0.5" transform="rotate(-7 155 138)"/>
  <ellipse cx="118" cy="230" rx="16" ry="62" fill="#FFFFFF" opacity="0.22"/>
  <path d="${SIDE_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="${TOP_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

// 巴斯克款：坑洼多色焦面 + 奶黄侧面 + 纸皱纹
function drawBasque() {
  const patchSeeds = [11, 23, 37, 51, 67];
  const patches = [
    `<path d="${blob(145, 138, 46, 26, patchSeeds[0])}" fill="${CARAMELS[0]}"/>`,
    `<path d="${blob(248, 132, 42, 24, patchSeeds[1])}" fill="${CARAMELS[1]}"/>`,
    `<path d="${blob(200, 168, 50, 22, patchSeeds[2])}" fill="${CARAMELS[4]}"/>`,
    `<path d="${blob(290, 162, 30, 18, patchSeeds[3])}" fill="${CARAMELS[2]}"/>`,
    `<path d="${blob(112, 168, 24, 15, patchSeeds[4])}" fill="${CARAMELS[3]}"/>`
  ].join('\n      ');
  return `
  <defs><clipPath id="bt"><path d="${BASQUE_TOP_PATH}"/></clipPath></defs>
  <path d="${SIDE_PATH}" fill="${BASQUE_PAL.side}"/>
  <path d="${BAND_PATH}" fill="${BASQUE_PAL.shade}"/>
  <path d="${BASQUE_TOP_PATH}" fill="${BASQUE_PAL.top}"/>
  <g clip-path="url(#bt)">
      ${patches}
  </g>
  <path d="M 92 215 q -6 28 2 55" fill="none" stroke="${BASQUE_PAL.shade}" stroke-width="4" stroke-linecap="round"/>
  <path d="M 310 210 q 6 30 -2 58" fill="none" stroke="${BASQUE_PAL.shade}" stroke-width="4" stroke-linecap="round"/>
  <path d="${SIDE_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="${BASQUE_TOP_PATH}" fill="none" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

const STYLE_DRAWERS = { cream: drawCream, mille: drawMille, mousse: drawMousse, basque: drawBasque };

// ===== SVG 组装 =====
function buildSVG(style, flavor) {
  const pal = FLAVORS[flavor] || BASQUE_PAL;
  const content = STYLE_DRAWERS[style](pal);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
${content}
</svg>`;
}

// ===== 噪点纹理（仅叠加在蛋糕不透明区域，模拟手绘纸感）=====
async function addGrain(buf, size) {
  const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const noise = Buffer.alloc(size * size * 4);
  const rnd = mulberry32(99);
  for (let i = 0; i < size * size; i++) {
    const cakeA = data[i * 4 + 3];
    let a = 0;
    if (cakeA > 0) {
      const r = rnd();
      a = r < 0.35 ? 10 : (r < 0.5 ? 18 : 0);
    }
    noise[i * 4] = 0;
    noise[i * 4 + 1] = 0;
    noise[i * 4 + 2] = 0;
    noise[i * 4 + 3] = Math.round((a * cakeA) / 255);
  }
  return sharp(buf)
    .composite([{ input: noise, raw: { width: size, height: size, channels: 4 } }])
    .png()
    .toBuffer();
}

// ===== 生成 =====
async function generateOne(style, flavor) {
  const svg = buildSVG(style, flavor);
  let img = await sharp(Buffer.from(svg)).png().toBuffer();
  img = await addGrain(img, SIZE);
  const base = `${style}_${flavor}`;
  await sharp(img).toFile(path.join(OUT_DIR, `${base}.png`));
  await sharp(img).resize(THUMB, THUMB).png().toFile(path.join(OUT_DIR, `${base}_thumb.png`));
  console.log(`✅ ${base}.png + thumb`);
}

async function main() {
  const sampleOnly = process.argv.includes('--sample');
  if (sampleOnly) {
    await generateOne('cream', 'vanilla');
    console.log('（样图模式，只生成 cream_vanilla）');
    return;
  }
  const combos = [];
  ['cream', 'mille', 'mousse'].forEach((style) => {
    Object.keys(FLAVORS).forEach((flavor) => combos.push({ style, flavor }));
  });
  combos.push({ style: 'basque', flavor: 'original' });
  for (const { style, flavor } of combos) {
    await generateOne(style, flavor);
  }
  console.log(`\n共生成 ${combos.length} 组，输出到 ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('生成失败:', err);
  process.exit(1);
});
