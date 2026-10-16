const express = require('express');

const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');
const invitesRoutes = require('./routes/invites');
const analyticsRoutes = require('./routes/analytics');

// 构建 Express app（不监听端口），供生产入口和测试共用
function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());

  // CORS for miniprogram dev (localhost:3000 ↔ devtools)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/rooms', roomsRoutes);
  app.use('/api/v1/invites', invitesRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 404
  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: '接口不存在' }
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? '服务器错误' : err.message
      }
    });
  });

  return app;
}

// 直接运行时才监听端口（被 require 用于测试时不会执行到这里）
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`✅ DearU v1 API running on http://localhost:${PORT}`);
    console.log(`📍 API base: http://localhost:${PORT}/api/v1`);
    console.log(`🔧 Dev mode: POST /api/v1/auth/dev-login with { "identity": "creator" | "invitee" | "third-party" }`);
  });
}

module.exports = { createApp };
