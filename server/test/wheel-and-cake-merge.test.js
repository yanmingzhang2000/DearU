// v1.1-转盘仪式与协作合并规格.md 集成测试
// 覆盖：F1/F2/F3/F4 权限边界与幂等性、PUT /cake 字段级权限 + 图层合并、第三人访问错误码分层
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

// 建房 + 寿星进房绑定的公共前置：返回到 wheel_ready 阶段（E4 自动推进）
// dev-login 只认识固定的 creator/invitee/third-party 三个身份字符串（见 routes/auth.js），
// 每次测试复用同一批 dev 用户，但每个 it() 都会在独立的新建房间上操作，互不污染。
async function setupRoomAtWheelReady() {
  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');
  const thirdToken = await loginAs(request, 'third-party');

  const createRes = await request('POST', '/rooms', { token: creatorToken, body: {} });
  const roomId = createRes.body.room.roomId;
  const inviteToken = createRes.body.invite.token;

  assert.strictEqual(createRes.body.room.makingPhase, 'awaiting_both');

  const enterRes = await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken, body: {} });
  assert.strictEqual(enterRes.body.room.makingPhase, 'wheel_ready');

  return { creatorToken, inviteeToken, thirdToken, roomId };
}

test('E4 绑定成功后 making_phase 自动从 awaiting_both 推进到 wheel_ready', async () => {
  const { roomId } = await setupRoomAtWheelReady();
  assert.ok(roomId);
});

test('F1: 非房主调用 wheel/start 返回 403 FORBIDDEN', async () => {
  const { inviteeToken, roomId } = await setupRoomAtWheelReady();
  const res = await request('POST', `/rooms/${roomId}/wheel/start`, { token: inviteeToken, body: {} });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

test('F1: 第三人调用 wheel/start 返回 403 ACCESS_DENIED，不泄露房间信息', async () => {
  const { thirdToken, roomId } = await setupRoomAtWheelReady();
  const res = await request('POST', `/rooms/${roomId}/wheel/start`, { token: thirdToken, body: {} });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'ACCESS_DENIED');
  assert.strictEqual(res.body.room, undefined);
});

test('F1: 房主开启转盘成功，making_phase 变为 wheel_playing 并记 wheelStartedAt', async () => {
  const { creatorToken, roomId } = await setupRoomAtWheelReady();
  const res = await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room.makingPhase, 'wheel_playing');
  assert.ok(res.body.room.wheelStartedAt);
});

test('F1: 幂等性 —— 重复调用 wheel/start 第二次应返回 400 INVALID_STATE，不会被误判成功', async () => {
  const { creatorToken, roomId } = await setupRoomAtWheelReady();
  const first = await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });
  assert.strictEqual(first.status, 200);

  const second = await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });
  assert.strictEqual(second.status, 400);
  assert.strictEqual(second.body.error.code, 'INVALID_STATE');
});

test('F2: 转盘未满 20 秒调用 wheel/complete 返回 400 WHEEL_NOT_FINISHED', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtWheelReady();
  await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });

  const res = await request('POST', `/rooms/${roomId}/wheel/complete`, { token: inviteeToken, body: {} });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'WHEEL_NOT_FINISHED');
});

test('F2: 非寿星调用 wheel/complete 返回 403 FORBIDDEN', async () => {
  const { creatorToken, roomId } = await setupRoomAtWheelReady();
  await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });

  const res = await request('POST', `/rooms/${roomId}/wheel/complete`, { token: creatorToken, body: {} });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

test('F2: wheel_playing 未满 20 秒前置条件（通过直接操作数据库模拟时间已过）：满足后可推进到 cake_editing', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtWheelReady();
  await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });

  // 直接改库，把 wheel_started_at 往前推 21 秒，模拟"已经播完 20 秒"，不等真实计时
  const db = require('../src/db');
  db.prepare(`UPDATE room SET wheel_started_at = datetime('now', '-21 seconds') WHERE room_id = ?`).run(roomId);

  const res = await request('POST', `/rooms/${roomId}/wheel/complete`, { token: inviteeToken, body: {} });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room.makingPhase, 'cake_editing');
});

test('F2: 幂等性 —— 重复调用第二次返回 400 INVALID_STATE', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtWheelReady();
  await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} });

  const db = require('../src/db');
  db.prepare(`UPDATE room SET wheel_started_at = datetime('now', '-21 seconds') WHERE room_id = ?`).run(roomId);

  const first = await request('POST', `/rooms/${roomId}/wheel/complete`, { token: inviteeToken, body: {} });
  assert.strictEqual(first.status, 200);

  const second = await request('POST', `/rooms/${roomId}/wheel/complete`, { token: inviteeToken, body: {} });
  assert.strictEqual(second.status, 400);
  assert.strictEqual(second.body.error.code, 'INVALID_STATE');
});

