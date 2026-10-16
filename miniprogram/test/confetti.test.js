// 单元测试：confetti.js 彩带粒子系统
const { test } = require('node:test');
const assert = require('node:assert');
const { ConfettiRenderer } = require('../utils/confetti');

function createMockCtx() {
  const calls = [];
  return {
    calls,
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(x, y) { calls.push(['translate', x, y]); },
    rotate(r) { calls.push(['rotate', r]); },
    beginPath() { calls.push(['beginPath']); },
    arc(...args) { calls.push(['arc', ...args]); },
    fill() { calls.push(['fill']); },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    set globalAlpha(v) { calls.push(['set globalAlpha', v]); },
    set fillStyle(v) { calls.push(['set fillStyle', v]); }
  };
}

test('ConfettiRenderer: burst adds particles', () => {
  const ctx = createMockCtx();
  const renderer = new ConfettiRenderer(ctx, 300, 500);
  assert.strictEqual(renderer.hasParticles(), false);
  renderer.burst(20);
  assert.strictEqual(renderer.particles.length, 20);
  assert.strictEqual(renderer.hasParticles(), true);
});

test('ConfettiRenderer: burst with default count produces particles', () => {
  const ctx = createMockCtx();
  const renderer = new ConfettiRenderer(ctx, 300, 500);
  renderer.burst();
  assert.strictEqual(renderer.particles.length, 80);
});

test('ConfettiRenderer: particles start above the visible area', () => {
  const ctx = createMockCtx();
  const renderer = new ConfettiRenderer(ctx, 300, 500);
  renderer.burst(10);
  renderer.particles.forEach((p) => {
    assert.ok(p.y < 0, 'particle should start above canvas top');
    assert.ok(p.x >= 0 && p.x <= 300, 'particle x should be within canvas width');
  });
});

test('ConfettiRenderer: update does not throw and clears canvas each frame', () => {
  const ctx = createMockCtx();
  const renderer = new ConfettiRenderer(ctx, 300, 500);
  renderer.burst(5);
  assert.doesNotThrow(() => renderer.update());
  const clearCall = ctx.calls.find((c) => c[0] === 'clearRect');
  assert.deepStrictEqual(clearCall, ['clearRect', 0, 0, 300, 500]);
});

test('ConfettiRenderer: particles eventually fall below canvas and get removed', () => {
  const ctx = createMockCtx();
  const renderer = new ConfettiRenderer(ctx, 300, 200);
  renderer.burst(10);

  // 跑足够多帧，让粒子因重力下落超出画布底部
  for (let i = 0; i < 500; i++) {
    renderer.update();
  }
  assert.strictEqual(renderer.hasParticles(), false);
});

test('ConfettiRenderer: clear empties particles and clears canvas', () => {
  const ctx = createMockCtx();
  const renderer = new ConfettiRenderer(ctx, 300, 500);
  renderer.burst(10);
  renderer.clear();
  assert.strictEqual(renderer.particles.length, 0);
  assert.ok(ctx.calls.some((c) => c[0] === 'clearRect'));
});

test('ConfettiRenderer: particle colors are drawn from the palette', () => {
  const ctx = createMockCtx();
  const renderer = new ConfettiRenderer(ctx, 300, 500);
  renderer.burst(30);
  renderer.particles.forEach((p) => {
    assert.ok(renderer.colors.includes(p.color));
  });
});
