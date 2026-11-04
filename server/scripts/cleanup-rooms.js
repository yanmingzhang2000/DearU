// S4 自动清理任务（v1-状态机.md §5.4 / v1产品契约决策回答.md §S4）
// 按房间状态设生命周期，到期后软删除（见 src/utils/room-lifecycle.js，脱敏 cake_state 并撤销邀请链接）：
//   draft / collaborating : 连续 14 天无活动（last_activity_at）
//   awaiting               : 自 sealed_at 起 7 天未完成庆祝（双方均未 complete）
//   completed              : 自 completed_at 起 30 天
//
// 用法：
//   node scripts/cleanup-rooms.js          直接执行清理
//   node scripts/cleanup-rooms.js --dry-run  只打印将被清理的房间，不实际写入
//
// 部署方式：本脚本不内置定时器，不随 server.js 常驻进程启动。
// 推荐用系统 cron（Linux）或任务计划程序（Windows）按天调度一次，
// 或云函数定时触发器调用等价逻辑。不内建调度是为了避免"进程重启后定时器丢失/重复触发"的运维复杂度，
// 交给平台原生的定时任务机制更可靠（见 README「清理任务部署」一节）。

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { softDeleteRoom } = require('../src/utils/room-lifecycle');

const DRAFT_COLLABORATING_DAYS = 14;
const AWAITING_DAYS = 7;
const COMPLETED_DAYS = 30;

/**
 * 找出三类规则下到期应被清理的房间，返回统一结构方便打印和后续软删除共用同一份数据。
 * 纯函数（不执行清理动作），由调用方决定是打印还是真的删。
 * @param {Object} db - 已打开的数据库连接
 * @returns {Array<{roomId: string, status: string, reason: string}>}
 */
function findExpiredRooms(db) {
  const expired = [];

  const draftCollaborating = db.prepare(`
    SELECT room_id, status FROM room
    WHERE deleted_at IS NULL
      AND status IN ('draft', 'collaborating')
      AND last_activity_at <= datetime('now', '-' || ? || ' days')
  `).all(DRAFT_COLLABORATING_DAYS);
  draftCollaborating.forEach((row) => {
    expired.push({ roomId: row.room_id, status: row.status, reason: `${DRAFT_COLLABORATING_DAYS}天无活动` });
  });

  const awaiting = db.prepare(`
    SELECT room_id, status FROM room
    WHERE deleted_at IS NULL
      AND status = 'awaiting'
      AND sealed_at IS NOT NULL
      AND sealed_at <= datetime('now', '-' || ? || ' days')
  `).all(AWAITING_DAYS);
  awaiting.forEach((row) => {
    expired.push({ roomId: row.room_id, status: row.status, reason: `封装后${AWAITING_DAYS}天未完成庆祝` });
  });

  const completed = db.prepare(`
    SELECT room_id, status FROM room
    WHERE deleted_at IS NULL
      AND status = 'completed'
      AND completed_at IS NOT NULL
      AND completed_at <= datetime('now', '-' || ? || ' days')
  `).all(COMPLETED_DAYS);
  completed.forEach((row) => {
    expired.push({ roomId: row.room_id, status: row.status, reason: `完成后保留${COMPLETED_DAYS}天已到期` });
  });

  return expired;
}

/**
 * 执行一轮清理：找到期房间并逐个软删除。
 * @param {Object} db
 * @param {{ dryRun?: boolean }} options
 * @returns {Array<{roomId: string, status: string, reason: string}>} 本轮（将）被清理的房间列表
 */
function runCleanup(db, { dryRun = false } = {}) {
  const expired = findExpiredRooms(db);
  if (!dryRun) {
    for (const room of expired) {
      softDeleteRoom(db, room.roomId);
    }
  }
  return expired;
}

// 把清理结果写一行追加日志，供用 cron/任务计划程序等后台方式调度时事后排查
// （后台调度没人盯着终端，console.log 的内容调度结束就看不到了，必须落盘）。
// 只在 CLI 入口调用，不进 runCleanup 本身，避免测试跑纯函数时产生这个副作用
// （见 test/cleanup-rooms.test.js 直接 require 调用 runCleanup 的用法）。
function appendCleanupLog(logPath, { dryRun, result }) {
  const fs = require('node:fs');
  const timestamp = new Date().toISOString();
  const summary = result.length === 0
    ? '没有到期需要清理的房间'
    : `共${dryRun ? '将' : ''}清理 ${result.length} 个房间：` +
      result.map((r) => `${r.roomId}(${r.status},${r.reason})`).join('; ');
  const line = `[${timestamp}]${dryRun ? ' [dry-run]' : ''} ${summary}\n`;
  try {
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (err) {
    // 日志写入失败不应该让清理任务本身失败（已经执行的软删除不应因为日志报错而回滚或报错退出）
    console.error(`⚠️ 写入清理日志失败（${logPath}），不影响本轮清理结果：`, err.message);
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const dbPath = path.join(__dirname, '../data/dearu-v1.db');
  const logPath = path.join(__dirname, '../data/cleanup.log');

  if (!require('node:fs').existsSync(dbPath)) {
    console.log(`ℹ️  数据库文件不存在（${dbPath}），无需清理。请先运行 npm run db:init 初始化数据库。`);
    process.exit(0);
  }

  const db = new DatabaseSync(dbPath);

  try {
    const result = runCleanup(db, { dryRun });
    if (result.length === 0) {
      console.log('✅ 没有到期需要清理的房间');
    } else {
      result.forEach((room) => {
        console.log(`${dryRun ? '🔍 [dry-run]' : '🗑 '} ${room.roomId} (${room.status}) — ${room.reason}`);
      });
      console.log(`${dryRun ? '🔍 [dry-run] 共 ' + result.length + ' 个房间将被清理（未实际执行）' : '✅ 共清理 ' + result.length + ' 个房间'}`);
    }
    appendCleanupLog(logPath, { dryRun, result });
  } finally {
    db.close();
  }
}

module.exports = { findExpiredRooms, runCleanup, DRAFT_COLLABORATING_DAYS, AWAITING_DAYS, COMPLETED_DAYS };
