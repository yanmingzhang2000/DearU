const express = require('express');
const { nanoid } = require('nanoid');
const { signToken } = require('../auth');
const db = require('../db');
// 引用整个模块对象（而非解构）调用，便于测试用 node:test 的 t.mock.method 替换
// wechatUtil.callCode2Session 的实现；解构出的本地变量绑定在 mock 替换后不会更新。
const wechatUtil = require('../utils/wechat');

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

// POST /auth/wechat-login - 微信登录：code2Session 换 openid，upsert user，签发 JWT
router.post('/wechat-login', async (req, res) => {
  const { code } = req.body || {};
  if (!code) {
    return res.status(400).json({
      error: { code: 'MISSING_CODE', message: '缺少登录凭证 code' }
    });
  }

  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) {
    // 未配置真实小程序主体前，明确告知原因而非伪装成功；devMode 登录不受此限制
    return res.status(501).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: '微信登录暂未配置：请在 server/.env 设置 WX_APPID 和 WX_SECRET 后重试'
      }
    });
  }

  let session;
  try {
    session = await wechatUtil.callCode2Session({ appid, secret, code });
  } catch (err) {
    return res.status(502).json({
      error: { code: 'WECHAT_UNREACHABLE', message: '无法连接微信登录服务，请稍后再试' }
    });
  }

  if (!session || session.errcode) {
    const mapped = wechatUtil.mapWechatError(session && session.errcode, session && session.errmsg);
    return res.status(400).json({ error: mapped });
  }

  const { openid } = session;
  if (!openid) {
    return res.status(502).json({
      error: { code: 'WECHAT_LOGIN_FAILED', message: '微信登录响应异常，请稍后再试' }
    });
  }

  // 按 openid upsert 用户：已存在则复用 user_id，不新建身份
  let user = db.prepare('SELECT user_id, nickname FROM user WHERE wx_openid = ?').get(openid);
  if (!user) {
    const userId = nanoid();
    db.prepare(`
      INSERT INTO user (user_id, wx_openid, nickname) VALUES (?, ?, ?)
    `).run(userId, openid, null);
    user = { user_id: userId, nickname: null };
  }

  const token = signToken({ userId: user.user_id });
  res.json({
    accessToken: token,
    user: { user_id: user.user_id, nickname: user.nickname }
  });
});

module.exports = router;
