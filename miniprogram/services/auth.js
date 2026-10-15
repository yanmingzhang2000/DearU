const api = require('./api');

function saveSession(payload) {
  const app = getApp();
  app.globalData.session = payload.accessToken;
  app.globalData.user = payload.user;
  wx.setStorageSync('dearu_session', payload);
  return payload;
}

function clearSession() {
  const app = getApp();
  app.globalData.session = null;
  app.globalData.user = null;
  wx.removeStorageSync('dearu_session');
}

function loginDev(identity) {
  return api.request('/auth/dev-login', {
    method: 'POST',
    auth: false,
    data: { identity: identity || 'creator' }
  }).then(saveSession);
}

function loginWechat() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (loginResult) {
        api.request('/auth/wechat-login', {
          method: 'POST',
          auth: false,
          data: { code: loginResult.code }
        }).then(function (payload) {
          resolve(saveSession(payload));
        }).catch(reject);
      },
      fail: reject
    });
  });
}

function ensureSession(identity) {
  const app = getApp();
  if (app.globalData.session && app.globalData.user) {
    return Promise.resolve({
      accessToken: app.globalData.session,
      user: app.globalData.user
    });
  }
  if (app.globalData.devMode) {
    return loginDev(identity || wx.getStorageSync('dearu_dev_identity') || 'creator');
  }
  return loginWechat();
}

function switchIdentity(identity) {
  clearSession();
  wx.setStorageSync('dearu_dev_identity', identity);
  return loginDev(identity);
}

module.exports = {
  ensureSession: ensureSession,
  switchIdentity: switchIdentity,
  clearSession: clearSession
};
