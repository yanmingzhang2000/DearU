require('dotenv').config();

const express = require('express');

const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');
const invitesRoutes = require('./routes/invites');
const analyticsRoutes = require('./routes/analytics');
const dashboardRoutes = require('./routes/dashboard');

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
  app.use('/api/v1/dashboard', dashboardRoutes);
  // 看板 HTML 页面也挂一个顶层短链接，方便直接在浏览器输入 /dashboard 访问（不走 /api/v1 前缀）
  app.get('/dashboard', (req, res) => res.redirect('/api/v1/dashboard'));

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

// 生产环境下如果忘记配置真实 JWT_SECRET，jsonwebtoken 会悄悄用源码里的默认占位密钥签发 token
// ——这个默认值是公开可见的（就写在 src/auth.js 里），任何人拿到它就能伪造任意用户的登录态。
// 只在真正启动监听时校验（而非 auth.js 模块加载时），避免测试环境（不设 NODE_ENV=production）受影响。
function assertProductionSecretsConfigured() {
  if (process.env.NODE_ENV !== 'production') return;
  const DEFAULT_JWT_SECRET = 'dearu-dev-secret-change-in-production';
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    console.error('❌ 拒绝启动：生产环境（NODE_ENV=production）检测到 JWT_SECRET 未设置或仍是默认占位值。');
    console.error('   请在 server/.env 中设置一个随机强密钥后重试（参见 server/.env.example 的说明）。');
    process.exit(1);
  }
}

// 直接运行时才监听端口（被 require 用于测试时不会执行到这里）
if (require.main === module) {
  assertProductionSecretsConfigured();
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`✅ DearU v1 API running on http://localhost:${PORT}`);
    console.log(`📍 API base: http://localhost:${PORT}/api/v1`);
    console.log(`🔧 Dev mode: POST /api/v1/auth/dev-login with { "identity": "creator" | "invitee" | "third-party" }`);
  });
}

module.exports = { createApp };
