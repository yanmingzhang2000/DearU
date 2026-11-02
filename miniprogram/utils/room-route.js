const STATUS_LABELS = {
  draft: '草稿',
  collaborating: '协作中',
  sealed: '已封装',
  awaiting: '待庆祝',
  completed: '已完成'
};

const ROLE_LABELS = {
  creator: '房主',
  invitee: '寿星'
};

// v1.1：collaborating 状态内部的 making_phase 子阶段文案
const MAKING_PHASE_LABELS = {
  awaiting_both: '等待双方到场',
  wheel_ready: '待开启转盘',
  wheel_playing: '转盘播放中',
  cake_editing: '寿星定底胚口味',
  decorating: '自由装饰中'
};

function statusLabel(status) {
  return STATUS_LABELS[status] || '未知状态';
}

function roleLabel(role) {
  return ROLE_LABELS[role] || '访客';
}

function makingPhaseLabel(makingPhase) {
  return MAKING_PHASE_LABELS[makingPhase] || '';
}

module.exports = {
  statusLabel: statusLabel,
  roleLabel: roleLabel,
  makingPhaseLabel: makingPhaseLabel
};
