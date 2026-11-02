// 单元测试：P1 涂鸦路径平滑（smoothPath/resampleUniform/averageSmooth）与贴纸元数据
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const strokeRenderer = require('../utils/stroke-renderer');
const cakeEditor = require('../utils/cake-editor');

// ===== 路径平滑 =====

test('resampleUniform produces evenly spaced points', () => {
  // 一条 100px 的水平直线，step=4 → 约 26 点，相邻间距 ≈ 4
  const pts = [];
  for (let i = 0; i <= 100; i += 5) pts.push({ x: i, y: 0 });
  const out = strokeRenderer.resampleUniform(pts, 4);
  assert.ok(out.length > pts.length, 'should upsample a coarse polyline');
  for (let i = 1; i < out.length - 1; i++) {
    const d = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    assert.ok(Math.abs(d - 4) < 0.01, `segment ${i} spacing ${d} != 4`);
  }
  // 首尾点保留
  assert.deepStrictEqual(out[0], { x: 0, y: 0 });
  assert.deepStrictEqual(out[out.length - 1], { x: 100, y: 0 });
});

test('resampleUniform keeps endpoints for short/degenerate input', () => {
  assert.deepStrictEqual(strokeRenderer.resampleUniform(null), []);
  assert.deepStrictEqual(strokeRenderer.resampleUniform([{ x: 1, y: 2 }]), [{ x: 1, y: 2 }]);
  // 零长度段不产生除零 NaN
  const out = strokeRenderer.resampleUniform([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 5 }], 4);
  assert.ok(out.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('averageSmooth reduces jitter but pins endpoints', () => {
  // 带锯齿抖动的路径
  const jitter = [];
  for (let i = 0; i <= 10; i++) jitter.push({ x: i * 10, y: i % 2 === 0 ? 0 : 6 });
  const out = strokeRenderer.resampleUniform(jitter, 4);
  const smooth = strokeRenderer.averageSmooth(out, 2);
  assert.deepStrictEqual(smooth[0], out[0], 'first point pinned');
  assert.deepStrictEqual(smooth[smooth.length - 1], out[out.length - 1], 'last point pinned');
  // 中间点的 y 振幅应显著小于原始 ±6
  const mid = smooth.slice(1, -1);
  const maxDev = Math.max(...mid.map(p => Math.abs(p.y)));
  assert.ok(maxDev < 6, `smoothed deviation ${maxDev} should be < raw 6`);
});

test('smoothPath composes resample + smooth and tolerates tiny input', () => {
  assert.deepStrictEqual(strokeRenderer.smoothPath([]), []);
  const line = [{ x: 0, y: 0 }, { x: 40, y: 0 }];
  const out = strokeRenderer.smoothPath(line);
  assert.deepStrictEqual(out[0], { x: 0, y: 0 });
  assert.deepStrictEqual(out[out.length - 1], { x: 40, y: 0 });
  // 直线平滑后仍是直线
  assert.ok(out.every(p => Math.abs(p.y) < 0.01), 'straight line stays straight');
});

// ===== 贴纸元数据（P1-5/P1-6） =====

test('STICKER_META covers exactly the 15 sticker assets', () => {
  const meta = cakeEditor.STICKER_META;
  const types = Object.keys(meta);
  assert.strictEqual(types.length, 15, `expected 15 entries, got ${types.length}`);

  const dir = path.join(__dirname, '../assets/stickers');
  for (const type of types) {
    assert.ok(meta[type].label, `${type} missing label`);
    assert.ok(meta[type].category, `${type} missing category`);
    assert.ok(meta[type].scale > 0 && meta[type].scale <= 2, `${type} scale out of range`);
    assert.ok(fs.existsSync(path.join(dir, `${type}.png`)), `${type}.png missing on disk`);
  }
});

test('every sticker png on disk is registered in STICKER_META (no orphan assets)', () => {
  const dir = path.join(__dirname, '../assets/stickers');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  for (const f of files) {
    const type = f.replace(/\.png$/, '');
    assert.ok(cakeEditor.STICKER_META[type], `asset ${f} has no STICKER_META entry`);
  }
});

test('STICKER_CATEGORIES partition all sticker types', () => {
  const keys = cakeEditor.STICKER_CATEGORIES.map(c => c.key);
  assert.deepStrictEqual(keys, ['fruit', 'dessert', 'topping', 'candle']);
  const meta = cakeEditor.STICKER_META;
  for (const type of Object.keys(meta)) {
    assert.ok(keys.includes(meta[type].category), `${type} category ${meta[type].category} not in categories`);
  }
  // 每个分类至少有 1 个素材（抽屉分组不会出现空组）
  for (const key of keys) {
    const count = Object.values(meta).filter(m => m.category === key).length;
    assert.ok(count >= 1, `category ${key} empty`);
  }
});

test('addSticker applies meta base scale', () => {
  const state = cakeEditor.createEmptyCake('cream', 'strawberry');
  const sprinkles = cakeEditor.addSticker(state, 'sprinkles', 0, 0);
  assert.strictEqual(sprinkles.scale, cakeEditor.STICKER_META.sprinkles.scale);
  // 未知类型回退 1.0，不崩
  const unknown = cakeEditor.addSticker(state, 'nope', 0, 0);
  assert.strictEqual(unknown.scale, 1.0);
});
