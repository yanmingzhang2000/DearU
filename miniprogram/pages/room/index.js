const api = require('../../services/api');
const auth = require('../../services/auth');
const analytics = require('../../services/analytics');
const roomRoute = require('../../utils/room-route');
const { shouldPoll, POLL_INTERVAL_MS } = require('../../utils/polling-policy');
const { mergeForDisplay } = require('../../utils/cake-display-merge');
const { SHARE_TITLE_PRESETS, resolveShareImage } = require('../../utils/share-presets');

// 本地存储 key 前缀：按 roomId 区分，换房间不会读到别的房间的文案选择（规格 §3.6 千人千面，
// 本地存储不跨设备，详见 README「分享卡片文案」一节的产品取舍说明）
const SHARE_TITLE_STORAGE_PREFIX = 'dearu_share_title_';

Page({
  data: {
    loading: true,
    error: '',
    room: null,
    role: '',
    situationLabel: '',
    inviteeNickname: '',
    makingPhaseLabel: '',
    inviteToken: '',
    invitePath: '',
    canSendInvite: false,
    canReady: false,
    canSeal: false,
    canCelebrate: false,
    canComplete: false,
    canEditCake: false,
    canEditBaseFlavor: false,
    lockBaseFlavor: false,
    inviteeReady: false,
    creatorStarted: false,
    inviteeStarted: false,
    creatorCompleted: false,
    inviteeCompleted: false,
    stickerDrawerVisible: false,
    ritualVisible: false,
    // v1.1：转盘仪式子状态机相关渲染开关（见 v1.1-转盘仪式与协作合并规格.md 第 1 节）
    canOpenWheel: false,
    wheelRitualVisible: false,
    // 分享卡片文案（规格 §3.5/§3.6）：预设 3 条 + 自定义，仅房主可见可改
    sharePresets: SHARE_TITLE_PRESETS,
    shareTitle: SHARE_TITLE_PRESETS[0],
    shareTitleEditorVisible: false,
    shareTitleDraft: ''
  },

  onLoad(options) {
    this.roomId = options.roomId || '';
    this.inviteToken = options.token || '';
    this._draggingLayerId = null; // 前端内存态，不落库、不提交服务端（规格第 5 节）
    this._shareTitleLoaded = false;
    wx.showShareMenu({ withShareTicket: false });
    this.loadRoom();
  },

  onShow() {
    if (this.roomId && !this.data.loading) {
      this.loadRoom();
    }
  },

  onHide() {
    this._stopPolling();
  },

  onUnload() {
    this._stopPolling();
    // 页面卸载前确保最后一次编辑被保存（跳过 debounce 等待）
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveCakeState();
    }
  },

  onShareAppMessage() {
    const cakeState = (this.data.room && this.data.room.cakeState) || {};
    return {
      title: this.data.shareTitle || SHARE_TITLE_PRESETS[0],
      path: '/pages/room/index?token=' + encodeURIComponent(this.data.inviteToken),
      imageUrl: resolveShareImage(cakeState.style, cakeState.flavor)
    };
  },

  // ========== 分享卡片文案（规格 §3.5/§3.6） ==========
  // 本地存储按 roomId 区分，读取/保存都只影响当前房间，不会跨房间串文案
  _shareTitleStorageKey() {
    return SHARE_TITLE_STORAGE_PREFIX + (this.roomId || '');
  },

  _loadShareTitle() {
    if (!this.roomId) return;
    const saved = wx.getStorageSync(this._shareTitleStorageKey());
    if (saved) {
      this.setData({ shareTitle: saved });
    }
  },

  _saveShareTitle(title) {
    if (!this.roomId) return;
    wx.setStorageSync(this._shareTitleStorageKey(), title);
  },

  openShareTitleEditor() {
    if (this.data.role !== 'creator') return;
    this.setData({ shareTitleEditorVisible: true, shareTitleDraft: this.data.shareTitle });
  },

  closeShareTitleEditor() {
    this.setData({ shareTitleEditorVisible: false });
  },

  // 弹层内容区域的 catchtap 占位：阻止点击内容区域时事件冒泡到遮罩层触发 closeShareTitleEditor
  noop() {},

  selectShareTitlePreset(e) {
    const title = e.currentTarget.dataset.title;
    this.setData({ shareTitle: title, shareTitleEditorVisible: false });
    this._saveShareTitle(title);
  },

  onShareTitleDraftInput(e) {
    this.setData({ shareTitleDraft: e.detail.value });
  },

  confirmShareTitleDraft() {
    const draft = (this.data.shareTitleDraft || '').trim();
    if (!draft) {
      wx.showToast({ title: '文案不能为空', icon: 'none' });
      return;
    }
    this.setData({ shareTitle: draft, shareTitleEditorVisible: false });
    this._saveShareTitle(draft);
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
      this._handleLoadRoomError(error);
    }
  },

  // 验收标准【坏链接容错】（见 亲爱的你-产品规格与版本路线图.md §3.7）：
  // 链接本身已经确定打不开（不存在/已撤销/无权访问），留在当前页面没有意义，
  // 自动退回首页并提示；网络抽风（NETWORK_ERROR）或登录态问题不属于"坏链接"，
  // 保留在当前页展示错误卡片，让用户可以点"重新尝试"，不强行踢回首页。
  _handleLoadRoomError(error) {
    const BAD_LINK_CODES = ['INVALID_LINK', 'ROOM_NOT_FOUND', 'ACCESS_DENIED'];
    const code = error.code || '';
    const message = error.message || '链接无效';

    if (BAD_LINK_CODES.includes(code)) {
      wx.showToast({ title: message || '链接无效', icon: 'none' });
      wx.reLaunch({ url: '/pages/home/index' });
      return;
    }

    this.setData({ loading: false, room: null, error: message });
  },

  applyRoom(payload) {
    const room = payload.room;
    const celebration = room.celebration || {};
    const role = payload.role || '';
    const status = room.status;
    const makingPhase = room.makingPhase || '';
    const inviteToken = payload.inviteToken || this.inviteToken || '';
    this.inviteToken = inviteToken;
    const celebrationConfig = room.celebrationConfig || {};

    const isInvitee = role === 'invitee';
    const isCreator = role === 'creator';

    this.setData({
      loading: false,
      error: '',
      room: room,
      role: role,
      situationLabel: roomRoute.situationLabel(status),
      inviteeNickname: celebrationConfig.inviteeNickname || '',
      makingPhaseLabel: roomRoute.makingPhaseLabel(makingPhase),
      invitePath: inviteToken ? '/pages/room/index?token=' + inviteToken : '',
      canSendInvite: role === 'creator' && status !== 'completed',
      canReady: isInvitee && status === 'collaborating' && !room.inviteeReadyAt,
      canSeal: isCreator && status === 'collaborating' && !!room.inviteeReadyAt,
      canCelebrate: (role === 'creator' || role === 'invitee') && status === 'awaiting',
      canComplete: (role === 'creator' || role === 'invitee') && status === 'awaiting',
      canEditCake: (status === 'draft' && isCreator) ||
        (status === 'collaborating' && (isCreator || isInvitee)),
      // v1.1 第 4.1 节：cake_editing 阶段底胚/口味仅寿星可改；decorating 起任何人不可改
      canEditBaseFlavor: status === 'collaborating' &&
        ((['awaiting_both', 'wheel_ready', 'wheel_playing'].includes(makingPhase) && (isCreator || isInvitee)) ||
          (makingPhase === 'cake_editing' && isInvitee)),
      lockBaseFlavor: status === 'collaborating' && makingPhase === 'decorating',
      // v1.1 第 3 节 F1：仅房主、仅 wheel_ready 可开启转盘
      canOpenWheel: isCreator && status === 'collaborating' && makingPhase === 'wheel_ready',
      inviteeReady: !!room.inviteeReadyAt,
      creatorStarted: !!celebration.creatorStartedAt,
      inviteeStarted: !!celebration.inviteeStartedAt,
      creatorCompleted: !!celebration.creatorCompletedAt,
      inviteeCompleted: !!celebration.inviteeCompletedAt
    });

    this._syncWheelRitual(makingPhase, isInvitee);
    this._syncPolling({ status, makingPhase, inviteeReady: !!room.inviteeReadyAt });

    // 只在拿到 roomId 后第一次加载本地保存的分享文案，避免轮询/重复 applyRoom 时覆盖用户刚选的文案
    if (!this._shareTitleLoaded) {
      this._shareTitleLoaded = true;
      this._loadShareTitle();
    }
  },

  // ========== v1.1 转盘仪式（第 1/2/3 节） ==========
  // wheel_playing 期间展示转盘动画；边界规则 1：任意一方重进/刷新均从转盘①重播，不做本地记忆，
  // 因此这里只看当前 makingPhase 决定展示与否，不读取任何"是否已播过"的持久标记。
  _syncWheelRitual(makingPhase, isInvitee) {
    const shouldShow = makingPhase === 'wheel_playing';
    if (shouldShow === this.data.wheelRitualVisible) return;
    this.setData({ wheelRitualVisible: shouldShow });
    this._isInviteeForWheel = isInvitee;
  },

  async onWheelOpen() {
    // F1：仅房主可调用，开启转盘（wheel_ready -> wheel_playing）
    await this.action('/rooms/' + this.data.room.roomId + '/wheel/start', 'POST', {}, '');
  },

  async onWheelRitualComplete() {
    // 三连转盘播完（前端本地计时触发，双方均会看到这个回调）。
    // 规格第 3 节 F2：仅寿星调用 wheel/complete 推进 making_phase；
    // 房主端绝不自行触发 F2，房主端靠轮询感知状态变化即可（见审核结论第 1 条）。
    if (this.data.role !== 'invitee') return;
    try {
      await this.action('/rooms/' + this.data.room.roomId + '/wheel/complete', 'POST', {}, '');
    } catch (error) {
      // F2 的 20 秒下限保护理论上不会在正常前端时序下触发（转盘动画本身约 18-20s+停留），
      // 若仍然命中（例如系统时钟漂移），保持转盘动画展示，等待下一次轮询/手动刷新再试，不打断用户。
    }
  },

  // ========== v1.1 轮询（第 6 节） ==========
  _syncPolling(state) {
    const shouldPollNow = shouldPoll(state);
    if (shouldPollNow) {
      this._startPolling();
    } else {
      this._stopPolling();
    }
  },

  _startPolling() {
    // 去重：先清掉可能已存在的定时器再设新的，避免 onShow 反复触发导致多个轮询定时器叠加
    this._stopPolling();
    this._pollTimer = setInterval(() => {
      this._pollRoom();
    }, POLL_INTERVAL_MS);
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  async _pollRoom() {
    if (!this.data.room) return;
    try {
      const payload = await api.request('/rooms/' + this.data.room.roomId);
      const remoteRoom = payload.room;
      const localRoom = this.data.room;
      // cakeVersion 是 room 层级字段，不在 cakeState 内部（见 server/src/utils/format.js）
      const cakeUnchanged = remoteRoom.cakeVersion === localRoom.cakeVersion;

      this.applyRoom(payload);

      // cakeVersion 未变化时跳过第 5 节显示侧合并，避免无意义重渲染（规格第 6 节末尾）
      if (cakeUnchanged) return;

      const merged = mergeForDisplay(localRoom.cakeState, remoteRoom.cakeState, this._draggingLayerId);
      this.setData({ 'room.cakeState': merged });
      const editor = this.selectComponent('#cakeEditor');
      if (editor && editor.applyExternalCakeState) {
        editor.applyExternalCakeState(merged);
      }
    } catch (error) {
      // 轮询失败不打断体验，静默忽略，等待下一次轮询
    }
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
    // E6"我选好了"：装饰阶段轮询到此为止的停止信号点（规格第 6 节停止条件）
    await this.action('/rooms/' + this.data.room.roomId + '/ready', 'POST', {}, '已经记下了你的心意');
    this._stopPolling();
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

  onCakeDraggingLayerChange(e) {
    // 前端内存态：记录当前手指正按着的图层 id，供轮询到达时的显示侧合并使用（规格第 5 节）
    // 不提交给服务端，不混进 cakeState 对象字段
    this._draggingLayerId = e.detail.layerId || null;
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
    // 只提交业务字段，不把任何前端内存态字段（如 draggingLayerId）带进请求体
    const { style, flavor, layers } = this._pendingCakeState;
    const cakeState = { style, flavor, layers };
    try {
      const payload = await api.request('/rooms/' + this.data.room.roomId + '/cake', {
        method: 'PUT',
        data: { cakeState: cakeState }
      });
      // 用服务端合并后的权威结果刷新本地（含 cakeVersion、以及可能被字段级权限矫正过的 style/flavor、
      // 或被 4.2 算法补回的对方新增图层），同步进 cake-editor 组件内部状态，不止是页面 data.room
      this.applyRoom(payload);
      const editor = this.selectComponent('#cakeEditor');
      if (editor && editor.applyExternalCakeState) {
        editor.applyExternalCakeState(payload.room.cakeState);
      }
    } catch (error) {
      // 保存失败不打断编辑体验，只提示，不回滚本地状态
      wx.showToast({ title: '蛋糕没存上，检查一下网络再继续', icon: 'none' });
    }
  },

  async onCakeLock() {
    // F3：寿星锁定底胚口味（cake_editing -> decorating）
    await this.action('/rooms/' + this.data.room.roomId + '/cake/lock', 'POST', {}, '已锁定底胚和口味');
  },

  async onDeleteLayer(e) {
    // F4：删除图层走独立接口，PUT 永不处理删除语义（规格第 4.3/10 节）
    const layerId = e.detail.layerId;
    if (!layerId || !this.data.room) return;
    try {
      const payload = await api.request('/rooms/' + this.data.room.roomId + '/cake/layers/' + layerId, {
        method: 'DELETE'
      });
      this.applyRoom(payload);
      // cake-editor 组件的 initialState 只在首次 attached 时读取，之后的 cakeState 变化
      // （包括这次删除后的权威结果）必须显式同步进组件内部状态，否则贴纸视图不会更新
      const editor = this.selectComponent('#cakeEditor');
      if (editor && editor.applyExternalCakeState) {
        editor.applyExternalCakeState(payload.room.cakeState);
      }
    } catch (error) {
      wx.showToast({ title: '删除失败，请稍后重试', icon: 'none' });
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
      // 不传坐标：由编辑器按智能落点落在顶面区域内（P0-2）
      editor.addSticker(stickerType);
    }
  }
});
