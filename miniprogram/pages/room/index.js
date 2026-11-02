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
    situationLabel: '',
    inviteeNickname: '',
    inviteToken: '',
    invitePath: '',
    canSendInvite: false,
    canReady: false,
    canSeal: false,
    canCelebrate: false,
    canComplete: false,
    canEditCake: false,
    inviteeReady: false,
    creatorStarted: false,
    inviteeStarted: false,
    creatorCompleted: false,
    inviteeCompleted: false,
    stickerDrawerVisible: false,
    ritualVisible: false
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
      title: '给你做了个蛋糕，等它到的时候，我们一起吹蜡烛 🎂',
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
    const celebrationConfig = room.celebrationConfig || {};
    this.setData({
      loading: false,
      error: '',
      room: room,
      role: role,
      situationLabel: roomRoute.situationLabel(status),
      inviteeNickname: celebrationConfig.inviteeNickname || '',
      inviteToken: inviteToken,
      invitePath: inviteToken ? '/pages/room/index?token=' + inviteToken : '',
      canSendInvite: role === 'creator' && status !== 'completed',
      canReady: role === 'invitee' && status === 'collaborating' && !room.inviteeReadyAt,
      canSeal: role === 'creator' && status === 'collaborating' && !!room.inviteeReadyAt,
      canCelebrate: (role === 'creator' || role === 'invitee') && status === 'awaiting',
      canComplete: (role === 'creator' || role === 'invitee') && status === 'awaiting',
      canEditCake: (status === 'draft' && role === 'creator') ||
        (status === 'collaborating' && (role === 'creator' || role === 'invitee')),
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
      wx.showToast({ title: '邀请链接已复制', icon: 'success' });
    } catch (error) {
      this.showError(error);
    }
  },

  async markReady() {
    await this.action('/rooms/' + this.data.room.roomId + '/ready', 'POST', {}, '已经记下了你的心意');
  },

  async sealRoom() {
    const that = this;
    wx.showModal({
      title: '封装礼盒',
      content: '封装后蛋糕内容会锁定，你们就可以一起庆祝了。',
      confirmText: '确认封装',
      success: function (result) {
        if (result.confirm) {
          that.action('/rooms/' + that.data.room.roomId + '/seal', 'POST', {}, '封好了，去叫 TA 一起来庆祝吧');
        }
      }
    });
  },

  async startCelebration() {
    // 先告知后端"已开始"（记 started_at），再弹出全屏仪式
    await this.action('/rooms/' + this.data.room.roomId + '/celebration/start', 'POST', {}, '');
    this.setData({ ritualVisible: true });
  },

  async onRitualComplete() {
    // 全屏仪式走完（点烛→唱歌→吹烛→彩带许愿），关闭仪式并上报完成
    this.setData({ ritualVisible: false });
    await this.action('/rooms/' + this.data.room.roomId + '/celebration/complete', 'POST', { duration: 0 }, '已经记下了这次庆祝');
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
    wx.showToast({ title: '邀请链接已复制', icon: 'success' });
  },

  reportExpression() {
    if (!this.data.room) return;
    analytics.track('user_expressed', {
      room_id: this.data.room.roomId,
      user_role: this.data.role
    });
    wx.showToast({ title: '谢谢你留下这份甜', icon: 'none' });
  },

  // ========== 蛋糕编辑器 ==========
  onCakeChange(e) {
    if (!this.data.canEditCake) return;
    const cakeState = e.detail.cakeState;
    this._pendingCakeState = cakeState;
    this._scheduleCakeSave();
  },

  // debounce 保存：避免拖拽/涂鸦每帧都发请求，停手 800ms 后落后端
  _scheduleCakeSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this._saveCakeState();
    }, 800);
  },

  async _saveCakeState() {
    if (!this.data.room || !this._pendingCakeState) return;
    const cakeState = this._pendingCakeState;
    try {
      await api.request('/rooms/' + this.data.room.roomId + '/cake', {
        method: 'PUT',
        data: { cakeState: cakeState }
      });
    } catch (error) {
      // 保存失败不打断编辑体验，只提示，不回滚本地状态
      wx.showToast({ title: '蛋糕没存上，检查一下网络再继续', icon: 'none' });
    }
  },

  openStickerDrawer() {
    if (!this.data.canEditCake) return;
    this.setData({ stickerDrawerVisible: true });
  },

  // 写句祝福：弹出输入框，确认后作为文字图层贴到蛋糕上
  writeBlessing() {
    if (!this.data.canEditCake) return;
    const that = this;
    wx.showModal({
      title: '写句祝福',
      editable: true,
      placeholderText: '写给 TA 的话，会贴在蛋糕上',
      confirmText: '贴上去',
      success(res) {
        if (!res.confirm) return;
        const text = String(res.content || '').trim();
        if (!text) return;
        const editor = that.selectComponent('#cakeEditor');
        if (editor) {
          editor.addText(text);
        }
      }
    });
  },

  // 房主设定寿星昵称（写进歌词第 4 句），失焦时保存
  async onNicknameBlur(e) {
    if (this.data.role !== 'creator' || !this.data.room) return;
    const nickname = String(e.detail.value || '').trim();
    if (nickname === (this.data.inviteeNickname || '')) return;
    try {
      await api.request('/rooms/' + this.data.room.roomId + '/nickname', {
        method: 'PUT',
        data: { nickname: nickname }
      });
      this.setData({ inviteeNickname: nickname });
    } catch (error) {
      wx.showToast({ title: '昵称没存上，检查一下网络', icon: 'none' });
    }
  },

  onStickerDrawerClose() {
    this.setData({ stickerDrawerVisible: false });
  },

  onStickerSelect(e) {
    const stickerType = e.detail.stickerType;
    const editor = this.selectComponent('#cakeEditor');
    if (editor) {
      // 新贴纸放在画布中心
      editor.addSticker(stickerType, 0, 0);
    }
  },

  onUnload() {
    // 页面卸载前确保最后一次编辑被保存（跳过 debounce 等待）
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveCakeState();
    }
  }
});
