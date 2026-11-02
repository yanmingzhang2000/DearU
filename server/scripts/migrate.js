// v1.1 增量迁移脚本：为已存在的生产数据库补齐 making_phase 相关 4 个字段
// 仅用于升级已有的 room 表（历史数据库文件）。全新建库走 schema.js 的 CREATE TABLE，
// 已经直接带这些字段，不需要跑这个脚本（包括所有测试库，都是全新建表，不经过这条路径）。
//
// 用法：node scripts/migrate.js
//
// 可重复执行：每个字段执行前先查 PRAGMA table_info(room) 确认是否已存在，
// 已存在则跳过，避免 SQLite "duplicate column name" 报错。

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbDir = path.join(__dirname, '../data');
const dbPath = path.join(dbDir, 'dearu-v1.db');

// v1.1 新增字段定义：列名 -> ALTER TABLE 的列类型+默认值 子句
const NEW_COLUMNS = [
  { name: 'making_phase', ddl: "TEXT NOT NULL DEFAULT 'awaiting_both'" },
  { name: 'wheel_started_at', ddl: 'TEXT' },
  { name: 'cake_locked_at', ddl: 'TEXT' },
  { name: 'cake_version', ddl: 'INTEGER NOT NULL DEFAULT 1' }
];

function getExistingColumns(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(rows.map((row) => row.name));
}

function migrate(db) {
  const existingColumns = getExistingColumns(db, 'room');
  let appliedCount = 0;

  for (const column of NEW_COLUMNS) {
    if (existingColumns.has(column.name)) {
      console.log(`⏭  room.${column.name} 已存在，跳过`);
      continue;
    }
    db.exec(`ALTER TABLE room ADD COLUMN ${column.name} ${column.ddl};`);
    console.log(`✅ room.${column.name} 已添加`);
    appliedCount += 1;
  }

  return appliedCount;
}

// 允许被测试 require 复用迁移逻辑（传入已打开的 db 实例），直接运行时才自己开库
if (require.main === module) {
  if (!fs.existsSync(dbPath)) {
    console.log(`ℹ️  数据库文件不存在（${dbPath}），无需迁移，直接运行 db:init 建全新库即可。`);
    process.exit(0);
  }

  const db = new DatabaseSync(dbPath);
  try {
    const appliedCount = migrate(db);
    console.log(appliedCount > 0 ? `✅ 迁移完成，新增 ${appliedCount} 个字段` : '✅ 数据库已是最新结构，无需迁移');
  } finally {
    db.close();
  }
}

module.exports = { migrate, getExistingColumns, NEW_COLUMNS };
