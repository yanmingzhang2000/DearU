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

module.exports = {
  statusLabel: statusLabel,
  roleLabel: roleLabel
};
