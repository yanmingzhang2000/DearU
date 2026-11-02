// v1.1-转盘仪式与协作合并规格.md 第 6 节：轮询策略
// 抽成纯函数，不依赖 wx/定时器，方便单测覆盖所有子阶段分支

const POLL_INTERVAL_MS = 8000;

/**
 * 判断给定的房间状态下是否应该轮询。
 * @param {Object} params
 * @param {string} params.status - room.status（5 态之一）
 * @param {string} params.makingPhase - room.makingPhase（仅在 collaborating 时有意义）
 * @param {boolean} params.inviteeReady - 是否已触发 E6 invitee_ready（"我选好了"）
 * @returns {boolean}
 */
function shouldPoll({ status, makingPhase, inviteeReady }) {
  if (status !== 'collaborating') {
    // sealed / awaiting / completed：延续 v1 原有手动刷新模式；draft 阶段寿星还没进房，无需轮询
    return false;
  }

  if (inviteeReady) {
    // 寿星已点"我选好了"，装饰阶段轮询到此为止（第 6 节停止条件）
    return false;
  }

  // awaiting_both / wheel_ready / wheel_playing / cake_editing / decorating 均轮询
  return ['awaiting_both', 'wheel_ready', 'wheel_playing', 'cake_editing', 'decorating'].includes(makingPhase);
}

module.exports = { shouldPoll, POLL_INTERVAL_MS };
