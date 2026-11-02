// 转盘仪式组件
// v1.1-转盘仪式与协作合并规格.md 第 1/2/9/10 节
// 三连转盘：①底胚权→寿星 ②口味权→寿星 ③惊喜使命→房主，落点固定非真随机
// 纯 CSS 动画分段切换（参照 celebration-ritual 的"定时器切换 stage"模式，不用 Canvas）
// 边界规则 1：任意一方重新进房/刷新页面，均从转盘①重新播放完整三连动画，不做"已播放过"的本地记忆
// （转盘内容对双方公开，重播无代价，见规格第 10 节）

// 每个转盘的固定文案（v1.1 首版固定第一条，随机抽取排入 P1，见规格第 9/11 节）
const WHEEL_TEXTS = [
  { title: '转盘①·底胚权', result: '今天的蛋糕底胚，由寿星决定' },
  { title: '转盘②·口味权', result: '口味同样由寿星决定' },
  { title: '转盘③·惊喜使命', result: '房主负责用这块蛋糕给寿星制造惊喜' }
];

// 每个转盘播放时长（毫秒），三段加起来控制在 20 秒下限保护之内留有余量，
// 具体数值见规格第 10 节边界规则 2：前端可设计为约 18-20 秒播完，
// 接口侧 20 秒是下限保护，不是精确同步点，不需要和后端强行对齐。
const SPIN_DURATION_MS = 2200; // 转动动画时长
const RESULT_HOLD_MS = 4000; // 落点结果停留时长（含卡片进入 + 阅读停留）

Component({
  properties: {
    visible: { type: Boolean, value: false }
  },

  data: {
    // wheelIndex: 0/1/2 对应转盘①②③；stage: spinning（转动中）/ result（落点结果展示）
    wheelIndex: 0,
    stage: 'spinning',
    currentText: WHEEL_TEXTS[0]
  },

  observers: {
    visible(nowVisible) {
      if (nowVisible) {
        this._startRitual();
      } else {
        this._cleanup();
      }
    }
  },

  methods: {
    _startRitual() {
      this.setData({ wheelIndex: 0, stage: 'spinning', currentText: WHEEL_TEXTS[0] });
      this._playWheel(0);
    },

    _playWheel(index) {
      this.setData({ wheelIndex: index, stage: 'spinning', currentText: WHEEL_TEXTS[index] });

      this._spinTimer = setTimeout(() => {
        this.setData({ stage: 'result' });

        this._holdTimer = setTimeout(() => {
          if (index < WHEEL_TEXTS.length - 1) {
            this._playWheel(index + 1);
          } else {
            // 三个转盘播完，通知父组件（房间页据此调用 F2 wheel/complete，仅寿星端生效）
            this.triggerEvent('complete');
          }
        }, RESULT_HOLD_MS);
      }, SPIN_DURATION_MS);
    },

    _cleanup() {
      if (this._spinTimer) {
        clearTimeout(this._spinTimer);
        this._spinTimer = null;
      }
      if (this._holdTimer) {
        clearTimeout(this._holdTimer);
        this._holdTimer = null;
      }
    }
  },

  lifetimes: {
    detached() {
      this._cleanup();
    }
  }
});
