// 装饰贴纸生成器（P1-5 素材扩容 3 → 15）
// 风格对齐现有 strawberry/blueberry/candle：平涂矢量、无描边、白色高光点、80×80 透明底
// 用法：
//   node generate-stickers.js            # 生成 12 张新贴纸
//   node generate-stickers.js --contact  # 额外拼一张 contact-sheet.png 供过目

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '../miniprogram/assets/stickers');
const SIZE = 80;

// ===== 配色（与蛋糕底胚色系同源）=====
const C = {
  strawberry: '#FF6B8E',
  cherryRed: '#E4576E',
  cherryDark: '#C14468',
  cream: '#FFF6E0',
  creamShade: '#EDDBB4',
  vanilla: '#FFF9EA',
  matcha: '#8FA565',
  matchaDark: '#6E8449',
  mango: '#FFB13D',
  mangoLight: '#FFC966',
  choco: '#8B5126',
  chocoDark: '#6B3D1C',
  cookie: '#E8B87A',
  cookieDark: '#C9955B',
  pink: '#FF93AC',
  pinkLight: '#FFC2D1',
  mint: '#9ED8B5',
  white: '#FFFFFF',
  stem: '#6B8E3D',
  flame: '#FFC35E',
  flameCore: '#FF8A3D'
};

