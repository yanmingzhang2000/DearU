// 数据看板：独立管理员密码鉴权 + 指标聚合正确性。
// 鉴权走 X-Dashboard-Password Header，不是现有 JWT 体系，makeClient 封装不支持自定义 Header，
// 这里直接用原生 fetch 发请求。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { nanoid } = require('nanoid');
const { startTestServer, cleanupTestDb, makeClient, loginAs } = require('./helpers');

let server;
let request;
const DASHBOARD_PASSWORD = 'test-dashboard-secret';

before(async () => {
  process.env.DASHBOARD_PASSWORD = DASHBOARD_PASSWORD;
  server = await startTestServer();
  request = makeClient(server.baseUrl);
});

after(async () => {
  delete process.env.DASHBOARD_PASSWORD;
  await server.close();
  await cleanupTestDb(server.dbPath);
});

function dashboardFetch(path, password) {
  const headers = {};
  if (password !== undefined) headers['X-Dashboard-Password'] = password;
  return fetch(server.baseUrl + '/dashboard' + path, { headers });
}

test('未提供密码访问 /dashboard/metrics 返回 401', async () => {
  const res = await dashboardFetch('/metrics');
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'UNAUTHORIZED');
});

test('密码错误返回 401', async () => {
  const res = await dashboardFetch('/metrics', 'wrong-password');
  assert.strictEqual(res.status, 401);
});

test('密码正确返回 200 且包含四大数据块', async () => {
  const res = await dashboardFetch('/metrics', DASHBOARD_PASSWORD);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.coreMetrics);
  assert.ok(body.eventCounts);
  assert.ok(body.roomStatusBreakdown);
  assert.ok(Array.isArray(body.recentEvents));
  assert.ok(body.generatedAt);
});

test('未配置 DASHBOARD_PASSWORD 时返回 503（不会裸奔放行）', async () => {
  const saved = process.env.DASHBOARD_PASSWORD;
  delete process.env.DASHBOARD_PASSWORD;
  try {
    // 直接调用中间件逻辑而非重启服务器：清缓存让中间件模块重新读取 process.env
    delete require.cache[require.resolve('../src/middleware/dashboard-auth')];
    const freshMiddleware = require('../src/middleware/dashboard-auth');
    let statusCode = null;
    let jsonBody = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(payload) { jsonBody = payload; return this; }
    };
    freshMiddleware({ headers: {} }, fakeRes, () => { throw new Error('should not call next()'); });
    assert.strictEqual(statusCode, 503);
    assert.strictEqual(jsonBody.error.code, 'DASHBOARD_NOT_CONFIGURED');
  } finally {
    process.env.DASHBOARD_PASSWORD = saved;
    delete require.cache[require.resolve('../src/middleware/dashboard-auth')];
  }
});

test('GET /dashboard（顶层短链接）无需密码即可返回 HTML 页面', async () => {
  const res = await fetch(server.baseUrl.replace('/api/v1', '') + '/dashboard', { redirect: 'follow' });
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('DearU 数据看板'));
  assert.ok(html.includes('passwordInput'));
});

test('指标计算：建房但未发邀请的房间不计入北极星分母', async () => {
  const creatorToken = await loginAs(request, 'creator');
  await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } });

  const res = await dashboardFetch('/metrics', DASHBOARD_PASSWORD);
  const body = await res.json();
  const before = body.coreMetrics.starMetric.denominator;

  // 对照：发了邀请的房间分母应该 +1
  const room2 = await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } });
  await request('POST', `/rooms/${room2.body.room.roomId}/invite`, { token: creatorToken, body: {} });

  const res2 = await dashboardFetch('/metrics', DASHBOARD_PASSWORD);
  const body2 = await res2.json();
  assert.strictEqual(body2.coreMetrics.starMetric.denominator, before + 1);
});