// 公共前置：推进到 cake_editing 阶段
async function setupRoomAtCakeEditing() {
  const ctx = await setupRoomAtWheelReady();
  await request('POST', `/rooms/${ctx.roomId}/wheel/start`, { token: ctx.creatorToken, body: {} });
  const db = require('../src/db');
  db.prepare(`UPDATE room SET wheel_started_at = datetime('now', '-21 seconds') WHERE room_id = ?`).run(ctx.roomId);
  await request('POST', `/rooms/${ctx.roomId}/wheel/complete`, { token: ctx.inviteeToken, body: {} });
  return ctx;
}

test('PUT /cake: cake_editing 阶段房主修改 style 被整体 403，连带的 layers 变化也不会被保存', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtCakeEditing();

  const res = await request('PUT', `/rooms/${roomId}/cake`, {
    token: creatorToken,
    body: {
      cakeState: {
        style: 'mille', // 越权修改
        flavor: 'vanilla',
        layers: [{ id: 'layer_x', type: 'sticker', stickerType: 'candle', x: 1, y: 1, scale: 1, rotate: 0, zIndex: 0 }]
      }
    }
  });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');

  // 确认 layers 变化没有被静默保存（整体拒绝，不做部分成功）
  const check = await request('GET', `/rooms/${roomId}`, { token: inviteeToken });
  assert.deepStrictEqual(check.body.room.cakeState.layers, []);
});

test('PUT /cake: cake_editing 阶段房主只改 layers（不改 style/flavor）应被允许', async () => {
  const { creatorToken, roomId } = await setupRoomAtCakeEditing();

  const getRes = await request('GET', `/rooms/${roomId}`, { token: creatorToken });
  const dbCake = getRes.body.room.cakeState;

  const res = await request('PUT', `/rooms/${roomId}/cake`, {
    token: creatorToken,
    body: {
      cakeState: {
        style: dbCake.style, // 原样回传，值未变化
        flavor: dbCake.flavor,
        layers: [{ id: 'layer_sticker_1', type: 'sticker', stickerType: 'candle', x: 1, y: 1, scale: 1, rotate: 0, zIndex: 0 }]
      }
    }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room.cakeState.layers.length, 1);
});

test('PUT /cake: cake_editing 阶段寿星修改 style/flavor 应被允许', async () => {
  const { inviteeToken, roomId } = await setupRoomAtCakeEditing();

  const res = await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: { cakeState: { style: 'basque', flavor: 'original', layers: [] } }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room.cakeState.style, 'basque');
  assert.strictEqual(res.body.room.cakeState.flavor, 'original');
});

test('PUT /cake: 图层合并 —— 对方新增的图层在本次 PUT 中未提交时应被保留', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtCakeEditing();

  // 寿星先加一个图层
  await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: {
      cakeState: {
        style: 'cream', flavor: 'vanilla',
        layers: [{ id: 'layer_a', type: 'sticker', stickerType: 'strawberry', x: 0, y: 0, scale: 1, rotate: 0, zIndex: 0 }]
      }
    }
  });

  // 房主提交时本地只带自己新增的图层（不知道寿星已加了 layer_a，模拟并发场景）
  const res = await request('PUT', `/rooms/${roomId}/cake`, {
    token: creatorToken,
    body: {
      cakeState: {
        style: 'cream', flavor: 'vanilla',
        layers: [{ id: 'layer_b', type: 'sticker', stickerType: 'blueberry', x: 5, y: 5, scale: 1, rotate: 0, zIndex: 0 }]
      }
    }
  });
  assert.strictEqual(res.status, 200);
  const ids = res.body.room.cakeState.layers.map((l) => l.id).sort();
  assert.deepStrictEqual(ids, ['layer_a', 'layer_b']); // 两边的新增都被保留，没有互相覆盖丢数据
});

test('PUT /cake: 每次成功写入 cakeVersion 自增', async () => {
  const { inviteeToken, roomId } = await setupRoomAtCakeEditing();

  const before = await request('GET', `/rooms/${roomId}`, { token: inviteeToken });
  const versionBefore = before.body.room.cakeVersion;

  const after1 = await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: { cakeState: { style: 'cream', flavor: 'vanilla', layers: [] } }
  });
  assert.strictEqual(after1.body.room.cakeVersion, versionBefore + 1);
});

test('F3: cake_lock 由寿星调用成功后 making_phase 变为 decorating', async () => {
  const { inviteeToken, roomId } = await setupRoomAtCakeEditing();
  const res = await request('POST', `/rooms/${roomId}/cake/lock`, { token: inviteeToken, body: {} });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room.makingPhase, 'decorating');
  assert.ok(res.body.room.cakeLockedAt);
});