// 每个贴纸是一段 80×80 的 SVG（无描边平涂 + 白色高光）
const STICKERS = {
  // 樱桃：双果 + 果梗 + 叶
  cherry: `
    <path d="M38 30 C 40 18, 50 10, 60 8" fill="none" stroke="${C.stem}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M46 34 C 50 24, 54 16, 60 8" fill="none" stroke="${C.stem}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M60 8 C 68 4, 76 6, 76 12 C 70 16, 62 14, 60 8 Z" fill="${C.matcha}"/>
    <circle cx="30" cy="52" r="16" fill="${C.cherryRed}"/>
    <circle cx="56" cy="56" r="14" fill="${C.cherryDark}"/>
    <ellipse cx="24" cy="46" rx="5" ry="3.5" fill="${C.white}" opacity="0.85" transform="rotate(-25 24 46)"/>
    <ellipse cx="51" cy="51" rx="4" ry="3" fill="${C.white}" opacity="0.7" transform="rotate(-25 51 51)"/>
  `,

  // 马卡龙：上下壳 + 夹心
  macaron: `
    <path d="M14 38 C 14 22, 26 14, 40 14 C 54 14, 66 22, 66 38 Z" fill="${C.pink}"/>
    <rect x="14" y="38" width="52" height="9" fill="${C.cream}"/>
    <path d="M14 47 C 14 62, 26 70, 40 70 C 54 70, 66 62, 66 47 Z" fill="${C.pink}"/>
    <ellipse cx="30" cy="24" rx="8" ry="4" fill="${C.white}" opacity="0.7" transform="rotate(-18 30 24)"/>
    <circle cx="40" cy="59" r="2" fill="${C.white}" opacity="0.55"/>
    <circle cx="50" cy="61" r="2" fill="${C.white}" opacity="0.55"/>
    <circle cx="30" cy="62" r="2" fill="${C.white}" opacity="0.55"/>
  `,

  // 巧克力牌：圆角排块 + 分格线 + 高光
  chocplate: `
    <rect x="14" y="20" width="52" height="42" rx="8" fill="${C.choco}"/>
    <path d="M31 22 L31 60 M48 22 L48 60 M16 40 L64 40" stroke="${C.chocoDark}" stroke-width="3" stroke-linecap="round"/>
    <rect x="14" y="20" width="52" height="42" rx="8" fill="none"/>
    <ellipse cx="26" cy="30" rx="7" ry="4" fill="${C.white}" opacity="0.35" transform="rotate(-20 26 30)"/>
  `,

  // 曲奇：圆饼 + 巧克力豆
  cookie: `
    <circle cx="40" cy="42" r="26" fill="${C.cookie}"/>
    <path d="M18 32 C 22 22, 32 16, 42 16 C 34 20, 26 26, 22 36 Z" fill="${C.cookieDark}" opacity="0.5"/>
    <circle cx="33" cy="36" r="4.5" fill="${C.chocoDark}"/>
    <circle cx="49" cy="42" r="4.5" fill="${C.chocoDark}"/>
    <circle cx="37" cy="52" r="4" fill="${C.chocoDark}"/>
    <circle cx="52" cy="55" r="3.5" fill="${C.chocoDark}"/>
    <ellipse cx="28" cy="49" rx="5" ry="3" fill="${C.white}" opacity="0.5" transform="rotate(-30 28 49)"/>
  `,

  // 芒果粒：两块果丁
  mango: `
    <rect x="14" y="30" width="30" height="30" rx="8" fill="${C.mango}" transform="rotate(-8 29 45)"/>
    <rect x="40" y="22" width="28" height="28" rx="8" fill="${C.mangoLight}" transform="rotate(10 54 36)"/>
    <ellipse cx="24" cy="38" rx="6" ry="3.5" fill="${C.white}" opacity="0.65" transform="rotate(-25 24 38)"/>
    <ellipse cx="49" cy="30" rx="5" ry="3" fill="${C.white}" opacity="0.7" transform="rotate(-25 49 30)"/>
  `,

  // 薄荷叶：双叶 + 叶脉
  mint: `
    <path d="M38 62 C 20 58, 12 42, 18 26 C 34 26, 44 40, 38 62 Z" fill="${C.matcha}"/>
    <path d="M44 60 C 60 54, 68 40, 62 26 C 48 28, 40 42, 44 60 Z" fill="${C.matchaDark}"/>
    <path d="M36 58 C 30 46, 26 36, 22 30" fill="none" stroke="${C.white}" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
    <path d="M47 56 C 54 46, 58 36, 60 30" fill="none" stroke="${C.white}" stroke-width="2.5" stroke-linecap="round" opacity="0.45"/>
  `,

  // 棉花糖：软方块 + 侧影
  marshmallow: `
    <rect x="18" y="22" width="44" height="40" rx="14" fill="${C.pinkLight}"/>
    <path d="M18 46 C 18 58, 26 62, 40 62 C 54 62, 62 58, 62 46 C 54 52, 26 52, 18 46 Z" fill="${C.pink}" opacity="0.6"/>
    <ellipse cx="32" cy="33" rx="9" ry="5" fill="${C.white}" opacity="0.85" transform="rotate(-18 32 33)"/>
    <circle cx="52" cy="52" r="2.5" fill="${C.white}" opacity="0.6"/>
  `,

  // 彩糖针：随机小糖针（确定性布局）
  sprinkles: `
    <g stroke-linecap="round" stroke-width="6">
      <line x1="18" y1="24" x2="26" y2="18" stroke="${C.cherryRed}"/>
      <line x1="44" y1="16" x2="52" y2="22" stroke="${C.matcha}"/>
      <line x1="62" y1="30" x2="66" y2="38" stroke="${C.mango}"/>
      <line x1="14" y1="46" x2="22" y2="50" stroke="${C.pink}"/>
      <line x1="34" y1="38" x2="42" y2="34" stroke="${C.creamShade}"/>
      <line x1="52" y1="46" x2="58" y2="52" stroke="${C.cherryRed}"/>
      <line x1="24" y1="62" x2="32" y2="66" stroke="${C.matchaDark}"/>
      <line x1="44" y1="60" x2="50" y2="66" stroke="${C.pink}"/>
      <line x1="64" y1="58" x2="70" y2="62" stroke="${C.mango}"/>
      <line x1="30" y1="24" x2="36" y2="30" stroke="${C.mango}"/>
    </g>
  `,

  // 奶油裱花：螺旋裱花
  creamdollop: `
    <path d="M40 14 C 52 14, 58 24, 54 32 C 62 38, 62 50, 52 54
             C 58 62, 50 70, 40 68 C 30 70, 22 62, 28 54
             C 18 50, 18 38, 26 32 C 22 24, 28 14, 40 14 Z" fill="${C.cream}"/>
    <path d="M40 30 C 48 30, 52 36, 48 41 C 52 46, 46 52, 40 50 C 34 52, 28 46, 32 41 C 28 36, 32 30, 40 30 Z" fill="${C.creamShade}"/>
    <ellipse cx="33" cy="24" rx="6" ry="3.5" fill="${C.white}" opacity="0.9" transform="rotate(-20 33 24)"/>
    <path d="M28 58 C 32 64, 48 64, 52 58 C 50 66, 44 70, 40 70 C 36 70, 30 66, 28 58 Z" fill="${C.creamShade}" opacity="0.7"/>
  `,

  // 爱心糖
  heartcandy: `
    <path d="M40 66 C 18 50, 12 36, 18 27 C 24 18, 35 20, 40 29 C 45 20, 56 18, 62 27 C 68 36, 62 50, 40 66 Z" fill="${C.strawberry}"/>
    <ellipse cx="29" cy="32" rx="6" ry="4" fill="${C.white}" opacity="0.8" transform="rotate(-30 29 32)"/>
    <circle cx="52" cy="52" r="2.5" fill="${C.white}" opacity="0.55"/>
  `,

  // 数字蜡烛「1」+ 火焰
  numbercandle1: `
    <path d="M34 22 L 46 16 L 46 66 L 36 66 L 36 30 L 30 34 Z" fill="${C.mango}"/>
    <rect x="26" y="66" width="30" height="7" rx="3.5" fill="${C.cherryRed}"/>
    <path d="M41 6 C 47 12, 48 17, 44 20 C 40 22, 37 19, 38 15 C 39 17, 41 16, 41 6 Z" fill="${C.flame}"/>
    <path d="M41 12 C 44 15, 44 18, 42 19 C 40 19, 39 17, 41 12 Z" fill="${C.flameCore}"/>
    <ellipse cx="40" cy="38" rx="3" ry="7" fill="${C.white}" opacity="0.55"/>
  `,

  // 生日小牌：吊牌 + 爱心点缀（不放文字，避免字体依赖）
  birthdayplaque: `
    <path d="M40 12 L 66 26 L 66 54 L 40 68 L 14 54 L 14 26 Z" fill="${C.pink}"/>
    <path d="M40 18 L 60 29 L 60 51 L 40 62 L 20 51 L 20 29 Z" fill="${C.cream}"/>
    <path d="M40 50 C 31 44, 28 38, 31 34 C 33 31, 38 32, 40 36 C 42 32, 47 31, 49 34 C 52 38, 49 44, 40 50 Z" fill="${C.strawberry}"/>
    <ellipse cx="34" cy="36" rx="3" ry="2" fill="${C.white}" opacity="0.8" transform="rotate(-30 34 36)"/>
    <circle cx="40" cy="12" r="3.5" fill="${C.creamShade}"/>
  `
};

