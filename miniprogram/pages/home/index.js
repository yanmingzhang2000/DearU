const api = require('../../services/api');
const auth = require('../../services/auth');

Page({
  data: {
    devMode: false,
    identityIndex: 0,
    identityOptions: ['creator', 'invitee', 'third-party'],
    identityLabels: ['房主（creator）', '寿星（invitee）', '第三人（拒绝访问）'],
    token: '',
    loading: false,
    message: ''
  },

  onLoad() {
    const app = getApp();
    this.setData({
      devMode: !!app.globalData.devMode
    });
  },

  onIdentityChange(event) {
    this.setData({ identityIndex: Number(event.detail.value) });
  },

  onTokenInput(event) {
    this.setData({ token: (event.detail.value || '').trim() });
  },

  currentIdentity() {
    return this.data.identityOptions[this.data.identityIndex];
  },

  ensureLogin() {
    return auth.ensureSession(this.currentIdentity());
  },

  showError(error) {
    this.setData({ message: error.message || '操作失败，请稍后重试' });
  },

  async switchDevIdentity() {
    if (!this.data.devMode) return;
    this.setData({ loading: true, message: '' });
    try {
      await auth.switchIdentity(this.currentIdentity());
      this.setData({ message: '已切换为' + this.data.identityLabels[this.data.identityIndex] });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  async createRoom() {
    this.setData({ loading: true, message: '' });
    try {
      await this.ensureLogin();
      const result = await api.request('/rooms', {
        method: 'POST',
        data: { occasion: 'birthday' }
      });
      await api.request('/rooms/' + result.room.roomId + '/invite', {
        method: 'POST',
        data: { channel: 'wechat_session' }
      });
      wx.redirectTo({
        url: '/pages/room/index?roomId=' + encodeURIComponent(result.room.roomId) + '&token=' + encodeURIComponent(result.invite.token)
      });
    } catch (error) {
      this.showError(error);
      this.setData({ loading: false });
    }
  },

  async enterRoom() {
    if (!this.data.token) {
      this.setData({ message: '请先粘贴邀请 token' });
      return;
    }
    this.setData({ loading: true, message: '' });
    try {
      await this.ensureLogin();
      wx.navigateTo({
        url: '/pages/room/index?token=' + encodeURIComponent(this.data.token)
      });
    } catch (error) {
      this.showError(error);
      this.setData({ loading: false });
    }
  }
});
