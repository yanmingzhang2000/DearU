// invitee_created_room 埋点（K 系数分子）：曾作为某房间的 invitee（寿星）的用户，
// 之后自己建房时应记录此事件；从未当过 invitee 的用户建房不应触发。
// 对应 v1-埋点schema.md §2：事件属于"自然新房"口径，只看"曾否绑定为某房间的 invitee_id"。
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

function countEvents(db, eventName, userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM analytics_event WHERE event_name = ? AND user_id = ?
  `).get(eventName, userId);
  return row.cnt;
}

test('从未当过 invitee 的用户建房，不触发 invitee_created_room', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const before = countEvents(server.db, 'invitee_created_room', 'dev_creator');

  const res = await request('POST', '/rooms', { token: creatorToken, body: {} });
  assert.strictEqual(res.status, 200);

  const after = countEvents(server.db, 'invitee_created_room', 'dev_creator');
  assert.strictEqual(after, before); // 未增加
});

test('曾绑定为某房间 invitee 的用户，之后自己建房应触发 invitee_created_room', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  // 先让 dev_invitee 绑定为某个房间的寿星（E4）
  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const inviteToken = createRes.body.invite.token;
  const enterRes = await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  assert.strictEqual(enterRes.body.role, 'invitee');

  const before = countEvents(server.db, 'invitee_created_room', 'dev_invitee');

  // dev_invitee 现在自己建一个新房
  const ownRoomRes = await request('POST', '/rooms', { token: inviteeToken, body: {} });
  assert.strictEqual(ownRoomRes.status, 200);
  const newRoomId = ownRoomRes.body.room.roomId;

  const after = countEvents(server.db, 'invitee_created_room', 'dev_invitee');
  assert.strictEqual(after, before + 1);

  // 事件应记在新建的房间上（room_id 取新房间，不是原来当寿星的房间）
  const event = server.db.prepare(`
    SELECT room_id FROM analytics_event WHERE event_name = 'invitee_created_room' AND user_id = 'dev_invitee'
    ORDER BY created_at DESC LIMIT 1
  `).get();
  assert.strictEqual(event.room_id, newRoomId);
});

test('曾当过 invitee 的用户再次建房（第二次及以后）每次都应触发', async () => {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  // dev_invitee 在上一个测试里已经绑定过 invitee，这里直接验证再次建房仍然触发（不是"只记一次"的语义）
  const before = countEvents(server.db, 'invitee_created_room', 'dev_invitee');
  await request('POST', '/rooms', { token: inviteeToken, body: {} });
  const after = countEvents(server.db, 'invitee_created_room', 'dev_invitee');
  assert.strictEqual(after, before + 1);
});
