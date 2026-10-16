// v1 数据模型 schema（4张表：user, room, invite_link, celebration + analytics_event）
// 抽成独立模块，供 scripts/init-db.js 和测试共用，避免 schema 定义重复维护

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user (
  user_id TEXT PRIMARY KEY,
  wx_openid TEXT UNIQUE NOT NULL,
  nickname TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room (
  room_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  invitee_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'collaborating', 'sealed', 'awaiting', 'completed')),
  cake_state TEXT NOT NULL DEFAULT '{}',
  celebration_config TEXT NOT NULL DEFAULT '{}',
  invite_link_token TEXT UNIQUE NOT NULL,
  invitee_ready_at TEXT,
  sealed_at TEXT,
  eta_minutes INTEGER,
  eta_set_at TEXT,
  first_invite_sent_at TEXT,
  real_cake_sku TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (creator_id) REFERENCES user(user_id),
  FOREIGN KEY (invitee_id) REFERENCES user(user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_token ON room(invite_link_token);
CREATE INDEX IF NOT EXISTS idx_room_creator ON room(creator_id);
CREATE INDEX IF NOT EXISTS idx_room_invitee ON room(invitee_id);
CREATE INDEX IF NOT EXISTS idx_room_cleanup ON room(status, last_activity_at);

CREATE TABLE IF NOT EXISTS invite_link (
  token TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE TABLE IF NOT EXISTS celebration (
  celebration_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE,
  creator_started_at TEXT,
  invitee_started_at TEXT,
  creator_completed_at TEXT,
  invitee_completed_at TEXT,
  screenshot_shared INTEGER DEFAULT 0,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE TABLE IF NOT EXISTS analytics_event (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  room_id TEXT,
  user_id TEXT,
  properties TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_event_room ON analytics_event(room_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_event(event_name);
`;

module.exports = { SCHEMA_SQL };
