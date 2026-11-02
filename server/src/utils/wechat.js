// 微信登录相关的纯逻辑：code2Session 调用 + errcode 映射
// 拆成独立模块（而不是写在 routes/auth.js 里），方便测试直接 mock callCode2Session，
// 不需要污染 Express router 对象或发起真实网络请求（参考 cake-merge.js 的分层方式）

// 微信 errcode -> 对外错误码/文案映射
// 文档：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
// 40029 code 无效 / 40163 code 已被使用（通常是前端重复提交或 code 已过期被消费）/ 45011 频率限制（每用户每分钟 100 次）
const WECHAT_ERRCODE_MAP = {
  40029: { code: 'INVALID_WX_CODE', message: '登录凭证无效，请重新登录' },
  40163: { code: 'INVALID_WX_CODE', message: 'code 已被使用，请重新登录' },
  45011: { code: 'RATE_LIMITED', message: '登录过于频繁，请稍后再试' }
};

/**
 * 将微信 code2Session 返回的 errcode/errmsg 映射为对外一致的错误码结构。
 * 未知 errcode 统一归为 WECHAT_LOGIN_FAILED，不把微信内部错误码直接透传给前端。
 * @param {number} errcode
 * @param {string} errmsg
 * @returns {{ code: string, message: string }}
 */
function mapWechatError(errcode, errmsg) {
  const known = WECHAT_ERRCODE_MAP[errcode];
  if (known) return known;
  return { code: 'WECHAT_LOGIN_FAILED', message: errmsg || '微信登录失败，请稍后再试' };
}

/**
 * 调用微信 code2Session 接口，用小程序登录 code 换取 openid/session_key。
 * appid/secret 从调用方传入（而非在本函数内读 process.env），便于测试注入固定值，
 * 也让"是否已配置真实凭证"的判断留在调用方（routes/auth.js），这里只负责发请求。
 * @param {Object} params
 * @param {string} params.appid
 * @param {string} params.secret
 * @param {string} params.code - wx.login() 拿到的登录凭证
 * @returns {Promise<{openid?: string, session_key?: string, unionid?: string, errcode?: number, errmsg?: string}>}
 */
async function callCode2Session({ appid, secret, code }) {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const response = await fetch(url);
  return response.json();
}

module.exports = { callCode2Session, mapWechatError };
