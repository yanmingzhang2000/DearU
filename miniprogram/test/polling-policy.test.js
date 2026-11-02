// 单元测试：polling-policy.js 轮询策略纯函数
// v1.1-转盘仪式与协作合并规格.md 第 6 节
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldPoll, POLL_INTERVAL_MS } = require('../utils/polling-policy');

test('非 collaborating 状态不轮询（draft/sealed/awaiting/completed）', () => {
  ['draft', 'sealed', 'awaiting', 'completed'].forEach((status) => {
    assert.strictEqual(
      shouldPoll({ status, makingPhase: 'cake_editing', inviteeReady: false }),
      false,
      `status=${status} 不应轮询`
    );
  });
});

test('collaborating + awaiting_both 应轮询', () => {
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'awaiting_both', inviteeReady: false }),
    true
  );
});

test('collaborating + wheel_ready 应轮询', () => {
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'wheel_ready', inviteeReady: false }),
    true
  );
});

test('collaborating + wheel_playing 应轮询', () => {
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'wheel_playing', inviteeReady: false }),
    true
  );
});

test('collaborating + cake_editing 且未 invitee_ready 应轮询', () => {
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'cake_editing', inviteeReady: false }),
    true
  );
});

test('collaborating + decorating 且未 invitee_ready 应轮询', () => {
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'decorating', inviteeReady: false }),
    true
  );
});

test('装饰阶段轮询停止条件：invitee_ready 为真后不轮询（第 6 节停止条件）', () => {
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'cake_editing', inviteeReady: true }),
    false
  );
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'decorating', inviteeReady: true }),
    false
  );
});

test('invitee_ready 为真即便在转盘前置阶段也不轮询（理论上不会出现，但函数需保证一致性）', () => {
  assert.strictEqual(
    shouldPoll({ status: 'collaborating', makingPhase: 'wheel_ready', inviteeReady: true }),
    false
  );
});

test('轮询间隔常量为 8000ms（规格第 6 节）', () => {
  assert.strictEqual(POLL_INTERVAL_MS, 8000);
});
