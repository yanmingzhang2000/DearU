const express = require('express');
const { nanoid } = require('nanoid');
const authMiddleware = require('../middleware/auth');
const db = require('../db');
const { formatRoomResponse } = require('../utils/format');
const { resolveCakeSave } = require('../utils/cake-merge');
const { softDeleteRoom } = require('../utils/room-lifecycle');
const roomContract = require('../../../shared/room-contract.json');

const router = express.Router();

function getRoute(status) {
  return roomContract.routes[status] || 'edit';
}

// 统一的"是否房间成员"判定：第三人返回 403 ACCESS_DENIED 且不泄露任何房间信息，
// 是成员但角色不对再返回 403 FORBIDDEN —— 与 v1-状态机.md 边界规则 1 的分层方式保持一致
// （见 v1.1-转盘仪式与协作合并规格.md 第 10 节边界规则 3）
function requireRoomMember(room, userId, res) {
  if (room.creator_id !== userId && room.invitee_id !== userId) {
    res.status(403).json({ error: { code: 'ACCESS_DENIED', message: '这不是给你的' } });
    return false;
  }
  return true;
}

// POST /rooms - 建房（E1 create_room）
router.post('/', authMiddleware, (req, res) => {
  const roomId = nanoid();
  const inviteToken = nanoid(16);
  const creatorId = req.user.user_id;

  // 初始化为完整的 cake_state 结构（与前端 utils/cake-editor.js 的 createEmptyCake 默认值一致），
  // 避免 v1.1 合并算法在"房间从未被 PUT 过"时读到 undefined 的 style/flavor/layers
  const initialCakeState = JSON.stringify({ style: 'cream', flavor: 'vanilla', layers: [] });
  db.prepare(`
    INSERT INTO room (room_id, creator_id, invite_link_token, cake_state, celebration_config)
    VALUES (?, ?, ?, ?, ?)
  `).run(roomId, creatorId, inviteToken, initialCakeState, '{}');

  db.prepare(`
    INSERT INTO invite_link (token, room_id) VALUES (?, ?)
  `).run(inviteToken, roomId);

  db.prepare(`
    INSERT INTO celebration (celebration_id, room_id) VALUES (?, ?)
  `).run(nanoid(), roomId);

  // 埋点 room_created
  db.prepare(`
    INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(), 'room_created', roomId, creatorId, JSON.stringify({ occasion: 'birthday' }));

  // 埋点 invitee_created_room（K 系数分子）：若本次建房者曾在任意房间担任过 invitee（寿星），
  // 说明这是"被邀请者自己也建了一个新房"的自然增长信号。只看"曾经当过寿星"，不要求是同一个房间，
  // 也不要求当次庆祝已完成——只要曾绑定为 invitee_id 就算，与 v1-埋点schema.md §2 口径一致
  // （"打开一次不算"由 invites.js 的 E4 绑定动作本身保证，此处复用绑定结果不重复判断）。
  const wasInvitee = db.prepare(`
    SELECT 1 FROM room WHERE invitee_id = ? LIMIT 1
  `).get(creatorId);
  if (wasInvitee) {
    db.prepare(`
      INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
      VALUES (?, ?, ?, ?, ?)
    `).run(nanoid(), 'invitee_created_room', roomId, creatorId, '{}');
  }

  const room = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(room, null, 'creator', inviteToken);
  response.route = getRoute(room.status);
  response.invite = { token: inviteToken, path: `/pages/room/index?token=${inviteToken}` };
  res.json(response);
});

// GET /rooms/:id - 读房间（需权限校验）
router.get('/:id', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare(`
    SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL
  `).get(roomId);

  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在或已被删除' }
    });
  }

  // 权限校验：仅 creator/invitee 可访问
  if (room.creator_id !== userId && room.invitee_id !== userId) {
    return res.status(403).json({
      error: { code: 'ACCESS_DENIED', message: '这不是给你的' }
    });
  }

  const celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(roomId);
  const role = room.creator_id === userId ? 'creator' : 'invitee';
  const response = formatRoomResponse(room, celebration, role, room.invite_link_token);
  response.route = getRoute(room.status);
  res.json(response);
});

// PUT /rooms/:id/cake - 编辑蛋糕（E2/E5，v1.1 起改为字段级权限 + 图层合并写入，见规格第 4 节）
router.put('/:id/cake', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;
  const requestCake = req.body.cakeState;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  // 权限：draft 只有 creator 可编辑；collaborating 双方可编辑；sealed+ 不可编辑
  if (room.status === 'draft' && room.creator_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '草稿阶段仅房主可编辑' }
    });
  }
  if (room.status === 'collaborating' && room.creator_id !== userId && room.invitee_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '协作阶段仅房主和寿星可编辑' }
    });
  }
  if (['sealed', 'awaiting', 'completed'].includes(room.status)) {
    return res.status(400).json({
      error: { code: 'ROOM_SEALED', message: '房间已封装，不可编辑' }
    });
  }

  const dbCake = typeof room.cake_state === 'string' ? JSON.parse(room.cake_state) : room.cake_state;
  const isInvitee = room.invitee_id === userId;

  // 第一层：style/flavor 字段级权限校验；第二层：图层合并（规格 4.1 先于 4.2，
  // 两者合并进同一个最终对象后一次性写入，不分两次写，不留中间脏状态）
  const { allowed, cakeState: finalCakeState } = resolveCakeSave({
    makingPhase: room.making_phase,
    isInvitee,
    dbCake,
    requestCake
  });

  if (!allowed) {
    // cake_editing 阶段非寿星试图改 style/flavor：整个请求 403，不做字段级部分成功
    // （即便本次请求同时带着被允许的贴纸/涂鸦变化，也一并拒绝，不单独保存）
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '当前阶段仅寿星可修改底胚和口味' }
    });
  }

  db.prepare(`
    UPDATE room SET cake_state = ?, cake_version = cake_version + 1, last_activity_at = datetime('now') WHERE room_id = ?
  `).run(JSON.stringify(finalCakeState), roomId);

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const role = room.creator_id === userId ? 'creator' : 'invitee';
  const response = formatRoomResponse(updatedRoom, null, role, room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// POST /rooms/:id/wheel/start - F1 房主开启转盘：wheel_ready -> wheel_playing
router.post('/:id/wheel/start', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' } });
  }
  if (!requireRoomMember(room, userId, res)) return;

  if (room.creator_id !== userId) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '仅房主可开启转盘' } });
  }

  // 带 WHERE 条件的原子 UPDATE + 检查受影响行数，防止重复点击被误判为两次成功
  // （node:sqlite DatabaseSync 同步阻塞 + Express 单线程，请求本身不会被打断，
  //  但两次独立的重复请求仍需要这层保护，否则第二次会被误判成功）
  const result = db.prepare(`
    UPDATE room SET making_phase = 'wheel_playing', wheel_started_at = datetime('now'), last_activity_at = datetime('now')
    WHERE room_id = ? AND making_phase = 'wheel_ready'
  `).run(roomId);

  if (result.changes === 0) {
    return res.status(400).json({ error: { code: 'INVALID_STATE', message: '当前阶段不可开启转盘' } });
  }

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(updatedRoom, null, 'creator', room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// POST /rooms/:id/wheel/complete - F2 寿星确认转盘播完：wheel_playing -> cake_editing
router.post('/:id/wheel/complete', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' } });
  }
  if (!requireRoomMember(room, userId, res)) return;

  if (room.invitee_id !== userId) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '仅寿星可确认转盘播完' } });
  }

  if (room.making_phase !== 'wheel_playing') {
    return res.status(400).json({ error: { code: 'INVALID_STATE', message: '当前阶段不可确认转盘播完' } });
  }

  // 20 秒下限保护：防止跳过动画直接调用接口；以服务端时间为准，不依赖前端传任何计时参数
  const wheelStartedAt = new Date(room.wheel_started_at + 'Z').getTime();
  const elapsedMs = Date.now() - wheelStartedAt;
  if (!room.wheel_started_at || elapsedMs < 20000) {
    return res.status(400).json({ error: { code: 'WHEEL_NOT_FINISHED', message: '转盘还没播完' } });
  }

  const result = db.prepare(`
    UPDATE room SET making_phase = 'cake_editing', last_activity_at = datetime('now')
    WHERE room_id = ? AND making_phase = 'wheel_playing'
  `).run(roomId);

  if (result.changes === 0) {
    return res.status(400).json({ error: { code: 'INVALID_STATE', message: '当前阶段不可确认转盘播完' } });
  }

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(updatedRoom, null, 'invitee', room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// POST /rooms/:id/cake/lock - F3 寿星锁定底胚口味：cake_editing -> decorating
router.post('/:id/cake/lock', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' } });
  }
  if (!requireRoomMember(room, userId, res)) return;

  if (room.invitee_id !== userId) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '仅寿星可锁定底胚口味' } });
  }

  const result = db.prepare(`
    UPDATE room SET making_phase = 'decorating', cake_locked_at = datetime('now'), last_activity_at = datetime('now')
    WHERE room_id = ? AND making_phase = 'cake_editing'
  `).run(roomId);

  if (result.changes === 0) {
    return res.status(400).json({ error: { code: 'INVALID_STATE', message: '当前阶段不可锁定底胚口味' } });
  }

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(updatedRoom, null, 'invitee', room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// DELETE /rooms/:id/cake/layers/:layerId - F4 删除图层（独立接口，PUT 永不处理删除语义）
router.delete('/:id/cake/layers/:layerId', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const layerId = req.params.layerId;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' } });
  }
  if (!requireRoomMember(room, userId, res)) return;

  // 延续原有编辑权限：draft 仅房主；collaborating 阶段双方；sealed+ 不可编辑
  if (room.status === 'draft' && room.creator_id !== userId) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '草稿阶段仅房主可编辑' } });
  }
  if (['sealed', 'awaiting', 'completed'].includes(room.status)) {
    return res.status(400).json({ error: { code: 'ROOM_SEALED', message: '房间已封装，不可编辑' } });
  }

  const dbCake = typeof room.cake_state === 'string' ? JSON.parse(room.cake_state) : room.cake_state;
  if (!dbCake.layers) dbCake.layers = [];
  const layerIndex = dbCake.layers.findIndex((l) => l.id === layerId);
  if (layerIndex === -1) {
    return res.status(404).json({ error: { code: 'LAYER_NOT_FOUND', message: '图层不存在' } });
  }

  dbCake.layers.splice(layerIndex, 1);
  dbCake.layers.forEach((layer, index) => {
    layer.zIndex = index;
  });

  db.prepare(`
    UPDATE room SET cake_state = ?, cake_version = cake_version + 1, last_activity_at = datetime('now') WHERE room_id = ?
  `).run(JSON.stringify(dbCake), roomId);

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const role = room.creator_id === userId ? 'creator' : 'invitee';
  const response = formatRoomResponse(updatedRoom, null, role, room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// POST /rooms/:id/invite - 房主发邀请（E3，记 first_invite_sent_at）
router.post('/:id/invite', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.creator_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '仅房主可发邀请' }
    });
  }

  // 如果 first_invite_sent_at 为空，记首次发送时刻（埋点分母）
  if (!room.first_invite_sent_at) {
    db.prepare(`
      UPDATE room SET first_invite_sent_at = datetime('now') WHERE room_id = ?
    `).run(roomId);

    // 埋点 invite_sent
    db.prepare(`
      INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
      VALUES (?, ?, ?, ?, ?)
    `).run(nanoid(), 'invite_sent', roomId, userId, JSON.stringify({ channel: req.body.channel || 'wechat' }));
  }

  res.json({
    invite: {
      token: room.invite_link_token,
      path: `/pages/room/index?token=${room.invite_link_token}`
    }
  });
});

// POST /rooms/:id/nickname - 房主设定寿星昵称（写进歌词第 4 句，存 celebration_config）
router.put('/:id/nickname', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.creator_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '仅房主可设定昵称' }
    });
  }

  const nickname = String(req.body.nickname || '').trim().slice(0, 12);
  let config = {};
  try {
    config = JSON.parse(room.celebration_config || '{}');
  } catch (e) {
    config = {};
  }
  config.inviteeNickname = nickname;

  db.prepare('UPDATE room SET celebration_config = ? WHERE room_id = ?')
    .run(JSON.stringify(config), roomId);

  res.json({ celebrationConfig: config });
});

// POST /rooms/:id/ready - 寿星"我选好了"（E6）
router.post('/:id/ready', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.invitee_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '仅寿星可标记已完成选择' }
    });
  }

  if (room.status !== 'collaborating') {
    return res.status(400).json({
      error: { code: 'INVALID_STATE', message: '仅协作阶段可标记完成' }
    });
  }

  db.prepare(`
    UPDATE room SET invitee_ready_at = datetime('now'), last_activity_at = datetime('now') WHERE room_id = ?
  `).run(roomId);

  // 埋点 invitee_ready
  db.prepare(`
    INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(), 'invitee_ready', roomId, userId, '{}');

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(updatedRoom, null, 'invitee', room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// POST /rooms/:id/seal - 房主封装（E7，原子事务）
router.post('/:id/seal', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.creator_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '仅房主可封装' }
    });
  }

  if (room.status !== 'collaborating') {
    return res.status(400).json({
      error: { code: 'INVALID_STATE', message: '仅协作阶段可封装' }
    });
  }

  // 前置条件：invitee_ready_at 必须非空
  if (!room.invitee_ready_at) {
    return res.status(400).json({
      error: { code: 'INVITEE_NOT_READY', message: '寿星尚未完成选择，无法封装' }
    });
  }

  // 原子操作：状态切 sealed，随即自动进入 awaiting（文档：Sealed 后自动进入 Awaiting）
  db.prepare(`
    UPDATE room 
    SET status = 'awaiting', sealed_at = datetime('now'), last_activity_at = datetime('now')
    WHERE room_id = ?
  `).run(roomId);

  // 埋点 room_sealed
  db.prepare(`
    INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(), 'room_sealed', roomId, userId, '{}');

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  const celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(updatedRoom, celebration, 'creator', room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// POST /rooms/:id/celebration/start - 开始庆祝（E8，按角色记 started_at）
router.post('/:id/celebration/start', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.status !== 'awaiting') {
    return res.status(400).json({
      error: { code: 'INVALID_STATE', message: '仅待庆祝阶段可开始' }
    });
  }

  const role = room.creator_id === userId ? 'creator' : (room.invitee_id === userId ? 'invitee' : null);
  if (!role) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '无权限' }
    });
  }

  const field = role === 'creator' ? 'creator_started_at' : 'invitee_started_at';
  db.prepare(`
    UPDATE celebration SET ${field} = datetime('now') WHERE room_id = ?
  `).run(roomId);

  const celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(room, celebration, role, room.invite_link_token);
  response.route = getRoute(room.status);
  res.json(response);
});

// POST /rooms/:id/celebration/complete - 完成庆祝（E9，双方均完成才进 completed）
router.post('/:id/celebration/complete', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.status !== 'awaiting') {
    return res.status(400).json({
      error: { code: 'INVALID_STATE', message: '仅待庆祝阶段可完成' }
    });
  }

  const role = room.creator_id === userId ? 'creator' : (room.invitee_id === userId ? 'invitee' : null);
  if (!role) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '无权限' }
    });
  }

  const field = role === 'creator' ? 'creator_completed_at' : 'invitee_completed_at';
  db.prepare(`
    UPDATE celebration SET ${field} = datetime('now') WHERE room_id = ?
  `).run(roomId);

  // 埋点 celebration_completed（按角色）
  db.prepare(`
    INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(), 'celebration_completed', roomId, userId, JSON.stringify({ role }));

  // 检查双方是否均完成
  let celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(roomId);
  if (celebration.creator_completed_at && celebration.invitee_completed_at) {
    // 双方均完成，房间进入 completed；completed_at = max(两个完成时间)
    const completedAt = celebration.creator_completed_at > celebration.invitee_completed_at
      ? celebration.creator_completed_at
      : celebration.invitee_completed_at;

    db.prepare(`
      UPDATE room SET status = 'completed', completed_at = ?, last_activity_at = datetime('now')
      WHERE room_id = ?
    `).run(completedAt, roomId);
  }

  const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(roomId);
  celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(roomId);
  const response = formatRoomResponse(updatedRoom, celebration, role, room.invite_link_token);
  response.route = getRoute(updatedRoom.status);
  res.json(response);
});

