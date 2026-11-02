// S4 自动清理任务测试（scripts/cleanup-rooms.js）
// 对应 v1-状态机.md §5.4 / v1产品契约决策回答.md §S4：
//   draft/collaborating 14天无活动、awaiting 自 sealed_at 起7天、completed 自 completed_at 起30天
// 通过直接 UPDATE 数据库时间字段模拟"已经过了 N 天"，不等待真实时间流逝
// （与 wheel-and-cake-merge.test.js 验证 20 秒下限保护时使用的手法一致）。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer, cleanupTestDb, makeClient, loginAs } = require('./helpers');

let server;
let request;

before(async () => {
  server = await startTestServer();
  request = makeClient(server.baseUrl);
});

after(async () => {
  await server.close();
  await cleanupTestDb(server.dbPath);
});

function getCleanupModule() {
  // 清理脚本本身不依赖 DEARU_TEST_DB_PATH 对应的 db 单例，这里直接 require 拿纯函数，
  // 传入测试服务器的 db 连接（server.db，由 helpers.js 暴露）来运行。
  delete require.cache[require.resolve('../scripts/cleanup-rooms')];
  return require('../scripts/cleanup-rooms');
}

async function createRoom(creatorToken) {
  const res = await request('POST', '/rooms', { token: creatorToken, body: {} });
  return res.body.room.roomId;
}

function setLastActivity(db, roomId, daysAgo) {
  db.prepare(`
    UPDATE room SET last_activity_at = datetime('now', '-' || ? || ' days') WHERE room_id = ?
  `).run(daysAgo, roomId);
}

function setSealedAt(db, roomId, daysAgo) {
  db.prepare(`
    UPDATE room SET sealed_at = datetime('now', '-' || ? || ' days') WHERE room_id = ?
  `).run(daysAgo, roomId);
}

function setCompletedAt(db, roomId, daysAgo) {
  db.prepare(`
    UPDATE room SET completed_at = datetime('now', '-' || ? || ' days') WHERE room_id = ?
  `).run(daysAgo, roomId);
}

test('draft 房间 14 天无活动应被清理，13 天不应被清理', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');

  const expiredRoomId = await createRoom(creatorToken);
  setLastActivity(server.db, expiredRoomId, 14);

  const freshRoomId = await createRoom(creatorToken);
  setLastActivity(server.db, freshRoomId, 13);

  const result = runCleanup(server.db, { dryRun: true });
  const expiredIds = result.map((r) => r.roomId);

  assert.ok(expiredIds.includes(expiredRoomId));
  assert.ok(!expiredIds.includes(freshRoomId));
});

test('collaborating 房间同样适用 14 天规则', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const roomId = await createRoom(creatorToken);
  const inviteRes = await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} });
  await request('POST', `/invites/${inviteRes.body.invite.token}/enter`, { token: inviteeToken, body: {} });
  setLastActivity(server.db, roomId, 15);

  const result = runCleanup(server.db, { dryRun: true });
  assert.ok(result.some((r) => r.roomId === roomId && r.status === 'collaborating'));
});

test('awaiting 房间自 sealed_at 起 7 天未完成庆祝应被清理', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const roomId = await createRoom(creatorToken);
  const inviteRes = await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} });
  await request('POST', `/invites/${inviteRes.body.invite.token}/enter`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });

  // 刚封装，不应被清理
  let result = runCleanup(server.db, { dryRun: true });
  assert.ok(!result.some((r) => r.roomId === roomId));

  // 模拟 7 天前封装、至今未完成庆祝
  setSealedAt(server.db, roomId, 7);
  result = runCleanup(server.db, { dryRun: true });
  assert.ok(result.some((r) => r.roomId === roomId && r.status === 'awaiting'));
});

test('awaiting 房间若双方已完成庆祝（已转 completed），不会被 7 天规则误清理', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const roomId = await createRoom(creatorToken);
  const inviteRes = await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} });
  await request('POST', `/invites/${inviteRes.body.invite.token}/enter`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });
  setSealedAt(server.db, roomId, 7); // 即便封装时间已过期 7 天

  await request('POST', `/rooms/${roomId}/celebration/start`, { token: creatorToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/start`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/complete`, { token: creatorToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/complete`, { token: inviteeToken, body: {} });

  const result = runCleanup(server.db, { dryRun: true });
  // 房间现在是 completed 状态，不再匹配 awaiting 规则；也未到 30 天，不匹配 completed 规则
  assert.ok(!result.some((r) => r.roomId === roomId));
});

test('completed 房间自 completed_at 起 30 天应被清理，29 天不应被清理', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  async function completeRoom() {
    const roomId = await createRoom(creatorToken);
    const inviteRes = await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} });
    await request('POST', `/invites/${inviteRes.body.invite.token}/enter`, { token: inviteeToken, body: {} });
    await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });
    await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });
    await request('POST', `/rooms/${roomId}/celebration/start`, { token: creatorToken, body: {} });
    await request('POST', `/rooms/${roomId}/celebration/start`, { token: inviteeToken, body: {} });
    await request('POST', `/rooms/${roomId}/celebration/complete`, { token: creatorToken, body: {} });
    await request('POST', `/rooms/${roomId}/celebration/complete`, { token: inviteeToken, body: {} });
    return roomId;
  }

  const expiredRoomId = await completeRoom();
  setCompletedAt(server.db, expiredRoomId, 30);

  const freshRoomId = await completeRoom();
  setCompletedAt(server.db, freshRoomId, 29);

  const result = runCleanup(server.db, { dryRun: true });
  const expiredIds = result.map((r) => r.roomId);
  assert.ok(expiredIds.includes(expiredRoomId));
  assert.ok(!expiredIds.includes(freshRoomId));
});

test('dry-run 模式不会实际修改数据库', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');
  const roomId = await createRoom(creatorToken);
  setLastActivity(server.db, roomId, 20);

  runCleanup(server.db, { dryRun: true });

  const room = server.db.prepare('SELECT deleted_at FROM room WHERE room_id = ?').get(roomId);
  assert.strictEqual(room.deleted_at, null);
});

test('非 dry-run 模式会实际软删除到期房间（脱敏 cake_state + deleted_at 非空）', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');
  const roomId = await createRoom(creatorToken);
  setLastActivity(server.db, roomId, 20);

  const result = runCleanup(server.db, { dryRun: false });
  assert.ok(result.some((r) => r.roomId === roomId));

  const room = server.db.prepare('SELECT deleted_at, cake_state FROM room WHERE room_id = ?').get(roomId);
  assert.ok(room.deleted_at);
  const cakeState = JSON.parse(room.cake_state);
  assert.strictEqual(cakeState.layers.length, 0);

  // 清理后该房间应从 GET /rooms/:id 消失（与 E11 删除产生相同效果）
  const getRes = await request('GET', `/rooms/${roomId}`, { token: creatorToken });
  assert.strictEqual(getRes.status, 404);
});

test('已被软删除的房间不会被清理任务重复处理', async () => {
  const { runCleanup } = getCleanupModule();
  const creatorToken = await loginAs(request, 'creator');
  const roomId = await createRoom(creatorToken);
  setLastActivity(server.db, roomId, 20);

  runCleanup(server.db, { dryRun: false }); // 第一轮清理

  const secondRound = runCleanup(server.db, { dryRun: true });
  assert.ok(!secondRound.some((r) => r.roomId === roomId));
});
