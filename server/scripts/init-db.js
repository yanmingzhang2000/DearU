const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { SCHEMA_SQL } = require('../src/schema');

const dbDir = path.join(__dirname, '../data');
const dbPath = path.join(dbDir, 'dearu-v1.db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec(SCHEMA_SQL);
console.log('✅ Database initialized:', dbPath);
console.log('✅ Schema tables created: user, room, invite_link, celebration, analytics_event');
db.close();
