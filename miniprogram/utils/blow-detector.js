// 麦克风吹蜡烛检测工具
// 参考调研：wx.getRecorderManager + onFrameRecorded 取 PCM 帧 -> 能量阈值法检测吹气
// 调研结论：无现成"吹蜡烛"开源方案，这是自研部分；必须保留点击兜底（权限拒绝/检测失败时降级）

/**
 * 从 PCM 帧（Int16Array，16位有符号小端）计算 RMS 音量（0~1 归一化）
 * @param {ArrayBuffer} frameBuffer - onFrameRecorded 回调拿到的原始帧数据
 * @returns {number} RMS 音量，0~1
 */
function calculateRMS(frameBuffer) {
  const samples = new Int16Array(frameBuffer);
  if (samples.length === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768; // Int16 范围 -32768~32767，归一化到 -1~1
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / samples.length);
}

/**
 * 吹气检测器：维护滑动窗口音量基线，检测突增判定为"吹气"
 * 简单能量法（调研标注为推荐先用的方案，比频谱法实现成本低）
 */
class BlowDetector {
  /**
   * @param {Object} options
   * @param {number} options.threshold - 触发阈值（相对基线的倍数），默认 2.5
   * @param {number} options.sustainMs - 需维持超阈值的最短时长（ms），默认 200
   * @param {number} options.baselineWindow - 基线滑动窗口大小（帧数），默认 10
   */
  constructor(options = {}) {
    this.threshold = options.threshold || 2.5;
    this.sustainMs = options.sustainMs || 200;
    this.baselineWindow = options.baselineWindow || 10;

    this.recentVolumes = [];
    this.overThresholdSince = null;
  }

  /**
   * 送入一帧音量数据，返回是否判定为"吹气触发"
   * @param {number} rms - 当前帧 RMS 音量（0~1）
   * @param {number} timestamp - 当前时间戳（ms），默认 Date.now()
   * @returns {boolean} 是否触发吹气判定
   */
  feed(rms, timestamp = Date.now()) {
    // 计算基线（最近 N 帧的平均值，不含当前帧，避免基线被当前突增污染）
    const baseline = this.recentVolumes.length > 0
      ? this.recentVolumes.reduce((a, b) => a + b, 0) / this.recentVolumes.length
      : 0.01; // 避免基线为 0 导致任何声音都触发

    const effectiveBaseline = Math.max(baseline, 0.01);
    const isOverThreshold = rms > effectiveBaseline * this.threshold;

    if (isOverThreshold) {
      if (this.overThresholdSince === null) {
        this.overThresholdSince = timestamp;
      }
      const duration = timestamp - this.overThresholdSince;
      if (duration >= this.sustainMs) {
        this._pushBaseline(rms);
        return true;
      }
    } else {
      this.overThresholdSince = null;
      this._pushBaseline(rms);
    }

    return false;
  }

  _pushBaseline(rms) {
    this.recentVolumes.push(rms);
    if (this.recentVolumes.length > this.baselineWindow) {
      this.recentVolumes.shift();
    }
  }

  reset() {
    this.recentVolumes = [];
    this.overThresholdSince = null;
  }
}

module.exports = { calculateRMS, BlowDetector };
