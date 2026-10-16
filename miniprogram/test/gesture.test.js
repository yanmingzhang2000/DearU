// 单元测试：gesture.js 手势计算工具
const { test } = require('node:test');
const assert = require('node:assert');
const gesture = require('../utils/gesture');

test('distance calculates euclidean distance correctly', () => {
  assert.strictEqual(gesture.distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.strictEqual(gesture.distance({ x: 0, y: 0 }, { x: 0, y: 0 }), 0);
});

test('angle calculates correct radian for cardinal directions', () => {
  const center = { x: 0, y: 0 };
  // 右侧点：角度应为 0
  assert.strictEqual(gesture.angle(center, { x: 10, y: 0 }), 0);
  // 下方点：角度应为 π/2（屏幕坐标 y 向下为正）
  assert.ok(Math.abs(gesture.angle(center, { x: 0, y: 10 }) - Math.PI / 2) < 1e-9);
});

test('radianToDegree and degreeToRadian are inverse operations', () => {
  const degree = 90;
  const radian = gesture.degreeToRadian(degree);
  assert.ok(Math.abs(radian - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(gesture.radianToDegree(radian) - degree) < 1e-9);
});

test('detectPinch returns null when touches are insufficient', () => {
  assert.strictEqual(gesture.detectPinch([{ pageX: 0, pageY: 0 }], [{ pageX: 0, pageY: 0 }]), null);
  assert.strictEqual(gesture.detectPinch(null, []), null);
  assert.strictEqual(gesture.detectPinch([], []), null);
});

test('detectPinch detects pure scale-up (zoom in)', () => {
  // 两指从相距 10 拉开到相距 20（无旋转，水平线）
  const prevTouches = [{ pageX: 0, pageY: 0 }, { pageX: 10, pageY: 0 }];
  const touches = [{ pageX: 0, pageY: 0 }, { pageX: 20, pageY: 0 }];

  const result = gesture.detectPinch(touches, prevTouches);
  assert.ok(result);
  assert.strictEqual(result.scale, 2); // 距离翻倍
  assert.ok(Math.abs(result.rotate) < 1e-9); // 无旋转
});

test('detectPinch detects pure scale-down (zoom out)', () => {
  const prevTouches = [{ pageX: 0, pageY: 0 }, { pageX: 20, pageY: 0 }];
  const touches = [{ pageX: 0, pageY: 0 }, { pageX: 10, pageY: 0 }];

  const result = gesture.detectPinch(touches, prevTouches);
  assert.strictEqual(result.scale, 0.5);
});

test('detectPinch detects pure rotation (no scale change)', () => {
  // 两指保持距离 10，从水平旋转到垂直（90度）
  const prevTouches = [{ pageX: 0, pageY: 0 }, { pageX: 10, pageY: 0 }];
  const touches = [{ pageX: 0, pageY: 0 }, { pageX: 0, pageY: 10 }];

  const result = gesture.detectPinch(touches, prevTouches);
  assert.ok(Math.abs(result.scale - 1) < 1e-9); // 距离不变
  assert.ok(Math.abs(result.rotate - 90) < 1e-9); // 旋转 90 度
});

test('detectPinch normalizes rotation delta to -180~180 range', () => {
  // 构造一个会产生接近 ±180 度跳变的情况，确保归一化逻辑不炸
  const prevTouches = [{ pageX: 0, pageY: 0 }, { pageX: 10, pageY: 0.1 }];
  const touches = [{ pageX: 0, pageY: 0 }, { pageX: 10, pageY: -0.1 }];

  const result = gesture.detectPinch(touches, prevTouches);
  assert.ok(result.rotate >= -180 && result.rotate <= 180);
});

test('detectDrag calculates delta correctly', () => {
  const touch = { pageX: 15, pageY: 25 };
  const prevTouch = { pageX: 10, pageY: 20 };
  const delta = gesture.detectDrag(touch, prevTouch);
  assert.strictEqual(delta.dx, 5);
  assert.strictEqual(delta.dy, 5);
});

test('detectDrag returns zero delta for missing touch points', () => {
  assert.deepStrictEqual(gesture.detectDrag(null, { pageX: 0, pageY: 0 }), { dx: 0, dy: 0 });
  assert.deepStrictEqual(gesture.detectDrag({ pageX: 0, pageY: 0 }, null), { dx: 0, dy: 0 });
});

test('isPointInRect correctly identifies points inside/outside rect', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.strictEqual(gesture.isPointInRect({ x: 50, y: 50 }, rect), true);
  assert.strictEqual(gesture.isPointInRect({ x: 0, y: 0 }, rect), true); // 边界
  assert.strictEqual(gesture.isPointInRect({ x: 100, y: 100 }, rect), true); // 边界
  assert.strictEqual(gesture.isPointInRect({ x: 150, y: 50 }, rect), false);
  assert.strictEqual(gesture.isPointInRect({ x: 50, y: -10 }, rect), false);
});

test('getRotatedBoundingBox returns original box for 0 degree rotation', () => {
  const box = gesture.getRotatedBoundingBox(50, 50, 100, 60, 0);
  assert.ok(Math.abs(box.width - 100) < 1e-9);
  assert.ok(Math.abs(box.height - 60) < 1e-9);
  assert.ok(Math.abs(box.left - 0) < 1e-9);
  assert.ok(Math.abs(box.top - 20) < 1e-9);
});

test('getRotatedBoundingBox swaps dimensions for 90 degree rotation', () => {
  const box = gesture.getRotatedBoundingBox(0, 0, 100, 60, 90);
  // 90度旋转后，宽高应接近互换
  assert.ok(Math.abs(box.width - 60) < 1e-6);
  assert.ok(Math.abs(box.height - 100) < 1e-6);
});
