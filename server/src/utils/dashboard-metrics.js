// 看板指标计算：对照 v1-埋点schema.md 第 2/3 节的事件定义和指标公式，纯 SQL 聚合，实时计算。
// v1 数据量小（熟人情侣 + 自然流量），不做快照/缓存，每次请求直接查库。
//
// 口径对照（务必和 v1-埋点schema.md 保持一致，改动任一方都要同步另一方）：
// - 北极星：邀请完成率 = 存在 invitee_completed_at 的房间数 ÷ 存在 first_invite_sent_at 的房间数
// - 邀请打开率 = invitee_entered_edit 房间数 ÷ first_invite_sent_at 房间数
// - 制作→庆祝走完率 = invitee 完成房间数 ÷ invitee_entered_edit 房间数
// - 口碑系数 K = invitee_created_room 次数 ÷ 总新房数
// - 主动表达率 = user_expressed 次数 ÷ celebration_completed 次数

/**
 * 计算北极星与四个衍生指标
 * @param {Object} db - node:sqlite DatabaseSync 实例
 * @returns {Object} 指标对象，均含 numerator/denominator/rate 三元组，分母为 0 时 rate 为 null（避免除零）
 */
function computeCoreMetrics(db) {
  const totalInvitedRooms = db.prepare(`
    SELECT COUNT(*) AS cnt FROM room WHERE first_invite_sent_at IS NOT NULL
  `).get().cnt;

  // 北极星分子：invitee_completed_at 非空的房间数（与 schema 文档"分子固定取寿星完成"口径一致）
  const inviteeCompletedRooms = db.prepare(`
    SELECT COUNT(*) AS cnt FROM room r
    JOIN celebration c ON c.room_id = r.room_id
    WHERE c.invitee_completed_at IS NOT NULL
  `).get().cnt;

  const starRate = totalInvitedRooms > 0 ? inviteeCompletedRooms / totalInvitedRooms : null;

  // 邀请打开率分子：invitee_entered_edit 事件覆盖的房间数（按房间去重，多次进入不重复计）
  const openedRooms = db.prepare(`
    SELECT COUNT(DISTINCT room_id) AS cnt FROM analytics_event WHERE event_name = 'invitee_entered_edit'
  `).get().cnt;
  const openRate = totalInvitedRooms > 0 ? openedRooms / totalInvitedRooms : null;

  // 制作→庆祝走完率分母：已打开制作页的房间；分子：寿星已完成庆祝的房间
  const walkthroughRate = openedRooms > 0 ? inviteeCompletedRooms / openedRooms : null;

  // 口碑系数 K：invitee_created_room 事件次数 ÷ 总新房数（room 表总行数，不受软删除过滤，
  // 与"总新房"口径一致——建房事件 room_created 不受软删除影响，历史建房数应全部计入分母）
  const totalRooms = db.prepare(`SELECT COUNT(*) AS cnt FROM room`).get().cnt;
  const inviteeCreatedRoomCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM analytics_event WHERE event_name = 'invitee_created_room'
  `).get().cnt;
  const kFactor = totalRooms > 0 ? inviteeCreatedRoomCount / totalRooms : null;

  // 主动表达率：user_expressed 次数 ÷ celebration_completed 次数（事件次数比，非房间去重，
  // 与 schema 文档一致："测情绪价值"，双方各自完成都算一次分母）
  const expressedCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM analytics_event WHERE event_name = 'user_expressed'
  `).get().cnt;
  const celebrationCompletedEventCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM analytics_event WHERE event_name = 'celebration_completed'
  `).get().cnt;
  const expressionRate = celebrationCompletedEventCount > 0
    ? expressedCount / celebrationCompletedEventCount
    : null;

  return {
    starMetric: {
      name: '邀请完成率（北极星）',
      numerator: inviteeCompletedRooms,
      denominator: totalInvitedRooms,
      rate: starRate
    },
    openRate: {
      name: '邀请打开率',
      numerator: openedRooms,
      denominator: totalInvitedRooms,
      rate: openRate
    },
    walkthroughRate: {
      name: '制作→庆祝走完率',
      numerator: inviteeCompletedRooms,
      denominator: openedRooms,
      rate: walkthroughRate
    },
    kFactor: {
      name: '口碑系数 K',
      numerator: inviteeCreatedRoomCount,
      denominator: totalRooms,
      rate: kFactor
    },
    expressionRate: {
      name: '主动表达率',
      numerator: expressedCount,
      denominator: celebrationCompletedEventCount,
      rate: expressionRate
    }
  };
}

/**
 * 8 个事件各自的总次数（粗粒度总览，不去重，用于快速判断"有没有数据""哪个事件几乎没发生"）
 * 即使某事件 count=0 也要出现在列表里，避免看板上"安静的缺失"被误读为"没有这个事件"
 */
function computeEventCounts(db) {
  const rows = db.prepare(`
    SELECT event_name, COUNT(*) AS cnt
    FROM analytics_event
    GROUP BY event_name
    ORDER BY cnt DESC
  `).all();

  const KNOWN_EVENTS = [
    'room_created',
    'invite_sent',
    'invitee_entered_edit',
    'invitee_ready',
    'room_sealed',
    'invitee_entered_celebrate',
    'celebration_completed',
    'user_expressed',
    'invitee_created_room'
  ];
  const countMap = new Map(rows.map((r) => [r.event_name, r.cnt]));
  const known = KNOWN_EVENTS.map((name) => ({ eventName: name, count: countMap.get(name) || 0 }));
  const unknown = rows
    .filter((r) => !KNOWN_EVENTS.includes(r.event_name))
    .map((r) => ({ eventName: r.event_name, count: r.cnt }));

  return { known, unknown };
}

/**
 * 房间状态分布（当前各 status 的房间数，含软删除房间单独一行，便于看"活跃房间"规模）
 */
function computeRoomStatusBreakdown(db) {
  const active = db.prepare(`
    SELECT status, COUNT(*) AS cnt FROM room WHERE deleted_at IS NULL GROUP BY status
  `).all();
  const deletedCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM room WHERE deleted_at IS NOT NULL
  `).get().cnt;
  return { active, deletedCount };
}

/**
 * 最近 N 条埋点事件明细（调试用，默认 50 条，按时间倒序）
 * properties 原样返回 JSON 字符串，不在服务端解析，由前端按需展示，避免脏数据导致接口报错
 */
function computeRecentEvents(db, limit = 50) {
  return db.prepare(`
    SELECT event_id, event_name, room_id, user_id, properties, created_at
    FROM analytics_event
    ORDER BY created_at DESC, event_id DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  computeCoreMetrics,
  computeEventCounts,
  computeRoomStatusBreakdown,
  computeRecentEvents
};
