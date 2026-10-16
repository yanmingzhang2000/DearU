const { verifyToken } = require('../auth');
const db = require('../db');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: '请先登录' }
    });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload || !payload.userId) {
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: '登录已失效' }
    });
  }

  // 查询用户是否存在
  const user = db.prepare('SELECT user_id, nickname FROM user WHERE user_id = ?').get(payload.userId);
  if (!user) {
    return res.status(401).json({
      error: { code: 'USER_NOT_FOUND', message: '用户不存在' }
    });
  }

  req.user = user;
  next();
}

module.exports = authMiddleware;
