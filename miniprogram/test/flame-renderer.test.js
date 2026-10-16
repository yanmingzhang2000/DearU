// 单元测试：flame-renderer.js 蜡烛火焰渲染
const { test } = require('node:test');
const assert = require('node:assert');
const { FlameRenderer } = require('../utils/flame-renderer');

function createMockCtx() {
  const calls = [];
  const gradientStops = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(x, y) { calls.push(['translate', x, y]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    quadraticCurveTo(...a) { calls.push(['quadraticCurveTo', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    fillRect(...a) { calls.push(['fillRect', ...a]); },
    strokeRect(...a) { calls.push(['strokeRect', ...a]); },
    createLinearGradient(...a) {
      calls.push(['createLinearGradient', ...a]);
      return { addColorStop(...stop) { gradientStops.push(stop); } };
    },
    set fillStyle(v) { calls.push(['set fillStyle', v]); },
    set strokeStyle(v) { calls.push(['set strokeStyle', v]); },
    set lineWidth(v) { calls.push(['set lineWidth', v]); },
    set globalAlpha(v) { calls.push(['set globalAlpha', v]); }
  };
}

test('FlameRenderer: drawCandle (lit) draws candle body and flame without throwing', () => {
  const ctx = createMockCtx();
  const renderer = new FlameRenderer(ctx);
  assert.doesNotThrow(() => {
    renderer.drawCandle(100, 200, { lit: true });
  });

  const types = ctx.calls.map((c) => c[0]);
  assert.ok(types.includes('fillRect')); // 蜡烛主体
  assert.ok(types.includes('fill')); // 火焰填充
});

test('FlameRenderer: drawCandle (unlit) draws smoke instead of flame', () => {
  const ctx = createMockCtx();
  const renderer = new FlameRenderer(ctx);
  renderer.drawCandle(100, 200, { lit: false });

  const types = ctx.calls.map((c) => c[0]);
  assert.ok(types.includes('stroke')); // 烟用 stroke 画曲线
  assert.ok(!types.includes('fill')); // 不应有火焰 fill
});

test('FlameRenderer: drawCandle respects custom width/height', () => {
  const ctx = createMockCtx();
  const renderer = new FlameRenderer(ctx);
  renderer.drawCandle(50, 100, { width: 30, height: 80, lit: true });

  const fillRectCall = ctx.calls.find((c) => c[0] === 'fillRect');
  assert.strictEqual(fillRectCall[1], 50 - 15); // x - width/2
  assert.strictEqual(fillRectCall[3], 30); // width
  assert.strictEqual(fillRectCall[4], 80); // height
});

test('FlameRenderer: defaults lit to true when not specified', () => {
  const ctx = createMockCtx();
  const renderer = new FlameRenderer(ctx);
  renderer.drawCandle(0, 0, {});
  const types = ctx.calls.map((c) => c[0]);
  assert.ok(types.includes('fill'));
});

test('FlameRenderer: multiple draws over time do not throw (animation loop simulation)', () => {
  const ctx = createMockCtx();
  const renderer = new FlameRenderer(ctx);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 10; i++) {
      renderer.drawCandle(100, 200, { lit: true });
    }
  });
});
