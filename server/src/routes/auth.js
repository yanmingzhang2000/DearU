const express = require('express');
const { nanoid } = require('nanoid');
const { signToken } = require('../auth');
const db = require('../db');

const router = express.Router();

// POST /auth/dev-login - 开发环境身份模拟登录（v1 验证阶段主力）
router.post('/dev-login', (req, res) => {
  const { identity } = req.body;
  const role = identity || 'creator';
  
  // 按 identity 生成对应的固定 dev user
  const devUsers = {
    creator: { userId: 'dev_creator', nickname: '房主（Dev）', openid: 'wx_dev_creator' },
    invitee: { userId: 'dev_invitee', nickname: '寿星（Dev）', openid: 'wx_dev_invitee' },
    'third-party': { userId: 'dev_third', nickname: '第三人（Dev）', openid: 'wx_dev_third' }
  };

  const user = devUsers[role] || devUsers.creator;

  // Upsert user
  db.prepare(`
    INSERT INTO user (user_id, wx_openid, nickname) 
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname
  `).run(user.userId, user.openid, user.nickname);

  const token = signToken({ userId: user.userId });
  res.json({
    accessToken: token,
    user: { user_id: user.userId, nickname: user.nickname }
  });
});

// POST /auth/wechat-login - 微信登录（占位，待实现）
router.post('/wechat-login', (req, res) => {
  // TODO: 微信登录实现
  // 1. 调用 wx.login() 拿到 code
  // 2. 后端用 appid + secret + code 换 openid (code2Session)
  // 3. 查询/创建 user 记录
  // 4. 签发 JWT token
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: '微信登录暂未配置，请在 project.config.json 配置真实 appid 后实现'
    }
  });
});

module.exports = router;
