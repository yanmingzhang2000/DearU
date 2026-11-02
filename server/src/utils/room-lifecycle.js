// 房间生命周期收尾逻辑：软删除 + 敏感内容脱敏
// 供 routes/rooms.js 的 E11（房主主动删房）和 scripts/cleanup-rooms.js（S4 自动清理）共用，
// 两者最终做的事完全一致，不应该各写一份。
//
// v1-数据模型.md 关键约束 #4：cake_state（含祝福语/愿望）属 PIPL 敏感个人信息，
// deleted_at 触发后须物理清理或脱敏，不可长期留存。
// 本模块选择"脱敏"而非"物理删除整行"：保留 room 行用于清理任务的审计（避免同一房间被反复扫描处理），
// 但把 cake_state 清空为不含任何用户输入内容的空壳结构，达到"敏感信息不留存"的效果。

/**
 * 对一个房间执行软删除：写 deleted_at，并清空 cake_state 中的用户输入内容。
 * 纯函数不直接操作 db，由调用方传入一个"执行 UPDATE"的回调，方便测试注入 mock db 或真实 db.prepare。
 *
 * @param {Object} db - 数据库连接（node:sqlite DatabaseSync 实例，需支持 prepare().run()）
 * @param {string} roomId
 */
function softDeleteRoom(db, roomId) {
  // 清空为空壳结构（与建房时的初始值形状一致），不保留任何底胚/口味/图层/祝福语等用户输入
  const scrubbedCakeState = JSON.stringify({ style: null, flavor: null, layers: [] });

  db.prepare(`
    UPDATE room
    SET deleted_at = datetime('now'),
        cake_state = ?,
        last_activity_at = datetime('now')
    WHERE room_id = ? AND deleted_at IS NULL
  `).run(scrubbedCakeState, roomId);

  // 邀请链接一并失效，避免软删除后链接仍能被打开（虽然 deleted_at 过滤已经会挡住，双重保护更稳妥）
  db.prepare(`
    UPDATE invite_link
    SET status = 'revoked', revoked_at = datetime('now')
    WHERE room_id = ? AND status = 'active'
  `).run(roomId);
}

module.exports = { softDeleteRoom };
