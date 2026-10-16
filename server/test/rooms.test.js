// 集成测试：完整的房间状态机闭环（E1-E9）
// 建房 -> 寿星进房绑定(E4) -> 第三人拒绝 -> 编辑蛋糕 -> ready(E6) -> seal(E7) -> 庆祝(E8/E9)
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

test('dev-login issues a token and upserts the dev user', async () => {
  const res = await request('POST', '/auth/dev-login', { body: { identity: 'creator' } });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.strictEqual(res.body.user.user_id, 'dev_creator');
});

test('dev-login defaults to creator identity when omitted', async () => {
  const res = await request('POST', '/auth/dev-login', { body: {} });
  assert.strictEqual(res.body.user.user_id, 'dev_creator');
});

test('wechat-login returns 501 NOT_IMPLEMENTED placeholder', async () => {
  const res = await request('POST', '/auth/wechat-login', { body: { code: 'fake_code' } });
  assert.strictEqual(res.status, 501);
  assert.strictEqual(res.body.error.code, 'NOT_IMPLEMENTED');
});

test('protected routes reject requests without Authorization header', async () => {
  const res = await request('POST', '/rooms', {});
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
});

test('protected routes reject invalid tokens', async () => {
  const res = await request('POST', '/rooms', { token: 'garbage.token.value' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'INVALID_TOKEN');
});

test('full happy path: create room -> invitee binds -> edit cake -> ready -> seal -> celebrate -> complete', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');
  const thirdToken = await loginAs(request, 'third-party');

  // E1: 建房
  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  assert.strictEqual(createRes.status, 200);
  assert.strictEqual(createRes.body.room.status, 'draft');
  assert.strictEqual(createRes.body.role, 'creator');
  assert.strictEqual(createRes.body.route, 'edit');
  const roomId = createRes.body.room.roomId;
  const token = createRes.body.invite.token;
  assert.ok(roomId);
  assert.ok(token);

  // E3: 房主发邀请（幂等，只记首次）
  const inviteRes = await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} });
  assert.strictEqual(inviteRes.status, 200);
  assert.strictEqual(inviteRes.body.invite.token, token);

  // 房主本人打开邀请链接：预览，不绑定为 invitee
  const creatorEnterRes = await request('POST', `/invites/${token}/enter`, { token: creatorToken, body: {} });
  assert.strictEqual(creatorEnterRes.status, 200);
  assert.strictEqual(creatorEnterRes.body.role, 'creator');
  assert.strictEqual(creatorEnterRes.body.room.status, 'draft'); // 仍是 draft，没被误绑定

  // E4: 寿星首次打开邀请链接，绑定为 invitee，draft -> collaborating
  const enterRes = await request('POST', `/invites/${token}/enter`, { token: inviteeToken, body: {} });
  assert.strictEqual(enterRes.status, 200);
  assert.strictEqual(enterRes.body.role, 'invitee');
  assert.strictEqual(enterRes.body.room.status, 'collaborating');
  assert.strictEqual(enterRes.body.room.inviteeId, 'dev_invitee');

  // 第三人打开同一链接：直接拒绝，不返回任何房间内容
  const thirdRes = await request('POST', `/invites/${token}/enter`, { token: thirdToken, body: {} });
  assert.strictEqual(thirdRes.status, 403);
  assert.strictEqual(thirdRes.body.error.code, 'ACCESS_DENIED');
  assert.strictEqual(thirdRes.body.room, undefined); // 确认没有房间内容泄露

  // 第三人直接 GET /rooms/:id 也应被拒绝
  const thirdGetRes = await request('GET', `/rooms/${roomId}`, { token: thirdToken });
  assert.strictEqual(thirdGetRes.status, 403);

  // E2/E5: 寿星编辑蛋糕
  const cakeState = {
    base: 'mousse',
    layers: [{ id: 'layer_1', type: 'sticker', stickerType: 'strawberry', x: 0, y: 0, scale: 1, rotate: 0, zIndex: 0 }]
  };
  const editRes = await request('PUT', `/rooms/${roomId}/cake`, { token: inviteeToken, body: { cakeState } });
  assert.strictEqual(editRes.status, 200);
  assert.deepStrictEqual(editRes.body.room.cakeState, cakeState);

  // 房主也能在 collaborating 阶段编辑
  const creatorEditRes = await request('PUT', `/rooms/${roomId}/cake`, {
    token: creatorToken,
    body: { cakeState: Object.assign({}, cakeState, { base: 'cream' }) }
  });
  assert.strictEqual(creatorEditRes.status, 200);

  // seal 前置条件未满足：寿星未 ready，应拒绝
  const earlySealRes = await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });
  assert.strictEqual(earlySealRes.status, 400);
  assert.strictEqual(earlySealRes.body.error.code, 'INVITEE_NOT_READY');

  // E6: 寿星标记 ready
  const readyRes = await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });
  assert.strictEqual(readyRes.status, 200);
  assert.ok(readyRes.body.room.inviteeReadyAt);

  // 房主不能标记 ready（仅寿星可以）
  const creatorReadyRes = await request('POST', `/rooms/${roomId}/ready`, { token: creatorToken, body: {} });
  assert.strictEqual(creatorReadyRes.status, 403);

  // E7: 房主封装，原子切 sealed -> awaiting
  const sealRes = await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });
  assert.strictEqual(sealRes.status, 200);
  assert.strictEqual(sealRes.body.room.status, 'awaiting');
  assert.strictEqual(sealRes.body.route, 'waiting');
  assert.ok(sealRes.body.room.sealedAt);

  // 封装后不可再编辑蛋糕
  const editAfterSealRes = await request('PUT', `/rooms/${roomId}/cake`, {
    token: creatorToken,
    body: { cakeState: { base: 'hacked' } }
  });
  assert.strictEqual(editAfterSealRes.status, 400);
  assert.strictEqual(editAfterSealRes.body.error.code, 'ROOM_SEALED');

  // 寿星不能再次 ready（状态已不是 collaborating）
  const readyAgainRes = await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });
  assert.strictEqual(readyAgainRes.status, 400);

  // E8: 双方开始庆祝
  const creatorStartRes = await request('POST', `/rooms/${roomId}/celebration/start`, { token: creatorToken, body: {} });
  assert.strictEqual(creatorStartRes.status, 200);
  assert.ok(creatorStartRes.body.room.celebration.creatorStartedAt);
  assert.strictEqual(creatorStartRes.body.room.celebration.inviteeStartedAt, null);

  const inviteeStartRes = await request('POST', `/rooms/${roomId}/celebration/start`, { token: inviteeToken, body: {} });
  assert.ok(inviteeStartRes.body.room.celebration.inviteeStartedAt);

  // E9: 仅一方完成，房间应保持 awaiting
  const creatorCompleteRes = await request('POST', `/rooms/${roomId}/celebration/complete`, { token: creatorToken, body: {} });
  assert.strictEqual(creatorCompleteRes.status, 200);
  assert.strictEqual(creatorCompleteRes.body.room.status, 'awaiting');

  // 双方均完成，房间整体进入 completed
  const inviteeCompleteRes = await request('POST', `/rooms/${roomId}/celebration/complete`, { token: inviteeToken, body: {} });
  assert.strictEqual(inviteeCompleteRes.status, 200);
  assert.strictEqual(inviteeCompleteRes.body.room.status, 'completed');
  assert.strictEqual(inviteeCompleteRes.body.route, 'replay');
  assert.ok(inviteeCompleteRes.body.room.completedAt);
});

