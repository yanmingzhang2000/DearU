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

function statusLabel(status) {
  return STATUS_LABELS[status] || '未知状态';
}

function roleLabel(role) {
  return ROLE_LABELS[role] || '访客';
}

// 情境标签：用户看到的"你现在在哪"，替代内部状态胶囊（修订版文案 B1）
const SITUATION_LABELS = {
  draft: '正在一起做蛋糕',
  collaborating: '正在一起做蛋糕',
  sealed: '蛋糕做好了，就差一起庆祝',
  awaiting: '蛋糕做好了，就差一起庆祝',
  completed: '这场仪式已完成'
};

function situationLabel(status) {
  return SITUATION_LABELS[status] || '正在一起做蛋糕';
}

module.exports = {
  statusLabel: statusLabel,
  roleLabel: roleLabel,
  situationLabel: situationLabel
};