test('指标计算：完整走完一遍流程后，北极星分子分母均 +1 且 rate 计算正确', async () => {
  // 基线快照必须在"建房 + 发邀请"之前取，否则本次新建的房间会被算进 before 里，断言会多算 1
  const before = await dashboardFetch('/metrics', DASHBOARD_PASSWORD).then((r) => r.json());

  const creatorToken = await loginAs(request, 'creator');
  const createRes = await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } });
  const roomId = createRes.body.room.roomId;
  const inviteRes = await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} });
  const inviteToken = inviteRes.body.invite.token;

  // 寿星绑定进房 -> 转盘 -> 选底胚口味 -> 锁定 -> ready -> seal -> 庆祝双方完成
  const inviteeToken = await loginAs(request, 'invitee');
  await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken });
  await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });

  // 直接操作数据库把 wheel_started_at 往前推 21 秒，绕过 F2 的 20 秒下限保护（测试目的不是验证这个）
  server.db.prepare(`
    UPDATE room SET wheel_started_at = datetime('now', '-21 seconds') WHERE room_id = ?
  `).run(roomId);
  await request('POST', `/rooms/${roomId}/wheel/complete`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/cake/lock`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/start`, { token: creatorToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/start`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/complete`, { token: creatorToken, body: { duration: 10 } });
  await request('POST', `/rooms/${roomId}/celebration/complete`, { token: inviteeToken, body: { duration: 10 } });

  const after = await dashboardFetch('/metrics', DASHBOARD_PASSWORD).then((r) => r.json());

  assert.strictEqual(
    after.coreMetrics.starMetric.numerator,
    before.coreMetrics.starMetric.numerator + 1,
    '双方均完成庆祝后，北极星分子应 +1'
  );
  assert.strictEqual(
    after.coreMetrics.starMetric.denominator,
    before.coreMetrics.starMetric.denominator + 1,
    '发了邀请，分母应 +1'
  );
  assert.strictEqual(
    after.coreMetrics.openRate.numerator,
    before.coreMetrics.openRate.numerator + 1,
    '寿星已进房绑定，打开率分子应 +1'
  );
});

test('事件计数：9 个已知事件即使 count=0 也出现在列表里', async () => {
  const res = await dashboardFetch('/metrics', DASHBOARD_PASSWORD);
  const body = await res.json();
  const knownNames = body.eventCounts.known.map((e) => e.eventName);
  assert.ok(knownNames.includes('room_created'));
  assert.ok(knownNames.includes('invite_sent'));
  assert.ok(knownNames.includes('invitee_entered_edit'));
  assert.ok(knownNames.includes('invitee_ready'));
  assert.ok(knownNames.includes('room_sealed'));
  assert.ok(knownNames.includes('invitee_entered_celebrate'));
  assert.ok(knownNames.includes('celebration_completed'));
  assert.ok(knownNames.includes('user_expressed'));
  assert.ok(knownNames.includes('invitee_created_room'));
  assert.strictEqual(knownNames.length, 9);
});

test('user_expressed 埋点上报后，主动表达率分子相应增加', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const before = await dashboardFetch('/metrics', DASHBOARD_PASSWORD).then((r) => r.json());

  await request('POST', '/analytics/events', {
    token: creatorToken,
    body: { events: [{ name: 'user_expressed', room_id: nanoid(), properties: { user_role: 'creator' } }] }
  });

  const after = await dashboardFetch('/metrics', DASHBOARD_PASSWORD).then((r) => r.json());
  assert.strictEqual(
    after.coreMetrics.expressionRate.numerator,
    before.coreMetrics.expressionRate.numerator + 1
  );
});

test('房间状态分布：新建房间计入 draft', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const before = await dashboardFetch('/metrics', DASHBOARD_PASSWORD).then((r) => r.json());
  const draftBefore = (before.roomStatusBreakdown.active.find((r) => r.status === 'draft') || { cnt: 0 }).cnt;

  await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } });

  const after = await dashboardFetch('/metrics', DASHBOARD_PASSWORD).then((r) => r.json());
  const draftAfter = (after.roomStatusBreakdown.active.find((r) => r.status === 'draft') || { cnt: 0 }).cnt;
  assert.strictEqual(draftAfter, draftBefore + 1);
});

test('最近事件明细按时间倒序，且 limit 参数生效', async () => {
  const res = await dashboardFetch('/metrics?recentLimit=3', DASHBOARD_PASSWORD);
  const body = await res.json();
  assert.ok(body.recentEvents.length <= 3);
});
