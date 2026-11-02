// 单元测试：P0 智能落点（getSpawnPoint）与边界约束（clampLayerPosition）
const { test } = require('node:test');
const assert = require('node:assert');
const cakeEditor = require('../utils/cake-editor');

// 画布 750x600 rpx 的半径（组件内按 canvas px × pxToRpxRatio 计算）
const BOUNDS = { halfWidth: 375, halfHeight: 300 };

test('getSpawnPoint returns distinct points for consecutive additions (no stacking)', () => {
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const p = cakeEditor.getSpawnPoint('cream', i);
    const key = p.x + ',' + p.y;
    assert.ok(!seen.has(key), `spawn point ${key} repeated at index ${i}`);
    seen.add(key);
  }
});

test('getSpawnPoint always lands inside canvas bounds (scale 1 margin)', () => {
  // scale=1 时边距 = STICKER_BOX_RPX/2 = 60，|x|<=315, |y|<=240
  for (let i = 0; i < 20; i++) {
    const p = cakeEditor.getSpawnPoint('cream', i);
    assert.ok(Math.abs(p.x) <= BOUNDS.halfWidth - cakeEditor.STICKER_BOX_RPX / 2,
      `x=${p.x} out of bounds at index ${i}`);
    assert.ok(Math.abs(p.y) <= BOUNDS.halfHeight - cakeEditor.STICKER_BOX_RPX / 2,
      `y=${p.y} out of bounds at index ${i}`);
    // 真实 clamp 后应保持不变
    const layer = { x: p.x, y: p.y, scale: 1 };
    cakeEditor.clampLayerPosition(layer, BOUNDS);
    assert.strictEqual(layer.x, p.x, 'spawn x should not be clamped');
    assert.strictEqual(layer.y, p.y, 'spawn y should not be clamped');
  }
});

test('getSpawnPoint compresses y offsets for basque (flatter cake)', () => {
  for (let i = 0; i < 8; i++) {
    const cream = cakeEditor.getSpawnPoint('cream', i);
    const basque = cakeEditor.getSpawnPoint('basque', i);
    if (cream.y !== 0) {
      assert.ok(Math.abs(basque.y) < Math.abs(cream.y),
        `basque y=${basque.y} should be tighter than cream y=${cream.y} at ${i}`);
    }
  }
});

test('getSpawnPoint text kind uses front-center placement', () => {
  const p = cakeEditor.getSpawnPoint('cream', 0, 'text');
  assert.strictEqual(p.x, 0);
  assert.ok(p.y > -50, 'text should sit below the top face');
});

test('clampLayerPosition pulls an overshoot layer back inside', () => {
  const layer = { x: 999, y: -999, scale: 1 };
  cakeEditor.clampLayerPosition(layer, BOUNDS);
  assert.strictEqual(layer.x, BOUNDS.halfWidth - 60);
  assert.strictEqual(layer.y, -(BOUNDS.halfHeight - 60));
});

test('clampLayerPosition tightens bounds as scale grows', () => {
  const layer = { x: 300, y: 0, scale: 2 };
  cakeEditor.clampLayerPosition(layer, BOUNDS);
  // scale=2 → margin=120 → maxX=255
  assert.strictEqual(layer.x, BOUNDS.halfWidth - cakeEditor.STICKER_BOX_RPX * 2 / 2);
});

test('clampLayerPosition tolerates missing bounds (canvas not ready yet)', () => {
  const layer = { x: 999, y: 999, scale: 1 };
  cakeEditor.clampLayerPosition(layer, null);
  assert.strictEqual(layer.x, 999, 'no bounds = no clamp, no crash');
});
