// 单元测试：room-route.js 情境标签（替代内部状态胶囊）
const { test } = require('node:test');
const assert = require('node:assert');
const roomRoute = require('../utils/room-route');

test('situationLabel maps making states to 正在一起做蛋糕', () => {
  assert.strictEqual(roomRoute.situationLabel('draft'), '正在一起做蛋糕');
  assert.strictEqual(roomRoute.situationLabel('collaborating'), '正在一起做蛋糕');
});

test('situationLabel maps sealed/awaiting to 蛋糕做好了，就差一起庆祝', () => {
  assert.strictEqual(roomRoute.situationLabel('sealed'), '蛋糕做好了，就差一起庆祝');
  assert.strictEqual(roomRoute.situationLabel('awaiting'), '蛋糕做好了，就差一起庆祝');
});

test('situationLabel maps completed to 这场仪式已完成', () => {
  assert.strictEqual(roomRoute.situationLabel('completed'), '这场仪式已完成');
});

test('situationLabel never leaks internal status words', () => {
  // 注意：情境标签「这场仪式已完成」自然包含"已完成"字样，故不列入内部词表
  const internalWords = ['草稿', '协作中', '已封装', '待庆祝', '未知状态'];
  ['draft', 'collaborating', 'sealed', 'awaiting', 'completed', 'unknown'].forEach((status) => {
    const label = roomRoute.situationLabel(status);
    internalWords.forEach((word) => {
      assert.ok(label.indexOf(word) === -1, `label "${label}" should not contain "${word}"`);
    });
  });
});

test('statusLabel/roleLabel still available for internal use', () => {
  assert.strictEqual(roomRoute.statusLabel('draft'), '草稿');
  assert.strictEqual(roomRoute.roleLabel('creator'), '房主');
});
