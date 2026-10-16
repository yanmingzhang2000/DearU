const express = require('express');
const { nanoid } = require('nanoid');
const authMiddleware = require('../middleware/auth');
const db = require('../db');
const { formatRoomResponse } = require('../utils/format');
const roomContract = require('../../../shared/room-contract.json');

const router = express.Router();

function getRoute(status) {
  return roomContract.routes[status] || 'edit';
}

// POST /rooms - 建房（E1 create_room）
router.post('/', authMiddleware, (req, res) => {
  const roomId = nanoid();
  const inviteToken = nanoid(16);
  const creatorId = req.user.user_id;

  db.prepare(`
    INSERT INTO room (room_id, creator_id, invite_link_token, cake_state, celebration_config)
    VALUES (?, ?, ?, ?, ?)
  `).run(roomId, creatorId, inviteToken, '{}', '{}');

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

// PUT /rooms/:id/cake - 编辑蛋糕（E2/E5）
router.put('/:id/cake', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.user_id;
  const cakeState = req.body.cakeState;

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

  db.prepare(`
    UPDATE room SET cake_state = ?, last_activity_at = datetime('now') WHERE room_id = ?
  `).run(JSON.stringify(cakeState), roomId);

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

module.exports = router;
