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

// P2-2：拖拽吸附引导（findSnapPoint）
test('findSnapPoint snaps to the nearest suggested point within radius', () => {
  // (0, -140) 是 cream 的一个建议落点，偏移 10rpx 仍应命中（半径默认 45）
  const snap = cakeEditor.findSnapPoint(10, -135, 'cream');
  assert.ok(snap, 'should snap when within radius');
  assert.strictEqual(snap.x, 0);
  assert.strictEqual(snap.y, -140);
});

test('findSnapPoint returns null when far from all suggested points', () => {
  const snap = cakeEditor.findSnapPoint(300, 280, 'cream');
  assert.strictEqual(snap, null, 'should not snap when far from any suggested point');
});

test('findSnapPoint respects basque y-compression (same offsets as getSpawnPoint)', () => {
  const basqueSnap = cakeEditor.findSnapPoint(0, -84, 'basque'); // -140 * 0.6 = -84
  assert.ok(basqueSnap, 'should snap to the compressed basque point');
  assert.strictEqual(basqueSnap.y, -84);
});

test('findSnapPoint picks the closer point when two candidates are both in radius', () => {
  // 不依赖具体坐标值，只验证返回的点确实是候选集合中离输入最近的一个
  const x = 100;
  const y = -100;
  const snap = cakeEditor.findSnapPoint(x, y, 'cream', 200); // 放大半径，制造多候选场景
  assert.ok(snap);
  let minDist = Infinity;
  for (let i = 0; i < 20; i++) {
    const candidate = cakeEditor.getSpawnPoint('cream', i);
    const d = Math.hypot(candidate.x - x, candidate.y - y);
    if (d < minDist) minDist = d;
  }
  const snapDist = Math.hypot(snap.x - x, snap.y - y);
  assert.ok(Math.abs(snapDist - minDist) < 1, 'snap point should be the globally nearest candidate');
});

test('findSnapPoint accepts a custom snap radius', () => {
  const farPoint = { x: 50, y: -130 }; // 距 (0,-140) 约 51.5rpx，超出默认 45 半径
  const noSnap = cakeEditor.findSnapPoint(farPoint.x, farPoint.y, 'cream');
  assert.strictEqual(noSnap, null, 'default radius should not reach this distance');
  const snapWithLargerRadius = cakeEditor.findSnapPoint(farPoint.x, farPoint.y, 'cream', 60);
  assert.ok(snapWithLargerRadius, 'larger radius should reach this distance');
});
