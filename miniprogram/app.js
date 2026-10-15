App({
  globalData: {
    // 真机/预览时改为 HTTPS 备案域名；本地开发可使用开发机局域网地址。
    apiBaseUrl: 'http://localhost:3000/api/v1',
    // 仅用于没有真实微信 AppID/后端凭证时的开发工具验证，生产必须关闭。
    devMode: true,
    session: null,
    user: null
  },

  onLaunch() {
    const saved = wx.getStorageSync('dearu_session');
    if (saved && saved.accessToken && saved.user) {
      this.globalData.session = saved.accessToken;
      this.globalData.user = saved.user;
    }
  }
});