// POST /rooms/:id/revoke - 房主撤销邀请链接（E10）
// 前置态"非 completed"（v1-状态机.md E10）；撤销后链接失效，第三人（以及尚未绑定的寿星）此后打开即拒。
// 幂等：链接已是 revoked 时重复调用直接返回成功，不报错（撤销操作本身没有"失败"的业务含义）。
router.post('/:id/revoke', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.creator_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '仅房主可撤销邀请链接' }
    });
  }

  if (room.status === 'completed') {
    return res.status(400).json({
      error: { code: 'INVALID_STATE', message: '已完成的房间无需撤销链接' }
    });
  }

  db.prepare(`
    UPDATE invite_link
    SET status = 'revoked', revoked_at = datetime('now')
    WHERE room_id = ? AND status = 'active'
  `).run(roomId);

  db.prepare(`
    UPDATE room SET last_activity_at = datetime('now') WHERE room_id = ?
  `).run(roomId);

  res.json({ success: true, invite: { token: room.invite_link_token, status: 'revoked' } });
});

// DELETE /rooms/:id - 房主删房（E11，逻辑删除 + 敏感内容脱敏）
// 前置态"任意"（v1-状态机.md E11：触发方房主，前置态任意，目标态删除）。
// 幂等：房间已是 deleted_at 非空时，视为"房间不存在"返回 404（与其他路由的查询条件保持一致，
// 不额外区分"从未存在"和"已被删除"两种 404，避免泄露房间是否曾经存在过）。
router.delete('/:id', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(roomId);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  if (room.creator_id !== userId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '仅房主可删除房间' }
    });
  }

  softDeleteRoom(db, roomId);

  res.json({ success: true });
});

module.exports = router;
