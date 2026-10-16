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

// POST /invites/:token/enter - 寿星通过邀请链接进房（E4，首位非房主绑定）
// 前端用 POST 调用（见 room/index.js loadRoom）
router.post('/:token/enter', authMiddleware, (req, res) => {
  const token = req.params.token;
  const userId = req.user.user_id;

  const link = db.prepare(`
    SELECT * FROM invite_link WHERE token = ?
  `).get(token);

  if (!link || link.status === 'revoked') {
    return res.status(404).json({
      error: { code: 'INVALID_LINK', message: '邀请链接无效或已失效' }
    });
  }

  const room = db.prepare('SELECT * FROM room WHERE room_id = ? AND deleted_at IS NULL').get(link.room_id);
  if (!room) {
    return res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' }
    });
  }

  // E4 核心逻辑：首位**非房主**打开者绑定为 invitee
  if (room.creator_id === userId) {
    // 房主本人打开（预览/重进/测试），不绑定，直接返回房间
    const celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(room.room_id);
    const response = formatRoomResponse(room, celebration, 'creator', token);
    response.route = getRoute(room.status);
    return res.json(response);
  }

  // 非房主
  if (!room.invitee_id) {
    // 首位非房主，绑定为 invitee，状态从 draft 切到 collaborating
    db.prepare(`
      UPDATE room SET invitee_id = ?, status = 'collaborating', last_activity_at = datetime('now')
      WHERE room_id = ?
    `).run(userId, room.room_id);

    // 埋点 invitee_entered_edit
    db.prepare(`
      INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
      VALUES (?, ?, ?, ?, ?)
    `).run(nanoid(), 'invitee_entered_edit', room.room_id, userId, '{}');

    const updatedRoom = db.prepare('SELECT * FROM room WHERE room_id = ?').get(room.room_id);
    const celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(room.room_id);
    const response = formatRoomResponse(updatedRoom, celebration, 'invitee', token);
    response.route = getRoute(updatedRoom.status);
    return res.json(response);
  }

  // invitee_id 已绑定
  if (room.invitee_id === userId) {
    // 寿星本人重进；如果状态是 awaiting，埋点 invitee_entered_celebrate（去重）
    if (room.status === 'awaiting') {
      const existing = db.prepare(`
        SELECT event_id FROM analytics_event 
        WHERE event_name = 'invitee_entered_celebrate' AND room_id = ? AND user_id = ?
      `).get(room.room_id, userId);
      if (!existing) {
        db.prepare(`
          INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
          VALUES (?, ?, ?, ?, ?)
        `).run(nanoid(), 'invitee_entered_celebrate', room.room_id, userId, '{}');
      }
    }

    const celebration = db.prepare('SELECT * FROM celebration WHERE room_id = ?').get(room.room_id);
    const response = formatRoomResponse(room, celebration, 'invitee', token);
    response.route = getRoute(room.status);
    return res.json(response);
  }

  // 第三人（非 creator/invitee）：直接拒绝访问，不返回任何房间内容
  return res.status(403).json({
    error: { code: 'ACCESS_DENIED', message: '这不是给你的' }
  });
});

module.exports = router;
