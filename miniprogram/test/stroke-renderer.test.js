// 单元测试：stroke-renderer.js 笔刷渲染工具
// Node 环境没有真实 Canvas 2D，这里用 mock context 记录调用，验证算法不抛错 + 调用序列合理
const { test } = require('node:test');
const assert = require('node:assert');
const { StrokeRenderer, throttle } = require('../utils/stroke-renderer');
const { BRUSH_TYPES } = require('../utils/cake-editor');

function createMockCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    arc(x, y, r, s, e) { calls.push(['arc', x, y, r, s, e]); },
    stroke() { calls.push(['stroke']); },
    fill() { calls.push(['fill']); },
    set strokeStyle(v) { calls.push(['set strokeStyle', v]); },
    set fillStyle(v) { calls.push(['set fillStyle', v]); },
    set lineWidth(v) { calls.push(['set lineWidth', v]); },
    set lineCap(v) { calls.push(['set lineCap', v]); },
    set lineJoin(v) { calls.push(['set lineJoin', v]); }
  };
}

function makeStroke(brushType, points, overrides) {
  return Object.assign({
    brushType: brushType,
    points: points,
    color: '#FFE5EC',
    width: 20
  }, overrides || {});
}

const samplePoints = [
  { x: 0, y: 0 },
  { x: 10, y: 5 },
  { x: 20, y: 0 },
  { x: 30, y: 8 },
  { x: 40, y: 2 }
];

test('StrokeRenderer: drawStroke does nothing for empty points', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  renderer.drawStroke(makeStroke(BRUSH_TYPES.ROUND, []));
  assert.strictEqual(ctx.calls.length, 0);
});

test('StrokeRenderer: drawStroke does nothing when points is undefined', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  assert.doesNotThrow(() => {
    renderer.drawStroke({ brushType: BRUSH_TYPES.ROUND, color: '#fff', width: 10 });
  });
});

test('StrokeRenderer: round brush draws without throwing and calls save/restore', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  renderer.drawStroke(makeStroke(BRUSH_TYPES.ROUND, samplePoints));

  const types = ctx.calls.map(c => c[0]);
  assert.ok(types.includes('save'));
  assert.ok(types.includes('restore'));
  assert.ok(types.includes('fill')); // round 笔刷用 fill 填充圆点
});

test('StrokeRenderer: wave brush draws without throwing and calls stroke', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  renderer.drawStroke(makeStroke(BRUSH_TYPES.WAVE, samplePoints));

  const types = ctx.calls.map(c => c[0]);
  assert.ok(types.includes('stroke')); // wave 笔刷用 stroke 描边路径
});

test('StrokeRenderer: zigzag brush draws without throwing and calls stroke', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  renderer.drawStroke(makeStroke(BRUSH_TYPES.ZIGZAG, samplePoints));

  const types = ctx.calls.map(c => c[0]);
  assert.ok(types.includes('stroke'));
});

test('StrokeRenderer: wave/zigzag brush handle single-point path without throwing', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  assert.doesNotThrow(() => {
    renderer.drawStroke(makeStroke(BRUSH_TYPES.WAVE, [{ x: 5, y: 5 }]));
  });
  assert.doesNotThrow(() => {
    renderer.drawStroke(makeStroke(BRUSH_TYPES.ZIGZAG, [{ x: 5, y: 5 }]));
  });
});

test('StrokeRenderer: unknown brush type falls back to round', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  renderer.drawStroke(makeStroke('unknown_brush_type', samplePoints));
  const types = ctx.calls.map(c => c[0]);
  assert.ok(types.includes('fill')); // 回退到圆点笔刷
});

test('StrokeRenderer: applies stroke color and width to context', () => {
  const ctx = createMockCtx();
  const renderer = new StrokeRenderer(ctx);
  renderer.drawStroke(makeStroke(BRUSH_TYPES.ROUND, samplePoints, { color: '#ABCDEF', width: 15 }));

  const strokeStyleCall = ctx.calls.find(c => c[0] === 'set strokeStyle');
  const lineWidthCall = ctx.calls.find(c => c[0] === 'set lineWidth');
  assert.strictEqual(strokeStyleCall[1], '#ABCDEF');
  assert.strictEqual(lineWidthCall[1], 15);
});

test('StrokeRenderer: clear calls clearRect with given dimensions', () => {
  const ctx = createMockCtx();
  ctx.clearRect = (...args) => ctx.calls.push(['clearRect', ...args]);
  const renderer = new StrokeRenderer(ctx);
  renderer.clear(300, 400);

  const clearCall = ctx.calls.find(c => c[0] === 'clearRect');
  assert.deepStrictEqual(clearCall, ['clearRect', 0, 0, 300, 400]);
});

// ========== throttle ==========

test('throttle: executes immediately on first call', () => {
  let callCount = 0;
  const fn = throttle(() => { callCount++; }, 50);
  fn();
  assert.strictEqual(callCount, 1);
});

test('throttle: suppresses calls within interval window', () => {
  let callCount = 0;
  const fn = throttle(() => { callCount++; }, 1000); // 大窗口确保测试内不会自然过期
  fn();
  fn();
  fn();
  assert.strictEqual(callCount, 1); // 后两次应被节流
});

test('throttle: allows call after interval has passed', async () => {
  let callCount = 0;
  const fn = throttle(() => { callCount++; }, 10);
  fn();
  await new Promise(resolve => setTimeout(resolve, 20));
  fn();
  assert.strictEqual(callCount, 2);
});

test('throttle: preserves `this` binding and arguments', () => {
  const obj = {
    value: 42,
    recorded: null,
    method: throttle(function (a, b) {
      this.recorded = { thisValue: this.value, a, b };
    }, 1000)
  };
  obj.method(1, 2);
  assert.deepStrictEqual(obj.recorded, { thisValue: 42, a: 1, b: 2 });
});