function svgOf(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${inner}</svg>`;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const names = Object.keys(STICKERS);
  const buffers = [];

  for (const name of names) {
    const buf = await sharp(Buffer.from(svgOf(STICKERS[name])))
      .resize(SIZE, SIZE)
      .png()
      .toBuffer();
    await sharp(buf).toFile(path.join(OUT_DIR, `${name}.png`));
    buffers.push({ name, buf });
    console.log(`✓ ${name}.png`);
  }

  if (process.argv.includes('--contact')) {
    // 拼图：5 列网格，白底 + 粉边，供人工过目
    const cols = 5;
    const cell = 96;
    const rows = Math.ceil(buffers.length / cols);
    const width = cols * cell;
    const height = rows * cell;
    const composites = [];
    for (let i = 0; i < buffers.length; i++) {
      const img = await sharp(buffers[i].buf)
        .resize(80, 80)
        .extend({ top: 8, bottom: 8, left: 8, right: 8, background: '#FFF8FB' })
        .png()
        .toBuffer();
      composites.push({
        input: img,
        left: (i % cols) * cell + 8,
        top: Math.floor(i / cols) * cell + 8
      });
    }
    const sheet = await sharp({
      create: { width, height, channels: 4, background: '#FFF8FB' }
    })
      .composite(composites)
      .png()
      .toBuffer();
    const sheetPath = path.join(OUT_DIR, 'contact-sheet.png');
    await sharp(sheet).toFile(sheetPath);
    console.log(`✓ contact-sheet.png（顺序：${names.join(', ')}）`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
