const api = require('./api');

function track(eventName, properties) {
  return api.request('/analytics/events', {
    method: 'POST',
    data: {
      eventName: eventName,
      properties: properties || {}
    }
  }).catch(function () {
    // 埋点失败不阻塞仪式主流程。
  });
}

module.exports = {
  track: track
};
