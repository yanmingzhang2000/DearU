const api = require('../../services/api');
const auth = require('../../services/auth');
const analytics = require('../../services/analytics');
const roomRoute = require('../../utils/room-route');

Page({
  data: {
    loading: true,
    error: '',
    room: null,
    role: '',
    roleLabel: '',
    statusLabel: '',
    route: '',
    inviteToken: '',
    invitePath: '',
    canSendInvite: false,
    canReady: false,
    canSeal: false,
    canCelebrate: false,
    canComplete: false,
    inviteeReady: false,
    creatorStarted: false,
    inviteeStarted: false,
    creatorCompleted: false,
    inviteeCompleted: false
  },

  onLoad(options) {
    this.roomId = options.roomId || '';
    this.inviteToken = options.token || '';
    wx.showShareMenu({ withShareTicket: false });
    this.loadRoom();
  },

  onShow() {
    if (this.roomId && !this.data.loading) {
      this.loadRoom();
    }
  },

  onShareAppMessage() {
    return {
      title: '和我一起做一块生日蛋糕',
      path: '/pages/room/index?token=' + encodeURIComponent(this.data.inviteToken)
    };
  },

  async loadRoom() {
    this.setData({ loading: true, error: '' });
    try {
      let payload;
      if (this.inviteToken) {
        payload = await api.request('/invites/' + encodeURIComponent(this.inviteToken) + '/enter', {
          method: 'POST'
        });
        this.roomId = payload.room.roomId;
      } else {
        payload = await api.request('/rooms/' + encodeURIComponent(this.roomId));
      }
      this.applyRoom(payload);
    } catch (error) {
      this.setData({ loading: false, room: null, error: error.message || '链接无效' });
    }
  },

  applyRoom(payload) {
    const room = payload.room;
    const celebration = room.celebration || {};
    const role = payload.role || '';
    const status = room.status;
    const inviteToken = payload.inviteToken || this.inviteToken || '';
    this.inviteToken = inviteToken;
    this.setData({
      loading: false,
      error: '',
      room: room,
      role: role,
      roleLabel: roomRoute.roleLabel(role),
      statusLabel: roomRoute.statusLabel(status),
      route: payload.route || room.route || '',
      inviteToken: inviteToken,
      invitePath: inviteToken ? '/pages/room/index?token=' + inviteToken : '',
      canSendInvite: role === 'creator' && status !== 'completed',
      canReady: role === 'invitee' && status === 'collaborating' && !room.inviteeReadyAt,
      canSeal: role === 'creator' && status === 'collaborating' && !!room.inviteeReadyAt,
      canCelebrate: (role === 'creator' || role === 'invitee') && status === 'awaiting',
      canComplete: (role === 'creator' || role === 'invitee') && status === 'awaiting',
      inviteeReady: !!room.inviteeReadyAt,
      creatorStarted: !!celebration.creatorStartedAt,
      inviteeStarted: !!celebration.inviteeStartedAt,
      creatorCompleted: !!celebration.creatorCompletedAt,
      inviteeCompleted: !!celebration.inviteeCompletedAt
    });
  },

  showError(error) {
    this.setData({ loading: false, error: error.message || '操作失败，请稍后重试' });
  },

  async sendInvite() {
    if (!this.data.room) return;
    try {
      const result = await api.request('/rooms/' + this.data.room.roomId + '/invite', {
        method: 'POST',
        data: { channel: 'wechat_session' }
      });
      this.inviteToken = result.invite.token;
      this.setData({ inviteToken: this.inviteToken, invitePath: result.invite.path });
      wx.setClipboardData({ data: result.invite.path });
      wx.showToast({ title: '邀请路径已复制', icon: 'success' });
    } catch (error) {
      this.showError(error);
    }
  },

  async markReady() {
    await this.action('/rooms/' + this.data.room.roomId + '/ready', 'POST', {}, '已记录你的选择');
  },

  async sealRoom() {
    const that = this;
    wx.showModal({
      title: '封装礼盒',
      content: '封装后蛋糕内容将锁定，双方进入等待庆祝。',
      confirmText: '确认封装',
      success: function (result) {
        if (result.confirm) {
          that.action('/rooms/' + that.data.room.roomId + '/seal', 'POST', {}, '已封装，等待庆祝');
        }
      }
    });
  },

  async startCelebration() {
    await this.action('/rooms/' + this.data.room.roomId + '/celebration/start', 'POST', {}, '可以开始庆祝了');
  },

  async completeCelebration() {
    await this.action('/rooms/' + this.data.room.roomId + '/celebration/complete', 'POST', { duration: 0 }, '已记录本次庆祝');
  },

  async action(path, method, data, successMessage) {
    this.setData({ loading: true, error: '' });
    try {
      const payload = await api.request(path, { method: method, data: data });
      this.applyRoom(payload);
      if (successMessage) wx.showToast({ title: successMessage, icon: 'success' });
    } catch (error) {
      this.showError(error);
    }
  },

  copyInvitePath() {
    if (!this.data.invitePath) return;
    wx.setClipboardData({ data: this.data.invitePath });
    wx.showToast({ title: '邀请路径已复制', icon: 'success' });
  },

  reportExpression() {
    if (!this.data.room) return;
    analytics.track('user_expressed', {
      room_id: this.data.room.roomId,
      user_role: this.data.role
    });
    wx.showToast({ title: '谢谢你留下这份甜', icon: 'none' });
  }
});
