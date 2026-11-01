// 从参考图提取线稿：灰度 -> Sobel 边缘 -> 阈值 -> 深棕线条透明底 PNG
const sharp = require('sharp');

const INPUT = 'C:/Users/yanmingzhang/Desktop/Code/DearU/raw-cakes/reference.png';
const OUTPUT = 'C:/Users/yanmingzhang/AppData/Local/Temp/opencode/lineart.png';
const THRESHOLD = 45; // 边缘强度阈值，越小线越多

async function main() {
  // 读成灰度 raw 像素
  const { data, info } = await sharp(INPUT)
    .grayscale()
    .resize(480, 480, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;

  // Sobel 卷积
  const gx = [
    -1, 0, 1, -2, 0, 2, -1, 0, 1
  ];
  const gy = [
    -1, -2, -1, 0, 0, 0, 1, 2, 1
  ];
  const out = Buffer.alloc(w * h * 4);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sx = 0, sy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const p = data[(y + ky) * w + (x + kx)];
          const ki = (ky + 1) * 3 + (kx + 1);
          sx += p * gx[ki];
          sy += p * gy[ki];
        }
      }
      const mag = Math.min(255, Math.sqrt(sx * sx + sy * sy) / 3);
      const i = (y * w + x) * 4;
      if (mag > THRESHOLD) {
        out[i] = 0x3D; out[i + 1] = 0x24; out[i + 2] = 0x19; // 深棕线条
        out[i + 3] = 255;
      } else {
        out[i + 3] = 0;
      }
    }
  }

  // 垫白底输出预览
  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .flatten({ background: '#ffffff' })
    .png()
    .toFile(OUTPUT);
  console.log(`线稿已输出: ${OUTPUT} (${w}x${h})`);
}

main().catch(e => { console.error(e); process.exit(1); });
