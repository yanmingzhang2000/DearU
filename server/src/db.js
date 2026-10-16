const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { SCHEMA_SQL } = require('./schema');

const dbDir = path.join(__dirname, '../data');
const defaultDbPath = path.join(dbDir, 'dearu-v1.db');

// 工厂函数，允许测试传入临时数据库路径（如 ':memory:'）
function createDatabase(dbPath = defaultDbPath) {
  if (dbPath !== ':memory:' && !fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

// 测试环境：用 DEARU_TEST_DB_PATH 指向独立的内存/临时数据库，不污染生产数据
// 并自动建表（生产环境 schema 由 npm run db:init 单独管理，不在这里自动建表）
const dbPath = process.env.DEARU_TEST_DB_PATH || defaultDbPath;
const isTestDb = !!process.env.DEARU_TEST_DB_PATH;

const dbInstance = createDatabase(dbPath);
if (isTestDb) {
  dbInstance.exec(SCHEMA_SQL);
}

// 默认导出数据库实例（向后兼容，保持原有调用方式不变）
module.exports = dbInstance;

// 导出工厂函数供测试使用
module.exports.createDatabase = createDatabase;
