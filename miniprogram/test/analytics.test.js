// 单元测试：services/analytics.js 的 track() 构造的请求体协议
// 服务端 POST /analytics/events 期望 { events: [{ name, room_id, properties }] }（批量数组，字段名 name），
// 不是 { eventName, properties }（历史 bug，见 server/src/routes/analytics.js）。
// 这里不依赖小程序 wx/getApp 全局对象，直接 mock services/api 模块本身来捕获请求参数。
const { test } = require('node:test');
const assert = require('node:assert');

function loadAnalyticsWithMockApi() {
  const apiPath = require.resolve('../services/api');
  const analyticsPath = require.resolve('../services/analytics');
  delete require.cache[apiPath];
  delete require.cache[analyticsPath];

  const calls = [];
  const fakeApi = {
    request: (path, options) => {
      calls.push({ path, options });
      return Promise.resolve({ success: true });
    }
  };
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi };

  const analytics = require('../services/analytics');
  return { analytics, calls };
}

test('track() 发送的 body 是 { events: [...] } 数组，字段名为 name 不是 eventName', async () => {
  const { analytics, calls } = loadAnalyticsWithMockApi();

  await analytics.track('user_expressed', { room_id: 'room_123', user_role: 'creator' });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].path, '/analytics/events');
  assert.strictEqual(calls[0].options.method, 'POST');

  const body = calls[0].options.data;
  assert.ok(Array.isArray(body.events), 'body.events 必须是数组');
  assert.strictEqual(body.events.length, 1);
  assert.strictEqual(body.events[0].name, 'user_expressed');
  assert.strictEqual(body.events[0].room_id, 'room_123');
  assert.deepStrictEqual(body.events[0].properties, { room_id: 'room_123', user_role: 'creator' });

  // 不应再出现旧协议的 eventName 字段
  assert.strictEqual(body.eventName, undefined);
});

test('track() 在 properties 未传 room_id 时，room_id 落为 null（不是 undefined，便于 JSON 序列化）', async () => {
  const { analytics, calls } = loadAnalyticsWithMockApi();

  await analytics.track('room_created', {});

  const body = calls[0].options.data;
  assert.strictEqual(body.events[0].room_id, null);
});

test('track() 失败时不向上抛错（埋点不阻塞主流程）', async () => {
  const apiPath = require.resolve('../services/api');
  const analyticsPath = require.resolve('../services/analytics');
  delete require.cache[apiPath];
  delete require.cache[analyticsPath];

  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: { request: () => Promise.reject(new Error('network down')) }
  };

  const analytics = require('../services/analytics');
  await assert.doesNotReject(analytics.track('user_expressed', { room_id: 'r1' }));
});
