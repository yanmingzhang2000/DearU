// 看板独立鉴权：不走现有用户 JWT 体系（authMiddleware），因为任何已登录的普通用户
// 都不应该能看到全局行为数据和房间汇总指标。改用环境变量配置的管理员密码，
// 前端用 Header `X-Dashboard-Password` 携带，比对失败统一返回 401，不泄露"密码对不对"之外的信息。
//
// 未配置 DASHBOARD_PASSWORD 时直接拒绝所有请求（而不是放行），避免部署时忘记配置导致看板裸奔。

function dashboardAuthMiddleware(req, res, next) {
  const configuredPassword = process.env.DASHBOARD_PASSWORD;
  if (!configuredPassword) {
    return res.status(503).json({
      error: { code: 'DASHBOARD_NOT_CONFIGURED', message: '看板未配置管理员密码，暂不可用' }
    });
  }

  const providedPassword = req.headers['x-dashboard-password'];
  if (!providedPassword || providedPassword !== configuredPassword) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: '密码错误或未提供' }
    });
  }

  next();
}

module.exports = dashboardAuthMiddleware;
