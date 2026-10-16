// 生成占位图片资源（纯色 PNG），用于本地开发/测试阶段
// 正式美术资源到位后，直接替换同名文件即可，无需改代码
// 不依赖任何第三方库：手工构造最小 PNG（单色填充）

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * 生成一个纯色填充的 PNG 文件（RGBA）
 * @param {number} width
 * @param {number} height
 * @param {Array} rgba - [r, g, b, a] 0-255
 * @returns {Buffer}
 */
function createSolidPNG(width, height, rgba) {
  const [r, g, b, a] = rgba;

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk: raw pixel data (each row prefixed with filter byte 0)
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const pxStart = rowStart + 1 + x * 4;
      raw[pxStart] = r;
      raw[pxStart + 1] = g;
      raw[pxStart + 2] = b;
      raw[pxStart + 3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 实现（PNG 标准算法）
const CRC_TABLE = (() => {
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ========== 生成资源 ==========

const cakesDir = path.join(__dirname, '../assets/cakes');
const stickersDir = path.join(__dirname, '../assets/stickers');

// 4 款底胚占位色（后续替换为真实矢量图）
const cakeColors = {
  cream: [255, 229, 236, 255],    // 奶油粉
  mille: [255, 213, 128, 255],    // 千层黄
  mousse: [200, 162, 200, 255],   // 慕斯紫
  basque: [139, 94, 60, 255]      // 巴斯克棕
};

Object.entries(cakeColors).forEach(([name, color]) => {
  const png = createSolidPNG(400, 400, color);
  fs.writeFileSync(path.join(cakesDir, `${name}.png`), png);
  const thumbPng = createSolidPNG(100, 100, color);
  fs.writeFileSync(path.join(cakesDir, `${name}_thumb.png`), thumbPng);
  console.log(`✅ ${name}.png / ${name}_thumb.png`);
});

// 装饰贴纸占位色
const stickerColors = {
  strawberry: [220, 20, 60, 255],   // 红
  blueberry: [65, 105, 225, 255],   // 蓝
  candle: [255, 165, 0, 255]        // 橙
};

Object.entries(stickerColors).forEach(([name, color]) => {
  const png = createSolidPNG(80, 80, color);
  fs.writeFileSync(path.join(stickersDir, `${name}.png`), png);
  console.log(`✅ sticker ${name}.png`);
});

console.log('\n占位图片生成完毕。正式美术资源到位后，用同名文件覆盖即可，无需改代码。');
