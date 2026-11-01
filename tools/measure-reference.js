// 从参考图量取蛋糕主体轮廓坐标，用于照着描 SVG 路径
const sharp = require('sharp');

const INPUT = 'C:/Users/yanmingzhang/Desktop/Code/DearU/raw-cakes/reference.png';

async function main() {
  const { data, info } = await sharp(INPUT)
    .resize(400, 400, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const ch = info.channels;
  const px = (x, y, c) => data[(y * w + x) * ch + c];

  // 1) 非白背景掩码（蛋糕+装饰的剪影）
  const isFg = (x, y) => {
    const r = px(x, y, 0), g = px(x, y, 1), b = px(x, y, 2);
    return !(r > 235 && g > 235 && b > 235);
  };

  // 主体左右轮廓：排除孤立装饰（取每行最长连续前景段）
  const rows = [];
  for (let y = 0; y < h; y++) {
    let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (let x = 0; x < w; x++) {
      if (isFg(x, y)) {
        if (curLen === 0) curStart = x;
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else curLen = 0;
    }
    if (bestLen > 60) rows.push({ y, left: bestStart, right: bestStart + bestLen });
  }

  console.log('== 主体轮廓（每20行采样，400x400 坐标系）==');
  for (let i = 0; i < rows.length; i += 10) {
    const r = rows[i];
    console.log(`y=${r.y} left=${r.left} right=${r.right} width=${r.right - r.left}`);
  }
  const first = rows[0], last = rows[rows.length - 1];
  console.log(`主体纵向范围: y=${first.y} .. ${last.y}`);
  const widest = rows.reduce((a, b) => (b.right - b.left > a.right - a.left ? b : a));
  console.log(`最宽处: y=${widest.y} left=${widest.left} right=${widest.right} (w=${widest.right - widest.left})`);

  // 2) 紫色顶面（慕斯层）区域：用于顶面椭圆
  const isPurple = (x, y) => {
    const r = px(x, y, 0), g = px(x, y, 1), b = px(x, y, 2);
    return b > g + 18 && r > g && b > 110 && r < 235;
  };
  let purTop = Infinity, purBottom = -Infinity, purLeft = Infinity, purRight = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (isPurple(x, y)) {
      if (y < purTop) purTop = y;
      if (y > purBottom) purBottom = y;
      if (x < purLeft) purLeft = x;
      if (x > purRight) purRight = x;
    }
  }
  console.log(`\n== 紫色（顶面+淋面）区域 ==\nx: ${purLeft}..${purRight}\ny: ${purTop}..${purBottom}`);

  // 紫色上边界弧线采样（顶面后缘）
  console.log('紫面上边界采样: x -> y');
  for (let x = purLeft + 10; x < purRight; x += 40) {
    for (let y = 0; y < h; y++) {
      if (isPurple(x, y)) { console.log(`  x=${x} y=${y}`); break; }
    }
  }

  // 3) 三层颜色采样（侧面：紫层下限、奶油层、饼干底）
  console.log('\n== 侧面分层（中线 x=200 从上往下扫描）==');
  const midX = Math.floor(w / 2);
  let prev = '';
  for (let y = purTop; y < last.y; y++) {
    const r = px(midX, y, 0), g = px(midX, y, 1), b = px(midX, y, 2);
    let cls;
    if (isPurple(midX, y)) cls = '紫/淋面';
    else if (r > 240 && g > 225 && b > 170 && b < 235) cls = '奶油层(奶黄)';
    else if (r > 200 && g > 150 && b < 160) cls = '饼干底(棕黄)';
    else if (r > 245 && g > 245 && b > 245) cls = '白底';
    else cls = `其他(${r},${g},${b})`;
    if (cls !== prev) { console.log(`  y=${y}: ${cls}`); prev = cls; }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
