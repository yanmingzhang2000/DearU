// E10 POST /rooms/:id/revoke（撤销邀请链接）与 E11 DELETE /rooms/:id（删房）测试
// 对应 v1-状态机.md E10/E11、v1-数据模型.md 关键约束 #4（deleted_at 触发后须脱敏敏感内容）
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

// ========== E10 revoke ==========

test('E10: 房主撤销邀请链接后，链接失效，寿星无法再凭该链接进房', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;
  const inviteToken = createRes.body.invite.token;

  const revokeRes = await request('POST', `/rooms/${roomId}/revoke`, { token: creatorToken, body: {} });
  assert.strictEqual(revokeRes.status, 200);
  assert.strictEqual(revokeRes.body.invite.status, 'revoked');

  const enterRes = await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  assert.strictEqual(enterRes.status, 404);
  assert.strictEqual(enterRes.body.error.code, 'INVALID_LINK');
});

test('E10: 非房主调用 revoke 返回 403 FORBIDDEN', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;

  const res = await request('POST', `/rooms/${roomId}/revoke`, { token: inviteeToken, body: {} });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

test('E10: 已完成的房间不允许撤销链接（INVALID_STATE）', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;
  const inviteToken = createRes.body.invite.token;

  await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/start`, { token: creatorToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/start`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/celebration/complete`, { token: creatorToken, body: {} });
  const completeRes = await request('POST', `/rooms/${roomId}/celebration/complete`, { token: inviteeToken, body: {} });
  assert.strictEqual(completeRes.body.room.status, 'completed');

  const revokeRes = await request('POST', `/rooms/${roomId}/revoke`, { token: creatorToken, body: {} });
  assert.strictEqual(revokeRes.status, 400);
  assert.strictEqual(revokeRes.body.error.code, 'INVALID_STATE');
});

test('E10: 重复撤销同一链接是幂等的，第二次仍返回 200', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;

  const first = await request('POST', `/rooms/${roomId}/revoke`, { token: creatorToken, body: {} });
  assert.strictEqual(first.status, 200);

  const second = await request('POST', `/rooms/${roomId}/revoke`, { token: creatorToken, body: {} });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.invite.status, 'revoked');
});

test('E10: 撤销链接不影响已绑定双方继续通过 roomId 正常访问房间', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;
  const inviteToken = createRes.body.invite.token;

  await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/revoke`, { token: creatorToken, body: {} });

  const getRes = await request('GET', `/rooms/${roomId}`, { token: inviteeToken });
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.room.status, 'collaborating');
});

// ========== E11 delete ==========

test('E11: 房主删房后，房间不可再被任何人访问（404），且敏感内容被清空', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;
  const inviteToken = createRes.body.invite.token;

  await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: { cakeState: { style: 'mousse', flavor: 'strawberry', layers: [{ id: 'l1', type: 'text', text: '生日快乐', zIndex: 0 }] } }
  });

  const deleteRes = await request('DELETE', `/rooms/${roomId}`, { token: creatorToken, body: {} });
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteRes.body.success, true);

  // 房主自己也不能再访问（符合 GET /:id 的 deleted_at IS NULL 过滤）
  const getRes = await request('GET', `/rooms/${roomId}`, { token: creatorToken });
  assert.strictEqual(getRes.status, 404);

  // 邀请链接同样失效
  const enterRes = await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  assert.strictEqual(enterRes.status, 404);

  // 直接查数据库确认 cake_state 已被脱敏，不再含用户输入的文字/图层内容
  const rawRoom = server.db.prepare('SELECT cake_state, deleted_at FROM room WHERE room_id = ?').get(roomId);
  assert.ok(rawRoom.deleted_at);
  const scrubbed = JSON.parse(rawRoom.cake_state);
  assert.strictEqual(scrubbed.layers.length, 0);
  assert.strictEqual(scrubbed.style, null);
  assert.strictEqual(scrubbed.flavor, null);
});

test('E11: 非房主调用 DELETE 返回 403 FORBIDDEN，房间不受影响', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;

  const res = await request('DELETE', `/rooms/${roomId}`, { token: inviteeToken, body: {} });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');

  const getRes = await request('GET', `/rooms/${roomId}`, { token: creatorToken });
  assert.strictEqual(getRes.status, 200);
});

test('E11: 删除一个任意状态（collaborating）的房间同样成功（前置态是"任意"）', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;
  const inviteToken = createRes.body.invite.token;
  await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });

  const deleteRes = await request('DELETE', `/rooms/${roomId}`, { token: creatorToken, body: {} });
  assert.strictEqual(deleteRes.status, 200);
});

test('E11: 重复删除已删除的房间返回 404（不会重复脱敏或报错崩溃）', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;

  const first = await request('DELETE', `/rooms/${roomId}`, { token: creatorToken, body: {} });
  assert.strictEqual(first.status, 200);

  const second = await request('DELETE', `/rooms/${roomId}`, { token: creatorToken, body: {} });
  assert.strictEqual(second.status, 404);
});