test('F3: 房主调用 cake/lock 返回 403 FORBIDDEN', async () => {
  const { creatorToken, roomId } = await setupRoomAtCakeEditing();
  const res = await request('POST', `/rooms/${roomId}/cake/lock`, { token: creatorToken, body: {} });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

test('PUT /cake: decorating 阶段任何人修改 style/flavor 被静默忽略，不报错，贴纸改动仍生效', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtCakeEditing();

  // 先在 cake_editing 阶段由寿星定下 style/flavor，再锁定进入 decorating，
  // 这样锁定后的"旧值"才是一个确定值，不是建房时从未初始化过的 undefined
  await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: { cakeState: { style: 'cream', flavor: 'vanilla', layers: [] } }
  });
  await request('POST', `/rooms/${roomId}/cake/lock`, { token: inviteeToken, body: {} });

  const res = await request('PUT', `/rooms/${roomId}/cake`, {
    token: creatorToken,
    body: {
      cakeState: {
        style: 'basque', // 试图修改，应被静默忽略
        flavor: 'chocolate',
        layers: [{ id: 'deco_1', type: 'sticker', stickerType: 'candle', x: 2, y: 2, scale: 1, rotate: 0, zIndex: 0 }]
      }
    }
  });
  assert.strictEqual(res.status, 200); // 不报错
  assert.strictEqual(res.body.room.cakeState.style, 'cream'); // 以数据库旧值为准，锁定前最后确定的值
  assert.strictEqual(res.body.room.cakeState.flavor, 'vanilla');
  assert.strictEqual(res.body.room.cakeState.layers.length, 1); // 贴纸改动正常生效
});

test('F4: 删除图层成功后 layers 中对应项消失，cakeVersion 自增，zIndex 重排', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtCakeEditing();

  await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: {
      cakeState: {
        style: 'cream', flavor: 'vanilla',
        layers: [
          { id: 'l1', type: 'sticker', stickerType: 'strawberry', x: 0, y: 0, scale: 1, rotate: 0, zIndex: 0 },
          { id: 'l2', type: 'sticker', stickerType: 'blueberry', x: 1, y: 1, scale: 1, rotate: 0, zIndex: 1 }
        ]
      }
    }
  });

  const versionBefore = (await request('GET', `/rooms/${roomId}`, { token: creatorToken })).body.room.cakeVersion;

  const res = await request('DELETE', `/rooms/${roomId}/cake/layers/l1`, { token: creatorToken, body: {} });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room.cakeState.layers.length, 1);
  assert.strictEqual(res.body.room.cakeState.layers[0].id, 'l2');
  assert.strictEqual(res.body.room.cakeState.layers[0].zIndex, 0); // 重排后的 zIndex
  assert.strictEqual(res.body.room.cakeVersion, versionBefore + 1);
});

test('F4: 删除不存在的图层返回 404 LAYER_NOT_FOUND', async () => {
  const { creatorToken, roomId } = await setupRoomAtCakeEditing();
  const res = await request('DELETE', `/rooms/${roomId}/cake/layers/does-not-exist`, { token: creatorToken, body: {} });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'LAYER_NOT_FOUND');
});

test('F4: 第三人删除图层返回 403 ACCESS_DENIED', async () => {
  const { thirdToken, roomId } = await setupRoomAtCakeEditing();
  const res = await request('DELETE', `/rooms/${roomId}/cake/layers/anything`, { token: thirdToken, body: {} });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'ACCESS_DENIED');
});

test('删除竞态窗口（规格 4.3 已知取舍）：删除后若另一方携带删除前快照 PUT，图层会被当作新增加回', async () => {
  const { creatorToken, inviteeToken, roomId } = await setupRoomAtCakeEditing();

  await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: {
      cakeState: {
        style: 'cream', flavor: 'vanilla',
        layers: [{ id: 'l1', type: 'sticker', stickerType: 'strawberry', x: 0, y: 0, scale: 1, rotate: 0, zIndex: 0 }]
      }
    }
  });

  // 房主删除 l1
  await request('DELETE', `/rooms/${roomId}/cake/layers/l1`, { token: creatorToken, body: {} });

  // 寿星本地仍是删除前的快照（没感知到删除），这次保存自己新增的 l2 时仍然带着 l1
  const res = await request('PUT', `/rooms/${roomId}/cake`, {
    token: inviteeToken,
    body: {
      cakeState: {
        style: 'cream', flavor: 'vanilla',
        layers: [
          { id: 'l1', type: 'sticker', stickerType: 'strawberry', x: 0, y: 0, scale: 1, rotate: 0, zIndex: 0 },
          { id: 'l2', type: 'sticker', stickerType: 'blueberry', x: 1, y: 1, scale: 1, rotate: 0, zIndex: 1 }
        ]
      }
    }
  });
  // 这是规格 4.3 明确接受的取舍：l1 被当作"客户端提交"重新加回，不是 bug
  const ids = res.body.room.cakeState.layers.map((l) => l.id).sort();
  assert.deepStrictEqual(ids, ['l1', 'l2']);
});
