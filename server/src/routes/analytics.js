const express = require('express');
const { nanoid } = require('nanoid');
const authMiddleware = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// POST /analytics/events - 批量上报埋点（兼容前端 analytics.js）
router.post('/events', authMiddleware, (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events)) {
    return res.status(400).json({
      error: { code: 'INVALID_PAYLOAD', message: 'events 必须是数组' }
    });
  }

  const insert = db.prepare(`
    INSERT INTO analytics_event (event_id, event_name, room_id, user_id, properties)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const event of events) {
    insert.run(
      nanoid(),
      event.name,
      event.room_id || null,
      req.user.user_id,
      JSON.stringify(event.properties || {})
    );
  }

  res.json({ success: true, count: events.length });
});

module.exports = router;
