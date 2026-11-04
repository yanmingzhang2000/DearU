// 临时演示脚本：造一批覆盖漏斗各步骤、各房间状态的数据，启动一个独立的 dev 服务常驻，
// 方便在浏览器里打开新版看板看效果。
//
// 关键点：
// - 使用临时数据库文件（os.tmpdir()），绝不触碰 server/data/dearu-v1.db 这个真实数据库
// - 监听固定端口 3001（避免和正常 npm start 的 3000 冲突）
// - dev-login 只认 'creator'/'invitee'/'third-party' 三个固定身份（见 src/routes/auth.js），
//   传其他字符串会静默 fallback 成 creator，不会报错也不会按预期建不同用户。
//   房间权限只认 room.creator_id/room.invitee_id，与登录用的是哪个 dev 身份无关，
//   所以这里统一复用标准的 'creator'/'invitee'，靠 room_id 区分不同场景的房间即可。
// - 故意制造一条"invitee_entered_celebrate 低于 celebration_completed"的矛盾数据，
//   用于验证看板④的异常矛盾检测提示是否正常工作
//
// 用法：node scripts/seed-demo-dashboard.js
// 跑起来后访问 http://localhost:3001/dashboard，密码见下方 DASHBOARD_PASSWORD
// Ctrl+C 结束，临时数据库文件会留在 tmpdir，不影响真实数据库，可忽略或手动删除。

const path = require('node:path');
const os = require('node:os');
const { nanoid } = require('nanoid');

const DASHBOARD_PASSWORD = 'demo123';
const PORT = 3001;

process.env.DASHBOARD_PASSWORD = DASHBOARD_PASSWORD;
process.env.DEARU_TEST_DB_PATH = path.join(os.tmpdir(), `dearu-demo-${Date.now()}.db`);
process.env.PORT = String(PORT);

const { createApp } = require('../src/server');
const db = require('../src/db');

function makeClient(baseUrl) {
  return async function request(method, p, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(baseUrl + p, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 空响应体 */ }
    return { status: res.status, body: data };
  };
}

async function loginAs(request, identity) {
  const res = await request('POST', '/auth/dev-login', { body: { identity } });
  return res.body.accessToken;
}

