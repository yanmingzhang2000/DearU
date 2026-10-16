// 庆祝仪式组件
// 完整状态机：lighting（点蜡烛）→ singing（唱生日歌+歌词高亮）→ blowing（吹蜡烛+麦克风检测）→ wishing（彩带许愿）→ complete
const { FlameRenderer } = require('../../utils/flame-renderer');
const { ConfettiRenderer } = require('../../utils/confetti');
const { DEFAULT_LYRICS, findActiveLyricIndex } = require('../../utils/lyrics-sync');
const { calculateRMS, BlowDetector } = require('../../utils/blow-detector');

Component({
  properties: {
    visible: { type: Boolean, value: false }
  },

  data: {
    stage: 'lighting', // lighting / singing / blowing / wishing / complete
    lyrics: DEFAULT_LYRICS,
    activeLyricIndex: -1,
    blowHintText: '对着麦克风轻轻吹气，吹灭蜡烛',
    candleLit: true,
    candles: [] // [{x, y, lit}, ...]
  },

  lifetimes: {
    ready() {
      this._initCandles();
    }
  },

  observers: {
    'visible': function (nowVisible) {
      if (nowVisible) {
        this._startRitual();
      } else {
        this._cleanup();
      }
    }
  },

  methods: {
    _initCandles() {
      // 固定 3 根蜡烛，居中排列
      this.setData({
        candles: [
          { x: 150, y: 400, lit: true },
          { x: 250, y: 400, lit: true },
          { x: 350, y: 400, lit: true }
        ]
      });
    },

    async _startRitual() {
      this.setData({ stage: 'lighting', activeLyricIndex: -1 });

      // 等待 canvas 节点创建，启动蜡烛渲染循环
      await this._waitFor(100);
      this._setupCandleCanvas();
      this._renderCandleLoop();

      // 2 秒后自动进入 singing 阶段（点烛动画结束）
      setTimeout(() => {
        this.setData({ stage: 'singing' });
        this._playSong();
      }, 2000);
    },

    _waitFor(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    async _setupCandleCanvas() {
      const query = this.createSelectorQuery();
      query.select('#candle-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0]) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);

          this._candleCanvas = canvas;
          this._candleCtx = ctx;
          this._flameRenderer = new FlameRenderer(ctx);
        });
    },

    _renderCandleLoop() {
      if (!this._candleCtx || (this.data.stage !== 'lighting' && this.data.stage !== 'singing' && this.data.stage !== 'blowing')) {
        return;
      }

      const ctx = this._candleCtx;
      const canvas = this._candleCanvas;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      this.data.candles.forEach((candle) => {
        this._flameRenderer.drawCandle(candle.x, candle.y, { lit: candle.lit });
      });

      requestAnimationFrame(() => this._renderCandleLoop());
    },

    onCandleTouch(e) {
      // 点击火焰区域熄灭蜡烛（兜底降级方案）
      const touch = e.touches[0];
      const x = touch.x;
      const y = touch.y;

      let updated = false;
      const candles = this.data.candles.map((candle) => {
        // 简单命中检测：点击蜡烛顶部 50px 圆形区域
        const dx = x - candle.x;
        const dy = y - (candle.y - 30);
        if (candle.lit && dx * dx + dy * dy < 30 * 30) {
          updated = true;
          return { ...candle, lit: false };
        }
        return candle;
      });

      if (updated) {
        this.setData({ candles });
        if (candles.every((c) => !c.lit)) {
          this._onAllCandlesBlown();
        }
      }
    },

    _playSong() {
      // 创建音频播放器，播放生日歌（v1 用占位静音 MP3，正式版替换真实录音）
      this._audio = wx.createInnerAudioContext();
      this._audio.src = '/assets/audio/birthday-song.mp3'; // 占位文件，需手动放置或替换为真实录音
      this._audio.obeyMuteSwitch = false; // iOS 忽略静音键

      this._audio.onTimeUpdate(() => {
        const currentTime = this._audio.currentTime;
        const activeIdx = findActiveLyricIndex(this.data.lyrics, currentTime);
        if (activeIdx !== this.data.activeLyricIndex) {
          this.setData({ activeLyricIndex: activeIdx });
        }
      });

      this._audio.onEnded(() => {
        // 歌曲播放完毕，进入吹蜡烛阶段
        this.setData({ stage: 'blowing' });
        this._startBlowDetection();
      });

      this._audio.onError((err) => {
        console.error('音频播放失败（占位文件不存在或格式错误），3秒后自动跳过', err);
        setTimeout(() => {
          this.setData({ stage: 'blowing' });
          this._startBlowDetection();
        }, 3000);
      });

      this._audio.play();
    },

    async _startBlowDetection() {
      // 尝试启动麦克风检测，拒绝授权或失败时降级为纯点击模式
      try {
        await this._requestRecordPermission();
        this._startMicrophoneMonitor();
      } catch (err) {
        console.warn('麦克风权限拒绝或不可用，降级为点击模式', err);
        this.setData({ blowHintText: '点击火焰熄灭蜡烛' });
      }
    },

    _requestRecordPermission() {
      return new Promise((resolve, reject) => {
        wx.getSetting({
          success: (res) => {
            if (res.authSetting['scope.record']) {
              resolve();
            } else {
              wx.authorize({
                scope: 'scope.record',
                success: resolve,
                fail: reject
              });
            }
          },
          fail: reject
        });
      });
    },

    _startMicrophoneMonitor() {
      this._blowDetector = new BlowDetector({ threshold: 2.5, sustainMs: 200 });
      this._recorderManager = wx.getRecorderManager();

      this._recorderManager.onStart(() => {
        console.log('麦克风监听已启动');
      });

      this._recorderManager.onFrameRecorded((res) => {
        const rms = calculateRMS(res.frameBuffer);
        const triggered = this._blowDetector.feed(rms);
        if (triggered) {
          console.log('检测到吹气，熄灭所有蜡烛');
          this._blowAllCandles();
        }
      });

      this._recorderManager.onError((err) => {
        console.error('录音失败', err);
        this.setData({ blowHintText: '麦克风检测失败，点击火焰熄灭' });
      });

      this._recorderManager.start({
        format: 'PCM',
        sampleRate: 16000,
        numberOfChannels: 1,
        frameSize: 4 // 4KB 帧，约 128ms @ 16kHz
      });
    },

    _blowAllCandles() {
      this.setData({
        candles: this.data.candles.map((c) => ({ ...c, lit: false }))
      });
      this._onAllCandlesBlown();
    },

    _onAllCandlesBlown() {
      // 所有蜡烛熄灭，停止麦克风，播放彩带
      if (this._recorderManager) {
        this._recorderManager.stop();
        this._recorderManager = null;
      }

      setTimeout(() => {
        this.setData({ stage: 'wishing' });
        this._setupConfettiCanvas();
      }, 500);
    },

    async _setupConfettiCanvas() {
      await this._waitFor(100);
      const query = this.createSelectorQuery();
      query.select('#confetti-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0]) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);

          this._confettiCanvas = canvas;
          this._confettiCtx = ctx;
          this._confettiRenderer = new ConfettiRenderer(ctx, res[0].width, res[0].height);

          // 喷发三波彩带
          this._confettiRenderer.burst(100);
          setTimeout(() => this._confettiRenderer.burst(80), 300);
          setTimeout(() => this._confettiRenderer.burst(60), 600);

          this._renderConfettiLoop();
        });
    },

    _renderConfettiLoop() {
      if (!this._confettiRenderer || (this.data.stage !== 'wishing' && this.data.stage !== 'complete')) {
        return;
      }

      this._confettiRenderer.update();

      if (this._confettiRenderer.hasParticles()) {
        requestAnimationFrame(() => this._renderConfettiLoop());
      }
    },

    onRitualComplete() {
      this.triggerEvent('complete');
      this._cleanup();
    },

    _cleanup() {
      if (this._audio) {
        this._audio.stop();
        this._audio.destroy();
        this._audio = null;
      }
      if (this._recorderManager) {
        this._recorderManager.stop();
        this._recorderManager = null;
      }
      if (this._confettiRenderer) {
        this._confettiRenderer.clear();
        this._confettiRenderer = null;
      }
      this.setData({ stage: 'lighting', activeLyricIndex: -1 });
    }
  }
});
