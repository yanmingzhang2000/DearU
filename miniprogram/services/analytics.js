const api = require('./api');

// 服务端 POST /analytics/events 期望的 body 是 { events: [{ name, room_id, properties }] }（批量数组），
// 字段名是 name 不是 eventName（见 server/src/routes/analytics.js）。
// track() 对调用方暴露的仍是单事件签名，内部包一层数组，调用方不用感知协议细节。
function track(eventName, properties) {
  const props = properties || {};
  const roomId = props.room_id || null;
  return api.request('/analytics/events', {
    method: 'POST',
    data: {
      events: [
        {
          name: eventName,
          room_id: roomId,
          properties: props
        }
      ]
    }
  }).catch(function () {
    // 埋点失败不阻塞仪式主流程。
  });
}

module.exports = {
  track: track
};
