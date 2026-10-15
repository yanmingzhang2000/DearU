function getAppConfig() {
  const app = getApp();
  return app.globalData;
}

function request(path, options) {
  const opts = options || {};
  const config = getAppConfig();
  const headers = Object.assign({
    'content-type': 'application/json'
  }, opts.header || {});

  if (opts.auth !== false && config.session) {
    headers.Authorization = 'Bearer ' + config.session;
  }

  return new Promise(function (resolve, reject) {
    wx.request({
      url: config.apiBaseUrl + path,
      method: opts.method || 'GET',
      data: opts.data,
      header: headers,
      timeout: opts.timeout || 10000,
      success: function (response) {
        const body = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body);
          return;
        }
        const apiError = body.error || {};
        const error = new Error(apiError.message || '请求失败，请稍后重试');
        error.code = apiError.code || 'REQUEST_FAILED';
        error.statusCode = response.statusCode;
        reject(error);
      },
      fail: function (reason) {
        const error = new Error(reason.errMsg || '网络连接失败');
        error.code = 'NETWORK_ERROR';
        reject(error);
      }
    });
  });
}

module.exports = {
  request: request
};
