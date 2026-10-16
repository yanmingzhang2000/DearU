// 单元测试：blow-detector.js 麦克风吹蜡烛检测
const { test } = require('node:test');
const assert = require('node:assert');
const { calculateRMS, BlowDetector } = require('../utils/blow-detector');

// 构造一个 Int16 PCM 帧（小端），所有采样点振幅相同，便于验证 RMS 计算
function createConstantPCM(amplitude, sampleCount) {
  const buffer = new ArrayBuffer(sampleCount * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < sampleCount; i++) {
    view.setInt16(i * 2, amplitude, true);
  }
  return buffer;
}

test('calculateRMS returns 0 for empty buffer', () => {
  const buffer = new ArrayBuffer(0);
  assert.strictEqual(calculateRMS(buffer), 0);
});

test('calculateRMS returns 0 for silence (all zeros)', () => {
  const buffer = createConstantPCM(0, 100);
  assert.strictEqual(calculateRMS(buffer), 0);
});

test('calculateRMS returns ~1 for full-scale constant amplitude', () => {
  const buffer = createConstantPCM(32767, 100);
  const rms = calculateRMS(buffer);
  assert.ok(rms > 0.99 && rms <= 1.0);
});

test('calculateRMS scales proportionally with amplitude', () => {
  const quiet = calculateRMS(createConstantPCM(1000, 100));
  const loud = calculateRMS(createConstantPCM(10000, 100));
  assert.ok(loud > quiet);
  // 振幅 10 倍，RMS 应接近 10 倍（常数信号下精确成比例）
  assert.ok(Math.abs(loud / quiet - 10) < 0.01);
});

// ========== BlowDetector ==========

test('BlowDetector: does not trigger on steady low volume (background noise)', () => {
  const detector = new BlowDetector({ threshold: 2.5, sustainMs: 200 });
  let triggered = false;
  let t = 0;
  for (let i = 0; i < 30; i++) {
    t += 50;
    if (detector.feed(0.02, t)) triggered = true;
  }
  assert.strictEqual(triggered, false);
});

test('BlowDetector: triggers after sustained volume spike above baseline', () => {
  const detector = new BlowDetector({ threshold: 2.5, sustainMs: 150 });
  let t = 0;

  // 建立安静基线
  for (let i = 0; i < 10; i++) {
    t += 50;
    detector.feed(0.02, t);
  }

  // 突增音量（模拟吹气），持续足够长时间
  let triggered = false;
  for (let i = 0; i < 10; i++) {
    t += 50;
    if (detector.feed(0.3, t)) {
      triggered = true;
      break;
    }
  }
  assert.strictEqual(triggered, true);
});

test('BlowDetector: does not trigger on brief spike shorter than sustainMs', () => {
  const detector = new BlowDetector({ threshold: 2.5, sustainMs: 500 });
  let t = 0;

  for (let i = 0; i < 10; i++) {
    t += 50;
    detector.feed(0.02, t);
  }

  // 只给一帧突增，立刻恢复，不足以达到 sustainMs
  const triggeredOnSpike = detector.feed(0.3, (t += 50));
  assert.strictEqual(triggeredOnSpike, false);

  const triggeredAfterDrop = detector.feed(0.02, (t += 50));
  assert.strictEqual(triggeredAfterDrop, false);
});

test('BlowDetector: reset clears internal state', () => {
  const detector = new BlowDetector();
  let t = 0;
  for (let i = 0; i < 5; i++) {
    detector.feed(0.1, (t += 50));
  }
  detector.reset();
  assert.strictEqual(detector.recentVolumes.length, 0);
  assert.strictEqual(detector.overThresholdSince, null);
});

test('BlowDetector: resets overThresholdSince once volume drops back down', () => {
  const detector = new BlowDetector({ threshold: 2.5, sustainMs: 1000 });
  let t = 0;
  for (let i = 0; i < 10; i++) {
    t += 50;
    detector.feed(0.02, t);
  }

  // 突增但不足以维持到 sustainMs
  detector.feed(0.3, (t += 50));
  assert.ok(detector.overThresholdSince !== null);

  // 掉回基线，应清空计时
  detector.feed(0.02, (t += 50));
  assert.strictEqual(detector.overThresholdSince, null);
});