// 包一层：非 2xx 直接抛出，避免某一步静默失败后，后续步骤带着错误状态继续跑却看不出来
function assertOk(res, label) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${label} 失败，status=${res.status}, body=${JSON.stringify(res.body)}`);
  }
  return res;
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`演示服务已启动：http://localhost:${PORT}`);
  });
  const baseUrl = `http://localhost:${PORT}/api/v1`;
  const request = makeClient(baseUrl);

  const creatorToken = await loginAs(request, 'creator');
  const inviteeToken = await loginAs(request, 'invitee');

  // ---- 场景 A：3 个完整走完全流程的房间（北极星分子来源） ----
  for (let i = 0; i < 3; i++) {
    const createRes = assertOk(
      await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } }),
      `A${i} 建房`
    );
    const roomId = createRes.body.room.roomId;
    const inviteRes = assertOk(
      await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} }),
      `A${i} 发邀请`
    );
    const inviteToken = inviteRes.body.invite.token;

    assertOk(await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken }), `A${i} 寿星进房`);
    assertOk(await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} }), `A${i} 转盘开始`);
    db.prepare(`UPDATE room SET wheel_started_at = datetime('now', '-21 seconds') WHERE room_id = ?`).run(roomId);
    assertOk(await request('POST', `/rooms/${roomId}/wheel/complete`, { token: inviteeToken, body: {} }), `A${i} 转盘完成`);
    assertOk(await request('POST', `/rooms/${roomId}/cake/lock`, { token: inviteeToken, body: {} }), `A${i} 锁定蛋糕`);
    assertOk(await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} }), `A${i} ready`);
    assertOk(await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} }), `A${i} 封装`);
    assertOk(await request('POST', `/rooms/${roomId}/celebration/start`, { token: creatorToken, body: {} }), `A${i} creator开始庆祝`);
    assertOk(await request('POST', `/rooms/${roomId}/celebration/start`, { token: inviteeToken, body: {} }), `A${i} invitee开始庆祝`);
    assertOk(await request('POST', `/rooms/${roomId}/celebration/complete`, { token: creatorToken, body: { duration: 10 } }), `A${i} creator完成庆祝`);
    assertOk(await request('POST', `/rooms/${roomId}/celebration/complete`, { token: inviteeToken, body: { duration: 10 } }), `A${i} invitee完成庆祝`);
    // 主动表达（截图/说甜），3 个里让 2 个表达，制造非 100% 的表达率
    if (i < 2) {
      assertOk(await request('POST', '/analytics/events', {
        token: inviteeToken,
        body: { events: [{ name: 'user_expressed', room_id: roomId, properties: { user_role: 'invitee' } }] }
      }), `A${i} 主动表达上报`);
    }
    console.log(`场景A房间${i}完成，room_id=${roomId}`);
  }

  // ---- 场景 B：寿星自建新房（K 系数分子）：invitee 曾被绑定过，现在自己也建一个房 ----
  assertOk(await request('POST', '/rooms', { token: inviteeToken, body: { occasion: 'birthday' } }), 'B 寿星自建房');

  // ---- 场景 C：发了邀请但寿星还没打开（卡在"TA进制作"之前） ----
  for (let i = 0; i < 2; i++) {
    const createRes = assertOk(await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } }), `C${i} 建房`);
    const roomId = createRes.body.room.roomId;
    assertOk(await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} }), `C${i} 发邀请`);
  }

  // ---- 场景 D：寿星打开制作页，但卡住没有 ready（卡在"完成制作"之前） ----
  for (let i = 0; i < 2; i++) {
    const createRes = assertOk(await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } }), `D${i} 建房`);
    const roomId = createRes.body.room.roomId;
    const inviteRes = assertOk(await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} }), `D${i} 发邀请`);
    const inviteToken = inviteRes.body.invite.token;
    assertOk(await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken }), `D${i} 寿星进房`);
  }

  // ---- 场景 E：只建房没发邀请（卡在最开始，不计入北极星分母） ----
  for (let i = 0; i < 3; i++) {
    assertOk(await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } }), `E${i} 建房`);
  }

  // ---- 场景 F：封装后卡在"待庆祝"没播放完（sealed/awaiting 状态，验证房间存量区） ----
  {
    const createRes = assertOk(await request('POST', '/rooms', { token: creatorToken, body: { occasion: 'birthday' } }), 'F 建房');
    const roomId = createRes.body.room.roomId;
    const inviteRes = assertOk(await request('POST', `/rooms/${roomId}/invite`, { token: creatorToken, body: {} }), 'F 发邀请');
    const inviteToken = inviteRes.body.invite.token;
    assertOk(await request('POST', `/invites/${inviteToken}/enter`, { token: inviteeToken }), 'F 寿星进房');
    assertOk(await request('POST', `/rooms/${roomId}/wheel/start`, { token: creatorToken, body: {} }), 'F 转盘开始');
    db.prepare(`UPDATE room SET wheel_started_at = datetime('now', '-21 seconds') WHERE room_id = ?`).run(roomId);
    assertOk(await request('POST', `/rooms/${roomId}/wheel/complete`, { token: inviteeToken, body: {} }), 'F 转盘完成');
    assertOk(await request('POST', `/rooms/${roomId}/cake/lock`, { token: inviteeToken, body: {} }), 'F 锁定蛋糕');
    assertOk(await request('POST', `/rooms/${roomId}/ready`, { token: inviteeToken, body: {} }), 'F ready');
    assertOk(await request('POST', `/rooms/${roomId}/seal`, { token: creatorToken, body: {} }), 'F 封装');
    // 只开始庆祝，不完成 -> 停留在 awaiting
    assertOk(await request('POST', `/rooms/${roomId}/celebration/start`, { token: creatorToken, body: {} }), 'F 开始庆祝');
  }

  // ---- 场景 G：故意制造口径矛盾，用于验证看板②的异常检测 ----
  // invitee_entered_celebrate 事件故意少打，让它的计数低于 celebration_completed，
  // 复现你截图里看到的"TA进庆祝=0 但仪式走完=14"的矛盾现象。
  assertOk(await request('POST', '/analytics/events', {
    token: creatorToken,
    body: {
      events: [
        { name: 'celebration_completed', room_id: nanoid(), properties: { role: 'creator', duration: 8 } },
        { name: 'celebration_completed', room_id: nanoid(), properties: { role: 'invitee', duration: 9 } }
      ]
    }
  }), 'G 口径矛盾演示数据');
  // 不上报任何额外 invitee_entered_celebrate，让它继续保持比场景A少，制造倒挂

  console.log('');
  console.log('========================================');
  console.log(`演示数据已生成完毕`);
  console.log(`看板地址: http://localhost:${PORT}/dashboard`);
  console.log(`管理员密码: ${DASHBOARD_PASSWORD}`);
  console.log(`临时数据库: ${process.env.DEARU_TEST_DB_PATH}`);
  console.log('========================================');
  console.log('按 Ctrl+C 结束演示服务');

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('造数据失败：', err);
  process.exit(1);
});