test('seal is rejected when room is not in collaborating state', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;

  // 房间仍是 draft（寿星还没进来），不应允许封装
  const sealRes = await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} });
  assert.strictEqual(sealRes.status, 400);
  assert.strictEqual(sealRes.body.error.code, 'INVALID_STATE');
});

test('non-creator cannot seal the room', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;
  const inviteToken = createRes.body.invite.token;

  await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} });

  const sealRes = await request('POST', `/rooms/${roomId}/seal`, { token: inviteeToken, body: {} });
  assert.strictEqual(sealRes.status, 403);
});

test('invalid invite token returns 404 without leaking room data', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const res = await request('POST', '/invites/does-not-exist-token/enter', { token: creatorToken, body: {} });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'INVALID_LINK');
});

test('reading a non-existent room returns 404', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const res = await request('GET', '/rooms/does-not-exist', { token: creatorToken });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'ROOM_NOT_FOUND');
});

test('analytics events endpoint accepts a batch and persists count', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const res = await request('POST', '/analytics/events', {
    token: creatorToken,
    body: { events: [{ name: 'user_expressed', room_id: 'room_x', properties: { user_role: 'creator' } }] }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.count, 1);
});

test('analytics events endpoint rejects non-array payload', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const res = await request('POST', '/analytics/events', { token: creatorToken, body: { events: 'not-an-array' } });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_PAYLOAD');
});

test('health check endpoint responds ok', async () => {
  const res = await fetch(server.baseUrl.replace('/api/v1', '/health'));
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.status, 'ok');
});

test('unknown route returns 404 NOT_FOUND', async () => {
  const res = await request('GET', '/this-route-does-not-exist', {});
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
});
